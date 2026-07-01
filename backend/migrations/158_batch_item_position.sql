-- ============================================================================
-- 158_batch_item_position.sql   (Batch UI/UX upgrade — Phase A)
-- Add a stable per-batch ordinal to distribution_batch_items so a batch's
-- numbers have a meaningful sequence (foundation for range-select / ordered /
-- shuffled distribution in later phases).
--
--   * position integer, NULLABLE (no default — populated explicitly on insert).
--   * Backfill existing rows per batch using their current created_at ASC order
--     (id ASC as the tiebreaker) so historical batches get 1..N instead of NULL.
--   * (batch_id, position) index for cheap ORDER BY position within a batch.
--
-- Purely additive. No behavior change on its own — send-batch / sub-batch start
-- writing position going forward (see routes). Apply in Supabase SQL editor.
-- Idempotent.
-- ============================================================================
ALTER TABLE distribution_batch_items ADD COLUMN IF NOT EXISTS position integer;

-- Backfill: 1..N per batch in the existing created_at order. Only touches rows
-- still NULL, so re-running after new (already-positioned) inserts is a no-op.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY batch_id ORDER BY created_at ASC, id ASC) AS rn
  FROM distribution_batch_items
  WHERE position IS NULL
)
UPDATE distribution_batch_items i
   SET position = r.rn
  FROM ranked r
 WHERE r.id = i.id;

CREATE INDEX IF NOT EXISTS idx_dbitem_batch_position
  ON distribution_batch_items (batch_id, position);
