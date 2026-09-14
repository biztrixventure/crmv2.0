-- ============================================================================
-- 315_ledger_integrity.sql
--
-- The books were built right in their bones (balanced lines, locked posted
-- lines, trigger-fed totals) and wrong in four places that give WRONG
-- NUMBERS. This fixes those, and makes the money rules editable.
--
-- 1. REVERSALS NOW NET TO ZERO.
--    Voiding a posted entry used to mark the original 'void' (reports skip
--    void) AND post a mirror-image reversal (reports count posted) -- so the
--    P&L showed MINUS the original instead of zero. Now a posted entry stays
--    'posted' for ever; a reversal is a second posted entry pointing back at
--    it (reversal_of), and the original records reversed_by / reversed_at /
--    reversal_reason. Both count, they cancel, the history reads cleanly.
--    'void' is kept only for DRAFTS (typing that never became a fact).
--    Live impact of the old bug: none -- no posted entry was ever voided.
--
-- 2. ONE TRANSACTION PER POSTING, AND NEVER TWICE.
--    Posting was three separate HTTP calls (header, lines, post) with no
--    duplicate protection. fn_post_journal() does it in one transaction:
--    validate, number (serialised per company), insert, post. And a unique
--    index on (company, source_type, source_id, source_event) for live
--    entries means the same business event -- "invoice X was sent" -- can
--    never post twice, which the automatic CRM postings in later stages need.
--    fn_reverse_journal() reverses (and optionally re-posts a correction) in
--    one transaction -- "edit a posted entry" without editing history.
--
-- 3. POSTED ENTRIES CANNOT BE EDITED, EVEN FROM SQL.
--    Lines were already locked; the header was not. A BEFORE UPDATE guard now
--    refuses any change to a posted entry except recording its reversal.
--
-- 4. MONEY RULES ARE SETTINGS, NOT CODE.
--    Every automatic posting used hardcoded account codes (1000, 1100, 2000,
--    2100, 2200, 5000, 5900). accounting_posting_rules lets each company pick
--    the accounts per event ("when an invoice is sent, record it as ...").
--    No row = today's default code, so behaviour is unchanged until someone
--    edits a rule.
--
-- 5. FOREIGN CURRENCY IS CONVERTED, NOT MIXED.
--    fx_rates holds the accountant's rates (e.g. USD -> PKR by month). A
--    foreign-currency document posts in the company's currency at the rate in
--    force on its date, and each line keeps the original amount, currency and
--    rate. No rate on file = the posting is refused with a clear message;
--    nothing ever guesses a rate.
--
-- 6. THE MISSING "PAID" STEPS.
--    Payroll went salary expense -> "owed to staff" and stopped; expenses went
--    expense -> "owed to claimant" and stopped. So what-we-owe only ever grew.
--    Runs gain paid_at / payment entry (owed -> bank); expenses gain their
--    reimbursement entry.
--
-- Verify after applying:
--   SELECT count(*) FROM journal_entries WHERE status = 'posted';   -- 1 (JE-000001 untouched)
--   SELECT proname FROM pg_proc WHERE proname IN ('fn_post_journal','fn_reverse_journal');
-- ============================================================================

-- -- Journal entries: reversal links, event key -------------------------------------
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS source_event    text;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversal_of     uuid REFERENCES journal_entries(id) ON DELETE RESTRICT;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversed_by     uuid REFERENCES journal_entries(id) ON DELETE RESTRICT;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversed_at     timestamptz;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversal_reason text;

COMMENT ON COLUMN journal_entries.reversal_of IS
  'This entry cancels that one (mig 315). Both stay posted and net to zero.';
COMMENT ON COLUMN journal_entries.reversed_by IS
  'The entry that cancelled this one (mig 315). A reversed entry is still posted -- history is never edited.';
COMMENT ON COLUMN journal_entries.source_event IS
  'Which moment of the source this entry records: issue, payment, approval, reimbursement, finalize, paid, reversal... (mig 315).';

-- Wider vocabulary for the CRM postings of later stages. TEXT + CHECK, never an
-- enum, so this list can move again.
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type IN ('manual','invoice','payment','expense','payroll','adjustment',
                         'sale','partner_fee','commission','opening_balance','fx'));

-- 'void' is for drafts only from now on: a posted entry is reversed instead.
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS je_void_is_draft_only;
ALTER TABLE journal_entries ADD CONSTRAINT je_void_is_draft_only
  CHECK (NOT (status = 'void' AND posted_at IS NOT NULL));

-- The same business moment can be live only once. Reversed originals and the
-- reversals themselves are outside the index, so a corrected re-post is allowed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_je_source_event
  ON journal_entries (company_id, source_type, source_id, source_event)
  WHERE source_id IS NOT NULL AND status = 'posted' AND reversal_of IS NULL AND reversed_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_je_reversal_of ON journal_entries (reversal_of) WHERE reversal_of IS NOT NULL;

