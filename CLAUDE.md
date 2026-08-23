# BizTrix CRM v2.0 â€” Claude Code Guide

## Stack
- **Backend**: Node.js + Express, Supabase (PostgreSQL + Auth + Realtime), JWT auth via Supabase
- **Frontend**: React + Vite, Tailwind CSS (utility classes + CSS variables), React Router v6
- **Notifications**: VAPID Web Push (`web-push` lib) + Supabase Realtime + 30s polling fallback
- **Scheduler**: `callbackScheduler.js` runs every 60s via `setInterval` in the Express process

## Repo Layout
```
backend/
  routes/          # One file per resource (sales, transfers, callbacks, compliance, â€¦)
  utils/           # logger, notificationService, pushService, callbackScheduler, featureGate
  middleware/      # authMiddleware (JWT â†’ req.user), errorHandler
  models/          # helpers.js â€” hasPermission, isSuperAdmin, getUserCompanies, â€¦
  migrations/      # Sequential SQL files (001_â€¦ to 022_â€¦) â€” apply manually in Supabase
  config/database.js  # supabaseAdmin (service role) + supabaseClient (anon)
frontend/
  src/
    shells/        # One shell per role group (StaffShell, ManagerShell, ComplianceShell, AdminPanel)
    components/    # Shared + role-specific UI (Callbacks/, Closer/, Shared/, UI/, Layout/)
    contexts/      # AuthContext, ThemeContext, FeatureFlagsContext
    hooks/         # useSales, useFormFields, useSaleConfigs, useNotifications, â€¦
    api/client.js  # Axios instance â€” baseURL = VITE_API_URL || http://localhost:3001/api
```

## Role Hierarchy (highest â†’ lowest)
```
superadmin â†’ readonly_admin â†’ compliance_manager â†’
company_admin â†’ operations_manager â†’ closer_manager â†’ fronter_manager â†’
closer â†’ fronter
```
- Roles stored in `custom_roles` table, linked via `user_company_roles`
- `req.user.role` = the `level` field of the user's active custom role
- `isSuperAdmin()` and `hasPermission()` helpers are in `backend/models/helpers.js`
- Superadmin bypasses all permission checks

## Multi-Tenant Architecture
- **Fronter companies** generate leads â†’ create Transfers
- **Closer companies** work leads â†’ create Sales from Transfers
- Companies linked via `company_links` table (`fronter_company_id â†” closer_company_id`)
- Each user belongs to one or more companies via `user_company_roles`
- `req.user.company_id` = their primary company from JWT metadata

## Authentication
- Supabase Auth â€” JWT tokens, refresh handled client-side
- `authMiddleware` in Express validates JWT, populates `req.user.{id, email, role, company_id}`
- Superadmin role stamped into `app_metadata.role` on startup via `syncSuperadminMetadata()`
- Frontend: `AuthContext` exposes `user`, `hasPermission(key)`, `login`, `logout`, `updateUser`

## Feature Flags
- Two tables: `feature_flags` (catalog with `default_enabled`) + `company_feature_flags` (per-company overrides)
- Frontend: `useFeatureFlags()` â†’ `isEnabled(key)` â€” checks company-specific flags
- Backend gate: `requireFeature('key')` middleware (in `utils/featureGate.js`)
- **Note**: `isEnabled` from `FeatureFlagsContext` is NOT memoized â€” never put it in `useCallback` deps. Use it at render time only.

## Permissions
- Permissions stored per-role in `role_permissions` table
- `hasPermission(userId, companyId, key)` in `models/helpers.js` for backend
- `hasPermission(key)` from `AuthContext` for frontend
- Special override table: `user_permission_overrides` (per-user grants/denials)

## Shell Routing
```
/dashboard  â†’ role-based redirect to the correct shell
/staff      â†’ StaffShell   (closer, fronter)
/manager    â†’ ManagerShell (manager roles, company_admin, operations_manager, â€¦)
/compliance â†’ ComplianceShell (compliance_manager)
/admin      â†’ AdminPanel   (superadmin, readonly_admin)
```

## Compliance Role
- Can see ALL companies, ALL transfers (read-only), ALL callbacks (read-only), ALL sales (full management)
- Own routes: `GET /api/compliance/{companies,sales,transfers,callbacks,users}`
- Can approve/return/update/delete sales across all companies
- Export: all tabs have CSV export with per-user + date-range filtering

