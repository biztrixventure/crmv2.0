-- ============================================================================
-- 318_commissions_receipts.sql -- commissions + SPIFF into payroll, receipts
-- on expense claims (stage 6).
--
-- COMMISSION PLANS are rules, not payments. A plan says "a closer earns PKR
-- 500 per approved sale" or "a fronter earns 5% of the down payment of the
-- sales they passed on, from the 10th sale in the period". Nothing is paid
-- from a plan on its own: the payroll run shows each person's SUGGESTED
-- commission and SPIFF prize next to what the run holds, and HR applies them
-- with one click (pay only ever changes by a person's hand). What was applied
-- -- which plan, how many sales, which SPIFF -- is kept on the payroll line
-- (earnings_detail) so the payslip can show where the number came from.
--
-- RECEIPTS live in a PRIVATE storage bucket (expense-receipts, created by the
-- route on first use) and are only ever shown through short-lived signed
-- links -- a receipt is a personal financial document, never a public URL.
-- ============================================================================

CREATE TABLE IF NOT EXISTS hr_commission_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name           text NOT NULL,
  applies_to     text NOT NULL CHECK (applies_to IN ('closer', 'fronter')),
                 -- closer: sales they closed (sales.closer_id); fronter: sales they passed on (sales.fronter_id)
  role_levels    text[] NOT NULL DEFAULT '{}',      -- only people with these CRM role levels; empty = anyone
  basis          text NOT NULL CHECK (basis IN ('per_sale', 'dp_percent')),
  amount         numeric(14,4) NOT NULL CHECK (amount >= 0),
                 -- per_sale: in the payroll currency; dp_percent: percent of the down payment
  dp_currency    text NOT NULL DEFAULT 'USD' CHECK (dp_currency ~ '^[A-Z]{3}$'),
  min_sales      integer NOT NULL DEFAULT 0 CHECK (min_sales >= 0),
                 -- nothing is earned in a period below this many counting sales
  counts_on      text NOT NULL DEFAULT 'approved' CHECK (counts_on IN ('approved', 'dp_paid')),
  is_active      boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT '2026-06-01',
  effective_to   date,
  note           text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (basis <> 'dp_percent' OR amount <= 100)
);
CREATE INDEX IF NOT EXISTS idx_hr_commission_plans_company ON hr_commission_plans (company_id, is_active);

ALTER TABLE hr_commission_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hr_commission_plans FROM anon, authenticated;
GRANT ALL ON hr_commission_plans TO service_role;
DROP TRIGGER IF EXISTS trg_module_audit ON hr_commission_plans;
CREATE TRIGGER trg_module_audit AFTER INSERT OR UPDATE OR DELETE ON hr_commission_plans
  FOR EACH ROW EXECUTE FUNCTION fn_module_audit('hr', '');

-- Where a payroll line's commission / SPIFF came from.
ALTER TABLE hr_payroll_entries ADD COLUMN IF NOT EXISTS earnings_detail jsonb;
COMMENT ON COLUMN hr_payroll_entries.earnings_detail IS
  'What HR applied from commission plans / SPIFF (mig 318): plans, sales counted, campaigns, amounts.';

-- The stored receipt behind an expense claim (private bucket).
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_path text;
