# Export Governance — Discovery Audit

Read-only landscape survey (2026-07-03) ahead of a superadmin-controlled export
governance system. No code changed. File/line refs are the source of truth.

TL;DR: exports are **plentiful, unbounded, and completely unlogged**, but the
CRM already has every *pattern* the governance system needs — a 3-tier
feature-flag override (user→company→global), a per-user permission-override
table, an activity-log with an admin view, and a role-scoped field-layout
config. The build is mostly *assembling existing patterns*, plus two genuinely
new pieces (numeric per-role/per-user limits, and an export-audit log + view).

---

## 1. Every export surface

There are **two mechanisms** and a long tail of surfaces on each.

### Mechanism A — client-side CSV (the dominant pattern)

Shared helpers in `frontend/src/components/Compliance/shared.jsx`:
- `fetchAllForExport(endpoint, params, dataKey)` — pages the **normal list
  endpoint** at `PAGE = 5000` rows, looping up to **4000 pages (~20 M row
  safety cap)**. Effectively **unbounded**.
- `downloadCSV(rows, headers, filename)` — builds the CSV blob in the browser.

Every client-side export is gated **only** by `isEnabled('exports')` (feature
flag, mig 123) — and note `isEnabled` returns **true for an unknown flag**
(`FeatureFlagsContext.jsx:62`), so the gate only bites when the flag row exists
and is explicitly off. `ExportModal.jsx` adds date-range + company + per-user
filter selection on top.

| Surface (component) | Endpoint it drains | Data | Filters | Role reach today |
|---|---|---|---|---|
| Compliance `QueueTab` | `compliance/sales` (pending) | Sales in review queue | date, company, users | compliance_manager / superadmin |
| Compliance `SalesTab` | `compliance/sales` | All sales, all companies | date, company, users, current filters | compliance / superadmin |
| Compliance `TransfersTab` | `compliance/transfers` | All transfers | date, company, users | compliance / superadmin |
| Compliance `CallbacksTab` | `compliance/callbacks` **and** `compliance/callback-audit-log` | Callbacks + the audit log itself | date, company, users | compliance / superadmin |
| Compliance `ReviewsTab` | `reviews` | Call reviews | company | compliance / superadmin |
| `ReportsPanel` (ManagerShell) | reports export | Manager reports | company | manager roles |
| `AdminAnalyticsDashboard` | sales / transfers / callbacks | Analytics rows (inline `downloadCSV`) | dashboard filters | superadmin / readonly_admin |
| `CompanyManagement/CompanyDetail` | sales / transfers / callbacks / members | One company's data + member roster | company-scoped | superadmin |
| `NumbersIntelligence` | numbers | Number-intelligence rows | current filters | superadmin |
| `CustomerProfile` | (in-memory profile) | **One customer** full profile → CSV | n/a | superadmin + `tool_customer_profiles` grant |

All of these export **the currently-filtered view** — the underlying endpoints
are already role-scoped server-side, so "everything the user can see" is the
effective scope. **No row cap, no field selection, no audit, no rate limit.**

### Mechanism B — server-side CSV stream

| Route | Data | Cap / filters | Gate |
|---|---|---|---|
| `POST /data-analyzer/export` (`dataAnalyzer.js:333`) | Sales **or** transfers, filter-built, **form_fields-labeled columns** | `fetchAll` cap **1,000,000 rows**; current analyzer filter set | `requireToolAccess('tool_data_analyzer')` (per-user grantable flag) + `readonlyGuard` |
| `GET /uploads/batches/:id/export` (`uploads.js:151`) | Re-export an uploaded transfer batch | one batch | superadmin |
| `GET /sale-uploads/batches/:id/export` (`saleUploads.js:88`) | Re-export an uploaded sale batch | one batch | superadmin |

**The Data Analyzer export is the single heaviest vector** — a 1 M-row scan,
form-field-labeled, streamed, behind a per-user-grantable tool flag. It already
reuses `form_fields` for column label + order (`dataAnalyzer.js:343`), and
already de-dups JSONB synonyms against typed columns — the closest thing to
"configured export columns" that exists.

### Not data exports (ignore for governance, or govern separately)
- **Blank templates**: BulkUploader / BulkSaleUploader / UserManagement bulk
  templates — download a header-only CSV. No customer data.