## Dynamic Form Fields
- `form_fields` table â€” admin-configurable fields for the Transfer and Sale forms
- Special `field_type` values: `sale_plan`, `sale_fronter`, `sale_date`, `sale_status`, `sale_down_payment`, `sale_monthly_payment`, `sale_payment_due_note`, `sale_reference_no`, `sale_client`
- Frontend: `useFormFields()` hook â€” fetches and caches field config
- `SaleForm.jsx` renders only dynamic fields (no hardcoded sections)

## Callback Timezone Rule
- Always store `callback_at` as UTC ISO string
- `datetime-local` input gives bare local string â†’ convert with `new Date(str).toISOString()` before saving
- `toLocalInputValue(utcIso)` helper in `CallbacksPage.jsx` converts UTC â†’ local for display in input

## Key Patterns

### Backend route guard
```javascript
const superadmin = await isSuperAdmin(userId);
const canDo = superadmin || await hasPermission(userId, companyId, 'permission_key');
if (!canDo) return res.status(403).json({ error: '...' });
```

### Frontend permission gate
```jsx
const canDo = isSuperadmin || hasPermission('permission_key');
// canDo && <button>...</button>
```

### useCallback with filters (safe pattern)
```javascript
// DO: stable primitive deps only
const load = useCallback(async () => { ... }, [page, search, status]);
// DON'T: isEnabled() in deps â€” it's a new ref every render
```

### CSV download (client-side)
```javascript
downloadCSV(rows, headers, filename)  // defined inline in compliance/manager shells
```

## Database Migrations
Files in `backend/migrations/` â€” apply in order via Supabase SQL editor.
Current highest: `223_compliance_manager_qa_scoring.sql` â€” **pending**. 221 and 222 are **applied** (SQL-verified 2026-07-30: post-dates are open 40 / pending_review 0 / cancelled 3). 208 is applied too; the warning that used to sit here was stale.

Accounting + HR (283-290) are **applied** (SQL-verified 2026-08-23: 24 tables, 25 permissions, 365 role grants, 17 triggers, 3 new role_level values). Trigger functions are search_path-pinned.

### Post-dated sales (mig 083 + 221)
A post-date is a **reminder, not a sale** â€” the card has not been charged, so it must never be counted as one. Identity is a string match on `closer_disposition` (`/post[\s_-]?date|postdate/i`) defined in **three places that must stay in sync**: `backend/utils/postDate.js`, `frontend/src/utils/dispositions.js`, and `fn_stamp_post_date` in mig 221.
- Use `excludePostDate(q)` from `backend/utils/postDate.js` for any new sales count. It is NULL-safe â€” the naive `.not('closer_disposition','ilike',â€¦)` evaluates to NULL, not TRUE, for a NULL disposition and silently drops those rows.
- `GET /sales` takes `exclude_post_date=true` (opt-in, so exports and admin tooling still see every row).
- `post_dated_at` / `post_date_converted_at` are trigger-stamped and survive the charge â€” they drive the compliance `P â†’ S` pill. Do **not** try to derive this from `policy_events`: its `charged` event fires on the scheduler's reminder stamp, not on the charge, and it never writes `post_dated` at all.
- Failed charge â†’ `POST /sales/:id/charge-failed` (reason + new date, re-arms the reminder); history in `post_date_attempts`; reason catalog in `business_config.post_date_fail_reasons`.

### QA department (two-tier org â€” mig 208)
Compliance wires the org chart only (assign companies + agents to a quality **manager**); the manager owns all the work (per-agent methods, task assignment, per-company review-type config), scoped to their companies + team. One company â†’ one manager; one agent â†’ one manager (`qa_manager_companies`, `qa_team_members`). `resolveAgent` (transferâ†’company attribution) is now deterministic. See memory: qa_two_tier_org, qa_ux_reporting_2026_07, vicidial_agent_attribution.

Notable migrations:
- `007_roles_transfers_compliance.sql` â€” compliance workflow
- `015_callback_numbers.sql` â€” callback number tracking
- `020_feature_flags.sql` â€” global feature catalog
- `021_per_company_feature_flags.sql` â€” per-company flag overrides
- `079_customer_uuid.sql` â€” deterministic UUIDv5(normalized_phone) customer identity on `sales`
- `085_customer_uuid_on_transfers.sql` â€” same customer_uuid on `transfers` (joins leads â†’ policies)
- `086_transfer_assignments.sql` â€” append-only lead reassignment chain (trigger-fed)
- `087_policy_events.sql` â€” typed immutable policy lifecycle timeline (trigger-fed)
- `088_vin_active_policy.sql` â€” one active policy per VIN; `superseded_by` auto-retires the prior policy. **Reverted by 090** (its BEFORE-insert trigger broke multi-row bulk inserts).
- `090_revert_vin_active_enforcement.sql` â€” drops 088's VIN supersede trigger + `uq_sales_active_vin` index (they 500'd bulk uploads with same-VIN rows in one batch). Keeps the `superseded_by` columns.
- `091_vin_active_reconcile.sql` â€” re-adds one-active-policy-per-VIN **bulk-safely**: a STATEMENT-level AFTER trigger (`fn_reconcile_vin_active`, transition table + `pg_trigger_depth` guard) that reconciles after each insert/update instead of a per-row BEFORE trigger, plus a NON-unique lookup index. Multi-row bulk inserts with duplicate VINs always succeed; only the newest `closed_won` per VIN stays active.

