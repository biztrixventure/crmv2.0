-- ============================================================================
-- 273_qa2_assign_workbench.sql
-- Two read helpers behind the QA manager's assignment workbench.
--
-- "How much work is waiting for method X" and "give me the next N calls of
-- method X nobody owns" are both an anti-join between qa2_call and
-- qa2_assignment. Through PostgREST that is several round trips and a client
-- side merge per method per agent; as SQL it is one statement each.
--
-- A call is assignable when it is qa_relevant, carries a method, and either has
-- no assignment row at all or has one nobody has claimed (the auto-assign pool
-- writes those). Pushing a pool row to an agent is a legitimate assignment, so
-- it must be visible here — it is not a second, conflicting row.
-- Calibration assignments are excluded throughout: mig 236's partial unique
-- index deliberately allows a second row per call for calibration, and that
-- row is not the review queue.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_qa2_assign_pool(
  p_company_ids      uuid[]      DEFAULT NULL,
  p_method_ids       uuid[]      DEFAULT NULL,
  p_from             timestamptz DEFAULT NULL,
  p_to               timestamptz DEFAULT NULL,
  p_require_recording boolean    DEFAULT true,
  p_min_talk         int         DEFAULT 0
)
RETURNS TABLE(method_id uuid, available bigint, with_recording bigint, awaiting_audio bigint, total bigint)
LANGUAGE sql STABLE AS $$
  SELECT c.method_id,
         count(*) FILTER (
           WHERE (a.id IS NULL OR a.assigned_to IS NULL)
             AND (NOT p_require_recording OR c.recording_state = 'found')
         )                                                                             AS available,
         count(*) FILTER (WHERE c.recording_state = 'found')                           AS with_recording,
         count(*) FILTER (WHERE c.recording_state = 'pending')                         AS awaiting_audio,
         count(*)                                                                      AS total
    FROM qa2_call c
    LEFT JOIN qa2_assignment a
      ON a.call_id = c.id AND a.calibration_group_id IS NULL
   WHERE c.qa_relevant
     AND c.method_id IS NOT NULL
     AND (p_company_ids IS NULL OR c.company_id = ANY (p_company_ids))
     AND (p_method_ids  IS NULL OR c.method_id  = ANY (p_method_ids))
     AND (p_from IS NULL OR c.call_at >= p_from)
     AND (p_to   IS NULL OR c.call_at <= p_to)
     AND coalesce(c.talk_sec, 0) >= coalesce(p_min_talk, 0)
   GROUP BY c.method_id;
$$;

CREATE OR REPLACE FUNCTION app_qa2_assign_pick(
  p_method_id        uuid,
  p_company_ids      uuid[]      DEFAULT NULL,
  p_from             timestamptz DEFAULT NULL,
  p_to               timestamptz DEFAULT NULL,
  p_require_recording boolean    DEFAULT true,
  p_min_talk         int         DEFAULT 0,
  p_limit            int         DEFAULT 50,
  p_exclude          uuid[]      DEFAULT NULL
)
RETURNS TABLE(call_id uuid, assignment_id uuid, company_id uuid, call_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT c.id, a.id, c.company_id, c.call_at
    FROM qa2_call c
    LEFT JOIN qa2_assignment a
      ON a.call_id = c.id AND a.calibration_group_id IS NULL
   WHERE c.qa_relevant
     AND c.method_id = p_method_id
     AND (a.id IS NULL OR a.assigned_to IS NULL)
     AND (NOT p_require_recording OR c.recording_state = 'found')
     AND (p_company_ids IS NULL OR c.company_id = ANY (p_company_ids))
     AND (p_from IS NULL OR c.call_at >= p_from)
     AND (p_to   IS NULL OR c.call_at <= p_to)
     AND coalesce(c.talk_sec, 0) >= coalesce(p_min_talk, 0)
     AND (p_exclude IS NULL OR NOT (c.id = ANY (p_exclude)))
   ORDER BY c.call_at ASC
   LIMIT greatest(0, coalesce(p_limit, 0));
$$;

GRANT EXECUTE ON FUNCTION app_qa2_assign_pool(uuid[], uuid[], timestamptz, timestamptz, boolean, int) TO service_role;
GRANT EXECUTE ON FUNCTION app_qa2_assign_pick(uuid, uuid[], timestamptz, timestamptz, boolean, int, int, uuid[]) TO service_role;
