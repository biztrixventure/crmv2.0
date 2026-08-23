-- ============================================================================
-- 288_hr_payroll.sql
--
-- HR module, part 3 of 4: pay periods, runs, entries, deductions.
--
-- Payroll is MANUAL-ENTRY by design in this phase. There is no tax engine here
-- and none is implied: gross components and every deduction are typed in by a
-- payroll operator. The database totals what it is given and nothing more --
-- see the TODOs in backend/routes/hr/payroll.js for where a real tax/statutory
-- calculator would attach.
--
-- Arithmetic is trigger-fed and generated, same rule as invoices (284):
--   hr_payroll_deductions change -> entry.deduction_total
--   hr_payroll_entries    change -> run.gross_total / deduction_total / net_total
-- gross_amount and net_amount on the entry are GENERATED columns.
--
-- Finalizing a run is what makes it real: hr/payroll.js flips status to
-- finalized and (optionally) writes a balanced journal_entries row with
-- source_type = 'payroll', linking it back through journal_entry_id.
--
-- Verify after applying:
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_name IN ('hr_pay_periods','hr_payroll_runs','hr_payroll_entries','hr_payroll_deductions');  -- 4
-- ============================================================================

CREATE TABLE IF NOT EXISTS hr_pay_periods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       text NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  pay_date   date,
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, start_date, end_date),
  CONSTRAINT hrpp_date_order CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_hrpp_company ON hr_pay_periods (company_id, start_date DESC);

CREATE TABLE IF NOT EXISTS hr_payroll_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  pay_period_id uuid NOT NULL REFERENCES hr_pay_periods(id) ON DELETE RESTRICT,
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','processing','finalized','void')),
  currency      text NOT NULL DEFAULT 'USD',
  -- Trigger-maintained from hr_payroll_entries. Do not write from route code.
  gross_total     numeric(14,2) NOT NULL DEFAULT 0,
  deduction_total numeric(14,2) NOT NULL DEFAULT 0,
  net_total       numeric(14,2) NOT NULL DEFAULT 0,
  finalized_at  timestamptz,
  finalized_by  uuid,
  voided_at     timestamptz,
  voided_by     uuid,
  journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  note          text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hrpr_company_status ON hr_payroll_runs (company_id, status);
CREATE INDEX IF NOT EXISTS idx_hrpr_period         ON hr_payroll_runs (pay_period_id);

CREATE TABLE IF NOT EXISTS hr_payroll_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  run_id      uuid NOT NULL REFERENCES hr_payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES hr_employees(id) ON DELETE RESTRICT,

  base_amount       numeric(14,2) NOT NULL DEFAULT 0 CHECK (base_amount       >= 0),
  overtime_amount   numeric(14,2) NOT NULL DEFAULT 0 CHECK (overtime_amount   >= 0),
  bonus_amount      numeric(14,2) NOT NULL DEFAULT 0 CHECK (bonus_amount      >= 0),
  commission_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  allowance_amount  numeric(14,2) NOT NULL DEFAULT 0 CHECK (allowance_amount  >= 0),
  gross_amount      numeric(14,2) GENERATED ALWAYS AS
                      (base_amount + overtime_amount + bonus_amount + commission_amount + allowance_amount) STORED,

  -- Trigger-maintained from hr_payroll_deductions.
  deduction_total   numeric(14,2) NOT NULL DEFAULT 0 CHECK (deduction_total >= 0),
  net_amount        numeric(14,2) GENERATED ALWAYS AS
                      (base_amount + overtime_amount + bonus_amount + commission_amount + allowance_amount - deduction_total) STORED,

  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_hrpe_run      ON hr_payroll_entries (run_id);
CREATE INDEX IF NOT EXISTS idx_hrpe_employee ON hr_payroll_entries (employee_id);
CREATE INDEX IF NOT EXISTS idx_hrpe_company  ON hr_payroll_entries (company_id);

CREATE TABLE IF NOT EXISTS hr_payroll_deductions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entry_id   uuid NOT NULL REFERENCES hr_payroll_entries(id) ON DELETE CASCADE,
  -- Vocabulary only. No rates, no thresholds, no jurisdiction -- the operator
  -- types the amount. A future tax engine would compute these instead.
  kind       text NOT NULL DEFAULT 'other'
             CHECK (kind IN ('tax','social','insurance','pension','loan','advance','garnishment','other')),
  label      text NOT NULL,
  amount     numeric(14,2) NOT NULL CHECK (amount >= 0),
  -- Employer-side costs are reported but never subtracted from take-home.
  is_employer_cost boolean NOT NULL DEFAULT false,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hrpd_entry   ON hr_payroll_deductions (entry_id);
