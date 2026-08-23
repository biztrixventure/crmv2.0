-- ============================================================================
-- 285_accounting_expenses.sql
--
-- Accounting module, part 3 of 3: expense categories + the submit/approve/reject
-- workflow.
--
-- An expense is a CLAIM until someone approves it. The status ladder is
--   draft -> submitted -> approved | rejected -> reimbursed
-- and every transition stamps who and when, because this is the surface a
-- finance audit asks about first. backend/routes/accounting/expenses.js owns the
-- ladder; the CHECK below only fences the vocabulary.
--
-- employee_id is a plain uuid, not an FK: hr_employees is created in 286, and a
-- forward reference would make 285 unappliable on its own. 286 adds the FK once
-- the target exists, so the files stay independently pasteable in order.
--
-- Verify after applying:
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_name IN ('expense_categories','expenses');  -- 2
-- ============================================================================

CREATE TABLE IF NOT EXISTS expense_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  -- Which ledger account this category posts to when the expense is approved.
  account_id  uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_expcat_company ON expense_categories (company_id, is_active);

CREATE TABLE IF NOT EXISTS expenses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category_id    uuid REFERENCES expense_categories(id) ON DELETE SET NULL,

  -- Who is out of pocket. submitted_by is the auth user (always present);
  -- employee_id links to the HR record when the claimant has one (mig 286).
  submitted_by   uuid NOT NULL,
  employee_id    uuid,

  expense_date   date NOT NULL DEFAULT CURRENT_DATE,
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  currency       text NOT NULL DEFAULT 'USD',
  vendor         text,
  description    text,
  receipt_url    text,
  is_billable    boolean NOT NULL DEFAULT false,
  invoice_id     uuid REFERENCES invoices(id) ON DELETE SET NULL,

  status         text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','submitted','approved','rejected','reimbursed')),
  submitted_at   timestamptz,
  approved_by    uuid,
  approved_at    timestamptz,
  rejected_by    uuid,
  rejected_at    timestamptz,
  rejection_reason text,
  reimbursed_at  timestamptz,
  reimbursed_by  uuid,

  journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exp_company_status ON expenses (company_id, status);
CREATE INDEX IF NOT EXISTS idx_exp_company_date   ON expenses (company_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_exp_submitter      ON expenses (submitted_by, status);
CREATE INDEX IF NOT EXISTS idx_exp_employee       ON expenses (employee_id);

COMMENT ON TABLE expenses IS
  'Expense claims with a submit/approve/reject ladder (mig 285). Approval stamps are the audit trail -- never overwrite them on a later transition.';

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses           ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON expense_categories FROM anon;
REVOKE ALL ON expenses           FROM anon;
