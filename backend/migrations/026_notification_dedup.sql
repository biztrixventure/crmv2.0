-- ============================================================
-- 026 — Notification deduplication key
-- ============================================================
-- Adds an optional dedup_key column to the notifications table.
-- When populated, a unique partial index prevents inserting the
-- same notification twice (client retry / race condition).
--
-- Key format used by notificationService.js:
--   {type}_{entityId}_{userId}_{utcHour}
--   e.g. "sale_approved_abc123_user456_2024-01-15T14"
--
-- The partial index (WHERE dedup_key IS NOT NULL) means rows
-- without a key (older or bulk notifications) are unaffected.
-- ============================================================

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS dedup_key text;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_key_idx
  ON notifications(dedup_key)
  WHERE dedup_key IS NOT NULL;
