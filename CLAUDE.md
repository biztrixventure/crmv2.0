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
Current highest: `223_compliance_manager_qa_scoring.sql` — **pending**. 221 and 222 are **applied** (SQL-verified 2026-07-30: post-dates are open 40 / pending_review 0 / cancelled 3). 208 is applied too; the warning that used to sit here was stale.

Accounting + HR (283-290) are **applied** (SQL-verified 2026-08-23: 24 tables, 25 permissions, 365 role grants, 17 triggers, 3 new role_level values). Trigger functions are search_path-pinned.

311 is **applied** (SQL-verified 2026-09-11: trainee enum value present, 6 training_* tables, 3 permissions, 64 role grants). See "Training portal" below.

291 + 292 are **applied** (SQL-verified 2026-08-23). 291 = `transfers.xfer_seq`, uniqueness moved to `(vicidial_vendor_code, created_by, xfer_seq)` so a re-transferred recycled lead creates a NEW transfer instead of overwriting the fronter's earlier one — see "Re-transferred leads" below. 292 = repaired 926 transfers whose customer name had been blanked (originals in `transfers_name_backfill_292`, reversible).

322 is **applied** (SQL-verified 2026-09-21: 3 new `distribution_batches` columns, 4 new `distribution_batch_items` columns, `fn_recall_batch_items` / `fn_expire_batch_assignments` / `app_batch_number_lookup` present; the recall path was exercised inside a rolled-back transaction — 1 named row recalled cascaded to 2, parent row unlocked). See "Lent numbers" below.

### Lent numbers — time limits + take-back (mig 322)
Numbers can be **lent, not given**: an assignment carries a deadline, and when it
passes the numbers leave the holder on their own. The loan lives on
`distribution_batches.expires_at` and is mirrored onto
`distribution_batch_items.assign_expires_at` (the row the assigner has open).
- **A take-back works on the HOLDER's rows, never on the assigner's lock alone.**
  Releasing `assigned_to` without hiding the holder's child row left the fronter
  still dialling numbers that had been handed to somebody else. One SQL function
  does it — `fn_recall_batch_items(item_ids, actor, reason)` — and it walks DOWN
  `parent_item_id`, so anyone the holder passed them to loses them too. Every
  door (`POST /recall`, `/:id/unassign`, `/:id/recall-all`, `/reassign`, the
  expiry job) calls it. Do not write a second one.
- Rows are **hidden (`recalled_at`), never deleted** — the event log and the
  disposition survive. Every list filters `recalled_at IS NULL`
  (`app_batch_items`, `app_batch_status_counts`, `app_batch_scoreboard`,
  `app_batch_roster`, `GET /my-numbers`), so a new query MUST filter it too.
- **Only untouched rows unlock.** A row carrying a real disposition keeps its
  outcome and its holder; `/reassign` skips those and says so in the response.
- `fn_mirror_item_status` no longer mirrors status `'new'` upward: a release is
  not an outcome, and mirroring it reset ancestor rows to "New" while the
  manager below still legitimately held them.
- Batch status gained `'expired'`. The holder's inbox filters to `'active'`, so
  an expired batch simply disappears for them while the sender still sees it in
  Sent / All.
- The job is `utils/batchExpiry.js` → `fn_expire_batch_assignments()`, every 5
  min from `utils/scheduler.js`. No-op for assignments without a deadline, which
  is all of them until someone sets one.
- Report: `POST /distribution-batches/number-lookup` (paste or upload a file →
  who holds each number, whole chain) — manager and up, scoped by
  `app_batch_number_lookup` exactly like the 159 roster. UI is
  `components/Distribution/NumberFinder.jsx`, opened from Batches → Find numbers.
- Deadline UI lives in ONE place: `components/Distribution/ExpiryPicker.jsx`
  (+ `utils/expiry.js` for the countdown wording). `datetime-local` → UTC before
  sending, same rule as `callback_at`.

### Unique numbers per agent (mig 323)
Two agents calling one customer is the failure distribution exists to prevent, so
the SAME check runs at every door a number can enter: `phoneHolderMap()` in
`routes/distributionBatches.js`, built on `app_batch_number_lookup`.
- `POST /number-check` — the upload dialog runs it on the parsed file BEFORE the
  batch exists and shows who holds each duplicate; "Upload only the new ones" is
  the default.
- `GET /:id/pool-check` — feeds the assign dialog (counts + who) and the
  workspace (per-row `elsewhere` badge, header total).
