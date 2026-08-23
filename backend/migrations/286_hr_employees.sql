-- ============================================================================
-- 286_hr_employees.sql
--
-- HR module, part 1 of 4: departments, positions, employees.
--
-- Every HR table is prefixed hr_ so the module reads as one unit next to the
-- 60-odd tables this database already carries.
--
-- An employee is NOT a user. user_id is nullable on purpose: a company records
-- people who never get a CRM login (warehouse, contractors), and a CRM login can
-- exist with no HR record. Where BOTH exist the link is what lets
--   hr.attendance.view_own / hr.payroll.view_own / hr.reviews.participate
-- resolve "me" server-side -- routes look up hr_employees by
-- (company_id, user_id) and never trust an employee_id from the client.
--
-- Also backfills the FK that 285 deliberately left off, now that the target
-- table exists.
--
-- Verify after applying:
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_name IN ('hr_departments','hr_positions','hr_employees');  -- 3
-- ============================================================================

CREATE TABLE IF NOT EXISTS hr_departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  head_employee_id uuid,          -- FK added after hr_employees exists
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_hrdept_company ON hr_departments (company_id, is_active);

CREATE TABLE IF NOT EXISTS hr_positions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title         text NOT NULL,
  department_id uuid REFERENCES hr_departments(id) ON DELETE SET NULL,
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, title)
);

CREATE INDEX IF NOT EXISTS idx_hrpos_company ON hr_positions (company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_hrpos_dept    ON hr_positions (department_id);

CREATE TABLE IF NOT EXISTS hr_employees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Optional link to the CRM login. See the header: an HR record can exist
  -- without one, and vice versa.
  user_id       uuid,
  employee_no   text NOT NULL,

  first_name    text NOT NULL,
  last_name     text,
  work_email    text,
  personal_email text,
  phone         text,
  date_of_birth date,
  address       text,
  emergency_contact jsonb,

  department_id uuid REFERENCES hr_departments(id) ON DELETE SET NULL,
  position_id   uuid REFERENCES hr_positions(id)   ON DELETE SET NULL,
  manager_employee_id uuid REFERENCES hr_employees(id) ON DELETE SET NULL,

  hire_date        date,
  termination_date date,
  employment_type  text CHECK (employment_type IN ('full_time','part_time','contract','intern','temp')),
  status           text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','on_leave','suspended','terminated')),

  -- Compensation is manual-entry in this phase (see payroll TODOs in 288).
  base_salary   numeric(14,2),
  pay_frequency text CHECK (pay_frequency IN ('weekly','biweekly','semi_monthly','monthly')),
  currency      text NOT NULL DEFAULT 'USD',

  notes         text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_no)
);

-- One HR record per CRM user per company. Partial, so the many employees with
-- no login do not collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hremp_company_user
  ON hr_employees (company_id, user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hremp_company_status ON hr_employees (company_id, status);
CREATE INDEX IF NOT EXISTS idx_hremp_dept           ON hr_employees (department_id);
CREATE INDEX IF NOT EXISTS idx_hremp_manager        ON hr_employees (manager_employee_id);
CREATE INDEX IF NOT EXISTS idx_hremp_user           ON hr_employees (user_id);

COMMENT ON COLUMN hr_employees.user_id IS
  'Optional link to auth user (mig 286). Self-service HR routes resolve the caller via (company_id, user_id) -- they never accept an employee_id from the client.';

-- Deferred FKs, now that hr_employees exists.
ALTER TABLE hr_departments DROP CONSTRAINT IF EXISTS hr_departments_head_employee_fk;
ALTER TABLE hr_departments
  ADD CONSTRAINT hr_departments_head_employee_fk
  FOREIGN KEY (head_employee_id) REFERENCES hr_employees(id) ON DELETE SET NULL;

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_employee_fk;
ALTER TABLE expenses
  ADD CONSTRAINT expenses_employee_fk
  FOREIGN KEY (employee_id) REFERENCES hr_employees(id) ON DELETE SET NULL;

ALTER TABLE hr_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_positions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employees   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hr_departments FROM anon;
REVOKE ALL ON hr_positions   FROM anon;
REVOKE ALL ON hr_employees   FROM anon;
