-- ============================================================================
-- 316_hr_attendance_sync.sql -- attendance from the dialer (stage 4).
--
-- Every agent's SHIFT DAY on the dialer (first call, last call, number of
-- calls, talk time) becomes one hr_attendance row. Per-company rules
-- (hr_settings.rules.attendance) decide late / half day / absent; approved
-- leave and company holidays fill the days nobody dialed; and a person's own
-- correction always wins -- the job only ever rewrites rows it wrote itself.
--
-- Why a SHIFT day and not a calendar day: the floor works US hours from
-- Pakistan, ~20:00 -> ~05:00 PKT (measured 2026-09: median first call 20:18,
-- median last 04:52). Grouping by calendar date splits every shift in two. A
-- shift day runs from `day_starts_at` (default 12:00 local) to the same time
-- next day, so a 20:00 -> 05:00 shift is ONE day, dated the evening it began.
--
-- Rules (all editable in HR -> Settings; defaults below are the ONE place
-- they live in SQL, mirrored by ATTENDANCE_DEFAULTS in utils/hrSettings.js):
--   auto                  true       run the sync for this company at all
--   timezone              Asia/Karachi
--   day_starts_at         12:00      shift-day boundary
--   shift_start           (not set)  "on time" reference for late. NOT SET =
--                                    lateness is not judged at all. A first call
--                                    lands minutes after login, and measured
--                                    starts differ by company (20:13 .. 22:08),
--                                    so nobody is marked late against a guess --
--                                    HR -> Settings suggests the measured time.
--   late_after_minutes    15         grace before a start counts as late
--   half_day_below_hours  4          first->last call shorter than this = half day
--   work_days             [1..6]     ISO weekdays that are working days (Mon-Sat)
--   absent_for            dialer_agents | everyone | none
--                                    who gets an "absent" on a working day with
--                                    no calls, no leave and no holiday.
--                                    dialer_agents = people who REGULARLY work
--                                    the phones: calls on at least `regular_days`
--                                    shift days in the 30 before (316d -- one
--                                    call by a manager once made them "expected"
--                                    every day after; 329 of 1,172 absences).
--   regular_days          3          see above
-- ============================================================================

-- 1. Who wrote each day ----------------------------------------------------------
--    manual  = typed or corrected by HR / a manager      (never touched by the job)
--    self    = the person's own check-in                  (never touched by the job)
--    dialer  = worked out from the dialer (or an absence the job marked)
--    leave   = an approved leave request covers the day
--    holiday = a company holiday
ALTER TABLE hr_attendance ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE hr_attendance DROP CONSTRAINT IF EXISTS hr_attendance_source_check;
ALTER TABLE hr_attendance ADD CONSTRAINT hr_attendance_source_check
  CHECK (source IN ('manual', 'self', 'dialer', 'leave', 'holiday'));
ALTER TABLE hr_attendance ADD COLUMN IF NOT EXISTS calls        integer;
ALTER TABLE hr_attendance ADD COLUMN IF NOT EXISTS talk_seconds integer;
ALTER TABLE hr_attendance ADD COLUMN IF NOT EXISTS late_minutes integer;
ALTER TABLE hr_attendance ADD COLUMN IF NOT EXISTS synced_at    timestamptz;
COMMENT ON COLUMN hr_attendance.source IS
  'Who wrote the day: manual/self (never overwritten) or dialer/leave/holiday (fn_hr_attendance_sync, mig 316).';

-- 2. The first shift day a person dialed. Makes "absent" mean something: only
--    people who actually work the phones are expected on them.
ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS dialer_since date;

-- 3. Company holidays -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_holidays (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name         text NOT NULL,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, holiday_date)
);
ALTER TABLE hr_holidays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hr_holidays FROM anon, authenticated;
GRANT ALL ON hr_holidays TO service_role;

DROP TRIGGER IF EXISTS trg_module_audit ON hr_holidays;
CREATE TRIGGER trg_module_audit AFTER INSERT OR UPDATE OR DELETE ON hr_holidays
  FOR EACH ROW EXECUTE FUNCTION fn_module_audit('hr', '');