- `POST /:id/assign` **filters held numbers by default** (`exclude_held`, opt
  OUT with `false`) and reports `skipped_held`. It is FAIL-OPEN: a broken check
  must never stop a manager dealing numbers.
- Classification, and the two traps in it:
  **`passed_on` ⇒ ignore the row** (the person below is the holder) — and it
  only counts children whose batch is still `active`. 322 forgot that, so a
  number whose child batch was deleted read as held by nobody; mig 323 fixes it.
  **holder == sender and nothing dealt ⇒ POOLED**, not held: not with an agent
  yet, but re-uploading it still duplicates it.
- Baseline when this shipped (2026-09-21): 18,271 live rows, 8,459 numbers with a
  holder, **450 of them held by two or more different people**.

### Re-transferred leads (mig 291)
A VICIdial `lead_id` names a **LEAD, not a transfer EVENT** — the dialer recycles it, so a fronter transferring the same customer again sends the same `vicidial_vendor_code`. Each XFER must get its **own** transfer row so each keeps its own closer disposition; the earlier row is never edited. `a775261` broke this (it reset the old row and merged the incoming payload over its `form_data`, blanking the customer to the literal word "Lead"); fixed in `9b79a16`.
- XFER idempotency keys on **TIME** (`XFER_DEDUP_MS`, 2 min), never on the code — a duplicate webhook lands in seconds, a genuine re-transfer is minutes-to-weeks later. Restoring code-only idempotency silently collapses real transfers.
- A blank from the dialer means "no news", never "clear this field" — `stripBlank()` guards every dialer-sourced patch (~1 XFER in 6 arrives with empty first/last tokens).
- Multiple rows per code are safe because every code lookup already does `.order('created_at',desc).limit(1)`. Verify that before adding a new one.
- No name on the XFER → seeded from the same customer's last named transfer **in the same company**, then from the dialer itself via `enrichFromDialer()` (`lead_field_info`, archive-proof). Historical repair: `POST /api/vicidial/backfill/names` (superadmin, batched + cursor).

### Post-dated sales (mig 083 + 221)
A post-date is a **reminder, not a sale** — the card has not been charged, so it must never be counted as one. Identity is a string match on `closer_disposition` (`/post[\s_-]?date|postdate/i`) defined in **three places that must stay in sync**: `backend/utils/postDate.js`, `frontend/src/utils/dispositions.js`, and `fn_stamp_post_date` in mig 221.
- Use `excludePostDate(q)` from `backend/utils/postDate.js` for any new sales count. It is NULL-safe — the naive `.not('closer_disposition','ilike',…)` evaluates to NULL, not TRUE, for a NULL disposition and silently drops those rows.
- `GET /sales` takes `exclude_post_date=true` (opt-in, so exports and admin tooling still see every row).
- `post_dated_at` / `post_date_converted_at` are trigger-stamped and survive the charge — they drive the compliance `P → S` pill. Do **not** try to derive this from `policy_events`: its `charged` event fires on the scheduler's reminder stamp, not on the charge, and it never writes `post_dated` at all.
- Failed charge → `POST /sales/:id/charge-failed` (reason + new date, re-arms the reminder); history in `post_date_attempts`; reason catalog in `business_config.post_date_fail_reasons`.

### Training portal + trainee role (mig 311)
A trainee is a **fronter who has not been signed off yet** — so promoting one
changes their role and NOTHING else. Every training table keys on `company_id`,
never on the role, and the portal is ONE component
(`frontend/src/components/Training/TrainingPortal.jsx`) mounted by StaffShell,
ManagerShell, ComplianceShell and AdminPanel. The old "My Quizzes" nav item in
the staff/manager shells is now a TAB inside it; `MyQuizzes.jsx` is unchanged and
ComplianceShell still lists it separately.
- `trainee` sits at the **same** hierarchy rung as `fronter` (8 frontend / 6
  backend), not one below — `hasRoleAccess` tests `userLevel <= requiredLevel`,
  so a lower rung locks them out of the `/fronter` route they are routed to.
- Access is the mig 290 **two-door** rule: `training.manage` on the role (seeded
  for fronter_manager and up) OR a superadmin designation naming companies
  (`module_designations`, `module='training'`, User Control Center → Modules).
  Gate every handler with `can()`/`deny()` from `utils/moduleAccess.js` —
  calling `hasPermission` directly makes the designation invisible.