-- -- Lines: original currency ----------------------------------------------------------------
ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS orig_currency text;
ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS orig_amount   numeric(14,2);
ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS fx_rate       numeric(18,8);

COMMENT ON COLUMN journal_entry_lines.fx_rate IS
  'Company-currency units per 1 orig_currency unit, taken from fx_rates on the entry date (mig 315). NULL = booked in the company currency.';

-- -- Posted entries are immutable ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_journal_entry_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF OLD.status = 'posted' THEN
    IF NEW.status <> 'posted' THEN
      RAISE EXCEPTION 'Entry % is posted and cannot be voided or re-opened. Reverse it instead.', OLD.entry_no;
    END IF;
    IF (NEW.company_id, NEW.entry_no, NEW.entry_date, NEW.memo, NEW.source_type, NEW.source_id,
        NEW.source_event, NEW.reversal_of, NEW.posted_at, NEW.posted_by)
       IS DISTINCT FROM
       (OLD.company_id, OLD.entry_no, OLD.entry_date, OLD.memo, OLD.source_type, OLD.source_id,
        OLD.source_event, OLD.reversal_of, OLD.posted_at, OLD.posted_by) THEN
      RAISE EXCEPTION 'Entry % is posted and cannot be edited. Reverse it, or use Correct to reverse and re-post.', OLD.entry_no;
    END IF;
    IF OLD.reversed_by IS NOT NULL AND NEW.reversed_by IS DISTINCT FROM OLD.reversed_by THEN
      RAISE EXCEPTION 'Entry % is already reversed.', OLD.entry_no;
    END IF;
  ELSIF OLD.status = 'void' AND NEW.status <> 'void' THEN
    RAISE EXCEPTION 'Entry % was voided as a draft and cannot be re-opened. Create a new entry.', OLD.entry_no;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_journal_entry_immutable ON journal_entries;
CREATE TRIGGER trg_journal_entry_immutable
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION fn_journal_entry_immutable();

-- A posted entry cannot be deleted either (drafts can).
CREATE OR REPLACE FUNCTION fn_journal_entry_no_delete_posted()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Entry % is posted and cannot be deleted. Reverse it instead.', OLD.entry_no;
  END IF;
  RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_journal_entry_no_delete_posted ON journal_entries;
CREATE TRIGGER trg_journal_entry_no_delete_posted
  BEFORE DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION fn_journal_entry_no_delete_posted();

-- -- Numbering -------------------------------------------------------------------------------------
-- Serialised per company by an advisory lock for the rest of the transaction,
-- so two postings can never take the same number.
CREATE OR REPLACE FUNCTION fn_next_entry_no(p_company uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE v_n integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('journal_entry_no:' || p_company::text, 0));
  SELECT COALESCE(max(substring(entry_no FROM '^JE-([0-9]{1,9})$')::integer), 0) INTO v_n
    FROM journal_entries WHERE company_id = p_company;
  RETURN 'JE-' || lpad((v_n + 1)::text, 6, '0');
END;
$fn$;

