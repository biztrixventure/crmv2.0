-- ============================================================================
-- 250_transfer_code_unique_per_fronter.sql
--
-- PROBLEM: uq_transfers_vicidial_code (created in 096_vicidial_integration.sql)
-- made vicidial_vendor_code globally unique, but a VICIdial lead_id is NOT
-- unique per transfer event — it is unique per LEAD. When the dialer recycles a
-- lead, a SECOND fronter can transfer the same customer and send the same
-- lead_id.
--
-- Because only one row could hold that code, the second fronter's XFER fell into
-- the "already exists" branch and merely UPDATED the first fronter's transfer:
--   * the second fronter got no pending card and no credit for the transfer,
--   * transfers.vicidial_agent was overwritten with the second agent's id while
--     created_by still pointed at the first fronter, and
--   * the closer's disposition then landed on the FIRST fronter's row, so the
--     wrong agent saw the outcome on their dashboard.
--
-- Measured before this change: 276 transfers in 30 days (69 distinct creators)
-- carried a dialer agent id that does not belong to the user credited as
-- creator — e.g. code TMC10562265 credited to one fronter but stamped with
-- another fronter's agent id, already carrying a closer disposition.
--
-- FIX: uniqueness belongs on (vicidial_vendor_code, created_by), not on the code
-- alone. Idempotency is preserved exactly where it matters — the SAME fronter
-- re-firing the SAME lead still collapses onto one row, so a repeated webhook
-- can never duplicate — while a DIFFERENT fronter transferring the same recycled
-- lead now gets their own transfer, their own pending card, and their own
-- disposition.
--
-- Matching stays correct because every code-based lookup in routes/vicidial.js
-- already orders by created_at DESC and takes one row, so a closer disposition
-- resolves to the most recent transfer of that lead — the fronter who actually
-- just sent it — instead of an older one.
--
-- SAFE TO APPLY: no rows change. The new index is strictly weaker than the old
-- one, so every existing row already satisfies it (the code alone was unique,
-- therefore (code, created_by) is unique too). The build cannot fail on
-- existing data.
-- ============================================================================

-- The old global-unique index is what blocked the second fronter's row.
DROP INDEX IF EXISTS uq_transfers_vicidial_code;

-- One row per (lead code, fronter). Same fronter + same lead = still one row,
-- so a duplicate webhook fire remains idempotent and cannot create a twin.
CREATE UNIQUE INDEX IF NOT EXISTS uq_transfers_vicidial_code_creator
  ON public.transfers (vicidial_vendor_code, created_by)
  WHERE vicidial_vendor_code IS NOT NULL;

-- The dropped unique index was also serving code lookups (closer-dispo matching
-- reads transfers by vicidial_vendor_code on the hot webhook path). Keep a
-- non-unique index so those stay index-backed.
CREATE INDEX IF NOT EXISTS idx_transfers_vicidial_code
  ON public.transfers (vicidial_vendor_code)
  WHERE vicidial_vendor_code IS NOT NULL;

INSERT INTO schema_migrations (filename, note)
VALUES ('250_transfer_code_unique_per_fronter.sql',
        'vicidial_vendor_code unique per (code, created_by) so a second fronter transferring a recycled lead gets their own transfer instead of overwriting the first fronter''s')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
