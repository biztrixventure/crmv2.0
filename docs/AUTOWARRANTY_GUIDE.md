# BizTrix CRM — Auto-Warranty Operations Guide

Comprehensive reference for every change made during the auto-warranty audit pass.
Covers what was built, where to find it in the GUI, how it changes the workflow,
and how to manually test each piece.

---

## Table of Contents

1. [Migration order](#migration-order)
2. [Cancellation system](#1-cancellation-system)
3. [Bulk Status Update](#2-bulk-status-update)
4. [Bulk Sale Upload — tier-based match rules](#3-bulk-sale-upload--tier-based-match-rules)
5. [Resell · Renewal · Client / Plan switch](#4-resell--renewal--client--plan-switch)
6. [Reference & Policy uniqueness](#5-reference--policy-uniqueness)
7. [Vehicle Eligibility engine](#6-vehicle-eligibility-engine)
8. [Customer lifetime identity (cross-co)](#7-customer-lifetime-identity-cross-co)
9. [Sale Chain timeline + lifetime banner](#8-sale-chain-timeline--lifetime-banner)
10. [Compliance lock](#9-compliance-lock)
11. [Transfer Dup Attempts](#10-transfer-dup-attempts)
12. [Dynamic status pills (sale + transfer)](#11-dynamic-status-pills)
13. [Shell Layouts admin](#12-shell-layouts-admin)
14. [Readonly Admin manager](#13-readonly-admin-manager)
15. [Stat Cards Triple — Today / MTD / Total](#14-stat-cards-triple)
16. [Permission matrix](#permission-matrix)
17. [Business Rules config keys reference](#business-rules-config-keys-reference)
18. [API endpoints added](#api-endpoints-added)
19. [Apply / upgrade checklist](#apply--upgrade-checklist)

---

## Migration order

Apply in numeric order via Supabase SQL editor. Each is idempotent + replay-safe.

| Mig | Purpose |
|---|---|
| 072 | `transfer_dedup_events` log table |
| 073 | `transfer.status_catalog` seed |
| 074 | `shell.layout.*` seeds (Staff / Manager / Compliance) |
| 075 | `sales.cancellation_date` column + partial index |
| 076 | `chargeback_date` + `chargeback_amount` + `cancellation_reason_key` + `original_fronter_id` + seed `cancellation_reasons` + `bulk.renewal_window_days` + `kpi.cancel_count_keys_on` |
| 077 | `sales.compliance_locked_at` column + tries to create `uniq_sales_reference_no` (fails if dups exist → run 078) |
| 078 | Dedupes `sales.reference_no` (keeps oldest, suffixes newer with `-DUP-<id>`) then creates the unique index |
| 079 | `sales.customer_uuid` (uuidv5 of normalized phone) + trigger + backfill |
| 080 | `sales.policy_number` generated column + dedupe + unique index |
| 081 | `vehicle_eligibility` catalog seed + enforcement mode |

After each migration, watch the `NOTICE` lines (mig 078 + 080 print before/after dup counts).

After all migrations: **restart the backend Node process**. Frontend just needs a browser refresh.

---

## 1. Cancellation system

### What was built

- `sales.cancellation_date date` column (mig 075)
- Distinct `chargeback_date` + `chargeback_amount` (mig 076)
- Canonical `cancellation_reason_key text` (mig 076)
- `cancellation_reasons` catalog: 12 reasons across 4 categories (`customer`, `compliance`, `chargeback`, `system`)
- Inline date chip + label on every sale status display
- Required date + canonical reason on all cancel-like transitions
- `compliance_locked_at` (mig 077) — terminal-status guard

### Where to see it in the GUI

| Surface | What appears |
|---|---|
| Compliance → Sales list | Red `cancellation_date` chip next to the status badge |
| Manager Shell → Team Sales | Same chip |
| Staff Shell → My Sales | Same chip |
| Admin → Analytics Dashboard sales table | Same chip |
| SaleDetailDrawer → Sale Info section | "Cancellation Date" labeled row (red highlight) |
| Compliance → Sales → Update modal | Date input + canonical reason dropdown (required when cancel-like) |
| Compliance → Bulk Status Update | Bulk-level date + reason + chargeback amount fields |

### How the workflow changes

- **Closer / Manager** never sets these directly — only Compliance can.
- **Compliance**: when flipping a sale to `cancelled` / `compliance_cancelled` / `closed_lost` / `chargeback` / `dispute`, the system requires:
  - Cancellation Date (business date the cancel took effect, not the row-update date)
  - Canonical reason from the catalog dropdown
  - Free-text reason (also appended to `compliance_note`)
- **Chargeback** additionally requires `chargeback_amount` (USD).

### How it helps

- Top-cancel-reason reports become possible (`SELECT cancellation_reason_key, COUNT(*) ...`)
- Monthly cancellation count keys on the **business date** (when cancel actually happened) — auditor-correct
- Distinct chargeback semantics — money-moved events tracked separately from pre-money cancels
- Visible-at-a-glance chips → no need to open a drawer to see cancellation date

### How to test

1. Compliance → Sales → click any sale → Update.
2. Set status = Cancelled, fill date + pick reason → save.
3. Sale list now shows red date chip next to "Cancelled".
4. Open drawer → Cancellation Date row in red.

---

## 2. Bulk Status Update

### What was built

New Compliance shell tab for updating many sales at once by reference / policy number.

### Where to see it

**Compliance shell → Bulk Status Update** tab (between All Sales + Transfers).

### Workflow

1. **Paste** references in textarea, one per line. Each line can be:
   - Just a ref: `P-1001`
   - Ref + date: `P-1001, 2026-05-15`
   - Ref + date + note: `P-1001, 2026-05-15, customer requested refund`
   - Separators: comma · semicolon · pipe · tab
   - Header row auto-skipped
2. **Or upload** CSV (first column = refs).
3. Click **Search** — backend matches each ref against `sales.reference_no` AND form_data variants (`SaleReferenceNo` / `PolicyNumber` / `policy_number` / `policy_no` / `PolicyNo`).
4. **Results table** shows:
   - Matched rows (auto-selected)
   - Unmatched refs in red chips
   - Duplicate-input refs in amber chips
5. **Per-row** Cancel Date + Note inputs, editable.
6. Pick **target status** from dynamic catalog.
7. Bulk-level Cancellation Date + Reason fields appear when status is picked.
8. Per-row values override bulk-level.
9. **Apply** — backend bulk-updates, writes audit history, stamps `compliance_locked_at` on terminal transitions.

### How it helps

- Process compliance batches in one pass instead of one-by-one
- Per-row cancellation dates from compliance paperwork batches
- Canonical reason key → drives top-cancel-reason analytics
- Chargeback amount captured at-source

### How to test

1. Have 5 sale refs on hand.
2. Compliance shell → Bulk Status Update.
3. Paste them, click Search.
4. Pick Cancelled status, fill bulk date + reason → Apply.
5. Each sale's list row now shows the new status + red date chip.

---

## 3. Bulk Sale Upload — tier-based match rules

### What was built

Replaced the old `pickExistingSale` with tier-based rules so cancelled sales are never silently overwritten and client / plan switches always produce new rows.

### Where to see it

SuperAdmin → **Bulk Upload** → Sale → Validate → **Review screen** → Auto-matched section.

### Tier rules

**Tier 1 — reference_no is king**
- File ref matches existing → UPDATE that exact sale
- File ref present + no match → NEW SALE (different ref = different deal)

**Tier 2 — no ref, car identity match**
- All car matches are terminal (cancelled / closed_lost / chargeback / compliance_cancelled) → NEW SALE flagged as **resell**
- File's client differs from active match's client → NEW SALE flagged **client switch**
- File's plan differs from active match's plan → NEW SALE flagged **plan switch**
- Single active match + file's `sale_date` > renewal window → NEW SALE flagged **renewal**
- Single active match + same client / blank client + within window → UPDATE
- Multiple active same-client matches → AMBIGUOUS (human picks)

**Tier 3 — no car identity**
- 1 sale → UPDATE
- N sales → AMBIGUOUS

### Review-screen chips

| Chip | Meaning |
|---|---|
| ♻ purple "Resell of P-1234 · cancelled YYYY-MM-DD" | Tier 2 cancelled-prior |
| 🔁 teal "Renewal of P-1234 · YYYY-MM-DD" | Tier 2 date-window pass |
| ↔ blue "Client switch" | Tier 2 client differs |
| 🪄 "Plan switch · OldPlan → NewPlan" | Tier 2 plan differs |
| ⚠ "Mass-VIN — file appears >5 times" | G5 mass-VIN warn |
| ⚠ "Client column is blank on a closed deal" | G3 reporting hole warn |

### File-level validators

| Rule | Behavior |
|---|---|
| Intra-file ref duplicate | Both rows → unmatched |
| Intra-file VIN+client+sale_date duplicate | Both rows → unmatched |
| Future `sale_date` | Row → unmatched ("typo year column") |
| Status in cancel-like + missing cancellation_date | Row → unmatched |
| Mass-VIN (>5 same VIN) | match_warning on each |
| Transfer in rejected/cancelled state | Row → unmatched |
| Existing sale past compliance lock window | Row → unmatched (G13) |
| Cross-transfer ref collision | Row → unmatched ("ref already used on different transfer") |

### How to test

1. Build CSV with the scenarios above.
2. Bulk Upload → Sale → Map columns → Validate.
3. Review screen shows the right bucket + chip per row.

---

## 4. Resell · Renewal · Client / Plan switch

### What was built

| Type | Detected by | Behavior |
|---|---|---|
| Resell | Prior sale on same car is cancelled-like | New sale w/ `is_resell=true`, `resell_intent='resell'`, `original_sale_id` set |
| Renewal | Prior sale active + same client + `sale_date` > window | New sale w/ `resell_intent='renewal'` |
| Client switch | Active prior + same car + different client | New sale (no `is_resell` flag — new deal w/ different underwriter) |
| Plan switch | Active prior + same car + same client + different plan | New sale w/ original plan preserved (audit-safe) |

### Renewal window

Default 30 days. Per-company override via `business_config bulk.renewal_window_days`. Lets each closer co tune to their typical contract term (6 / 12 / 24 months).

### Original fronter credit (G11 / G19)

Every resell row stores `original_fronter_id` — the fronter who first brought this customer. Walks the chain: prior row's `original_fronter_id` if it had one, else prior row's `fronter_id`. Survives re-fronts.

### Manual flow parity

- Closer can NOT change `plan` on a closed_won sale (PUT returns 403 — use Resell flow).
- Closer can NOT change `client_name` on a closed_won sale (same block).
- ResellModal (closer-side) supports `intent` in `{resell, additional_car, renewal, other}`.

### Where to see it

- Bulk upload review screen → chips on each row
- Sale Detail Drawer → resell info badge on the status bar
- Sale Detail Drawer → **Sale Chain** timeline (see section 8)

### How to test

1. **Resell**: cancel a sale → upload bulk file w/ same VIN + client + new ref → review shows ♻ chip.
2. **Renewal**: have active sale w/ sale_date 2 months ago → upload row w/ same VIN + client + today's date → review shows 🔁 chip.
3. **Client switch**: active sale w/ client=MTM → upload row w/ same VIN + client=OMEGA → review shows ↔ chip.
4. **Plan switch**: active sale + plan=Basic → upload row w/ same VIN + plan=Premium → review shows 🪄 chip.
5. **Manual block**: open closed_won sale as closer → try changing plan → 403.

---

## 5. Reference & Policy uniqueness

### What was built

- Partial unique index on `sales.reference_no` (mig 077, dedupe in 078)
- Generated column `sales.policy_number` projected from `form_data` variants (mig 080)
- Partial unique index on `sales.policy_number` (mig 080, includes dedupe)
- Pre-flight collision checks at app layer so the operator gets a precise error, not a generic 23505

### Manual collision check

- POST `/sales`: rejects any ref in primary + `additional_cars[]` that's already in use → 409 `REF_COLLISION` with the conflicting sale id
- PUT `/sales/:id`: rejects ref change to a value already in use → 409 `REF_COLLISION`

### Bulk collision check

- Pre-flights every file ref against the WHOLE sales table
- Hit on a different transfer → unmatched ("every ref must be globally unique")

### Dedupe pattern (mig 078 + 080)

Oldest sale keeps the value. Newer siblings get `-DUP-<short_id>` suffixed. Each renamed row gets an `edit_history` entry:
```json
{
  "action": "reference_no_deduped",
  "previous_value": "MBH44MUILR",
  "new_value": "MBH44MUILR-DUP-7a3c1b4e",
  "reason": "mig 078: ...",
  "edited_at": "..."
}
```

### How to test

1. SQL: `SELECT id, reference_no FROM sales WHERE reference_no LIKE '%-DUP-%' LIMIT 5;`
2. Each row should have an audit entry in `edit_history` for the rename.
3. Try inserting two rows w/ same ref via SQL → 23505 on the second.
4. Try creating a sale w/ an existing ref via UI → 409 with conflicting sale info.

---

## 6. Vehicle Eligibility engine

### What was built

- Catalog stored in `business_config vehicle_eligibility` (mig 081)
- Per-plan rules: `min_year` · `max_age_years` · `max_miles` · `max_age_miles_combined` · `allowed_makes` · `disallowed_makes`
- `_default` fallback when plan has no specific rule
- Enforcement mode: `block` (POST/PUT → 400) or `warn` (response carries `eligibility_warning`)
- Server-side checks on POST `/sales`, PUT `/sales/:id`, bulk upload `confirmUpload`
- Closer-side debounced preview endpoint POST `/sales/eligibility-check`

### Where to see it (admin)

**SuperAdmin → Business Rules → Vehicle Eligibility** tab.

- Pill row to pick `_default` + every per-plan rule
- Add new plan input clones `_default`
- Numeric inputs for caps
- Comma-list inputs for allowed/disallowed makes
- Enforcement mode toggle (`block` | `warn`)
- Per-company overrides via the scope picker at top of Business Rules

### Where to see it (closer)

Closer SaleForm shows a 🚫 red banner above the form when the plan + vehicle combo is ineligible.

- 350ms debounce
- Updates as closer types
- Cancels prior requests so latest wins
- Submit not client-blocked (warn-mode still works)

### Workflow change

| Before | After |
|---|---|
| Closer fills 5-min form → Submit → 400 → frustration | Closer types year `2009` → instant banner: "Year 2009 below minimum 2010 for this plan." Closer adjusts before submit. |
| Underwriter rejects after submit | Pre-rejected at sale-create time |

### How to test

1. SuperAdmin → Business Rules → Vehicle Eligibility → pick `omega-powertrain` → set `min_year=2015` → save.
2. Login as Closer → open SaleForm → pick plan Omega Powertrain → enter year 2010.
3. Red banner appears: "Vehicle year 2010 is below the minimum (2015) for plan Omega Powertrain."
4. Bump year to 2018 → banner disappears.
5. Click Submit on the bad combo → 400 w/ same reason.

### To unblock a specific vehicle

Edit the rule in the Vehicle Eligibility admin tab:
- "Ferrari now allowed on Omega" → remove `ferrari` from `disallowed_makes` → save.
- Effective immediately (60s config cache TTL).

---

## 7. Customer lifetime identity (cross-co)

### What was built

`sales.customer_uuid` — deterministic UUIDv5 derived from the normalized phone number (mig 079).

- Same phone → same UUID across every company, every fronter co, every closer co
- Computed by trigger on INSERT + UPDATE of `customer_phone` / `form_data`
- pgcrypto `app_uuid_v5()` + `app_norm_phone()` SQL functions
- Backfilled on all existing rows via `UPDATE sales SET customer_phone = customer_phone`

### Why

Auto-warranty parent companies need to roll up a single customer's lifetime activity. Without a stable cross-co identifier, customer X buying at FronterCo1 → CloserCo1 then later at FronterCo2 → CloserCo2 appeared as two unrelated customers.

### Where to see it

- SaleDetailDrawer → 🧬 "Lifetime customer — N sales across M companies" banner appears when the customer has touched more than one company
- API: `GET /api/sales/lifetime/by-phone/:phone` returns every sale tied to the customer_uuid
- API: `GET /api/sales/customer-history/by-phone/:phone` returns trimmed summary (total / active / cancelled / chargebacks)

### Role scope

Same as every other cross-cut endpoint:
- Fronter / fronter_manager: own non-resell rows only
- Closer / closer_manager: own closer-side rows
- Compliance + SuperAdmin + Readonly: everything

### How to test

1. Use a phone that has sales at 2+ different companies.
2. As compliance, open any sale's drawer for that customer.
3. Banner: 🧬 "Lifetime customer — N sales across M companies".

---

## 8. Sale Chain timeline + lifetime banner

### What was built

SaleDetailDrawer section showing every sale in the resell / renewal lineage. Walks `original_sale_id` back to the root, then forward to every descendant. Ordered by `sale_date` ascending.

### What renders

Each timeline entry shows:
- `#1`, `#2`, ... badges (current row highlighted purple)
- Reference number
- Sale date
- Client name + plan
- Status (uppercase)
- `original | resell` badge
- Red `cancelled YYYY-MM-DD` chip when cancellation_date is set

### Endpoints

- `GET /sales/:id/chain` — permission-scoped
- `GET /sales/lifetime/by-phone/:phone` — cross-co
- `GET /sales/customer-history/by-phone/:phone` — trimmed summary

### Workflow

Whenever a sale is part of a chain (it has `original_sale_id` OR another sale points at it), the drawer section auto-renders. Single-sale customers see nothing (no clutter).

### How to test

1. Have a resell chain in the DB (sale1 cancelled → ResellModal → sale2 created).
2. Open sale2 drawer.
3. Scroll to **Sale Chain** section.
4. Both entries visible, ordered by date, current row highlighted.

---

## 9. Compliance lock

### What was built

`sales.compliance_locked_at timestamptz` column (mig 077). Stamped automatically when status flips to a terminal-lock value:
- `compliance_cancelled`
- `chargeback`
- `dispute`

Cleared when compliance restores to a non-terminal status.

### Effect

PUT `/sales/:id` from closer / manager returns 403 when `compliance_locked_at IS NOT NULL`. Only compliance / superadmin can mutate.

### How to test

1. As compliance, flip a sale → Chargeback → save.
2. As closer, try editing any field → 403 "This sale is compliance-locked."
3. As compliance, flip the same sale → open → save.
4. As closer, edit → succeeds.

### Why this matters

Stops closers from reverting a chargeback or compliance-cancellation mid-lock-window. Audit-safe immutability.

---

## 10. Transfer Dup Attempts

### What was built

`transfer_dedup_events` log table (mig 072). Every fronter dup-submission (refresh / reengage / sale_overlap) gets a row.

### Where to see it

ManagerShell overview → **Dup Attempts** triple stat card (Today / MTD / Total).

### Why

Fronter KPI hygiene means a re-submitted phone does NOT count as a new transfer in the fronter's count. But the manager needs visibility into the raw activity for reporting.

### How to test

1. Have a fronter try to submit the same phone twice.
2. ManagerShell → overview → Dup Attempts card increments.

---

## 11. Dynamic status pills

### Sale status pills

Driven by `business_config compliance.status_catalog`. Pills auto-group: Pending → Won → Lost. Each pill carries a colored dot from the catalog `badge` field.

**Where**: Compliance Sales tab · ManagerShell team_sales · StaffShell team_sales.

**Admin**: SuperAdmin → Business Rules → Compliance Workflow → Sale status catalog (add / rename / disable / reorder).

### Transfer status pills

Driven by `business_config transfer.status_catalog` (mig 073). Linear order: pending → assigned → completed → rejected → cancelled.

**Where**: ManagerShell transfers tab · StaffShell team_transfers.

**Admin**: SuperAdmin → Business Rules → Transfer Lifecycle.

### How to test

1. SuperAdmin → Compliance Workflow → add a new status "Customer Recall" → save.
2. Refresh manager / staff shell.
3. New pill appears in the team_sales filter row with the badge color you picked.

---

## 12. Shell Layouts admin

### What was built

`business_config shell.layout.{staff, manager, compliance}` (mig 074). SuperAdmin can hide / rename / reorder tabs and pick the default landing tab per shell.

### Where

**SuperAdmin → Business Rules → Shell Layouts**.

Pick the shell pill (Staff / Manager / Compliance) → tab list:
- Inline label edit (pencil → text input)
- Default-tab radio
- Visibility toggle
- Up/down reorder
- Reset to defaults

Phase 2 sections (in the same admin page):
- **Stat cards**: which KPI cards appear on each shell's overview
- **Filters**: toggle date picker / agent select per shell
- **Actions**: toggle Export button visibility

### Workflow

`useShellLayout(shellId)` hook reads the config, applies to the tab array each shell renders. Permissions still gate first — admin can only narrow what permissions already allowed.

### How to test

1. SuperAdmin → Business Rules → Shell Layouts → pick Manager.
2. Hide "Activity Log" tab → save.
3. Login as manager → "Activity Log" no longer in sidebar.
4. Restore → it returns.

---

## 13. Readonly Admin manager

### What was built

Dedicated SuperAdmin tool for managing `readonly_admin` users with per-user nav allowlist + permission flags.

### Where

**SuperAdmin → Readonly Admins** tab.

### Features

| Feature | Details |
|---|---|
| List count + grant source | Badges: ENV (env-stamped) / JWT (app_metadata) / ROLE (custom_roles assignment) |
| Add user | Inline form: email / password / invite-email checkbox / initial sidebar tabs / initial flags |
| Send invite email | Calls `inviteUserByEmail` with `redirectTo=/accept-invite` so Supabase sends magic link |
| Per-user nav allowlist | Grouped tab matrix (Overview · Cross-Company · Admin · Tools · Content) with quick presets (Defaults · Full SA parity · Dashboard only) |
| Per-user permission flags | `view_financial_data` · `view_pii` · `can_export` · `view_audit_history` |
| Revoke (soft) | Strips metadata + deactivates role |
| Permanent delete | Wipes auth user. Two-confirm (yes/no + retype email) |

### Env-stamp

Add to `.env`:
```
READONLY_ADMIN_EMAIL=auditor@yourco.com,investor@parentco.com
```
On backend startup, every listed email gets `app_metadata.role='readonly_admin'`.

### Permission flags wiring

`AuthContext.roFlag(key)` returns the boolean. Non-readonly users always get `true` so call-sites work uniformly.

Currently wired:
- `view_financial_data` — gates `monthly_payment` + `down_payment` in SaleDetailDrawer
- `view_audit_history` — gates audit-trail section in drawer

### Login fix

Readonly admins bypass the `user_company_roles` lookup at login (no assignment needed). Same fast-path as superadmin.

### Backend enforcement

`readonlyGuard` middleware blocks every POST / PUT / DELETE for readonly_admin → 403 "Read-only account". Hidden UI buttons are cosmetic; backend is source of truth.

### How to test

1. SuperAdmin → Readonly Admins → Add → email / password / pick tabs / pick flags → Create.
2. Login as that user → see narrowed sidebar.
3. Try to click any Save button → 403.
4. SuperAdmin → toggle off `view_financial_data` for that user → save.
5. Re-login → SaleDetailDrawer no longer shows financial section.

---

## 14. Stat Cards Triple

Triple-segment cards (Today / MTD / Total) across every shell. Each segment is independently clickable.

### Where

- Staff Shell (closer + fronter views)
- Manager Shell (overview)
- Compliance Shell (where applicable)

### What changed

- Cards driven by `useDashboardStats` hook
- Card visibility per-shell controlled by Shell Layouts admin
- Click any segment → drill-down to filtered list

### How to test

1. Manager Shell → overview.
2. Click "Today" segment on Total Sales card.
3. Lands on team_sales tab with date filter = today.

---

## Permission matrix

### Who can do what

| Action | Closer | Closer Mgr | Fronter | Fronter Mgr | Ops Mgr | Co Admin | Compliance | SuperAdmin | Readonly Admin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Create sale | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | — |
| Edit own sale | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | — |
| Edit team sale | — | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | — |
| Change plan on closed_won | — | — | — | — | — | — | ✓ | ✓ | — |
| Change client on closed_won | — | — | — | — | — | — | ✓ | ✓ | — |
| Approve sale | — | — | — | — | — | — | ✓ | ✓ | — |
| Bulk Status Update | — | — | — | — | — | — | ✓ | ✓ | — |
| Bulk Upload | — | — | — | — | — | — | — | ✓ | — |
| See cross-co lifetime | — | — | — | — | — | — | ✓ | ✓ | flags-gated |
| Edit Business Rules | — | — | — | — | — | — | — | ✓ | — |
| Edit Shell Layouts | — | — | — | — | — | — | — | ✓ | — |
| Vehicle Eligibility config | — | — | — | — | — | — | — | ✓ | — |
| Revoke compliance lock | — | — | — | — | — | — | ✓ | ✓ | — |
| See readonly admin manager | — | — | — | — | — | — | — | ✓ | — |
| Any write | varies | varies | varies | varies | varies | varies | ✓ | ✓ | **❌ 403** |

### Visibility scope on chain / lifetime endpoints

| Role | Scope |
|---|---|
| Fronter | Own non-resell rows only |
| Fronter Manager | Company-scoped non-resell rows |
| Closer | Own closer-side rows |
| Closer Manager | Company-scoped closer-side rows |
| Ops Mgr / Co Admin / Compliance / SuperAdmin / Readonly | Full chain across all companies |

---

## Business Rules config keys reference

All keys live in `business_config` (`scope` = `global` OR `company:<uuid>` for per-company override).

| Key | Default | Purpose |
|---|---|---|
| `compliance.status_catalog` | seeded 11 statuses | Sale status pills |
| `compliance.allowed_statuses` | derived from catalog | Legacy whitelist |
| `compliance.default_new_sale_status` | `open` | Status a new sale starts in |
| `compliance.resell_initial_status` | `pending_review` | Status a resell row starts in |
| `compliance.lock_window_days` | 90 | Days after `sale_date` before closer-edits lock |
| `transfer.status_catalog` | seeded 5 statuses | Transfer status pills |
| `shell.layout.staff` | seeded | Staff shell tabs + cards + filters + actions |
| `shell.layout.manager` | seeded | Manager shell |
| `shell.layout.compliance` | seeded | Compliance shell |
| `dedup.window_days` | 30 | Fronter dedup window (refresh vs reengage) |
| `bulk.renewal_window_days` | 30 | Bulk Tier 2 renewal threshold |
| `kpi.cancel_count_keys_on` | `cancellation_date` | Which column drives cancel-rollup |
| `kpi.today_timezone` | `America/New_York` | Today/MTD boundary timezone |
| `kpi.conversion_numerator` | `closed_won` | Conversion rate numerator |
| `kpi.conversion_denominator` | `all_transfers` | Conversion rate denominator |
| `kpi.resell_counts_in` | `{...}` | Per-card resell-inclusion toggles |
| `resell.enabled_statuses` | seeded | Statuses where the Resell button shows |
| `resell.hide_from_fronter` | `true` | Fronter views hide `is_resell=true` rows |
| `resell.hide_from_fronter_manager` | `true` | Same for fronter managers |
| `resell.hide_from_compliance` | `false` | Compliance always sees resells |
| `cancellation_reasons` | seeded 12 reasons × 4 categories | Canonical reason key catalog |
| `vehicle_eligibility` | seeded 13 plans + `_default` | Per-plan eligibility rules |
| `vehicle_eligibility.enforcement` | `block` | `block` (POST/PUT 400) vs `warn` (response carries warning) |
| `notifications.*` | seeded | Notification preferences |
| `drawer.layout.<type>.<role>` | seeded | Drawer section + field visibility |
| `readonly_admin.nav.<user_id>` | none | Per-RO nav allowlist |
| `readonly_admin.flags.<user_id>` | all on | Per-RO permission flags |

---

## API endpoints added

### Sales

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/sales/:id/chain` | Resell chain timeline (permission-scoped) |
| `GET` | `/sales/lifetime/by-phone/:phone` | All sales tied to customer_uuid |
| `GET` | `/sales/customer-history/by-phone/:phone` | Trimmed prior-sales summary |
| `POST` | `/sales/eligibility-check` | Non-mutating eligibility preview |

### Compliance

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/compliance/sales/bulk-search` | Match refs → matched / unmatched / duplicates |
| `POST` | `/compliance/sales/bulk-status` | Bulk status update + reason key + cancellation date + chargeback fields |

### Readonly Admins

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/readonly-admins` | List + nav allowlist + flags |
| `POST` | `/readonly-admins` | Create + optional invite email |
| `PUT` | `/readonly-admins/:userId/nav` | Update nav allowlist |
| `PUT` | `/readonly-admins/:userId/flags` | Update permission flags |
| `DELETE` | `/readonly-admins/:userId` | Soft revoke (default) or `?permanent=true` |

### Existing routes — new request fields

| Route | New fields accepted |
|---|---|
| `PUT /sales/:id` | `cancellation_date` · `cancellation_reason_key` · `chargeback_date` · `chargeback_amount` |
| `POST /sales/:id/compliance` | Same |
| `POST /compliance/sales/bulk-status` | Same + per-row overrides via `updates[]` |

---

## Apply / upgrade checklist

### Step-by-step

1. **Pull main**: `git pull origin main`
2. **Apply migrations in order** in Supabase SQL editor:
   - 072 → 073 → 074 → 075 → 076 → 077 → 078 → 079 → 080 → 081
3. **Set env vars** (if not already):
   ```
   READONLY_ADMIN_EMAIL=...,...        # optional
   SUPERADMIN_EMAIL=...,...            # required
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   FRONTEND_URL=https://crm.yourdomain.com   # required for invite-email redirects
   ```
4. **Restart backend Node process**.
5. **Refresh frontend** in browser.

### Sanity check (5-min smoke)

1. Login as SuperAdmin → check Business Rules → all tabs render.
2. SuperAdmin → Readonly Admins → list loads.
3. SuperAdmin → Business Rules → Vehicle Eligibility → pick a plan → save a tweak.
4. Login as Compliance → Bulk Status Update → search a ref → see results.
5. Open any sale's drawer → check chain section + lifetime banner if applicable.
6. Login as Closer → open SaleForm → bad year/plan combo → eligibility banner.
7. Edit a sale to status=Cancelled → date + reason dropdown appears, required.

All pass → system is healthy.

### Rollback

Each migration is idempotent + replay-safe. To downgrade a single feature without rolling back the whole stack:

| Feature | Toggle |
|---|---|
| Vehicle eligibility | `business_config vehicle_eligibility.enforcement = "warn"` (or drop the catalog row) |
| Cancellation count keying | `business_config kpi.cancel_count_keys_on = "sale_date"` |
| Reason key required | `business_config compliance.require_cancellation_reason_key = false` *(future)* |
| Compliance lock | `UPDATE sales SET compliance_locked_at = NULL` (re-runs on next terminal flip) |

### Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| `23505 uniq_sales_reference_no` on mig 077 | Existing duplicates | Run mig 078 (dedupes + creates index) |
| `23505 uniq_sales_policy_number` on mig 080 | Existing duplicates | Mig 080 has dedupe built-in — re-run |
| Eligibility-check 404 | Backend not restarted after pull | Restart Node |
| Cancellation reason dropdown empty | Catalog config not seeded | Re-apply mig 076 |
| Readonly admin invite email link 404s | `FRONTEND_URL` env missing | Set + restart |
| Readonly admin can't log in after invite | login flow rejecting (missing fast-path) | Pull latest commit `78cd3be` or newer |

---

## Glossary

| Term | Meaning |
|---|---|
| **Cancellation date** | Business date the cancel took effect (not the row-update date) |
| **Reason key** | Canonical key from the `cancellation_reasons` catalog |
| **Resell** | New sale on a customer whose prior sale was cancelled-like |
| **Renewal** | New sale on a customer whose prior sale is still active but `sale_date` is > window days old |
| **Client switch** | Same car, same customer, different underwriter (MTM → OMEGA) |
| **Plan switch** | Same car, same client, different plan (Basic → Premium) |
| **Lifetime customer** | Customer touched by ≥2 companies (cross-co) |
| **Compliance lock** | Terminal-status guard preventing closer revert |
| **Customer UUID** | Deterministic UUIDv5 of normalized phone — cross-co identity |
| **Sale Chain** | Linear timeline of every term tied to one original sale |
| **Tier 1/2/3** | Bulk-upload match rules: ref-king → car-identity → no-key |
| **DUP-suffix** | `-DUP-<id>` appended by mig 078 / 080 dedupe |
| **Readonly Admin** | View-everything-write-nothing role for auditors / investors |

---

## Where to find this guide

`docs/AUTOWARRANTY_GUIDE.md` in the repo. Update as new features land.

## Questions / changes needed

Open a ticket or ping the dev team. Add a section here when shipping new gap-closures.
