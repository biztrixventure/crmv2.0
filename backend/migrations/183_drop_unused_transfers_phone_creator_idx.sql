-- ============================================================================
-- 183_drop_unused_transfers_phone_creator_idx.sql   🧹 tech-debt (issue #4)
-- idx_transfers_phone_creator on transfers has idx_scan = 0 since stats reset
-- (~4 MB pure write/maintenance overhead). No route queries phone+creator
-- directly — phone lookups go through utils/phone.js on `normalized_phone`.
-- Drop it. IF EXISTS keeps this idempotent / safe to re-run.
-- ============================================================================
DROP INDEX IF EXISTS idx_transfers_phone_creator;

-- Note: if a phone-lookup path is ever added, index `normalized_phone`
-- (the column actually queried) rather than re-adding phone+creator.
