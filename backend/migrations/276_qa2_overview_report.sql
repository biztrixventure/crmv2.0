-- ============================================================================
-- 276_qa2_overview_report.sql
-- One query behind a QA manager's Overview.
--
-- Every existing report section is computed from qa2_evaluation, and today the
-- department holds 11,234 reviewable calls, 3,399 assignments, 0 completed
-- reviews and 2 scored evaluations. So every chart a manager opens is honestly
-- empty, and an empty chart looks like a broken chart. Nothing is wrong with
-- them — there is simply nothing scored yet.
--
-- What a manager actually needs to see on day one is the PIPELINE: what was
-- captured, what can be handed out, what is with someone, what came back, and
-- whether the audio is there. All of that exists in volume right now.
--
-- Returned as one JSON document rather than six round trips, and grouped in SQL
-- rather than by hauling eleven thousand rows into Node to count them.
--
-- The day key is coalesce(recorded_at, call_at): recorded_at is the dialer's
-- own stamp (mig 275) and call_at is when the CRM heard about the call, which
-- can be days out. Falling back keeps rows with no audio yet in the window
-- instead of silently dropping them.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_qa2_overview(
  p_company_ids uuid[]      DEFAULT NULL,
  p_method_ids  uuid[]      DEFAULT NULL,
  p_from        timestamptz DEFAULT NULL,
  p_to          timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH scoped AS (
  SELECT c.*,
         a.id            AS assignment_id,
         a.assigned_to,
         a.status        AS assignment_status,
         coalesce(c.recorded_at, c.call_at) AS at
    FROM qa2_call c
    LEFT JOIN qa2_assignment a
      ON a.call_id = c.id AND a.calibration_group_id IS NULL
   WHERE c.qa_relevant
     AND c.method_id IS NOT NULL
     AND (p_company_ids IS NULL OR c.company_id = ANY (p_company_ids))
     AND (p_method_ids  IS NULL OR c.method_id  = ANY (p_method_ids))
     AND (p_from IS NULL OR coalesce(c.recorded_at, c.call_at) >= p_from)
     AND (p_to   IS NULL OR coalesce(c.recorded_at, c.call_at) <= p_to)
)
SELECT jsonb_build_object(

  'pipeline', (
    SELECT jsonb_build_object(
      'captured',        count(*),
      'audio_ready',     count(*) FILTER (WHERE recording_state = 'found'),
      'audio_waiting',   count(*) FILTER (WHERE recording_state = 'pending'),
      'audio_missing',   count(*) FILTER (WHERE recording_state = 'missing'),
      'unassigned',      count(*) FILTER (WHERE assignment_id IS NULL OR assigned_to IS NULL),
      'with_reviewer',   count(*) FILTER (WHERE assigned_to IS NOT NULL AND assignment_status = 'pending'),
      'in_review',       count(*) FILTER (WHERE assignment_status = 'in_review'),
      'completed',       count(*) FILTER (WHERE assignment_status IN ('completed','scored')),
      'skipped',         count(*) FILTER (WHERE assignment_status = 'skipped'),
      'both_legs',       count(*) FILTER (WHERE linked_call_id IS NOT NULL)
    ) FROM scoped),

  'by_method', (
    SELECT coalesce(jsonb_agg(x ORDER BY x->>'name'), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'method_id',     m.id,
        'code',          m.code,
        'name',          m.name,
        'captured',      count(*),
        'audio_ready',   count(*) FILTER (WHERE s.recording_state = 'found'),
        'audio_waiting', count(*) FILTER (WHERE s.recording_state = 'pending'),
        'audio_missing', count(*) FILTER (WHERE s.recording_state = 'missing'),
        'unassigned',    count(*) FILTER (WHERE s.assignment_id IS NULL OR s.assigned_to IS NULL),
        'in_flight',     count(*) FILTER (WHERE s.assigned_to IS NOT NULL AND s.assignment_status IN ('pending','in_review')),
        'completed',     count(*) FILTER (WHERE s.assignment_status IN ('completed','scored'))
      ) x
      FROM scoped s JOIN qa2_method m ON m.id = s.method_id
      GROUP BY m.id, m.code, m.name) t),

  'by_company', (
    SELECT coalesce(jsonb_agg(x ORDER BY (x->>'captured')::int DESC), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'company_id',    co.id,
        'name',          co.name,
        'captured',      count(*),
        'audio_ready',   count(*) FILTER (WHERE s.recording_state = 'found'),
        'unassigned',    count(*) FILTER (WHERE s.assignment_id IS NULL OR s.assigned_to IS NULL),
        'in_flight',     count(*) FILTER (WHERE s.assigned_to IS NOT NULL AND s.assignment_status IN ('pending','in_review')),
        'completed',     count(*) FILTER (WHERE s.assignment_status IN ('completed','scored'))
      ) x
      FROM scoped s JOIN companies co ON co.id = s.company_id
      GROUP BY co.id, co.name) t),

  'daily', (
    SELECT coalesce(jsonb_agg(x ORDER BY x->>'date'), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'date',        to_char(s.at, 'YYYY-MM-DD'),
        'captured',    count(*),
        'audio_ready', count(*) FILTER (WHERE s.recording_state = 'found'),
        'assigned',    count(*) FILTER (WHERE s.assigned_to IS NOT NULL),
        'completed',   count(*) FILTER (WHERE s.assignment_status IN ('completed','scored'))
      ) x
      FROM scoped s WHERE s.at IS NOT NULL
      GROUP BY to_char(s.at, 'YYYY-MM-DD')) t),

  -- Who is holding what. Counted from the same scoped set, so it always adds up
  -- to the pipeline above rather than being a separate number from a separate
  -- query that quietly disagrees.
  'team', (
    SELECT coalesce(jsonb_agg(x ORDER BY (x->>'in_flight')::int DESC), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'agent_id',  s.assigned_to,
        'waiting',   count(*) FILTER (WHERE s.assignment_status = 'pending'),
        'in_review', count(*) FILTER (WHERE s.assignment_status = 'in_review'),
        'completed', count(*) FILTER (WHERE s.assignment_status IN ('completed','scored')),
        'skipped',   count(*) FILTER (WHERE s.assignment_status = 'skipped'),
        'in_flight', count(*) FILTER (WHERE s.assignment_status IN ('pending','in_review'))
      ) x
      FROM scoped s WHERE s.assigned_to IS NOT NULL
      GROUP BY s.assigned_to) t)
);
$$;

GRANT EXECUTE ON FUNCTION app_qa2_overview(uuid[], uuid[], timestamptz, timestamptz) TO service_role;
