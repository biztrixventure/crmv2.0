-- ============================================================================
-- 110_vicidial_perf_indexes.sql
-- Hot-path index for the dialer integration + drop a redundant duplicate index.
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================

-- transfers.vicidial_vendor_code is matched on EVERY closer-dispo and
-- fronter-xfer hit (idempotency + lead lookup: .eq('vicidial_vendor_code', …)).
-- With 35k+ transfers and no index that was a full seq scan per dialer event.
-- Partial index keeps it small (only transfers that actually carry a code).
CREATE INDEX IF NOT EXISTS idx_transfers_vendor_code
  ON transfers (vicidial_vendor_code)
  WHERE vicidial_vendor_code IS NOT NULL;

-- disposition_actions(transfer_id) was indexed twice under two names
-- (idx_disp_actions_transfer + idx_disposition_actions_transfer) — identical
-- column, so one is pure write overhead. Keep idx_disp_actions_transfer.
DROP INDEX IF EXISTS idx_disposition_actions_transfer;
