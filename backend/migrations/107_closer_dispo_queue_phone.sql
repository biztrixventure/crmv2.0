-- ============================================================================
-- 107_closer_dispo_queue_phone.sql
-- Store the normalized phone on each queued closer disposition so a later
-- fronter-xfer (transfer created AFTER the closer already dispositioned — the
-- timing race) can reconcile: find the pending dispo for that phone and attach
-- it to the new transfer automatically. Idempotent.
-- ============================================================================
ALTER TABLE vicidial_closer_dispo_queue
  ADD COLUMN IF NOT EXISTS normalized_phone text;

CREATE INDEX IF NOT EXISTS idx_closer_dispo_queue_phone
  ON vicidial_closer_dispo_queue (normalized_phone)
  WHERE status = 'pending' AND transfer_id IS NULL;
