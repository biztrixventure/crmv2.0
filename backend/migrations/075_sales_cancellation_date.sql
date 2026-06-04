-- ============================================================================
-- 075_sales_cancellation_date.sql
-- Adds sales.cancellation_date so compliance can record the *business date*
-- a sale was cancelled (independent of when the status flip was recorded).
-- Drives reporting that asks "how many cancels happened in May" — the
-- existing updated_at / compliance_reviewed_at only tell us when the row
-- changed, which can drift weeks from the actual cancel date when
-- compliance batch-processes paperwork.
--
-- Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS cancellation_date date;

COMMENT ON COLUMN sales.cancellation_date IS
  'Business date the sale was cancelled. Set when status transitions to a cancellation-like value (cancelled, compliance_cancelled, closed_lost, chargeback, dispute). NULL for non-cancelled sales.';

-- Lets reports filter cancellation totals by month / week without a seq scan.
CREATE INDEX IF NOT EXISTS idx_sales_cancellation_date
  ON sales(cancellation_date)
  WHERE cancellation_date IS NOT NULL;