- **Pronunciation is free and must stay free**: `components/Training/useSpeech.js`
  uses the browser Web Speech API (en-US voices only). It is the only free option
  that emits `onboundary`, which is what lights each word in time with the audio.
- Car makes/models are read **live** from `vehicle_makes`/`vehicle_models`;
  `training_terms` holds only manager-added extras and uploaded name lists.
  Copying the catalog would fork it the moment an admin edits the real one.
- `GET /scenarios` strips `is_correct` for non-managers; the verdict comes from
  `POST /scenarios/:id/answer`. No option marked correct ⇒ `graded:false`.
- Files: `backend/routes/training.js`, storage bucket `training-media` (created
  lazily, like `branding.js`).

### QA department (two-tier org — mig 208)
Compliance wires the org chart only (assign companies + agents to a quality **manager**); the manager owns all the work (per-agent methods, task assignment, per-company review-type config), scoped to their companies + team. One company → one manager; one agent → one manager (`qa_manager_companies`, `qa_team_members`). `resolveAgent` (transfer→company attribution) is now deterministic. See memory: qa_two_tier_org, qa_ux_reporting_2026_07, vicidial_agent_attribution.

Notable migrations:
- `007_roles_transfers_compliance.sql` — compliance workflow
- `015_callback_numbers.sql` — callback number tracking
- `020_feature_flags.sql` — global feature catalog
- `021_per_company_feature_flags.sql` — per-company flag overrides
- `079_customer_uuid.sql` — deterministic UUIDv5(normalized_phone) customer identity on `sales`
- `085_customer_uuid_on_transfers.sql` — same customer_uuid on `transfers` (joins leads → policies)
- `086_transfer_assignments.sql` — append-only lead reassignment chain (trigger-fed)
- `087_policy_events.sql` — typed immutable policy lifecycle timeline (trigger-fed)
- `088_vin_active_policy.sql` — one active policy per VIN; `superseded_by` auto-retires the prior policy. **Reverted by 090** (its BEFORE-insert trigger broke multi-row bulk inserts).
- `090_revert_vin_active_enforcement.sql` — drops 088's VIN supersede trigger + `uq_sales_active_vin` index (they 500'd bulk uploads with same-VIN rows in one batch). Keeps the `superseded_by` columns.
- `091_vin_active_reconcile.sql` — re-adds one-active-policy-per-VIN **bulk-safely**: a STATEMENT-level AFTER trigger (`fn_reconcile_vin_active`, transition table + `pg_trigger_depth` guard) that reconciles after each insert/update instead of a per-row BEFORE trigger, plus a NON-unique lookup index. Multi-row bulk inserts with duplicate VINs always succeed; only the newest `closed_won` per VIN stays active.

> **VIN rule lesson:** never enforce one-active-per-VIN with a per-row BEFORE trigger that mutates sibling rows or a partial UNIQUE index — both break multi-row bulk inserts. Use the statement-level reconcile (091).
- `089_compliance_transfer_records_view.sql` — `v_compliance_transfer_records` view: real transfers UNION invisible `refresh` dedup attempts as synthetic rows, so compliance counts/exports reconcile 1:1 with VICIDIAL. `GET /compliance/transfers` reads it by default (falls back to `transfers` if the view is missing)

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

### HR + Accounts overhaul (migs 313-318, applied 2026-09-14)
- **313 change log**: `module_audit_log` (append-only) fed by `fn_module_audit` triggers.
  Actor/reason/source travel as request headers stamped by `contextFetch`
  (`utils/requestContext.js`). A change that needs a reason answers
  `400 {needs_reason:true}`; `api/client.js` asks and resends. New audited tables
  go in `routes/moduleHistory.js` TABLES + `RecordHistory.jsx` TABLE_LABEL.
- **314 people sync**: CRM logins -> `hr_employees` via a `user_company_roles`
  trigger; deactivation opens an `hr_exit_cases` row (never auto-terminates).
- **315 ledger**: post ONLY through `createPostedEntry` / `reverseEntry`
  (`fn_post_journal` / `fn_reverse_journal`), keyed (company, source_type,
  source_id, source_event) -- idempotent. Posted entries are immutable; a
  correction is a reversal. Accounts per event = `POSTING_EVENTS` defaults,
  overridden per company in `accounting_posting_rules`; foreign amounts need an
  `fx_rates` row (never guessed).
