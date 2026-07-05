-- ============================================================================
-- 177_qa_retention.sql
-- QA retention: keep assignments that are being WORKED (assigned) or DONE
-- (reviewed); everything else (materialized-but-untouched: pending + unassigned)
-- is kept only qa.retention_days (default 2) then purged. Drains the
-- full-coverage TRA backlog (was ~36k pending / 1 reviewed) and bounds it.
--
-- Two coordinated pieces so there is NO purge↔re-materialize churn:
--   1. seed qa.retention_days = 2.
--   2. TRA materializer only looks at transfers created within the last
--      p_since window (new 3rd arg), so an untouched TRA row that ages past
--      retention is purged AND not recreated (its transfer is out of window).
-- The purge itself runs in code (utils/qaMaterializer.purgeStaleQaAssignments),
-- on the scheduler. Apply AFTER 172. Idempotent.
-- ============================================================================

-- 1. retention knob
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'qa.retention_days', '2'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

-- 2. TRA materializer gains a lookback window (p_since). NULL = full history
-- (old behaviour). The scheduler passes now()-retention_days so only recent
-- transfers get pending assignments. Drop the old 2-arg form first (CREATE OR
-- REPLACE can't add a param), then recreate with the 3-arg signature.
DROP FUNCTION IF EXISTS app_qa_materialize_tra(uuid, text[]);

CREATE OR REPLACE FUNCTION app_qa_materialize_tra(
  p_company_id uuid,
  p_statuses   text[]      DEFAULT ARRAY['all'],
  p_since      timestamptz DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO qa_assignments (company_id, method, subject_role, transfer_id, sampled, status)
  SELECT t.company_id, 'tra', 'fronter', t.id, false, 'pending'
  FROM transfers t
  WHERE t.company_id = p_company_id
    AND (p_since IS NULL OR t.created_at >= p_since)
    AND (p_statuses IS NULL
         OR 'all' = ANY(p_statuses)
         OR t.status::text = ANY(p_statuses))
    AND NOT EXISTS (
      SELECT 1 FROM qa_assignments a
      WHERE a.transfer_id = t.id AND a.method = 'tra'
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION app_qa_materialize_tra(uuid, text[], timestamptz)
  TO authenticated, anon, service_role;