CREATE INDEX IF NOT EXISTS idx_hrpd_company ON hr_payroll_deductions (company_id);

-- -- entry.deduction_total from its deductions --------------------------------
CREATE OR REPLACE FUNCTION fn_hr_entry_recalc_deductions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE hr_payroll_entries e
     SET deduction_total = t.total,
         updated_at      = now()
    FROM (
      SELECT en.id, COALESCE(SUM(d.amount) FILTER (WHERE d.is_employer_cost = false), 0) AS total
        FROM hr_payroll_entries en
        LEFT JOIN hr_payroll_deductions d ON d.entry_id = en.id
       WHERE en.id IN (SELECT entry_id FROM changed_rows)
       GROUP BY en.id
    ) t
   WHERE e.id = t.id;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_hrpd_recalc_ins ON hr_payroll_deductions;
CREATE TRIGGER trg_hrpd_recalc_ins
  AFTER INSERT ON hr_payroll_deductions
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION fn_hr_entry_recalc_deductions();

DROP TRIGGER IF EXISTS trg_hrpd_recalc_upd ON hr_payroll_deductions;
CREATE TRIGGER trg_hrpd_recalc_upd
  AFTER UPDATE ON hr_payroll_deductions
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION fn_hr_entry_recalc_deductions();

DROP TRIGGER IF EXISTS trg_hrpd_recalc_del ON hr_payroll_deductions;
CREATE TRIGGER trg_hrpd_recalc_del
  AFTER DELETE ON hr_payroll_deductions
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION fn_hr_entry_recalc_deductions();

-- -- run totals from its entries ----------------------------------------------
CREATE OR REPLACE FUNCTION fn_hr_run_recalc_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE hr_payroll_runs r
     SET gross_total     = t.gross,
         deduction_total = t.deducted,
         net_total       = t.net,
         updated_at      = now()
    FROM (
      SELECT run.id,
             COALESCE(SUM(e.gross_amount),    0) AS gross,
             COALESCE(SUM(e.deduction_total), 0) AS deducted,
             COALESCE(SUM(e.net_amount),      0) AS net
        FROM hr_payroll_runs run
        LEFT JOIN hr_payroll_entries e ON e.run_id = run.id
       WHERE run.id IN (SELECT run_id FROM changed_rows)
       GROUP BY run.id
    ) t
   WHERE r.id = t.id;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_hrpe_recalc_ins ON hr_payroll_entries;
CREATE TRIGGER trg_hrpe_recalc_ins
  AFTER INSERT ON hr_payroll_entries
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION fn_hr_run_recalc_totals();

DROP TRIGGER IF EXISTS trg_hrpe_recalc_upd ON hr_payroll_entries;
CREATE TRIGGER trg_hrpe_recalc_upd
  AFTER UPDATE ON hr_payroll_entries
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION fn_hr_run_recalc_totals();

DROP TRIGGER IF EXISTS trg_hrpe_recalc_del ON hr_payroll_entries;
CREATE TRIGGER trg_hrpe_recalc_del
  AFTER DELETE ON hr_payroll_entries
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION fn_hr_run_recalc_totals();

-- A finalized run is closed. Entries and deductions stop being editable, the
-- same way posted journal lines do (283).
CREATE OR REPLACE FUNCTION fn_hr_run_locked_when_final()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM hr_payroll_runs
   WHERE id = COALESCE(NEW.run_id, OLD.run_id);
  IF v_status IN ('finalized','void') THEN
    RAISE EXCEPTION 'Payroll run is % and can no longer be edited', v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_hrpe_locked ON hr_payroll_entries;
CREATE TRIGGER trg_hrpe_locked
  BEFORE INSERT OR UPDATE OR DELETE ON hr_payroll_entries
  FOR EACH ROW
  WHEN (pg_trigger_depth() < 2)
  EXECUTE FUNCTION fn_hr_run_locked_when_final();

ALTER TABLE hr_pay_periods        ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_payroll_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_payroll_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_payroll_deductions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hr_pay_periods        FROM anon;
REVOKE ALL ON hr_payroll_runs       FROM anon;
REVOKE ALL ON hr_payroll_entries    FROM anon;
REVOKE ALL ON hr_payroll_deductions FROM anon;
