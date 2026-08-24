-- ============================================================================
-- 295_company_currency.sql
--
-- Gives a company a CURRENCY, the way it already has an internal_timezone.
--
-- mig 294 moved every money column's default to PKR, which fixed the data but
-- not the reports: the accounting dashboard had 'USD' written into it as a
-- constant, so a company booking in rupees still had its P&L, balance sheet and
-- KPI tiles labelled US$. Swapping that constant for 'PKR' would have moved the
-- same bug one deployment down the road.
--
-- The ledger itself has no currency to read: journal_entries stores amounts and
-- the accounts belong to a company, so the currency IS a property of the
-- company. This is that property, and every default now derives from it --
-- employees, invoices, expenses, payroll runs and the report headings.
--
-- Default PKR, matching internal_timezone's 'Asia/Karachi': this deployment is
-- Pakistan-based, and a per-company column means a future USD company is a
-- setting rather than a code change.
--
-- Verify after applying:
--   SELECT name, currency, internal_timezone FROM companies ORDER BY name;
-- ============================================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'PKR';

COMMENT ON COLUMN companies.currency IS
  'The currency this company books in (mig 295). Source of truth for the accounting reports and the default on employees, invoices, expenses and payroll runs. Sibling of internal_timezone.';

INSERT INTO schema_migrations (filename, note)
VALUES ('295_company_currency.sql',
        'per-company currency (default PKR); accounting reports and every money default now derive from it instead of a hardcoded USD')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