- **Recording audio** (client portal `/portal/sales/:id/recording`) — streams
  audio, not tabular data, but *is* customer data leaving the system. Already
  gated + **audit-logged** via `portal_listens`. If "export governance" means
  "data leaving the building," this belongs in scope; if it means "CSV/Excel,"
  it doesn't.

---

## 2. Existing audit-logging patterns (what to model the export log on)

Three, ranked by fit:

1. **`activity_logs` + `logActivity()`** (`backend/utils/activityLogger.js`) —
   `{ company_id, user_id, action, entity_type, entity_id, old_value,
   new_value, metadata }`, fire-and-forget, never throws. **Has an admin-facing
   view**: `GET /activity-logs` (role-gated, paginated, filter by
   company/action/user/date) consumed by the ManagerShell + FronterManager
   "Activity Log" tab. **This is the best model for an export-audit log** — an
   export is just `logActivity({ action:'export', entity_type:'sales',
   metadata:{ row_count, filters, columns, file } })`, and the admin view
   pattern already exists to copy.
2. **`field_audit_log`** (mig 063, trigger-populated) + `GET /audit`
   (`audit.js`, superadmin/compliance only) — every PII field change on
   transfers/sales/callbacks, with **per-record** and **by-actor** timelines
   (`/audit/by-actor/:userId`). Good UI reference for "show me everything user
   X did" — an export log wants the same by-actor lens.
3. **`edit_history` jsonb** on rows (used by sales cancel/reassign/resell) —
   inline per-record; **not** suitable for a cross-cutting export log.

Gap: no *superadmin, cross-company, richly-filtered* audit browser exists today —
the manager Activity Log tab is the closest and is company-scoped. An
export-audit admin screen is modest new UI that can mirror that tab.

---

## 3. Limit / config patterns (for per-user limits)

**Per-user override is already a first-class, proven pattern — twice:**

- **`user_feature_flags`** (mig 122) — per-user feature on/off. Resolved
  **user → company → global** in `featureFlags.js` + `/auth/me`. The superadmin
  "Tabs & Features" panel (`UserPermissionsPanel` + `users.js`) already writes
  these. *This is how "turn exports off for closer X" already works.*
- **`user_permission_overrides`** (mig 014) — grant/revoke a *permission* per
  user on top of the role default. `override_type ∈ grant|revoke`.

**But both are BOOLEAN.** A per-user *numeric* limit (max rows, max exports/day)
is a **new shape** — nothing today stores a per-user numeric value.
- `business_config` stores arbitrary jsonb values (could be numeric) but is only
  **global / company** scoped — no per-user row.