- **316 attendance**: `fn_hr_attendance_sync` turns dialer calls (`qa2_call`)
  into SHIFT days (12:00->12:00 local; a 20:00->05:00 shift is one day).
  `hr_attendance.source` dialer/leave/holiday = the sync may rewrite;
  manual/self = never. Lateness only once a company sets `shift_start`.
  Absent only for people who dialed on >= `regular_days` of the last 30.
  Hourly job in `utils/scheduler.js`; rules in `hr_settings.rules.attendance`.
- **317 sales into the books**: `utils/revenueSync.js`, desired-state, OFF per
  company until switched on (Accounts -> Sales); rate cards in `revenue_rates`.
  A sale it cannot price is left alone, never reversed.
- **318**: commission plans SUGGEST pay (HR applies per run); receipts live in
  the PRIVATE `expense-receipts` bucket, shown by 2-minute signed links.
- Every HR/Accounts CSV goes through `utils/moduleExport.js` (egress log).

### Connected dialers — CallTools and anything else (mig 320, APPLIED 2026-09-21)
Live CallTools tenant: `https://east-3.calltools.io`, DRF API at `/api/`, auth `Authorization: Token <key>`
(auth.type `token`). Real endpoints: `contactcalls` (needs `?uuid=` or `?contact_id=`), `calldispositions`
(**3428 = "XFER Transfered"** — the transfer dispo), `users`, `campaigns`, `queues`, `automations`,
`actions`, `httprequests`, `connectorbuttons`. Automations fire an **HTTP Request** action (url,
Get/Post, headers, JSON body) with merge fields `{{%locals[contact][first_name]}}` /
`{{%locals[call][...]}}`; connector buttons use `{first_name}`-style tokens and already push leads
into VICIdial (`add_lead`). Account row + webhook token live in `dialer_accounts` — never in the repo.
"The dialer" is a ROW now (`dialer_accounts`), not a hardcoded product. One public URL per
account: `POST /api/dialer/hook/<webhook_token>`. VICIdial is untouched — it keeps `/api/vicidial/*`
and `VICIDIAL_INGEST_TOKEN`. Operator guide: `docs/DIALER_INTEGRATION.md`.
- **The engine is never duplicated.** `utils/dialers/bridge.js` runs the EXISTING
  `fronterXferHandler` / `closerDispoHandler` (exported from `routes/vicidial.js`) in-process with a
  synthetic req/res, plus the QA2 ingest hook. The 2-min dedup window, xfer_seq (291), stripBlank,
  the closer-side guard and the queued-dispo reconcile are therefore the same code for every dialer.
  Never write a second ingest path for a new dialer.
- **The payload SHAPE is configuration**, not code: `dialer_accounts.field_map` interpreted by
  `utils/dialers/mapping.js` (paths, fallback lists, templates, transforms). Add a dialer by adding a
  preset in `providers.js` — or by mapping it in the UI from a real payload. Admin → Dialers →
  Mapping reads `dialer_webhook_events` and lets you click the keys the dialer actually sent.
- **The XFER gate moved per account**: `settings.xfer_dispos`. The bridge decides and states the
  verdict via `req.__dialerXfer`; `vicidial_config.field_map.xfer_dispos` still rules the VICIdial path.
- Agents: VICIdial keeps `user_profiles.vicidial_agent_ids`; every other dialer maps in
  `dialer_agent_links` (`resolveAgent(agentId, {accountId})` falls back to it). A link naming a company
  outranks the role order.
- **A webhook answers 200 even when it cannot use the event** — a 4xx/5xx makes the dialer retry
  forever. Only an unknown token (404) and a failed signature (401) are refused. `?dry=1` maps + logs
  and writes nothing.
- A bare lead id gets the account's `prefix` (88421 → CT88421) — without it two dialers numbering
  leads from 1 collide on one transfer, the same failure 291/boxForCode exist to prevent.
- Recordings: a URL in the payload is attached at ingest; otherwise `qa2RecordingPoller` asks the
  provider API by `dialer_call_id`. Provider clips sit under `box_id='<provider>:<id8>'` so
  `uq_qa2_call_recording` still means one clip per call. `qaMedia` adds the account's token
  server-side — never the browser.
- Every new column is deploy-order safe (insert/select retries without the `dialer_*` columns), so the
  backend can ship before 320 is applied.
