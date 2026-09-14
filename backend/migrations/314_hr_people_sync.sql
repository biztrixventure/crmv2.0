-- ============================================================================
-- 314_hr_people_sync.sql
--
-- People flow from the CRM into HR on their own.
--
-- Before this, HR and the CRM did not know about each other: 152 people held
-- an active CRM login and 3 of them had an HR record. Every hire, promotion and
-- departure had to be typed twice, and the second copy was simply never made.
--
-- One trigger on user_company_roles does the whole job. That table is the
-- single place every one of the CRM's 9 user-creation paths and 7
-- deactivation paths eventually writes (users.js, bulk upload, invite,
-- companies.js assign/remove, QA assignment, company deactivation, and the
-- auth-user delete that CASCADEs into it). Hooking the table instead of the
-- routes means no existing route changes, and a path added next year is
-- covered without anyone remembering to.
--
--   new active membership  -> an HR employee (if the company's settings say
--                             so), plus a 'joined' row in position history
--   role changed           -> 'role_changed' in position history
--                             (trainee -> fronter shows up here by itself)
--   deactivated / removed  -> an OPEN exit case. HR confirms resigned vs
--                             terminated and the last day. Nothing is ever
--                             terminated automatically: a login switched off
--                             for a week's leave is not a resignation.
--   re-activated           -> 'crm_access_restored', and any open exit case
--                             for that person is dismissed with a note.
--
-- HR-side changes to position / department / status are recorded in the same
-- position history (source = 'hr'), so the history is complete whichever side
-- made the move.
--
-- SAFETY: every trigger body is wrapped in EXCEPTION -> RAISE WARNING. A CRM
-- user write can never fail because the HR side had a problem. The triggers
-- only ever INSERT into HR tables (and dismiss/confirm exit cases); they never
-- touch the row that fired them or its siblings (mig 088/091 lesson).
--
-- SETTINGS are per company and editable in HR -> Settings (hr_settings):
-- auto-enrol on/off, which role levels, the employee-number prefix, whether a
-- deactivation opens an exit case. No row = the defaults (auto-enrol every
-- role, prefix EMP-, exit prompts on).
--
-- Verify after applying:
--   SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_hr_sync_membership','trg_hr_employee_moves');
--   SELECT count(*) FROM hr_position_history;   -- 0 until someone changes
-- ============================================================================

