-- ============================================================================
-- 266_qa2_purge_parked_calls.sql
-- Retention for the calls QA will never open. Every dial becomes a qa2_call row
-- — roughly 50k a day — and 262 parks the non-reviewable ones as 'skipped'
-- rather than chasing their audio. Parking stopped the wasted lookups but the
-- rows still pile up: 239,934 already, and the Unclassified pool was showing
-- all of them (264,291 rows where only 363 needed a human decision).
--
-- A parked row is deleted only when every one of these holds:
--   • recording_state = 'skipped'  — not reviewable, and no audio was fetched
--   • no method, transfer, sale or paired leg — nothing ever claimed it
--   • no evaluation, assignment or listen-log points at it. Those FKs CASCADE,
--     so a row carrying QA work must never be swept away with it.
--   • older than the retention window
-- Anything a human or the CRM touched survives. Batched, so the scheduler can
-- call it every few hours without holding a long lock.
-- ============================================================================
CREATE OR REPLACE FUNCTION app_qa2_purge_parked(p_days int DEFAULT 14, p_limit int DEFAULT 5000)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  WITH doomed AS (
    SELECT c.id
      FROM qa2_call c
     WHERE c.recording_state = 'skipped'
       AND c.method_id      IS NULL
       AND c.transfer_id    IS NULL
       AND c.sale_id        IS NULL
       AND c.linked_call_id IS NULL
       AND c.recording_id   IS NULL
       AND c.call_at < now() - make_interval(days => GREATEST(p_days, 1))
       AND NOT EXISTS (SELECT 1 FROM qa2_evaluation e WHERE e.call_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM qa2_assignment a WHERE a.call_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM qa2_listen_log l WHERE l.call_id = c.id)
     ORDER BY c.call_at
     LIMIT GREATEST(p_limit, 1)
  )
  DELETE FROM qa2_call c USING doomed d WHERE c.id = d.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION app_qa2_purge_parked(int, int) TO service_role;
