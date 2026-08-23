-- ============================================================================
-- 284_accounting_invoicing.sql
--
-- Accounting module, part 2 of 3: invoices, line items, payments.
--
-- Money totals are TRIGGER-FED, not route-fed. The brief asked the route to
-- auto-update invoices.status / amount_paid on payment insert; doing that in
-- the route AND leaving the table writable elsewhere is exactly how the sales
-- denormalized-column drift happened (see memory: sale_denormalized_columns).
-- So the database owns the arithmetic:
--
--   invoice_line_items  change -> recompute invoices.subtotal/tax_total/total
--   invoice_payments    change -> recompute invoices.amount_paid + status
--
-- backend/routes/accounting/invoices.js writes the child row and re-reads the
-- parent. One writer, no drift. The recompute triggers are STATEMENT-level with
-- a transition table, so a multi-row bulk insert of line items or payments
-- reconciles once at the end instead of fighting itself per row (mig 091 lesson).
--
-- balance_due is a GENERATED column -- it can never disagree with its inputs.
-- Read it, never set it.
--
-- Verify after applying:
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_name IN ('invoices','invoice_line_items','invoice_payments');  -- 3
-- ============================================================================

-- -- Invoices ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_no     text NOT NULL,

  -- Customer. Free text by design: this module bills anyone, not only CRM
  -- customers. customer_uuid / sale_id are OPTIONAL links back into the CRM
  -- (customer_uuid is the UUIDv5(normalized_phone) identity from mig 079/085).
  customer_name  text NOT NULL,
  customer_email text,
  customer_phone text,
  customer_uuid  uuid,
  sale_id        uuid REFERENCES sales(id) ON DELETE SET NULL,

  issue_date     date NOT NULL DEFAULT CURRENT_DATE,
  due_date       date,
  currency       text NOT NULL DEFAULT 'USD',

  -- Maintained by fn_invoice_recalc_totals / fn_invoice_recalc_paid. Do not
  -- write these from route code.
  subtotal       numeric(14,2) NOT NULL DEFAULT 0,
  tax_total      numeric(14,2) NOT NULL DEFAULT 0,
  discount_total numeric(14,2) NOT NULL DEFAULT 0,
  total          numeric(14,2) NOT NULL DEFAULT 0,
  amount_paid    numeric(14,2) NOT NULL DEFAULT 0,
  balance_due    numeric(14,2) GENERATED ALWAYS AS (total - amount_paid) STORED,

  status         text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','sent','partial','paid','overdue','void')),
  notes          text,
  terms          text,
  journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, invoice_no)
);

CREATE INDEX IF NOT EXISTS idx_inv_company_status ON invoices (company_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_company_issue  ON invoices (company_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_due            ON invoices (company_id, due_date);
CREATE INDEX IF NOT EXISTS idx_inv_customer_uuid  ON invoices (customer_uuid);

COMMENT ON COLUMN invoices.amount_paid IS
  'Trigger-maintained sum of invoice_payments (mig 284). Never write from route code.';

-- -- Line items --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id  uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity    numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity   >= 0),
  unit_price  numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  tax_rate    numeric(6,3)  NOT NULL DEFAULT 0 CHECK (tax_rate   >= 0),
  discount    numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount   >= 0),
  net_total   numeric(14,2) GENERATED ALWAYS AS (round(quantity * unit_price, 2) - discount) STORED,
  tax_amount  numeric(14,2) GENERATED ALWAYS AS
                (round((round(quantity * unit_price, 2) - discount) * tax_rate / 100, 2)) STORED,
  line_no     integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ili_invoice ON invoice_line_items (invoice_id, line_no);
CREATE INDEX IF NOT EXISTS idx_ili_company ON invoice_line_items (company_id);

