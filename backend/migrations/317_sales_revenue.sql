-- ============================================================================
-- 317_sales_revenue.sql -- CRM sales into the books (stage 5). OFF by default.
--
-- One sale touches two sets of books:
--
--   The CLOSER company (the one whose closer made the sale -- 1-Vertex today)
--   is paid by the CLIENT: the "DP Status" (sales.payout_status) is that money.
--     earned     Dr receivable from the client   Cr sales revenue
--     collected  Dr cash                         Cr receivable       (DP paid)
--     cost       Dr partner fees (expense)       Cr owed to partners (fronter's cut)
--     paid       Dr owed to partners             Cr cash             (Paid to Partner)
--
--   The FRONTER company (sales.company_id) earns a partner fee from the closer:
--     income     Dr receivable from the closer   Cr partner-fee revenue
--     received   Dr cash                         Cr receivable       (Paid to Partner)
--
-- WHEN (the approved rule): a sale is earned once it is approved (closed_won)
-- or its down payment is paid, and stays earned until the DP is REVERTED. A
-- sale cancelled before the client paid stops being revenue. Post-dated sales
-- (not charged yet) are never revenue. Nothing before `go_live` is touched.
--
-- HOW MUCH: a rate card per company -- per client (optionally per plan) a
-- percent of the down payment or a flat amount, per partner company the same.
-- No rate = the sale is listed as "needs a rate" and nothing is posted for it.
-- Rates are in `rate_currency` (USD -- the DP is dollars) and converted to the
-- company's book currency with the exchange rate in force on the day.
--
-- The worker (utils/revenueSync.js) is DESIRED-STATE: it works out what the
-- books should hold for every sale and posts / reverses / re-posts only the
-- difference, keyed on (company, source_type, source_id, source_event) -- the
-- mig 315 idempotency key. A DP edited after posting = reverse + re-post.
-- Nothing runs for a company until someone switches it on in
-- Accounts -> Settings -> Sales into the books.
-- ============================================================================

CREATE TABLE IF NOT EXISTS revenue_settings (
  company_id       uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  closer_enabled   boolean NOT NULL DEFAULT false,
  fronter_enabled  boolean NOT NULL DEFAULT false,
  go_live          date    NOT NULL DEFAULT '2026-06-01',
  recognize_on     text    NOT NULL DEFAULT 'approved' CHECK (recognize_on IN ('approved', 'dp_paid')),
  rate_currency    text    NOT NULL DEFAULT 'USD' CHECK (rate_currency ~ '^[A-Z]{3}$'),
  last_run_at      timestamptz,
  last_run_summary jsonb,
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE revenue_settings IS
  'Per company: book CRM sales automatically (mig 317). Both switches default OFF.';

CREATE TABLE IF NOT EXISTS revenue_rates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('client', 'partner_cost', 'partner_income')),
  client_name        text,                 -- kind=client: matched case-insensitively to sales.client_name
  plan               text,                 -- optional, case-insensitive; NULL = every plan of that client
  partner_company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
                                           -- partner_cost: the fronter company; partner_income: optional closer
  basis              text NOT NULL CHECK (basis IN ('dp_percent', 'flat')),
  value              numeric(14,4) NOT NULL CHECK (value >= 0),
  effective_from     date NOT NULL DEFAULT '2026-06-01',
  note               text,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'client' OR client_name IS NOT NULL),
  CHECK (kind <> 'partner_cost' OR partner_company_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_revenue_rates_company ON revenue_rates (company_id, kind, effective_from DESC);

ALTER TABLE revenue_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_rates    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON revenue_settings, revenue_rates FROM anon, authenticated;
GRANT ALL ON revenue_settings, revenue_rates TO service_role;

DROP TRIGGER IF EXISTS trg_module_audit ON revenue_settings;
CREATE TRIGGER trg_module_audit AFTER INSERT OR UPDATE OR DELETE ON revenue_settings
  FOR EACH ROW EXECUTE FUNCTION fn_module_audit('accounting', '');
DROP TRIGGER IF EXISTS trg_module_audit ON revenue_rates;
CREATE TRIGGER trg_module_audit AFTER INSERT OR UPDATE OR DELETE ON revenue_rates
  FOR EACH ROW EXECUTE FUNCTION fn_module_audit('accounting', '');

-- Reading the desired state walks sales by closer and by company since
-- go-live: idx_sales_closer_saledate / idx_sales_company_saledate already
-- cover both. The live entries of one company by source need this one.
CREATE INDEX IF NOT EXISTS idx_je_company_source_live ON journal_entries (company_id, source_type)
  WHERE status = 'posted' AND reversal_of IS NULL AND reversed_by IS NULL;
