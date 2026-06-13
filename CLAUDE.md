# BizTrix CRM v2.0 — Claude Code Guide

## Stack
- **Backend**: Node.js + Express, Supabase (PostgreSQL + Auth + Realtime), JWT auth via Supabase
- **Frontend**: React + Vite, Tailwind CSS (utility classes + CSS variables), React Router v6
- **Notifications**: VAPID Web Push (`web-push` lib) + Supabase Realtime + 30s polling fallback
- **Scheduler**: `callbackScheduler.js` runs every 60s via `setInterval` in the Express process

## Repo Layout
```
backend/
  routes/          # One file per resource (sales, transfers, callbacks, compliance, …)
  utils/           # logger, notificationService, pushService, callbackScheduler, featureGate
  middleware/      # authMiddleware (JWT → req.user), errorHandler
  models/          # helpers.js — hasPermission, isSuperAdmin, getUserCompanies, …
  migrations/      # Sequential SQL files (001_… to 022_…) — apply manually in Supabase
  config/database.js  # supabaseAdmin (service role) + supabaseClient (anon)
frontend/
  src/
    shells/        # One shell per role group (StaffShell, ManagerShell, ComplianceShell, AdminPanel)
    components/    # Shared + role-specific UI (Callbacks/, Closer/, Shared/, UI/, Layout/)
    contexts/      # AuthContext, ThemeContext, FeatureFlagsContext
    hooks/         # useSales, useFormFields, useSaleConfigs, useNotifications, …
    api/client.js  # Axios instance — baseURL = VITE_API_URL || http://localhost:3001/api
```

## Role Hierarchy (highest → lowest)
```
superadmin → readonly_admin → compliance_manager →
company_admin → operations_manager → closer_manager → fronter_manager →
closer → fronter
```
- Roles stored in `custom_roles` table, linked via `user_company_roles`
- `req.user.role` = the `level` field of the user's active custom role
- `isSuperAdmin()` and `hasPermission()` helpers are in `backend/models/helpers.js`
- Superadmin bypasses all permission checks

## Multi-Tenant Architecture
- **Fronter companies** generate leads → create Transfers
- **Closer companies** work leads → create Sales from Transfers
- Companies linked via `company_links` table (`fronter_company_id ↔ closer_company_id`)
- Each user belongs to one or more companies via `user_company_roles`
- `req.user.company_id` = their primary company from JWT metadata

## Authentication
- Supabase Auth — JWT tokens, refresh handled client-side
- `authMiddleware` in Express validates JWT, populates `req.user.{id, email, role, company_id}`
- Superadmin role stamped into `app_metadata.role` on startup via `syncSuperadminMetadata()`
- Frontend: `AuthContext` exposes `user`, `hasPermission(key)`, `login`, `logout`, `updateUser`

## Feature Flags
- Two tables: `feature_flags` (catalog with `default_enabled`) + `company_feature_flags` (per-company overrides)
- Frontend: `useFeatureFlags()` → `isEnabled(key)` — checks company-specific flags
- Backend gate: `requireFeature('key')` middleware (in `utils/featureGate.js`)
- **Note**: `isEnabled` from `FeatureFlagsContext` is NOT memoized — never put it in `useCallback` deps. Use it at render time only.

## Permissions
- Permissions stored per-role in `role_permissions` table
- `hasPermission(userId, companyId, key)` in `models/helpers.js` for backend
- `hasPermission(key)` from `AuthContext` for frontend
- Special override table: `user_permission_overrides` (per-user grants/denials)

## Shell Routing
```
/dashboard  → role-based redirect to the correct shell
/staff      → StaffShell   (closer, fronter)
/manager    → ManagerShell (manager roles, company_admin, operations_manager, …)
/compliance → ComplianceShell (compliance_manager)
/admin      → AdminPanel   (superadmin, readonly_admin)
```

## Compliance Role
- Can see ALL companies, ALL transfers (read-only), ALL callbacks (read-only), ALL sales (full management)
- Own routes: `GET /api/compliance/{companies,sales,transfers,callbacks,users}`
- Can approve/return/update/delete sales across all companies
- Export: all tabs have CSV export with per-user + date-range filtering

## Dynamic Form Fields
- `form_fields` table — admin-configurable fields for the Transfer and Sale forms
- Special `field_type` values: `sale_plan`, `sale_fronter`, `sale_date`, `sale_status`, `sale_down_payment`, `sale_monthly_payment`, `sale_payment_due_note`, `sale_reference_no`, `sale_client`
- Frontend: `useFormFields()` hook — fetches and caches field config
- `SaleForm.jsx` renders only dynamic fields (no hardcoded sections)

## Callback Timezone Rule
- Always store `callback_at` as UTC ISO string
- `datetime-local` input gives bare local string → convert with `new Date(str).toISOString()` before saving
- `toLocalInputValue(utcIso)` helper in `CallbacksPage.jsx` converts UTC → local for display in input

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
// DON'T: isEnabled() in deps — it's a new ref every render
```

### CSV download (client-side)
```javascript
downloadCSV(rows, headers, filename)  // defined inline in compliance/manager shells
```

## Database Migrations
Files in `backend/migrations/` — apply in order via Supabase SQL editor.
Current highest: `088_vin_active_policy.sql`

Notable migrations:
- `007_roles_transfers_compliance.sql` — compliance workflow
- `015_callback_numbers.sql` — callback number tracking
- `020_feature_flags.sql` — global feature catalog
- `021_per_company_feature_flags.sql` — per-company flag overrides
- `079_customer_uuid.sql` — deterministic UUIDv5(normalized_phone) customer identity on `sales`
- `085_customer_uuid_on_transfers.sql` — same customer_uuid on `transfers` (joins leads → policies)
- `086_transfer_assignments.sql` — append-only lead reassignment chain (trigger-fed)
- `087_policy_events.sql` — typed immutable policy lifecycle timeline (trigger-fed)
- `088_vin_active_policy.sql` — one active policy per VIN; `superseded_by` auto-retires the prior policy

### Customer / policy data model (085–088)
- **Customer identity** = `customer_uuid` (UUIDv5 of `normalized_phone`), present on both `sales` and `transfers`. No `customers` table — the uuid IS the canonical id. Join lead history to policies on `customer_uuid`.
- **Transfer chain**: `transfer_assignments` logs every `assigned_closer_id` change. Current owner is still `transfers.assigned_closer_id`; the log gives the full A→B→C history.
- **Policy lifecycle**: `policy_events` (sold/submitted/approved/returned/cancelled/superseded/…). Fed by `trg_log_policy_event` on `sales` — never written by route code. Logging triggers swallow errors so they can never block a sale/transfer write.
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