-- -- Payments ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_at     timestamptz NOT NULL DEFAULT now(),
  method      text CHECK (method IN ('card','ach','cash','check','wire','other')),
  reference   text,
  note        text,
  journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ipay_invoice ON invoice_payments (invoice_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_ipay_company ON invoice_payments (company_id, paid_at DESC);

-- -- Totals from line items --------------------------------------------------
CREATE OR REPLACE FUNCTION fn_invoice_recalc_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE invoices i
     SET subtotal       = t.net,
         tax_total      = t.tax,
         discount_total = t.disc,
         total          = t.net + t.tax,
         updated_at     = now()
    FROM (
      SELECT inv.id,
             COALESCE(SUM(l.net_total),  0) AS net,
             COALESCE(SUM(l.tax_amount), 0) AS tax,
             COALESCE(SUM(l.discount),   0) AS disc
        FROM invoices inv
        LEFT JOIN invoice_line_items l ON l.invoice_id = inv.id
       WHERE inv.id IN (SELECT invoice_id FROM changed_rows)
       GROUP BY inv.id
    ) t
   WHERE i.id = t.id;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ili_recalc_ins ON invoice_line_items;
CREATE TRIGGER trg_ili_recalc_ins
  AFTER INSERT ON invoice_line_items
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION fn_invoice_recalc_totals();

DROP TRIGGER IF EXISTS trg_ili_recalc_upd ON invoice_line_items;
CREATE TRIGGER trg_ili_recalc_upd
  AFTER UPDATE ON invoice_line_items
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION fn_invoice_recalc_totals();

DROP TRIGGER IF EXISTS trg_ili_recalc_del ON invoice_line_items;
CREATE TRIGGER trg_ili_recalc_del
  AFTER DELETE ON invoice_line_items
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION fn_invoice_recalc_totals();

-- -- amount_paid + status from payments --------------------------------------
-- Status rules, in order:
--   void / draft   -> left alone (a draft that gets paid is a data-entry error
--                     the operator should see, not something to silently mark paid)
--   paid >= total  -> paid
--   paid > 0       -> partial
--   else           -> overdue if due_date has passed, otherwise back to sent
CREATE OR REPLACE FUNCTION fn_invoice_recalc_paid()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE invoices i
     SET amount_paid = t.paid,
         status = CASE
                    WHEN i.status IN ('void','draft')             THEN i.status
                    WHEN t.paid >= i.total AND i.total > 0        THEN 'paid'
                    WHEN t.paid > 0                               THEN 'partial'
                    WHEN i.due_date IS NOT NULL
                     AND i.due_date < CURRENT_DATE                THEN 'overdue'
                    ELSE 'sent'
                  END,
         updated_at = now()
    FROM (
      SELECT inv.id, COALESCE(SUM(p.amount), 0) AS paid
        FROM invoices inv
        LEFT JOIN invoice_payments p ON p.invoice_id = inv.id
       WHERE inv.id IN (SELECT invoice_id FROM changed_rows)
       GROUP BY inv.id
    ) t
   WHERE i.id = t.id;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ipay_recalc_ins ON invoice_payments;
CREATE TRIGGER trg_ipay_recalc_ins
  AFTER INSERT ON invoice_payments
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION fn_invoice_recalc_paid();

DROP TRIGGER IF EXISTS trg_ipay_recalc_upd ON invoice_payments;
CREATE TRIGGER trg_ipay_recalc_upd
  AFTER UPDATE ON invoice_payments
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION fn_invoice_recalc_paid();

DROP TRIGGER IF EXISTS trg_ipay_recalc_del ON invoice_payments;
CREATE TRIGGER trg_ipay_recalc_del
  AFTER DELETE ON invoice_payments
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION fn_invoice_recalc_paid();

-- Editing line items changes total, which can change whether the invoice is
-- fully paid. Re-run the paid/status pass whenever totals move. The depth guard
-- keeps this from recursing into itself.
CREATE OR REPLACE FUNCTION fn_invoice_restatus_after_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE invoices i
     SET status = CASE
                    WHEN i.status IN ('void','draft')       THEN i.status
                    WHEN i.amount_paid >= i.total
                     AND i.total > 0                        THEN 'paid'
                    WHEN i.amount_paid > 0                  THEN 'partial'
                    WHEN i.due_date IS NOT NULL
                     AND i.due_date < CURRENT_DATE          THEN 'overdue'
                    ELSE 'sent'
                  END
   WHERE i.id = NEW.id;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_inv_restatus ON invoices;
CREATE TRIGGER trg_inv_restatus
  AFTER UPDATE OF total ON invoices
  FOR EACH ROW
  WHEN (OLD.total IS DISTINCT FROM NEW.total AND pg_trigger_depth() < 3)
  EXECUTE FUNCTION fn_invoice_restatus_after_totals();

-- -- Lock down ---------------------------------------------------------------
ALTER TABLE invoices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON invoices           FROM anon;
REVOKE ALL ON invoice_line_items FROM anon;
REVOKE ALL ON invoice_payments   FROM anon;