- **A TRANSFER IS NAMED BY ITS LEAD CODE, OR FAILING THAT BY THE CALL.** `xferCode()`
  in `routes/vicidial.js`. Both CallTools automations send the CONTACT id as the
  code, so a call with no contact record (manual dial, inbound) arrives with
  `code: null` — and the handler used to 400, silently, because the webhook
  answers 200 either way. Measured 2026-09-22: 5 of the last 20 live XFERs
  vanished that way; the fronter pressed transfer and got no card, no bell, no
  push. Now the dialer's own per-call id stands in (`CALL-<16>`; no box claims
  that prefix, so nothing tries to resolve it as a lead).
- **Code-less idempotency keys on PHONE + fronter**, not on the code it does not
  have. CallTools reports one transfer twice (button press AND disposition); with
  a contact they share the contact id and collapse, without one they would each
  name the call differently and credit the fronter twice.
- **A BUTTON PRESS IS A TRANSFER SIGNAL, and it gets the same per-account allow
  list as a disposition**: `settings.xfer_buttons`, applied in
  `resolveEventType`. CallTools has six connector buttons and only two are
  transfers — "Zillow" and "Google Maps" open a web page. An unlisted button is
  demoted to `'call'` (logged for QA, never a transfer), which is the guard the
  3,077 stale VICIdial cards exist to justify. This gate is what makes the
  dialer-side binding non-safety-critical.
- The connector-button automation (514) was ACTIVE but had never fired: 18 real
  presses of button 942, zero webhooks. Its condition compared
  `{{%locals[connectorbuttonevent][connector_button]}}` to the integer 942, and
  CallTools renders related fields as reprs (`"AppUser object (uuid)"` — the same
  thing `unwrap` exists for), so it could never be true. 501 (the disposition
  automation) was carrying the whole integration alone.