-- -- Settings ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_settings (
  company_id         uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  auto_enroll        boolean NOT NULL DEFAULT true,
  -- NULL or empty = every role level. Otherwise only these custom_roles.level values.
  enroll_role_levels text[],
  employee_no_prefix text NOT NULL DEFAULT 'EMP-' CHECK (length(employee_no_prefix) BETWEEN 1 AND 12),
  exit_prompt        boolean NOT NULL DEFAULT true,
  -- Room for the rules later stages add (attendance, pay) without a migration
  -- per knob. Read through utils/hrSettings.js, which supplies the defaults.
  rules              jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE hr_settings IS
  'Per-company HR settings (mig 314). No row = defaults. Edited in HR -> Settings.';

-- -- Where an employee came from -------------------------------------------------------
ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE hr_employees DROP CONSTRAINT IF EXISTS hr_employees_source_check;
ALTER TABLE hr_employees ADD CONSTRAINT hr_employees_source_check CHECK (source IN ('manual','crm'));

COMMENT ON COLUMN hr_employees.source IS
  'manual = typed in HR; crm = created from a CRM login by fn_hr_enroll_member (mig 314).';

-- -- Position history ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_position_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  event        text NOT NULL CHECK (event IN ('joined','role_changed','position_changed','department_changed',
                                              'left','rejoined','crm_access_removed','crm_access_restored')),
  effective_at timestamptz NOT NULL DEFAULT now(),
  from_value   text,          -- human words: role name, position title, department name, status
  to_value     text,
  from_id      uuid,          -- role_id / position_id / department_id
  to_id        uuid,
  source       text NOT NULL DEFAULT 'crm' CHECK (source IN ('crm','hr')),
  changed_by   uuid,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hrph_employee ON hr_position_history (employee_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS idx_hrph_company  ON hr_position_history (company_id, effective_at DESC);

COMMENT ON TABLE hr_position_history IS
  'Every join, role change, position/department move and departure (mig 314). Fed by triggers on user_company_roles (source crm) and hr_employees (source hr).';

-- -- Exit cases ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_exit_cases (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  user_id             uuid,
  opened_at           timestamptz NOT NULL DEFAULT now(),
  trigger             text NOT NULL CHECK (trigger IN ('crm_deactivated','crm_removed','manual')),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed','dismissed')),
  exit_type           text CHECK (exit_type IN ('resigned','terminated')),
  last_day            date,
  reason              text,
  eligible_for_rehire boolean,
  handled_by          uuid,
  handled_at          timestamptz,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- One open case per person: a second deactivation of the same login is the
-- same departure, not a new one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrexit_open ON hr_exit_cases (employee_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_hrexit_company ON hr_exit_cases (company_id, status, opened_at DESC);

COMMENT ON TABLE hr_exit_cases IS
  'Departures waiting for HR to confirm (mig 314). Opened by a CRM deactivation/removal; closed by HR. Never terminates anyone by itself.';

ALTER TABLE hr_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_position_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_exit_cases       ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hr_settings         FROM anon, authenticated;
REVOKE ALL ON hr_position_history FROM anon, authenticated;
REVOKE ALL ON hr_exit_cases       FROM anon, authenticated;

-- The mig 313 change record covers the two editable tables. Position history
-- IS a history, so it does not need a history of its own.
DROP TRIGGER IF EXISTS trg_module_audit ON hr_settings;
CREATE TRIGGER trg_module_audit AFTER INSERT OR UPDATE OR DELETE ON hr_settings
  FOR EACH ROW EXECUTE FUNCTION fn_module_audit('hr', '');
DROP TRIGGER IF EXISTS trg_module_audit ON hr_exit_cases;
CREATE TRIGGER trg_module_audit AFTER INSERT OR UPDATE OR DELETE ON hr_exit_cases
  FOR EACH ROW EXECUTE FUNCTION fn_module_audit('hr', 'employee_id');

-- -- Helpers ------------------------------------------------------------------------------------
-- The signed-in user behind the current write, when the backend sent one
-- (mig 313 request context). NULL from the SQL editor.
CREATE OR REPLACE FUNCTION fn_request_actor()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $fn$
BEGIN
  RETURN nullif(fn_request_context() ->> 'actor', '')::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$fn$;

-- Create the HR employee for one CRM membership, if the company wants it.
-- Returns the employee id (new or existing), or NULL when settings say no.
CREATE OR REPLACE FUNCTION fn_hr_enroll_member(
  p_company uuid, p_user uuid, p_role uuid, p_at timestamptz, p_by uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_set     hr_settings%ROWTYPE;
  v_level   text;
  v_role    text;
  v_emp     uuid;
  v_first   text;
  v_last    text;
  v_email   text;
  v_prefix  text;
  v_cur     text;
  v_tz      text;
  v_n       integer;
  v_try     integer := 0;
BEGIN
  SELECT * INTO v_set FROM hr_settings WHERE company_id = p_company;
  SELECT level::text, name INTO v_level, v_role FROM custom_roles WHERE id = p_role;

  -- Already known here (a manual record linked earlier, or a rehire): never
  -- create a second one and never change their status -- HR decides that.
  SELECT id INTO v_emp FROM hr_employees WHERE company_id = p_company AND user_id = p_user;
  IF v_emp IS NOT NULL THEN
    RETURN v_emp;
  END IF;

  IF NOT COALESCE(v_set.auto_enroll, true) THEN RETURN NULL; END IF;
  IF v_level IN ('superadmin', 'readonly_admin') THEN RETURN NULL; END IF;
  IF v_set.enroll_role_levels IS NOT NULL AND cardinality(v_set.enroll_role_levels) > 0
     AND NOT (COALESCE(v_level, '') = ANY (v_set.enroll_role_levels)) THEN
    RETURN NULL;
  END IF;

  SELECT first_name, last_name INTO v_first, v_last FROM user_profiles WHERE user_id = p_user;
  SELECT email INTO v_email FROM auth.users WHERE id = p_user;
  SELECT currency, internal_timezone INTO v_cur, v_tz FROM companies WHERE id = p_company;
  v_first  := COALESCE(nullif(btrim(v_first), ''), nullif(split_part(COALESCE(v_email, ''), '@', 1), ''), 'New employee');
  v_prefix := COALESCE(v_set.employee_no_prefix, 'EMP-');

  -- Next number for this prefix. Two enrolments racing for the same number
  -- hit UNIQUE(company_id, employee_no); retry with the next one.
  LOOP
    SELECT COALESCE(max(substr(employee_no, length(v_prefix) + 1)::integer), 0) INTO v_n
      FROM hr_employees
     WHERE company_id = p_company
       AND left(employee_no, length(v_prefix)) = v_prefix
       AND substr(employee_no, length(v_prefix) + 1) ~ '^[0-9]{1,9}$';
    BEGIN
      INSERT INTO hr_employees
        (company_id, user_id, employee_no, first_name, last_name, work_email,
         hire_date, status, source, currency, created_by)
      VALUES
        (p_company, p_user, v_prefix || lpad((v_n + 1 + v_try)::text, 5, '0'), v_first, nullif(btrim(v_last), ''), v_email,
         (COALESCE(p_at, now()) AT TIME ZONE COALESCE(nullif(v_tz, ''), 'UTC'))::date,
         'active', 'crm', COALESCE(v_cur, 'PKR'), COALESCE(p_by, fn_request_actor()))
      RETURNING id INTO v_emp;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- Either the number was taken (retry) or this user got a record from a
      -- concurrent enrolment (stop and use it).
      SELECT id INTO v_emp FROM hr_employees WHERE company_id = p_company AND user_id = p_user;
      IF v_emp IS NOT NULL THEN RETURN v_emp; END IF;
      v_try := v_try + 1;
      IF v_try > 5 THEN RAISE; END IF;
    END;
  END LOOP;

  INSERT INTO hr_position_history (company_id, employee_id, event, effective_at, to_value, to_id, source, changed_by, note)
  VALUES (p_company, v_emp, 'joined', COALESCE(p_at, now()), v_role, p_role, 'crm',
          COALESCE(p_by, fn_request_actor()), 'Added automatically from the CRM login');

  RETURN v_emp;
END;
$fn$;

-- Open (or keep) the exit case for someone whose login went away.
CREATE OR REPLACE FUNCTION fn_hr_open_exit(p_company uuid, p_user uuid, p_trigger text, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_emp    hr_employees%ROWTYPE;
  v_prompt boolean;
BEGIN
  SELECT * INTO v_emp FROM hr_employees WHERE company_id = p_company AND user_id = p_user;
  IF v_emp.id IS NULL THEN RETURN; END IF;

  INSERT INTO hr_position_history (company_id, employee_id, event, source, changed_by, note)
  VALUES (p_company, v_emp.id, 'crm_access_removed', 'crm', fn_request_actor(),
          COALESCE(p_note, CASE p_trigger WHEN 'crm_removed' THEN 'Removed from the company in the CRM'
                                          ELSE 'CRM login switched off' END));

  -- Already gone in HR: nothing left to ask.
  IF v_emp.status IN ('resigned', 'terminated') THEN RETURN; END IF;
  SELECT exit_prompt INTO v_prompt FROM hr_settings WHERE company_id = p_company;
  IF NOT COALESCE(v_prompt, true) THEN RETURN; END IF;

  INSERT INTO hr_exit_cases (company_id, employee_id, user_id, trigger, note)
  VALUES (p_company, v_emp.id, p_user, p_trigger, p_note)
  ON CONFLICT (employee_id) WHERE status = 'open' DO NOTHING;
END;
$fn$;

-- -- The membership trigger ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_hr_sync_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_emp      uuid;
  v_old_role text;
  v_new_role text;
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.is_active THEN
        v_emp := fn_hr_enroll_member(NEW.company_id, NEW.user_id, NEW.role_id, NEW.created_at, NEW.assigned_by);
      END IF;

    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
        -- Moved to another company (superadmin only): a departure here, a join there.
        PERFORM fn_hr_open_exit(OLD.company_id, OLD.user_id, 'crm_removed', 'Moved to another company in the CRM');
        IF NEW.is_active THEN
          v_emp := fn_hr_enroll_member(NEW.company_id, NEW.user_id, NEW.role_id, now(), NULL);
        END IF;
      ELSE
        IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
          SELECT id INTO v_emp FROM hr_employees WHERE company_id = NEW.company_id AND user_id = NEW.user_id;
          IF v_emp IS NULL AND NEW.is_active THEN
            -- Promoted INTO a level the company enrols: they join HR now, but
            -- their start date is still the day their membership began.
            v_emp := fn_hr_enroll_member(NEW.company_id, NEW.user_id, NEW.role_id, NEW.created_at, NULL);
          ELSIF v_emp IS NOT NULL THEN
            SELECT name INTO v_old_role FROM custom_roles WHERE id = OLD.role_id;
            SELECT name INTO v_new_role FROM custom_roles WHERE id = NEW.role_id;
            INSERT INTO hr_position_history
              (company_id, employee_id, event, from_value, to_value, from_id, to_id, source, changed_by)
            VALUES
              (NEW.company_id, v_emp, 'role_changed', v_old_role, v_new_role, OLD.role_id, NEW.role_id, 'crm', fn_request_actor());
          END IF;
        END IF;

        IF OLD.is_active AND NOT NEW.is_active THEN
          PERFORM fn_hr_open_exit(NEW.company_id, NEW.user_id, 'crm_deactivated', NULL);
        ELSIF NOT OLD.is_active AND NEW.is_active THEN
          SELECT id INTO v_emp FROM hr_employees WHERE company_id = NEW.company_id AND user_id = NEW.user_id;
          IF v_emp IS NULL THEN
            v_emp := fn_hr_enroll_member(NEW.company_id, NEW.user_id, NEW.role_id, NEW.created_at, NULL);
          ELSE
            INSERT INTO hr_position_history (company_id, employee_id, event, source, changed_by, note)
            VALUES (NEW.company_id, v_emp, 'crm_access_restored', 'crm', fn_request_actor(), 'CRM login switched back on');
            UPDATE hr_exit_cases
               SET status = 'dismissed', handled_at = now(), handled_by = fn_request_actor(),
                   note = COALESCE(note || ' -- ', '') || 'CRM login switched back on', updated_at = now()
             WHERE employee_id = v_emp AND status = 'open';
          END IF;
        END IF;
      END IF;

    ELSIF TG_OP = 'DELETE' THEN
      -- A company being deleted cascades here with the company row already
      -- gone; its HR rows go with it, so there is nobody to ask about.
      IF EXISTS (SELECT 1 FROM companies WHERE id = OLD.company_id) THEN
        PERFORM fn_hr_open_exit(OLD.company_id, OLD.user_id, 'crm_removed', NULL);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_hr_sync_membership: % -- the CRM change was kept, the HR sync was skipped', SQLERRM;
  END;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_hr_sync_membership ON user_company_roles;
CREATE TRIGGER trg_hr_sync_membership
  AFTER INSERT OR UPDATE OR DELETE ON user_company_roles
  FOR EACH ROW EXECUTE FUNCTION fn_hr_sync_membership();

-- -- HR-side moves ----------------------------------------------------------------------------------
-- Position, department and status changes made IN HR land in the same
-- history. A departure also closes the open exit case, so HR can either use
-- the exit-case screen or simply set the status -- the two never disagree.
CREATE OR REPLACE FUNCTION fn_hr_employee_moves()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_from text;
  v_to   text;
BEGIN
  BEGIN
    IF NEW.position_id IS DISTINCT FROM OLD.position_id THEN
      SELECT title INTO v_from FROM hr_positions WHERE id = OLD.position_id;
      SELECT title INTO v_to   FROM hr_positions WHERE id = NEW.position_id;
      INSERT INTO hr_position_history (company_id, employee_id, event, from_value, to_value, from_id, to_id, source, changed_by)
      VALUES (NEW.company_id, NEW.id, 'position_changed', v_from, v_to, OLD.position_id, NEW.position_id, 'hr', fn_request_actor());
    END IF;

    IF NEW.department_id IS DISTINCT FROM OLD.department_id THEN
      SELECT name INTO v_from FROM hr_departments WHERE id = OLD.department_id;
      SELECT name INTO v_to   FROM hr_departments WHERE id = NEW.department_id;
      INSERT INTO hr_position_history (company_id, employee_id, event, from_value, to_value, from_id, to_id, source, changed_by)
      VALUES (NEW.company_id, NEW.id, 'department_changed', v_from, v_to, OLD.department_id, NEW.department_id, 'hr', fn_request_actor());
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status IN ('resigned', 'terminated') THEN
        INSERT INTO hr_position_history (company_id, employee_id, event, from_value, to_value, effective_at, source, changed_by, note)
        VALUES (NEW.company_id, NEW.id, 'left', OLD.status, NEW.status,
                COALESCE(NEW.termination_date::timestamptz, now()), 'hr', fn_request_actor(),
                CASE WHEN NEW.termination_date IS NOT NULL THEN 'Last day ' || NEW.termination_date::text END);
        UPDATE hr_exit_cases
           SET status = 'confirmed', exit_type = NEW.status, last_day = COALESCE(last_day, NEW.termination_date),
               handled_at = now(), handled_by = fn_request_actor(), updated_at = now()
         WHERE employee_id = NEW.id AND status = 'open';
      ELSIF OLD.status IN ('resigned', 'terminated') THEN
        INSERT INTO hr_position_history (company_id, employee_id, event, from_value, to_value, source, changed_by)
        VALUES (NEW.company_id, NEW.id, 'rejoined', OLD.status, NEW.status, 'hr', fn_request_actor());
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_hr_employee_moves: % -- the change was kept, position history skipped', SQLERRM;
  END;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_hr_employee_moves ON hr_employees;
CREATE TRIGGER trg_hr_employee_moves
  AFTER UPDATE OF position_id, department_id, status ON hr_employees
  FOR EACH ROW EXECUTE FUNCTION fn_hr_employee_moves();

-- -- Enrol the people who are already here -------------------------------------------------------------
-- Preview (p_apply = false) or do it. One row per active member without an HR
-- record, saying what happened. The route (GET/POST /hr/people/sync) wraps it.
CREATE OR REPLACE FUNCTION fn_hr_enroll_missing(p_company uuid, p_apply boolean)
RETURNS TABLE (user_id uuid, full_name text, role_name text, role_level text, member_since timestamptz, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r      record;
  v_set  hr_settings%ROWTYPE;
  v_emp  uuid;
BEGIN
  SELECT * INTO v_set FROM hr_settings WHERE company_id = p_company;
  FOR r IN
    SELECT ucr.user_id AS uid, ucr.role_id, ucr.created_at, cr.name AS rname, cr.level::text AS rlevel,
           btrim(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')) AS fname
      FROM user_company_roles ucr
      JOIN custom_roles cr ON cr.id = ucr.role_id
      LEFT JOIN user_profiles up ON up.user_id = ucr.user_id
     WHERE ucr.company_id = p_company
       AND ucr.is_active
       AND NOT EXISTS (SELECT 1 FROM hr_employees e WHERE e.company_id = p_company AND e.user_id = ucr.user_id)
     ORDER BY ucr.created_at
  LOOP
    user_id := r.uid; full_name := nullif(r.fname, ''); role_name := r.rname;
    role_level := r.rlevel; member_since := r.created_at;
    IF NOT COALESCE(v_set.auto_enroll, true) THEN
      action := 'auto_enroll_off';
    ELSIF r.rlevel IN ('superadmin', 'readonly_admin') THEN
      action := 'not_staff';
    ELSIF v_set.enroll_role_levels IS NOT NULL AND cardinality(v_set.enroll_role_levels) > 0
          AND NOT (r.rlevel = ANY (v_set.enroll_role_levels)) THEN
      action := 'role_not_enrolled';
    ELSIF p_apply THEN
      v_emp := fn_hr_enroll_member(p_company, r.uid, r.role_id, r.created_at, fn_request_actor());
      action := CASE WHEN v_emp IS NULL THEN 'skipped' ELSE 'created' END;
    ELSE
      action := 'will_create';
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION fn_hr_enroll_missing(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_hr_enroll_missing(uuid, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_hr_enroll_missing(uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION fn_hr_enroll_member(uuid, uuid, uuid, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_hr_enroll_member(uuid, uuid, uuid, timestamptz, uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION fn_hr_open_exit(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_hr_open_exit(uuid, uuid, text, text) FROM anon, authenticated;

-- -- Trainees are employees too ------------------------------------------------------------------------
-- A trainee is paid, takes leave and has attendance from day one. They get the
-- same self-service rights every floor role already has (mig 290): their own
-- payslips, leave, attendance and expense claims -- nothing about anyone else.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM custom_roles r
  JOIN permissions  p ON p.name IN ('accounting.expenses.submit', 'hr.attendance.view_own',
                                    'hr.leave.request', 'hr.payroll.view_own', 'hr.reviews.participate')
 WHERE r.level::text = 'trainee'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- -- Settings rows are keyed by company, not id ------------------------------------------------------------
-- hr_settings has no id / user_id column, so mig 313's fn_module_audit found no
-- record key and skipped it -- a settings change would have gone unrecorded.
-- Fall back to company_id as the record key (applied as 314c; body otherwise
-- identical to mig 313, plus updated_by as an INSERT attribution column).
CREATE OR REPLACE FUNCTION fn_module_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_module text := TG_ARGV[0]; v_parent_c text := nullif(TG_ARGV[1], '');
  v_old jsonb; v_new jsonb; v_row jsonb; v_diff jsonb := '{}'::jsonb; v_changes jsonb; v_key text;
  v_ctx jsonb; v_actor uuid; v_reason text; v_source text; v_record uuid; v_parent uuid; v_company uuid; v_col text;
BEGIN
  BEGIN
    IF TG_OP IN ('UPDATE','DELETE') THEN v_old := to_jsonb(OLD); END IF;
    IF TG_OP IN ('INSERT','UPDATE') THEN v_new := to_jsonb(NEW); END IF;
    v_row := COALESCE(v_new, v_old);
    IF TG_OP = 'UPDATE' THEN
      FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
        CONTINUE WHEN v_key = 'updated_at';
        IF (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
          v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
        END IF;
      END LOOP;
      IF v_diff = '{}'::jsonb THEN RETURN NULL; END IF;
      v_changes := v_diff;
    ELSE
      v_changes := jsonb_build_object('snapshot', v_row);
    END IF;
    v_ctx := fn_request_context();
    v_source := left(COALESCE(nullif(v_ctx ->> 'source', ''), v_ctx ->> 'via', 'sql'), 60);
    BEGIN v_actor := nullif(v_ctx ->> 'actor', '')::uuid; EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;
    IF v_actor IS NULL AND TG_OP = 'INSERT' THEN
      FOREACH v_col IN ARRAY ARRAY['created_by','recorded_by','submitted_by','requested_by','assigned_by','designated_by','posted_by','updated_by'] LOOP
        BEGIN v_actor := nullif(v_row ->> v_col, '')::uuid; EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;
        EXIT WHEN v_actor IS NOT NULL;
      END LOOP;
    END IF;
    IF nullif(v_ctx ->> 'reason_b64', '') IS NOT NULL THEN
      BEGIN v_reason := left(convert_from(decode(v_ctx ->> 'reason_b64', 'base64'), 'UTF8'), 1000);
      EXCEPTION WHEN OTHERS THEN v_reason := NULL; END;
    END IF;
    BEGIN
      v_record := COALESCE(nullif(v_row ->> 'id', ''), nullif(v_row ->> 'user_id', ''), nullif(v_row ->> 'company_id', ''))::uuid;
    EXCEPTION WHEN OTHERS THEN v_record := NULL; END;
    IF v_record IS NULL THEN RETURN NULL; END IF;
    BEGIN v_company := nullif(v_row ->> 'company_id', '')::uuid; EXCEPTION WHEN OTHERS THEN v_company := NULL; END;
    IF v_parent_c IS NOT NULL THEN
      BEGIN v_parent := nullif(v_row ->> v_parent_c, '')::uuid; EXCEPTION WHEN OTHERS THEN v_parent := NULL; END;
    END IF;
    INSERT INTO module_audit_log (module, company_id, table_name, record_id, parent_id, operation, changes, changed_by, reason, source)
    VALUES (v_module, v_company, TG_TABLE_NAME, v_record, v_parent, TG_OP, v_changes, v_actor, v_reason, v_source);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_module_audit(%): % -- change kept, history row skipped', TG_TABLE_NAME, SQLERRM;
  END;
  RETURN NULL;
END;
$fn$;

INSERT INTO schema_migrations (filename, note)
VALUES ('314_hr_people_sync.sql',
        'CRM memberships sync into HR: auto-enrol, position history, exit cases (never auto-terminate); hr_settings per company; trainee self-service grants')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
