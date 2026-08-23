-- ============================================================================
-- 290_accounting_hr_roles_permissions.sql
--
-- Accounting + HR: role levels, the designation table, the permission catalog,
-- and the default grants. Apply LAST of 283-290.
--
-- ---------------------------------------------------------------------------
-- 1. ROLE LEVELS
-- ---------------------------------------------------------------------------
-- custom_roles.level is the Postgres ENUM `role_level` (mig 001, replaced in
-- 003, extended in 016 and 168). It is extensible, so three new rungs are added
-- the same way mig 168 added qa_manager / qa_agent.
--
-- NOTE, and it matters: an enum value can NEVER be dropped. Nothing below uses
-- the new values (no casts, no comparisons), which is what makes it safe to run
-- ADD VALUE and the seed in the same paste. Do not add a query to this file that
-- casts to one of them -- Postgres refuses to use a value added in the same
-- transaction, and the Supabase SQL editor wraps every paste in one.
--
-- Hierarchy placement (backend/models/helpers.js ROLE_HIERARCHY, and
-- frontend/src/utils/roleRouting.js are updated to match):
--     accountant  -> tier 4, beside compliance_manager
--     hr_manager  -> tier 4, beside compliance_manager
--     employee    -> tier 6, beside fronter (self-service only)
--
-- ---------------------------------------------------------------------------
-- 2. DESIGNATIONS -- the part that was actually asked for
-- ---------------------------------------------------------------------------
-- In practice nobody will be given the accountant or hr_manager ROLE: the people
-- who do these jobs already hold compliance_manager, company_admin or
-- operations_manager, and moving their role would move their shell and their
-- permissions. Exactly the qa_manager problem, solved exactly the way mig 227
-- solved it -- a DESIGNATION.
--
--   module_designations(user_id, module) = "this user ALSO works as that"
--
-- One row per module, so a superadmin can give one person accounting, or HR, or
-- both, from the User Control Center, and their existing role is untouched.
-- A designation grants that module in full; the permission rows below stay the
-- authority for everyone else.
--
-- ---------------------------------------------------------------------------
-- 3. PERMISSIONS
-- ---------------------------------------------------------------------------
-- The `permissions` table is (name, description, category) -- NOT `module`.
-- Category is the existing grouping column the AdminPanel permission UI reads.
--
-- Verify after applying:
--   SELECT category, count(*) FROM permissions
--    WHERE category IN ('accounting','hr') GROUP BY 1;          -- 10 / 15
--   SELECT unnest(enum_range(NULL::role_level))::text;          -- includes the 3 new
--   SELECT count(*) FROM module_designations;                   -- 0 until designated
-- ============================================================================

-- -- 1. Role levels ------------------------------------------------------------
ALTER TYPE role_level ADD VALUE IF NOT EXISTS 'accountant';
ALTER TYPE role_level ADD VALUE IF NOT EXISTS 'hr_manager';
ALTER TYPE role_level ADD VALUE IF NOT EXISTS 'employee';

-- -- 2. Designations -----------------------------------------------------------
-- Mirrors qa_managers (mig 227): no FK on user_id, RLS on, anon revoked.
-- Everything reaches this through the service role in backend/routes/users.js
-- and backend/utils/moduleAccess.js.
CREATE TABLE IF NOT EXISTS module_designations (
  user_id       uuid NOT NULL,
  module        text NOT NULL CHECK (module IN ('accounting','hr')),
  designated_by uuid,
  designated_at timestamptz NOT NULL DEFAULT now(),
  note          text,
  PRIMARY KEY (user_id, module)
);

CREATE INDEX IF NOT EXISTS idx_moddesig_module ON module_designations (module);

COMMENT ON TABLE module_designations IS
  'Users who ALSO act as an accountant or HR manager without holding that role (mig 290). Superadmin-managed from the User Control Center; read by backend/utils/moduleAccess.js.';

ALTER TABLE module_designations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON module_designations FROM anon;

