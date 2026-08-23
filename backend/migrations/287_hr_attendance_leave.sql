-- ============================================================================
-- 287_hr_attendance_leave.sql
--
-- HR module, part 2 of 4: attendance, leave types, balances, requests.
--
-- The balance rule, which is the whole point of this file: approving a leave
-- request DECREMENTS the matching balance. That happens in a trigger, not in
-- backend/routes/hr/leave.js, for the same reason invoice totals do (mig 284):
-- if the route owns the arithmetic and anything else ever writes the table, the
-- two silently disagree and nobody notices until someone is short a week.
--
--   pending  -> approved   : used_days += request.days
--   approved -> rejected   : used_days -= request.days   (approval reversed)
--   approved -> cancelled  : used_days -= request.days
--
-- No balance row for that (employee, type, year)? One is created with
-- entitled_days = the leave type default, so an approval can never fail just
-- because nobody pre-seeded the year.
--
-- remaining_days is GENERATED -- it cannot drift from entitled minus used.
--
-- Verify after applying:
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_name IN ('hr_attendance','hr_leave_types','hr_leave_balances','hr_leave_requests');  -- 4
-- ============================================================================

-- -- Attendance --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_attendance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  work_date    date NOT NULL,
  check_in     timestamptz,
  check_out    timestamptz,
  -- Manual-entry in this phase. Left NULL when the route cannot derive it from
  -- check_in/check_out; the UI shows a dash, never a fabricated zero.
  hours_worked numeric(6,2) CHECK (hours_worked >= 0),
  status       text NOT NULL DEFAULT 'present'
               CHECK (status IN ('present','absent','late','half_day','remote','holiday','on_leave')),
  note         text,
  recorded_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_hratt_company_date ON hr_attendance (company_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_hratt_employee     ON hr_attendance (employee_id, work_date DESC);

-- -- Leave types -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_leave_types (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code         text NOT NULL,
  name         text NOT NULL,
  default_days numeric(6,2) NOT NULL DEFAULT 0 CHECK (default_days >= 0),
  is_paid      boolean NOT NULL DEFAULT true,
  requires_approval boolean NOT NULL DEFAULT true,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_hrlt_company ON hr_leave_types (company_id, is_active);

-- -- Balances ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_leave_balances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  leave_type_id  uuid NOT NULL REFERENCES hr_leave_types(id) ON DELETE CASCADE,
  year           integer NOT NULL,
  entitled_days  numeric(6,2) NOT NULL DEFAULT 0 CHECK (entitled_days >= 0),
  -- Trigger-maintained. Do not write from route code.
  used_days      numeric(6,2) NOT NULL DEFAULT 0 CHECK (used_days >= 0),
  remaining_days numeric(6,2) GENERATED ALWAYS AS (entitled_days - used_days) STORED,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, leave_type_id, year)
);

CREATE INDEX IF NOT EXISTS idx_hrlb_employee ON hr_leave_balances (employee_id, year);

COMMENT ON COLUMN hr_leave_balances.used_days IS
  'Trigger-maintained by fn_hr_leave_apply_balance (mig 287). Never write from route code.';

-- -- Requests ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_leave_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES hr_leave_types(id) ON DELETE RESTRICT,
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  -- Stored, not derived: half days and company holidays mean the calendar span
  -- is not the number of days taken.
  days          numeric(6,2) NOT NULL CHECK (days > 0),
  reason        text,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by  uuid,
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrlr_date_order CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_hrlr_company_status ON hr_leave_requests (company_id, status);
CREATE INDEX IF NOT EXISTS idx_hrlr_employee       ON hr_leave_requests (employee_id, start_date DESC);

-- -- Balance movement ---------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_hr_leave_apply_balance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_year  integer := EXTRACT(YEAR FROM NEW.start_date)::integer;
  v_delta numeric(6,2) := 0;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status <> 'approved') THEN
    v_delta := NEW.days;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'approved' AND NEW.status <> 'approved' THEN
    v_delta := -OLD.days;
  END IF;

  IF v_delta = 0 THEN
    RETURN NEW;
  END IF;

  -- Ensure a balance row exists for this year, seeded from the leave type.
  INSERT INTO hr_leave_balances (company_id, employee_id, leave_type_id, year, entitled_days, used_days)
  SELECT NEW.company_id, NEW.employee_id, NEW.leave_type_id, v_year,
         COALESCE(lt.default_days, 0), 0
    FROM hr_leave_types lt
   WHERE lt.id = NEW.leave_type_id
  ON CONFLICT (company_id, employee_id, leave_type_id, year) DO NOTHING;

  UPDATE hr_leave_balances
     SET used_days  = GREATEST(0, used_days + v_delta),
         updated_at = now()
   WHERE company_id    = NEW.company_id
     AND employee_id   = NEW.employee_id
     AND leave_type_id = NEW.leave_type_id
     AND year          = v_year;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_hr_leave_balance ON hr_leave_requests;
CREATE TRIGGER trg_hr_leave_balance
  AFTER INSERT OR UPDATE OF status ON hr_leave_requests
  FOR EACH ROW EXECUTE FUNCTION fn_hr_leave_apply_balance();

ALTER TABLE hr_attendance     ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_types    ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hr_attendance     FROM anon;
REVOKE ALL ON hr_leave_types    FROM anon;
REVOKE ALL ON hr_leave_balances FROM anon;
REVOKE ALL ON hr_leave_requests FROM anon;