- `press_id` (the connector-button event's own id) names a contact-less press.
  It is deliberately NOT sent as `call_id`: the call a press belongs to is the
  PREVIOUS call in CallTools, which had QA scoring the wrong recording. About
  21% of presses have no contact record, so without it one press in five is
  lost.

### Where a record came from (migs 325-327, applied 2026-09-22)
With two dialers, "which one sent this?" is the first question asked of any odd
record, so EVERY transfer and EVERY sale carries the answer on the row.
- **The origin is stamped ON the row, never joined.** `transfers.dialer_box` and
  `sales.{dialer_provider,dialer_account_id,dialer_box}`, trigger-fed by
  `fn_sale_stamp_dialer` (from the sale's transfer) and `fn_transfer_stamp_box`.
  The question people ask is "how many of this month's sales came from each
  dialer", and grouping through an embedded resource filters one page in the
  browser instead of the table in the database.
- **No dialer fingerprint means NO dialer.** A sale with no vendor code, no
  agent and no account was typed into the CRM — it is `NULL` (shown as
  "Manual"), not VICIdial. The first backfill credited VICIdial with 5,868
  hand-typed sales before this rule went in.
- `dialer_box` is one level finer than the provider: the vendor-code prefix for
  VICIdial (WTI / TMC / ETC / INB / OAT) and the connected account's own name
  otherwise. It is the useful label — "VICIdial" says nothing when every row is.
- **A view does not inherit ALTER TABLE.** `v_compliance_transfer_records` names
  its columns, so 326 had to recreate it (same trap as 321). Adding a dialer
  column anywhere means checking that view, or the compliance tab filters on a
  column that is not there: 42703 -> 500 -> blank tab.
- The filter tick-list comes from `app_dialer_boxes` (mig 327 — the boxes
  actually ON rows, with counts), NOT from the dialerBoxes.js config and not
  from `fn_dialer_box`'s prefix list. Both of those omit OAT and INB, which have
  no live box but do have transfers. Served by `GET /api/dialers/labels`
  (5-min cache) and rendered by `components/Shared/DialerBadge.jsx`.
- One component renders the tag everywhere. It distinguishes **null from
  undefined**: an explicit null is "Manual", an ABSENT field means the row was
  not fetched with it and the badge renders nothing. Named selects are the
  recurring trap here — `/vicidial/pending` and the four QA2 lists each had to
  be widened by hand.

### QA2 recordings — the right clip, or none (mig 328, applied 2026-09-23)
**A DIALER'S CLOCK IS NOT UTC AND NEVER SAYS SO.** `recording_lookup` returns a
naive wall clock in the BOX's zone (`2026-09-18 17:39:50`), and so does every
recording file name. `qa2_call.call_at` is a real UTC instant. Subtracting one
from the other carried the box's whole UTC offset as error — four hours — and
with no cap on how far a match could be, the least-badly-wrong clip won. The
clips on a lead came out ROTATED among its calls. Measured 2026-09-23 before the
fix: **11,091 of 54,423 attached recordings (1 in 5) were more than 30 minutes
from their own call.**
- Convert with `utils/dialerTime.js` (`naiveToUtcMs`, `clipDistanceMs`) using
  `vicidial_boxes.tz` (IANA, default `America/New_York`). NOT a fixed offset:
  Eastern is -4 in September and -5 in December, so a constant is correct until
  the first Sunday in November and then wrong for six weeks.
- A clip is scored against **both its start and its end**, because `call_at` is
  not one thing: an `ingest` row is stamped at the DISPOSITION (call end), a
  `crm_day` row carries the transfer's own time (nearer the start).
- **Distance limits, and they are the point.** 30 min for the row's own agent,
  90 s for any other agent — past that the nearest clip is the customer's NEXT
  call, and one lead holds both transfer legs plus every redial. No audio beats
  another conversation. `rankClips` in `utils/qa2RecordingPoller.js`.
- **Never overwrite `talk_sec` with the clip's duration.** That destroyed the
  only signal a mis-pick left behind — the row agreed with its own wrong audio.
- The reviewer can override: `GET /qa2/calls/:id/recordings` lists every clip on
  the lead (ranked by the same rule, flagged `is_current` / `same_agent` /
  `held_by` / `rank:null` for outside-window), `POST /qa2/calls/:id/recording`
  sets one. A manual pick parks `recording_attempts` at 99 so the poller never
  re-picks it, and releases the clip from whichever row held it. UI is
  `ClipPicker` in `components/QA2/ReviewScreen.jsx`, shown on the missing state
  too — that is exactly when it is needed.
- Audit a box for mis-picks in SQL from the file name, no dialer needed:
  `to_timestamp(substring(recording_location from '(\d{8}-\d{6})_') …)::timestamp
  AT TIME ZONE 'America/New_York'` vs `call_at`. Cast to `timestamp` FIRST —
  `to_timestamp()` already returns timestamptz in the session zone, and
  `AT TIME ZONE` on that converts the wrong way (it reported 100% wrong).
- `wti_flexo` is retired: one day, 10 calls, host gone. It shared the WTI prefix
  with `wavetechpk`, so every WTI lookup disambiguated between two boxes.

### IP access control (mig 319, applied 2026-09-15)
Which networks each user may use the CRM from. Ships OFF, and everyone is `anywhere`. README → "IP access control" has the operator steps.
- **Mode lives in `user_ip_access` (sidecar), NEVER on `user_profiles`.** That table has RLS `users_can_update_own_profile`
  + an `authenticated` UPDATE grant, so a restricted user could PATCH themselves to `anywhere` with the anon key.
  No row = `anywhere`. All three tables are RLS-on, no policies, revoked from anon/authenticated.
- **Switch** = `business_config` `security.ip_restriction.enabled`. `GET /business-config` strips `security.*` (every user
  reads it), and `PUT/DELETE` there refuses `security.*` even for superadmin. Only `/api/ip-access` writes it, because
  that route enforces the `409 {needs_confirm}` lockout checks.
- **Hot path**: `ipAccess.isEnabled()` is an in-memory boolean, and OFF means zero queries. Scheduler re-reads it every 60s (so
  the CLI works without restart); `server.js` reads it before `app.listen`. Enforcement = `ipAccessGate` chained INSIDE
  `authMiddleware` + `guardLogin()` in `/auth/login`, `/refresh`, `/exchange`. `checkAccess()` is the one pure decision.
- **Any write to `user_ip_rules` or `user_ip_access.ip_access_mode` must call `ipAccess.invalidatePolicies()`**, or the
  change waits out the 30s policy snapshot.
- Client IP = `resolveClientIp()` (`utils/clientIp.js`): forwarded header only from `IP_TRUSTED_PROXIES`. `geoGate`,
  `presence.js`, `portal.js` still read X-Forwarded-For raw; switch them once the proxies are configured.
- Break-glass: `npm run ip-access -- disable | anywhere <email>` (backend/), or `IP_RESTRICTION_FORCE_OFF=true` + restart.
- Audit = `module_audit_log` module `access` (rules, mode changes only, `security.*` config). Last-seen stamps are NOT logged.
- Tests run on `backend/testing/supabaseFake.js` (in-memory supabase-js; `fake.calls` proves "no queries when off").