- So per-user numeric limits need **either** a new `user_export_limits` table
  (mirroring `user_feature_flags`' shape with a value column) **or** a
  `business_config`-style `export_limits` catalog keyed by role, with a thin
  per-user override table on top.

**No rate-limiting / quota-tracking mechanism** exists at the app/feature level
(there's a global express rate-limiter on the API, but nothing per-feature or
per-user quota-counting). "N exports per day per user" would be net-new — and
needs the export log from §2 as its counting substrate.

---

## 4. Display / field-config patterns

- **`form_fields`** (`name, label, field_type, is_required, options, "order"`) —
  drives the **sale/transfer form inputs**. The analyzer export borrows its
  `label` + `order` for column naming. It is **input-field config**, not
  output-column selection — it has no notion of "which columns a list/export
  shows" or per-role output choice, and export CSVs carry typed columns
  (`closer_name`, `company_name`, `created_at`) that aren't form inputs at all.
- **`drawer.layout.<type>.<role>`** in `business_config` (mig 070) — **the real
  field-visibility-per-role pattern**: an ordered array of sections, each
  `{ id, label, visible, order, fields?[] }`, admin-editable in Business Rules →
  Drawer Layout, role-scoped. This is the closest existing model for "which
  fields display/export."
- **`shell.layout.<shell>`** (mig 074) already scaffolds an
  **`actions: [{ key:'export', enabled }]`** slot, and the hook exposes
  `isActionVisible('export')` (`useShellLayout.js:127`) — a **per-shell
  export-action toggle already exists and is wired**.
- **No "customize columns" UI** anywhere (only a show/hide-JSON toggle in
  `LeadEditModal`).
- **Page size is hardcoded per screen** (`compliance shared LIMIT = 30`,
  `ManagerShell PAGE_SIZE = 25`) — no user-facing rows-per-page control exists.
- **Expand/collapse detail** — the canonical pattern is the **detail drawer**
  (click a row → `SaleDetailDrawer` / `TransferDetailDrawer` slides out with
  full, role-layout-driven fields). List-row inline expand exists in
  NumberUploadManager/AssignedNumbersList (group expand) and the audit trail.

---

## 5. Scope questions — my read (yours to decide)

### Q1 — reuse form_fields for "which fields export/display"?
**No — don't overload it.** `form_fields` is input config; export/display is
output config and they genuinely diverge (typed columns, computed names,
JSONB synonyms). Reuse `form_fields` only as the **label/id catalog**, and model
export/display columns on the **drawer-layout shape** instead:
`business_config` key like `export.columns.<dataset>.<role>` = ordered
`[{ id, label, visible }]`. You get role-scoping, admin-editability, and forward-
compat for free, and you don't entangle the sale form with report columns.

### Q2 — per-user vs role-level limits?
**Role-level is the primary axis; per-user is a thin override — not the reverse.**
The real requirement is almost always role-shaped ("closers ≤ N rows / these
columns; managers more; compliance unlimited"). Per-user is the rare exception
(one untrusted closer, one power user). The whole app already resolves gates
**role → company → user** — mirror that: a role-keyed `export_limits` default in
`business_config`, plus a per-user override layer using the *exact* precedent of
`user_feature_flags` / `user_permission_overrides`. Building per-user as the
*primary* axis would be far more config surface for a need roles already cover
~95% of. **Recommendation: role-level limits first, per-user override as a small
add-on — same layering as every other permission in the system.**

### Q3 — export volume (does the audit log need to scale)?
**Unknowable precisely — exports are unlogged today** — but structurally
**low-volume**: every export is a human clicking a button on an admin/compliance/
manager screen. That's tens-to-low-hundreds/day org-wide, not machine scale. So
the **export-audit log is a modest admin feature** — one indexed table + a
paginated view (à la `activity_logs`) is ample; it does **not** need a
high-throughput pipeline. The real scaling risk is not log rows but **exported
row volume** (the 1 M-row analyzer export, the ~20 M client cap) hammering the
DB — that's what governance should actually cap first.

---

## Appendix — the reusable inventory (what the build stands on)

| Need | Existing pattern to reuse | Where |
|---|---|---|
| On/off export per user/company/global | `user_feature_flags` + `company_feature_flags` + `feature_flags` (3-tier), flag `exports` | migs 122/021/123; `featureFlags.js` |
| Per-user override precedent | `user_permission_overrides` (grant/revoke) | mig 014; `/auth/me` |
| Role/company numeric/string config | `business_config` (scope=global|company:<id>) + `getConfig` cascade | mig 068; `utils/businessConfig.js` |
| Audit log + admin view | `activity_logs` + `logActivity` + `GET /activity-logs` + Activity Log tab | `activityLogger.js`; ManagerShell |
| By-actor investigation UI | `field_audit_log` + `/audit/by-actor` | mig 063; `audit.js` |
| Field-visibility per role | `drawer.layout.<type>.<role>` (visible/order/fields) | mig 070 |
| Per-shell export-action toggle | `shell.layout.*.actions[export]` + `isActionVisible` | mig 074; `useShellLayout.js` |
| Column label/order source | `form_fields` (label, "order") — already used by analyzer export | mig 001; `dataAnalyzer.js:343` |
| Server-side filtered stream | `POST /data-analyzer/export` + `fetchAll` | `dataAnalyzer.js` |
| Client-side paged export | `fetchAllForExport` + `downloadCSV` | `Compliance/shared.jsx` |

### The two genuinely new pieces
1. **Numeric limits** (max rows / max fields / exports-per-day) — no numeric
   per-user store exists; boolean flags don't cover it.
2. **Export audit log + counting** — exports are unlogged; the log is both the
   accountability record *and* the substrate for any "N per day" quota.
