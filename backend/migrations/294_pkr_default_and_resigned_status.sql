-- ============================================================================
-- 294_pkr_default_and_resigned_status.sql
--
-- Two unrelated corrections, both reported from the HR module.
--
-- 1. CURRENCY DEFAULTS -> PKR.
--    Every money column defaulted to 'USD', which was a guess baked in when the
--    module was written. It is wrong for this deployment: all three employees on
--    record are PKR. The visible symptom was payroll -- the employees were PKR
--    but both runs were created with the USD default, and the payroll page
--    renders every amount in the RUN's currency, so PKR salaries displayed as $.
--
--    The two existing runs are relabelled to PKR. Only the LABEL was ever wrong;
--    the amounts were typed as rupees and are untouched. There is no ledger
--    inconsistency to worry about -- journal_entries carries no currency of its
--    own, the accounts are per company.
--
--    Nothing is converted at an exchange rate here, and nothing should be: no
--    rate was ever applied on the way in.
--
-- 2. 'resigned' JOINS THE EMPLOYEE STATUS LIST.
--    terminated is the company ending it; resigned is the person ending it. HR
--    needs to tell those apart -- it drives rehire eligibility and it is the
--    first thing anyone asks about a leaver. Widening a CHECK is exactly why
--    these columns are TEXT + CHECK instead of an enum (see the role_level
--    lesson: an enum value can never be removed).
--
-- Verify after applying:
--   SELECT column_name, column_default FROM information_schema.columns
--    WHERE column_name = 'currency'
--      AND table_name IN ('hr_employees','hr_payroll_runs','invoices','expenses');
--   SELECT currency, count(*) FROM hr_payroll_runs GROUP BY 1;   -- PKR
-- ============================================================================

-- -- 1. Defaults ---------------------------------------------------------------
ALTER TABLE hr_employees    ALTER COLUMN currency SET DEFAULT 'PKR';
ALTER TABLE hr_payroll_runs ALTER COLUMN currency SET DEFAULT 'PKR';
ALTER TABLE invoices        ALTER COLUMN currency SET DEFAULT 'PKR';
ALTER TABLE expenses        ALTER COLUMN currency SET DEFAULT 'PKR';

-- Relabel the runs that inherited the old default. Scoped to runs whose people
-- are actually PKR, so a genuinely-USD run elsewhere would be left alone.
UPDATE hr_payroll_runs r
   SET currency = 'PKR', updated_at = now()
 WHERE r.currency = 'USD'
   AND NOT EXISTS (
     SELECT 1
       FROM hr_payroll_entries e
       JOIN hr_employees emp ON emp.id = e.employee_id
      WHERE e.run_id = r.id
        AND coalesce(emp.currency, 'PKR') <> 'PKR'
   );

-- -- 2. resigned ---------------------------------------------------------------
ALTER TABLE hr_employees DROP CONSTRAINT IF EXISTS hr_employees_status_check;
ALTER TABLE hr_employees
  ADD CONSTRAINT hr_employees_status_check
  CHECK (status IN ('active','on_leave','suspended','resigned','terminated'));

COMMENT ON COLUMN hr_employees.status IS
  'active | on_leave | suspended | resigned | terminated (mig 294). resigned = the person left; terminated = the company ended it. Both are departures and both stamp termination_date.';

INSERT INTO schema_migrations (filename, note)
VALUES ('294_pkr_default_and_resigned_status.sql',
        'currency defaults USD->PKR (and relabelled the 2 all-PKR payroll runs, amounts untouched); added resigned to hr_employees.status')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