> **VIN rule lesson:** never enforce one-active-per-VIN with a per-row BEFORE trigger that mutates sibling rows or a partial UNIQUE index â€” both break multi-row bulk inserts. Use the statement-level reconcile (091).
- `089_compliance_transfer_records_view.sql` â€” `v_compliance_transfer_records` view: real transfers UNION invisible `refresh` dedup attempts as synthetic rows, so compliance counts/exports reconcile 1:1 with VICIDIAL. `GET /compliance/transfers` reads it by default (falls back to `transfers` if the view is missing)

### Customer / policy data model (085â€“088)
- **Customer identity** = `customer_uuid` (UUIDv5 of `normalized_phone`), present on both `sales` and `transfers`. No `customers` table â€” the uuid IS the canonical id. Join lead history to policies on `customer_uuid`.
- **Transfer chain**: `transfer_assignments` logs every `assigned_closer_id` change. Current owner is still `transfers.assigned_closer_id`; the log gives the full Aâ†’Bâ†’C history.
- **Policy lifecycle**: `policy_events` (sold/submitted/approved/returned/cancelled/superseded/â€¦). Fed by `trg_log_policy_event` on `sales` â€” never written by route code. Logging triggers swallow errors so they can never block a sale/transfer write.
- **One active policy per VIN**: active = `status='closed_won' AND superseded_by IS NULL`. A new `closed_won` on a VIN auto-stamps the prior policy's `superseded_by` (history kept). `pending_review` is intentionally NOT in the active set (compliance race allowed).
- Post-apply check: `node backend/verify_migrations.js`.

## Environment Variables (backend)
```
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
SUPERADMIN_EMAIL         # comma-separated, stamped to app_metadata on startup
VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
PORT                     # default 3001
```

## Git Identity
- Author: Abdul Manan
- Co-author tag: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
- Co-author display: `@abdulmanan69`
- Never use `mibrahim` as author name

### Accounting + HR (migs 283-290, applied 2026-08-23)
Two modules, two shells: `/accounting` (chart of accounts, double-entry journal,
invoices, expenses, P&L + balance sheet) and `/hr` (employees, attendance, leave,
payroll, performance reviews). Drafted as 225-232; those numbers were already
taken, so the set is 283-290.

**Access has two doors.** A permission on the role, OR a superadmin DESIGNATION in
`module_designations` saying someone ALSO works as the accountant / HR manager
without changing their role, shell or permissions. Same answer mig 227 gave for
quality managers, for the same reason: the job is done by people who already hold
compliance_manager / company_admin / operations_manager. Gate every handler with
`deny(req, res, companyId, '<perm>')` from `backend/utils/moduleAccess.js` --
calling `hasPermission` directly makes the designation invisible and shuts the
module for exactly the people it was built for. Shells ask `GET /accounting/my-scope`
and `/hr/my-scope` for the same reason. Toggled at User Control Center -> Modules.

**Money is trigger-fed, never route-fed.** Invoice subtotal/tax/total/amount_paid/
status, payroll entry `deduction_total` and run totals, and `hr_leave_balances.used_days`
all move in the database (see mig 284/287/288). Route code writes the child row and
re-reads the parent. Do not "fix" this by computing in a handler -- that is how the
sales denormalized columns drifted (mig 190).

**Journal balance is guarded three times**: the editor disables Post, the route 422s,
and a BEFORE UPDATE trigger raises. Posted entries are immutable -- void writes a
mirror-image reversal, never a delete. Shared primitives in `backend/utils/ledger.js`
work in integer cents.

**Self-service** (`hr.payroll.view_own`, `hr.reviews.participate`, own attendance/leave)
resolves the caller's `hr_employees` row from `(company_id, user_id)` via `selfEmployee()`.
An `employee_id` from the client is never honoured on those paths.

Payroll is MANUAL ENTRY in this phase -- no tax engine. See `TODO(tax)` in
`backend/routes/hr/payroll.js` for the three attach points.
