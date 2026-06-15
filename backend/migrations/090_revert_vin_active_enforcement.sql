-- ============================================================================
-- 090_revert_vin_active_enforcement.sql
-- Unblocks bulk sale upload, which migration 088 broke.
--
-- 088 added a BEFORE-INSERT trigger (fn_supersede_vin_active) that UPDATEs other
-- sales rows with the same car_vin, plus a partial unique index
-- (uq_sales_active_vin). Bulk upload inserts up to 100 sales in ONE multi-row
-- INSERT. When a single batch contains the same car_vin twice as closed_won
-- (normal in historical files: renewals, resells, dupes), the second row's
-- trigger tries to update the first row created by the SAME command →
--   ERROR: tuple to be updated was already modified by an operation triggered
--          by the current command
-- (or a uq_sales_active_vin unique violation) → the whole batch fails →
-- 500 on POST /api/sale-uploads/confirm.
--
-- A BEFORE trigger that mutates sibling rows of the same table is fundamentally
-- unsafe for multi-row inserts. We drop the hard DB enforcement here to restore
-- bulk upload immediately. The superseded_by / superseded_at / superseded_reason
-- columns and their existing data are KEPT (harmless, still useful for reporting).
--
-- "One active policy per VIN" will be re-introduced in a bulk-safe way later —
-- enforced in application code on the manual sale + resell paths, and/or via a
-- STATEMENT-level AFTER trigger that supersedes older same-VIN rows without a
-- blocking per-row index. See docs / migration 091 (to be written).
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- Drop the per-row supersede trigger + its function (the cause of the bulk break).
DROP TRIGGER IF EXISTS trg_supersede_vin_active ON sales;
DROP FUNCTION IF EXISTS fn_supersede_vin_active();

-- Drop the partial unique index that rejected multi-row / historical dupes.
DROP INDEX IF EXISTS uq_sales_active_vin;

-- NOTE: superseded_by / superseded_at / superseded_reason columns are intentionally
-- retained. The policy-event logging function (fn_log_policy_event) still references
-- superseded_by harmlessly — it simply won't receive trigger-driven supersede events
-- anymore, which is fine.