-- 4. The sync ---------------------------------------------------------------------
-- One company, one date range (shift days). Set-based: one UPDATE for
-- dialer_since, then one statement that upserts every wanted day and removes
-- auto rows that are no longer wanted (a holiday deleted, leave cancelled, a
-- rule changed). Rows are only written when something actually changed, so a
-- re-run is a no-op and the change log (mig 313) is not flooded.
CREATE OR REPLACE FUNCTION fn_hr_attendance_sync(p_company uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  cfg      jsonb := COALESCE((SELECT rules -> 'attendance' FROM hr_settings WHERE company_id = p_company), '{}'::jsonb);
  v_tz     text;
  v_cut    interval;
  v_start  interval;
  v_grace  int;
  v_half   numeric;
  v_days   int[];
  v_absent text;
  v_regular int;
  v_today  date;
  v_since  int := 0;
  v_ins    int := 0;
  v_upd    int := 0;
  v_del    int := 0;
BEGIN
  IF p_company IS NULL OR p_from IS NULL OR p_to IS NULL THEN RAISE EXCEPTION 'company and dates are required'; END IF;
  IF p_to < p_from THEN RAISE EXCEPTION 'The date range is backwards'; END IF;
  IF p_to - p_from > 62 THEN RAISE EXCEPTION 'At most 62 days per run -- split a longer backfill'; END IF;
  IF COALESCE((cfg ->> 'auto')::boolean, true) = false THEN
    RETURN jsonb_build_object('skipped', 'Automatic attendance is switched off for this company');
  END IF;

  v_tz     := COALESCE(NULLIF(cfg ->> 'timezone', ''), 'Asia/Karachi');
  v_cut    := COALESCE(NULLIF(cfg ->> 'day_starts_at', '')::time, '12:00'::time) - '00:00'::time;
  v_start  := NULLIF(cfg ->> 'shift_start', '')::time - '00:00'::time;   -- NULL = lateness not judged
  v_grace  := COALESCE(NULLIF(cfg ->> 'late_after_minutes', '')::int, 15);
  v_half   := COALESCE(NULLIF(cfg ->> 'half_day_below_hours', '')::numeric, 4);
  v_days   := COALESCE((SELECT array_agg(x::int) FROM jsonb_array_elements_text(cfg -> 'work_days') x), '{1,2,3,4,5,6}'::int[]);
  v_absent := COALESCE(NULLIF(cfg ->> 'absent_for', ''), 'dialer_agents');
  v_regular := GREATEST(1, COALESCE(NULLIF(cfg ->> 'regular_days', '')::int, 3));
  -- The shift day still in progress: never judged absent or half-day yet.
  v_today  := ((now() AT TIME ZONE v_tz) - v_cut)::date;

  -- dialer_since: earliest shift day seen for each person (only moves earlier).
  WITH emp AS (
    SELECT id, user_id FROM hr_employees WHERE company_id = p_company AND user_id IS NOT NULL
  ), first_day AS (
    SELECT e.id, min(((q.call_at AT TIME ZONE v_tz) - v_cut)::date) AS d
      FROM qa2_call q JOIN emp e ON e.user_id = q.agent_user_id
     WHERE q.call_at >= ((p_from + v_cut) AT TIME ZONE v_tz)
       AND q.call_at <  (((p_to + 1) + v_cut) AT TIME ZONE v_tz)
     GROUP BY e.id
  )
  UPDATE hr_employees h SET dialer_since = f.d
    FROM first_day f
   WHERE h.id = f.id AND (h.dialer_since IS NULL OR h.dialer_since > f.d);
  GET DIAGNOSTICS v_since = ROW_COUNT;

  WITH emp AS (
    SELECT id, user_id, status, hire_date, termination_date, dialer_since
      FROM hr_employees WHERE company_id = p_company AND user_id IS NOT NULL
  ), wide AS (
    -- Per person per shift day, from 30 days before the range (the "works the
    -- phones regularly" look-back) to its end.
    SELECT e.id AS employee_id, ((q.call_at AT TIME ZONE v_tz) - v_cut)::date AS d,
           count(*)::int AS n, COALESCE(sum(q.talk_sec), 0)::int AS talk,
           min(q.call_at) AS f, max(q.call_at) AS l
      FROM qa2_call q JOIN emp e ON e.user_id = q.agent_user_id
     WHERE q.call_at >= (((p_from - 30) + v_cut) AT TIME ZONE v_tz)
       AND q.call_at <  (((p_to + 1) + v_cut) AT TIME ZONE v_tz)
     GROUP BY 1, 2
  ), calls AS (
    SELECT * FROM wide WHERE d BETWEEN p_from AND p_to
  ), grid AS (
    SELECT e.id AS employee_id, gs::date AS d, e.status, e.dialer_since,
           (extract(isodow FROM gs)::int = ANY (v_days)) AS workday
      FROM emp e CROSS JOIN generate_series(p_from, p_to, interval '1 day') gs
     WHERE (e.hire_date IS NULL OR gs::date >= e.hire_date)
       AND (e.termination_date IS NULL OR gs::date <= e.termination_date)
  ), on_leave AS (
    SELECT DISTINCT g.employee_id, g.d
      FROM grid g JOIN hr_leave_requests r
        ON r.employee_id = g.employee_id AND r.company_id = p_company
       AND r.status = 'approved' AND g.d BETWEEN r.start_date AND r.end_date
  ), hol AS (
    SELECT holiday_date AS d, name FROM hr_holidays
     WHERE company_id = p_company AND holiday_date BETWEEN p_from AND p_to
  ), judged AS (
    SELECT g.employee_id, g.d, g.workday, g.status AS emp_status, g.dialer_since,
           c.n, c.talk, c.f, c.l, h.name AS holiday_name,
           (lv.employee_id IS NOT NULL) AS leave_day,
           CASE WHEN v_start IS NOT NULL THEN ((g.d + v_start) AT TIME ZONE v_tz) END AS due_at,
           -- expected on the phones that day?
           (CASE v_absent
              WHEN 'everyone'      THEN g.status = 'active'
              WHEN 'dialer_agents' THEN g.status = 'active'
                AND (SELECT count(*) FROM wide w2
                      WHERE w2.employee_id = g.employee_id AND w2.d BETWEEN g.d - 30 AND g.d - 1) >= v_regular
              ELSE false END) AS expected
      FROM grid g
      LEFT JOIN calls c     ON c.employee_id = g.employee_id AND c.d = g.d
      LEFT JOIN on_leave lv ON lv.employee_id = g.employee_id AND lv.d = g.d
      LEFT JOIN hol h       ON h.d = g.d
  ), wanted AS (
    SELECT j.employee_id, j.d,
           CASE WHEN j.n IS NOT NULL THEN 'dialer'
                WHEN j.leave_day     THEN 'leave'
                WHEN j.holiday_name IS NOT NULL THEN 'holiday'
                ELSE 'dialer' END AS source,
           CASE WHEN j.n IS NOT NULL THEN
                  CASE WHEN j.d < v_today AND extract(epoch FROM (j.l - j.f)) / 3600.0 < v_half THEN 'half_day'
                       WHEN j.due_at IS NOT NULL AND j.f > j.due_at + make_interval(mins => v_grace) THEN 'late'
                       ELSE 'present' END
                WHEN j.leave_day THEN 'on_leave'
                WHEN j.holiday_name IS NOT NULL THEN 'holiday'
                ELSE 'absent' END AS status,
           j.f, j.l, j.n, j.talk,
           CASE WHEN j.n IS NOT NULL AND j.due_at IS NOT NULL THEN
                  GREATEST(0, floor(extract(epoch FROM (j.f - j.due_at)) / 60))::int END AS late_min,
           CASE WHEN j.n IS NULL AND NOT j.leave_day AND j.holiday_name IS NOT NULL THEN j.holiday_name END AS note
      FROM judged j
     WHERE j.n IS NOT NULL                                      -- dialed: always a row
        OR (j.leave_day AND j.workday)                          -- approved leave on a working day
        OR (j.holiday_name IS NOT NULL AND j.workday AND j.expected)
        OR (j.workday AND j.expected AND j.d < v_today)         -- absent (day is over)
  ), removed AS (
    DELETE FROM hr_attendance a
     WHERE a.company_id = p_company AND a.work_date BETWEEN p_from AND p_to
       AND a.source IN ('dialer', 'leave', 'holiday')
       AND NOT EXISTS (SELECT 1 FROM wanted w WHERE w.employee_id = a.employee_id AND w.d = a.work_date)
    RETURNING 1
  ), written AS (
    INSERT INTO hr_attendance AS a
      (company_id, employee_id, work_date, check_in, check_out, hours_worked, status, note,
       source, calls, talk_seconds, late_minutes, synced_at, updated_at)
    SELECT p_company, w.employee_id, w.d, w.f, w.l,
           CASE WHEN w.f IS NOT NULL THEN round((extract(epoch FROM (w.l - w.f)) / 3600.0)::numeric, 2) END,
           w.status, w.note, w.source, w.n, w.talk, w.late_min, now(), now()
      FROM wanted w
    -- note: the sync owns only the holiday name. A note a person added to an
    -- automatic day ("doctor's appointment") survives every re-sync.
    ON CONFLICT (company_id, employee_id, work_date) DO UPDATE SET
           check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out,
           hours_worked = EXCLUDED.hours_worked, status = EXCLUDED.status,
           note = CASE WHEN EXCLUDED.source = 'holiday' THEN EXCLUDED.note
                       WHEN a.source = 'holiday' THEN NULL
                       ELSE a.note END,
           source = EXCLUDED.source, calls = EXCLUDED.calls, talk_seconds = EXCLUDED.talk_seconds,
           late_minutes = EXCLUDED.late_minutes, synced_at = now(), updated_at = now()
     WHERE a.source IN ('dialer', 'leave', 'holiday')          -- a person's correction always wins
       AND ((a.status, a.check_in, a.check_out, a.calls, a.talk_seconds, a.late_minutes, a.source)
            IS DISTINCT FROM
            (EXCLUDED.status, EXCLUDED.check_in, EXCLUDED.check_out, EXCLUDED.calls,
             EXCLUDED.talk_seconds, EXCLUDED.late_minutes, EXCLUDED.source)
            OR (EXCLUDED.source = 'holiday' AND a.note IS DISTINCT FROM EXCLUDED.note))
    RETURNING (xmax = 0) AS inserted
  )
  SELECT (SELECT count(*) FROM removed),
         (SELECT count(*) FILTER (WHERE inserted) FROM written),
         (SELECT count(*) FILTER (WHERE NOT inserted) FROM written)
    INTO v_del, v_ins, v_upd;

  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'inserted', v_ins, 'updated', v_upd,
                            'removed', v_del, 'dialer_since_set', v_since, 'shift_day_in_progress', v_today);
END;
$fn$;

REVOKE ALL ON FUNCTION fn_hr_attendance_sync(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_hr_attendance_sync(uuid, date, date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_hr_attendance_sync(uuid, date, date) TO service_role;

-- 5. What the floor actually does -- read-only, for the settings screen.
-- Median and 25th-percentile first call of a shift day, and the average
-- first->last span, over the last p_days. Shown next to "shift start" so the
-- number HR types is grounded in the company's own data.
CREATE OR REPLACE FUNCTION fn_hr_attendance_typical(p_company uuid, p_days int DEFAULT 14)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  cfg   jsonb := COALESCE((SELECT rules -> 'attendance' FROM hr_settings WHERE company_id = p_company), '{}'::jsonb);
  v_tz  text := COALESCE(NULLIF(cfg ->> 'timezone', ''), 'Asia/Karachi');
  v_cut interval := COALESCE(NULLIF(cfg ->> 'day_starts_at', '')::time, '12:00'::time) - '00:00'::time;
  out   jsonb;
BEGIN
  WITH d AS (
    SELECT e.id, ((q.call_at AT TIME ZONE v_tz) - v_cut)::date AS day,
           min(q.call_at) AS f, max(q.call_at) AS l
      FROM qa2_call q JOIN hr_employees e ON e.user_id = q.agent_user_id AND e.company_id = p_company
     WHERE q.call_at > now() - make_interval(days => GREATEST(1, LEAST(p_days, 60)))
     GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
           'shift_days', count(*),
           'people', count(DISTINCT id),
           -- times are taken in "shift clock" (minus the day boundary) so a
           -- 20:00 start and a 00:30 start sort in shift order, then shifted back.
           'median_first_call', to_char(percentile_disc(0.5)  WITHIN GROUP (ORDER BY ((f AT TIME ZONE v_tz) - v_cut)::time) + v_cut, 'HH24:MI'),
           'early_first_call',  to_char(percentile_disc(0.25) WITHIN GROUP (ORDER BY ((f AT TIME ZONE v_tz) - v_cut)::time) + v_cut, 'HH24:MI'),
           'median_last_call',  to_char(percentile_disc(0.5)  WITHIN GROUP (ORDER BY ((l AT TIME ZONE v_tz) - v_cut)::time) + v_cut, 'HH24:MI'),
           'avg_span_hours', round(avg(extract(epoch FROM (l - f)) / 3600.0)::numeric, 1))
    INTO out FROM d;
  RETURN out;
END;
$fn$;

REVOKE ALL ON FUNCTION fn_hr_attendance_typical(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_hr_attendance_typical(uuid, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_hr_attendance_typical(uuid, int) TO service_role;