-- -- Post one balanced entry, atomically and idempotently ----------------------------------------------
-- p = { company_id, entry_date, memo, source_type, source_id, source_event,
--       reversal_of, actor, lines: [{account_id, debit, credit, description,
--       orig_currency, orig_amount, fx_rate}] }
-- Returns { id, entry_no, existing }. existing=true means this exact business
-- moment was already posted and nothing new was written.
CREATE OR REPLACE FUNCTION fn_post_journal(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company uuid    := nullif(p ->> 'company_id', '')::uuid;
  v_type    text    := COALESCE(nullif(p ->> 'source_type', ''), 'manual');
  v_src     uuid    := nullif(p ->> 'source_id', '')::uuid;
  v_event   text    := nullif(p ->> 'source_event', '');
  v_date    date    := COALESCE(nullif(p ->> 'entry_date', '')::date, current_date);
  v_actor   uuid    := COALESCE(nullif(p ->> 'actor', '')::uuid, fn_request_actor());
  v_rev_of  uuid    := nullif(p ->> 'reversal_of', '')::uuid;
  v_found   record;
  v_line    jsonb;
  v_n       integer := 0;
  v_dr      numeric := 0;
  v_cr      numeric := 0;
  v_d       numeric;
  v_c       numeric;
  v_id      uuid;
  v_no      text;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'company_id is required'; END IF;
  IF jsonb_typeof(p -> 'lines') <> 'array' THEN RAISE EXCEPTION 'lines must be a list'; END IF;

  IF v_src IS NOT NULL AND v_rev_of IS NULL THEN
    SELECT id, entry_no INTO v_found FROM journal_entries
     WHERE company_id = v_company AND source_type = v_type AND source_id = v_src
       AND source_event IS NOT DISTINCT FROM v_event
       AND status = 'posted' AND reversal_of IS NULL AND reversed_by IS NULL
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('id', v_found.id, 'entry_no', v_found.entry_no, 'existing', true);
    END IF;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p -> 'lines') LOOP
    v_n := v_n + 1;
    v_d := round(COALESCE(nullif(v_line ->> 'debit', '')::numeric, 0), 2);
    v_c := round(COALESCE(nullif(v_line ->> 'credit', '')::numeric, 0), 2);
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts
                    WHERE id = nullif(v_line ->> 'account_id', '')::uuid AND company_id = v_company) THEN
      RAISE EXCEPTION 'Line %: that account does not belong to this company', v_n;
    END IF;
    IF v_d < 0 OR v_c < 0 THEN RAISE EXCEPTION 'Line %: amounts cannot be negative', v_n; END IF;
    IF (v_d > 0) = (v_c > 0) THEN
      RAISE EXCEPTION 'Line %: a line is either money in (debit) or money out (credit), not both and not neither', v_n;
    END IF;
    v_dr := v_dr + v_d;
    v_cr := v_cr + v_c;
  END LOOP;
  IF v_n = 0 THEN RAISE EXCEPTION 'The entry has no lines'; END IF;
  IF v_dr <> v_cr THEN
    RAISE EXCEPTION 'The entry does not balance: money in %, money out % (difference %)', v_dr, v_cr, abs(v_dr - v_cr);
  END IF;
  IF v_dr = 0 THEN RAISE EXCEPTION 'The entry totals zero -- nothing to record'; END IF;

  v_no := fn_next_entry_no(v_company);
  INSERT INTO journal_entries
    (company_id, entry_no, entry_date, memo, status, source_type, source_id, source_event, reversal_of, created_by)
  VALUES
    (v_company, v_no, v_date, nullif(p ->> 'memo', ''), 'draft', v_type, v_src, v_event, v_rev_of, v_actor)
  RETURNING id INTO v_id;

  INSERT INTO journal_entry_lines
    (entry_id, company_id, account_id, debit, credit, description, line_no, orig_currency, orig_amount, fx_rate)
  SELECT v_id, v_company, (l ->> 'account_id')::uuid,
         round(COALESCE(nullif(l ->> 'debit', '')::numeric, 0), 2),
         round(COALESCE(nullif(l ->> 'credit', '')::numeric, 0), 2),
         nullif(l ->> 'description', ''), ord::integer,
         nullif(l ->> 'orig_currency', ''), nullif(l ->> 'orig_amount', '')::numeric, nullif(l ->> 'fx_rate', '')::numeric
    FROM jsonb_array_elements(p -> 'lines') WITH ORDINALITY AS t(l, ord);

  -- The mig 283 balance guard runs again on this transition: third check.
  UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = v_actor WHERE id = v_id;

  RETURN jsonb_build_object('id', v_id, 'entry_no', v_no, 'existing', false);
END;
$fn$;

-- -- Reverse one posted entry (and optionally post its correction) ------------------------------------
-- Everything in one transaction: the mirror entry, the link on the original,
-- and the corrected re-post when p_replacement is given. Reversing twice is a
-- no-op that returns the existing reversal.
CREATE OR REPLACE FUNCTION fn_reverse_journal(p_entry uuid, p_reason text, p_date date DEFAULT NULL, p_replacement jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_e     journal_entries%ROWTYPE;
  v_actor uuid := fn_request_actor();
  v_rev   jsonb;
  v_new   jsonb;
  v_lines jsonb;
BEGIN
  SELECT * INTO v_e FROM journal_entries WHERE id = p_entry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journal entry not found'; END IF;
  IF v_e.status <> 'posted' THEN RAISE EXCEPTION 'Only a posted entry can be reversed (% is %)', v_e.entry_no, v_e.status; END IF;
  IF v_e.reversal_of IS NOT NULL THEN
    RAISE EXCEPTION '% is itself a reversal. To undo it, post a new entry.', v_e.entry_no;
  END IF;
  IF v_e.reversed_by IS NOT NULL THEN
    RETURN jsonb_build_object('reversal_id', v_e.reversed_by, 'existing', true);
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required to reverse an entry'; END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'account_id', account_id, 'debit', credit, 'credit', debit,     -- mirrored on purpose
           'description', description, 'orig_currency', orig_currency,
           'orig_amount', orig_amount, 'fx_rate', fx_rate) ORDER BY line_no)
    INTO v_lines FROM journal_entry_lines WHERE entry_id = v_e.id;

  v_rev := fn_post_journal(jsonb_build_object(
    'company_id', v_e.company_id, 'entry_date', COALESCE(p_date, current_date),
    'memo', 'Reversal of ' || v_e.entry_no || ' -- ' || btrim(p_reason),
    'source_type', v_e.source_type, 'source_id', v_e.source_id, 'source_event', 'reversal',
    'reversal_of', v_e.id, 'actor', v_actor, 'lines', v_lines));

  UPDATE journal_entries
     SET reversed_by = (v_rev ->> 'id')::uuid, reversed_at = now(),
         reversal_reason = btrim(p_reason), updated_at = now()
   WHERE id = v_e.id;

  IF p_replacement IS NOT NULL THEN
    v_new := fn_post_journal(p_replacement || jsonb_build_object('company_id', v_e.company_id, 'actor', v_actor));
  END IF;

  RETURN jsonb_build_object('reversal_id', v_rev ->> 'id', 'reversal_no', v_rev ->> 'entry_no',
                            'replacement', v_new, 'existing', false);
