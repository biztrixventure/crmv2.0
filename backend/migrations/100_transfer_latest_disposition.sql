-- ============================================================================
-- 100_transfer_latest_disposition.sql
-- Denormalized transfers.latest_disposition so the Data Analyzer can filter
-- transfers by disposition on a real indexed column (the source of truth,
-- disposition_actions, can't be filtered through PostgREST without a join).
-- Kept in sync by an AFTER trigger on disposition_actions — covers BOTH manual
-- CRM dispositions and dialer-applied ones (both write disposition_actions).
-- Idempotent.
-- ============================================================================
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS latest_disposition text;
CREATE INDEX IF NOT EXISTS idx_transfers_latest_disposition ON transfers (latest_disposition);

CREATE OR REPLACE FUNCTION fn_sync_transfer_latest_disposition() RETURNS trigger AS $$
DECLARE tid uuid;
BEGIN
  tid := COALESCE(NEW.transfer_id, OLD.transfer_id);
  IF tid IS NOT NULL THEN
    UPDATE transfers t SET latest_disposition = (
      SELECT da.disposition_name FROM disposition_actions da
      WHERE da.transfer_id = tid
      ORDER BY da.created_at DESC NULLS LAST LIMIT 1
    ) WHERE t.id = tid;
  END IF;
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- never block a disposition write because of this denormalization
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_transfer_latest_disposition ON disposition_actions;
CREATE TRIGGER trg_sync_transfer_latest_disposition
  AFTER INSERT OR UPDATE OR DELETE ON disposition_actions
  FOR EACH ROW EXECUTE FUNCTION fn_sync_transfer_latest_disposition();

-- Backfill existing transfers from their most recent disposition_action.
UPDATE transfers t SET latest_disposition = sub.name
FROM (
  SELECT DISTINCT ON (transfer_id) transfer_id, disposition_name AS name
  FROM disposition_actions
  ORDER BY transfer_id, created_at DESC NULLS LAST
) sub
WHERE sub.transfer_id = t.id
  AND t.latest_disposition IS DISTINCT FROM sub.name;
