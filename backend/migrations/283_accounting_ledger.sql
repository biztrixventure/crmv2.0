-- ============================================================================
-- 283_accounting_ledger.sql
--
-- Accounting module, part 1 of 3: chart of accounts + double-entry journal.
--
-- Numbering note: this module was drafted as 225-232, but 225-232 were already
-- taken (and applied) by the QA/compliance work. Renumbered to 283-290.
--
-- Shape follows the repo's existing conventions:
--   * every row carries company_id and cascades from companies (multi-tenant)
--   * status/type columns are TEXT + CHECK, not new enums -- an enum value can
--     never be removed, and these lists will move (see the role_level lesson).
--   * RLS on + anon REVOKEd; everything reaches these through the service role
--     in backend/routes/accounting/*.
--
-- Balance rule: a journal entry may sit in `draft` unbalanced while it is being
-- typed, but it can never REACH `posted` unless SUM(debit) = SUM(credit).
-- backend/routes/accounting/journal.js checks this before it writes; the trigger
-- below is the backstop so no other writer (SQL editor, a future importer) can
-- post a crooked entry. It is a per-row BEFORE UPDATE on journal_entries and
-- never touches sibling rows, so it is bulk-insert safe (mig 088/091 lesson).
--
-- Verify after applying:
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_name IN ('chart_of_accounts','journal_entries','journal_entry_lines');  -- 3
-- ============================================================================

-- -- Chart of accounts ------------------------------------------------------
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  account_type    text NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense')),
  account_subtype text,
  parent_id       uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  description     text,
  is_active       boolean NOT NULL DEFAULT true,
  is_system       boolean NOT NULL DEFAULT false,   -- seeded defaults; UI hides delete
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_coa_company      ON chart_of_accounts (company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_coa_company_type ON chart_of_accounts (company_id, account_type);
CREATE INDEX IF NOT EXISTS idx_coa_parent       ON chart_of_accounts (parent_id);

COMMENT ON TABLE chart_of_accounts IS
  'Per-company chart of accounts (mig 283). account_type drives P&L vs balance sheet in GET /accounting/reports.';

-- -- Journal entries ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS journal_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entry_no     text NOT NULL,
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  memo         text,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','void')),
  -- Where this entry came from. 'payroll' is written by hr/payroll.js when a run
  -- is finalized; 'invoice'/'payment'/'expense' by their own routes.
  source_type  text NOT NULL DEFAULT 'manual'
               CHECK (source_type IN ('manual','invoice','payment','expense','payroll','adjustment')),
  source_id    uuid,
  posted_at    timestamptz,
  posted_by    uuid,
  voided_at    timestamptz,
  voided_by    uuid,
  void_reason  text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, entry_no)
);

CREATE INDEX IF NOT EXISTS idx_je_company_date   ON journal_entries (company_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_je_company_status ON journal_entries (company_id, status);
CREATE INDEX IF NOT EXISTS idx_je_source         ON journal_entries (source_type, source_id);

-- -- Journal entry lines -----------------------------------------------------
-- company_id is denormalized on purpose: every list/report query filters by it,
-- and carrying it here avoids a join on the hottest table in the module.
CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  debit       numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit      numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description text,
  line_no     integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- A line is a debit OR a credit, never both, never neither.
  CONSTRAINT jel_one_side CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE INDEX IF NOT EXISTS idx_jel_entry           ON journal_entry_lines (entry_id);
CREATE INDEX IF NOT EXISTS idx_jel_company_account ON journal_entry_lines (company_id, account_id);

COMMENT ON TABLE journal_entry_lines IS
  'Double-entry lines (mig 283). company_id denormalized for report queries; one side only per line.';

-- -- Balance backstop --------------------------------------------------------
-- Refuses the draft -> posted transition on an unbalanced or empty entry.
-- Per-row BEFORE UPDATE on the PARENT; reads its own children, mutates nothing.
CREATE OR REPLACE FUNCTION fn_journal_entry_balance_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_debit  numeric(14,2);
  v_credit numeric(14,2);
  v_lines  integer;
BEGIN
  IF NEW.status <> 'posted' OR OLD.status = 'posted' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), count(*)
    INTO v_debit, v_credit, v_lines
    FROM journal_entry_lines WHERE entry_id = NEW.id;

  IF v_lines = 0 THEN
    RAISE EXCEPTION 'Journal entry % has no lines and cannot be posted', NEW.entry_no;
  END IF;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced: debits %, credits %', NEW.entry_no, v_debit, v_credit;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_journal_entry_balance_guard ON journal_entries;
CREATE TRIGGER trg_journal_entry_balance_guard
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION fn_journal_entry_balance_guard();

-- -- Posted lines are immutable ----------------------------------------------
-- Correcting a posted entry means voiding it and writing a reversal, never
-- editing history. Same reasoning as policy_events (mig 087).
CREATE OR REPLACE FUNCTION fn_journal_lines_locked_when_posted()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM journal_entries
   WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF v_status IN ('posted','void') THEN
    RAISE EXCEPTION 'Cannot modify lines of a % journal entry', v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_journal_lines_locked ON journal_entry_lines;
CREATE TRIGGER trg_journal_lines_locked
  BEFORE INSERT OR UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION fn_journal_lines_locked_when_posted();

-- -- Lock down ---------------------------------------------------------------
ALTER TABLE chart_of_accounts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON chart_of_accounts   FROM anon;
REVOKE ALL ON journal_entries     FROM anon;
REVOKE ALL ON journal_entry_lines FROM anon;