END;
$fn$;

REVOKE ALL ON FUNCTION fn_post_journal(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_post_journal(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_post_journal(jsonb) TO service_role;
REVOKE ALL ON FUNCTION fn_reverse_journal(uuid, text, date, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_reverse_journal(uuid, text, date, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_reverse_journal(uuid, text, date, jsonb) TO service_role;
REVOKE ALL ON FUNCTION fn_next_entry_no(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_next_entry_no(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_next_entry_no(uuid) TO service_role;

-- -- Money rules -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounting_posting_rules (
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_key         text NOT NULL,
  debit_account_id  uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  credit_account_id uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  is_enabled        boolean NOT NULL DEFAULT true,
  updated_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- The audit trigger keys rows on id; this table's natural key is composite.
  id                uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  PRIMARY KEY (company_id, event_key)
);

COMMENT ON TABLE accounting_posting_rules IS
  'Which accounts each automatic posting uses, per company (mig 315). No row = the default code in utils/ledger.js POSTING_EVENTS.';

-- -- Exchange rates --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fx_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  currency       text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  -- How many units of the COMPANY currency one unit of `currency` is worth.
  rate           numeric(18,8) NOT NULL CHECK (rate > 0),
  effective_from date NOT NULL,
  note           text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, currency, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_fx_lookup ON fx_rates (company_id, currency, effective_from DESC);

COMMENT ON TABLE fx_rates IS
  'Accountant-entered exchange rates (mig 315): company-currency units per 1 unit of currency, in force from effective_from until the next row.';

-- -- The missing "paid" steps -----------------------------------------------------------------------------
ALTER TABLE hr_payroll_runs ADD COLUMN IF NOT EXISTS paid_at                  timestamptz;
ALTER TABLE hr_payroll_runs ADD COLUMN IF NOT EXISTS paid_by                  uuid;
ALTER TABLE hr_payroll_runs ADD COLUMN IF NOT EXISTS payment_reference        text;
ALTER TABLE hr_payroll_runs ADD COLUMN IF NOT EXISTS payment_journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL;
ALTER TABLE expenses        ADD COLUMN IF NOT EXISTS reimbursement_journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL;

ALTER TABLE accounting_posting_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_rates                 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON accounting_posting_rules FROM anon, authenticated;
REVOKE ALL ON fx_rates                 FROM anon, authenticated;

-- Both settings tables are part of the complete record (mig 313).
DROP TRIGGER IF EXISTS trg_module_audit ON accounting_posting_rules;
CREATE TRIGGER trg_module_audit AFTER INSERT OR UPDATE OR DELETE ON accounting_posting_rules
  FOR EACH ROW EXECUTE FUNCTION fn_module_audit('accounting', '');
DROP TRIGGER IF EXISTS trg_module_audit ON fx_rates;
CREATE TRIGGER trg_module_audit AFTER INSERT OR UPDATE OR DELETE ON fx_rates
  FOR EACH ROW EXECUTE FUNCTION fn_module_audit('accounting', '');

-- Who may change the money rules and rates.
INSERT INTO permissions (name, description, category) VALUES
  ('accounting.settings.manage', 'Change the money rules (which accounts each posting uses) and exchange rates', 'accounting')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, category = EXCLUDED.category;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM custom_roles r JOIN permissions p ON p.name = 'accounting.settings.manage'
 WHERE r.level::text = 'company_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO schema_migrations (filename, note)
VALUES ('315_ledger_integrity.sql',
        'reversals net to zero (posted stays posted + reversal_of/reversed_by); fn_post_journal / fn_reverse_journal atomic + idempotent; posted entries immutable; per-company posting rules; fx_rates; payroll paid + expense reimbursement entries')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