-- -- 3. Permission catalog ------------------------------------------------------
INSERT INTO permissions (name, description, category) VALUES
  ('accounting.accounts.view',    'View the chart of accounts',                              'accounting'),
  ('accounting.accounts.manage',  'Create, edit and archive ledger accounts',                'accounting'),
  ('accounting.journal.view',     'Browse journal entries and the general ledger',           'accounting'),
  ('accounting.journal.manage',   'Create, post and void journal entries',                   'accounting'),
  ('accounting.invoices.view',    'View invoices and their payments',                        'accounting'),
  ('accounting.invoices.manage',  'Create and edit invoices, and record payments',           'accounting'),
  ('accounting.expenses.view',    'View all expense claims for the company',                 'accounting'),
  ('accounting.expenses.submit',  'Submit own expense claims',                               'accounting'),
  ('accounting.expenses.approve', 'Approve, reject and reimburse expense claims',            'accounting'),
  ('accounting.reports.view',     'View profit and loss and balance sheet reports',          'accounting'),

  ('hr.employees.view',        'View the employee directory and profiles',        'hr'),
  ('hr.employees.manage',      'Create and edit employees, departments and positions', 'hr'),
  ('hr.attendance.view_own',   'View own attendance record',                      'hr'),
  ('hr.attendance.view_team',  'View attendance for the whole company',           'hr'),
  ('hr.attendance.manage',     'Record and correct attendance for others',        'hr'),
  ('hr.leave.request',         'Request leave and see own balances',              'hr'),
  ('hr.leave.view_team',       'View leave requests and balances for the company','hr'),
  ('hr.leave.approve',         'Approve or reject leave requests',                'hr'),
  ('hr.leave.manage',          'Configure leave types and set entitlements',      'hr'),
  ('hr.payroll.view_own',      'View own payslips',                               'hr'),
  ('hr.payroll.view',          'View payroll runs for the company',               'hr'),
  ('hr.payroll.manage',        'Create, edit and finalize payroll runs',          'hr'),
  ('hr.reviews.participate',   'Complete own self-assessment and view own review','hr'),
  ('hr.reviews.view_team',     'View reviews for the company',                    'hr'),
  ('hr.reviews.manage',        'Create review cycles and manage reviews',         'hr')
ON CONFLICT (name) DO UPDATE
  SET description = EXCLUDED.description,
      category    = EXCLUDED.category;

-- -- 4. Default grants ----------------------------------------------------------
-- Granted per ROLE LEVEL against every existing custom_roles row at that level.
-- Idempotent: role_permissions has UNIQUE(role_id, permission_id).
--
-- Everything not listed here is reached either by a designation (module_
-- designations) or by a per-user grant in user_permission_overrides -- the same
-- two escape hatches every other module in this app uses.

-- company_admin: the whole of both modules.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM custom_roles r
  JOIN permissions  p ON p.category IN ('accounting','hr')
 WHERE r.level::text = 'company_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- operations_manager: read the books, run the people side, no payroll writes.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM custom_roles r
  JOIN permissions  p ON p.name IN (
        'accounting.accounts.view','accounting.journal.view','accounting.invoices.view',
        'accounting.expenses.view','accounting.expenses.submit','accounting.expenses.approve',
        'accounting.reports.view',
        'hr.employees.view','hr.attendance.view_own','hr.attendance.view_team',
        'hr.leave.request','hr.leave.view_team','hr.leave.approve',
        'hr.payroll.view_own','hr.payroll.view',
        'hr.reviews.participate','hr.reviews.view_team','hr.reviews.manage')
 WHERE r.level::text = 'operations_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Team leads: self-service plus visibility over their people.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM custom_roles r
  JOIN permissions  p ON p.name IN (
        'accounting.expenses.submit',
        'hr.attendance.view_own','hr.attendance.view_team',
        'hr.leave.request','hr.leave.view_team','hr.leave.approve',
        'hr.payroll.view_own',
        'hr.reviews.participate','hr.reviews.view_team')
 WHERE r.level::text IN ('closer_manager','fronter_manager','manager',
                         'compliance_manager','qa_manager')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Everyone else: strictly their own record.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM custom_roles r
  JOIN permissions  p ON p.name IN (
        'accounting.expenses.submit',
        'hr.attendance.view_own',
        'hr.leave.request',
        'hr.payroll.view_own',
        'hr.reviews.participate')
 WHERE r.level::text IN ('closer','fronter','qa_agent','operations')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- readonly_admin is deliberately absent: readonlyGuard blocks its writes anyway,
-- and its visibility is governed per-user by mig 209, not by blanket grants.
