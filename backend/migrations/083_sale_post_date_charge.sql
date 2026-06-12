-- ============================================================================
-- 083_sale_post_date_charge.sql
-- Post-dated sales support. When a closer picks the "post date" disposition on
-- a sale, they schedule a future charge date/time. The sale lives in a "Post
-- Date" tab (closer + compliance) until it's charged (disposition flipped back
-- to "sale"), and the closer gets a reminder notification at charge_at.
--
--   charge_at          — when the card should be charged (the closer's chosen
--                        date + time). NULL for normal sales.
--   charge_notified_at — stamped by callbackScheduler once the reminder fires,
--                        so it never notifies twice.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

ALTER TABLE sales ADD COLUMN IF NOT EXISTS charge_at          timestamptz;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS charge_notified_at timestamptz;

COMMENT ON COLUMN sales.charge_at IS
  'Scheduled charge date/time for a post-dated sale (closer_disposition = the post-date option). NULL for normal sales.';
COMMENT ON COLUMN sales.charge_notified_at IS
  'When the charge-due reminder was sent to the closer. NULL = not yet notified.';

-- Drives the scheduler scan: due, not-yet-notified post-dated sales.
CREATE INDEX IF NOT EXISTS idx_sales_charge_due
  ON sales (charge_at)
  WHERE charge_at IS NOT NULL AND charge_notified_at IS NULL;
