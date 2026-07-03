# Data-Egress Governance — Complete Guide

**One line:** every time data leaves BizTrix — a CSV/Excel download, or a client
playing a call recording — it is now optionally capped, column-filtered, and
**always logged**, all controlled by the superadmin from one screen.

Shipped 2026-07-03 (commits `8e9e2af`, `2d8e919`). Migration **167**. The
landscape survey that preceded it is in [`export-governance-audit.md`](export-governance-audit.md);
this document is the how-it-works + how-to-use guide.

---

## Contents
1. [What we built](#1-what-we-built)
2. [Turning it on](#2-turning-it-on)
3. [The four things you control](#3-the-four-things-you-control)
4. [How to use it — operator guide](#4-how-to-use-it--operator-guide)
5. [What users experience](#5-what-users-experience)
6. [Every surface that's governed](#6-every-surface-thats-governed)
7. [How it works under the hood](#7-how-it-works-under-the-hood)
8. [For developers — adding a new export](#8-for-developers--adding-a-new-export)
9. [Config & data reference](#9-config--data-reference)
10. [FAQ / troubleshooting](#10-faq--troubleshooting)

---

## 1. What we built

Before this, anyone who could reach an export button could download **unbounded**
data (the client exporter paged up to ~20 million rows; the Data Analyzer export
capped at 1 million) with **no record of it happening**, no row limit, and no way
to hide sensitive columns. Recording playback in the client portal was logged
(`portal_listens`) but not limited.

Now there is one governance layer over **all** of it:

| Capability | What it does |
|---|---|
| **Audit log** | Every export and every recording listen — allowed *or* blocked — is recorded: who, when, which dataset, how many rows / how many minutes, the exact filters used, and (if blocked) why. |
| **Numeric limits** | Cap max rows per export, max exports per day, and max recording-minutes per day — set per role, with per-company or per-user overrides. |
| **Export field selection** | Choose exactly which columns appear in the downloaded file, per dataset and per role. |
| **List-display config** | Set the on-screen rows-per-page and default row view per shell and role. |

**Nothing is a black box:** it's all driven from **Admin Panel → System → Data
Egress**, and nothing changes for anyone until a superadmin actively sets a limit
or a config. On day one everything is seeded *unlimited*.

---

## 2. Turning it on

1. **Apply the migration** — run `backend/migrations/167_data_egress_governance.sql`
   in the Supabase SQL editor. It creates two tables (`export_audit_log`,
   `egress_limits`), their indexes, and seeds one *unlimited* limit row per role.
   Idempotent — safe to re-run.
2. **Restart the backend** so the new `/api/egress` routes + the enforcement
   middleware mount.
3. **Hard-refresh** the frontend. A new **Data Egress** item appears in the admin
   sidebar under **System** (superadmin only).

**Rollout safety:** until you set a real limit, every role is unlimited and no
column/page-size config exists, so **every existing export behaves exactly as
before** — except it now writes an audit-log row. If the migration isn't applied
yet, the code fails *open* (exports work, just unlogged) — nothing breaks.

---

## 3. The four things you control

Open **Admin Panel → Data Egress**. Three tabs:

### a. Export & Recording Audit
A searchable, paginated log of every egress event. Four summary tiles at the top
show **today's** totals: exports, denied attempts, recordings, active users.

### b. Egress Limits
- **Role defaults** — a grid of every role × action. Type a number to cap it;
  leave blank for **∞ unlimited**. Edits save when you click away (on blur).
- **Per-user / per-company overrides** — the rare case where one person or one
  company needs a different limit than their role. Pick the user/company (a real
  search box, not a UUID) and set their numbers.

### c. Fields & Display
- **Export columns** — for a dataset + role, tick exactly which fields land in the
  downloaded CSV. Unticked columns never leave the server.
- **List display** — for a shell + role, set rows-per-page and the default row
  view (expanded/collapsed).

---

## 4. How to use it — operator guide

### Cap how much a role can export
1. Data Egress → **Egress Limits**.
2. In **Role defaults**, find the row (e.g. `closer` / `csv_export`).
3. Type into **Max rows / export** (e.g. `5000`) and/or **Max exports / day**
   (e.g. `10`). Click away — it saves and toasts "Limit saved".
4. Done. Every closer is now capped; a closer trying to export 12,000 rows is
   blocked *before* the download with a message telling them the limit.

> **How limits resolve:** for each person we look for the most specific matching
> row — **user override beats company override beats role default** — and use
> that row's numbers. A blank field in the chosen row means "unlimited for that
> one field". To give one closer a bigger cap than the rest, add a **user
> override** (below); it wins over the role row wholesale.

### Give one person (or company) a different limit
1. Egress Limits → **Per-user / per-company overrides**.
2. Toggle **User** or **Company**, then **search and pick** them (type a name).
3. Choose the action, set the numbers, **Add override**.
4. It appears in the overrides table; edit any cell on blur, or trash the row to
   remove the override (they fall back to their role default).

### Limit recording playback for a client
Recordings use the `recording_listen` action. Set **Max rec. min / day** on the
`portal_client` role row (or a per-user override keyed to a specific portal
login). A client who has played, say, 60 minutes today is then blocked from
starting another clip until midnight.

### Hide columns from an export
1. Data Egress → **Fields & Display** → **Export columns**.
2. Pick the **dataset** (Sales, Transfers, …) and the **role**.
3. Untick the fields you don't want in that role's exports (e.g. hide
   `customer_email`, `monthly_payment`).
4. **Save columns.**
5. From then on, when someone of that role exports that dataset, those fields'
   **values never leave the server** — they're stripped before the file is built.

> Data Analyzer columns are dynamic, so its field-selection is label-based and
> configured against the analyzer's own output rather than a fixed checklist.

### Set rows-per-page / default view for a shell
1. Fields & Display → **List display**.
2. Pick the **shell** (staff/manager/compliance) and **role**.
3. Set **Rows per page** (blank = the built-in default) and **Default row view**.
4. **Save display.** Users of that shell/role get that page size on next load;
   they can still change views per session — this just sets the starting point.

### Investigate an export
1. Data Egress → **Export & Recording Audit**.
2. Filter by user, action, dataset, status (allowed/denied), or date range.
3. Click a row to expand it — you see the **exact filters** that were applied at
   export time, the origin surface, and (for a blocked attempt) the reason.

---

## 5. What users experience

| Scenario | What they see |
|---|---|
| **Export within limits** | Nothing different — the file downloads as always. (A row is silently logged.) |
| **Export over the row cap** | The download is **refused before it starts** with a clear message: *"This export has 12,300 rows but your limit is 5,000. Narrow the filters (e.g. a date range) and try again."* The export modal stays open so they can adjust. |
| **Hit the daily export limit** | *"You've reached your daily export limit (10). It resets at midnight."* |
| **Near the limit (in the export modal)** | A hint shows before they even click: *"Exports today: 8/10. Max 5,000 rows per export."* |
| **Export a dataset with hidden columns** | The file simply doesn't contain those columns' data. |
| **Client hits the recording-minutes cap** | Playback is refused: *"Daily recording-playback limit reached (60 min). It resets at midnight."* |
| **Everyone with no limit set** | Completely unchanged — unlimited, as before. |

Every one of these — allowed or blocked — lands in the audit log for the
superadmin.

---

## 6. Every surface that's governed

All confirmed against the codebase, not assumed.

| Surface | Governed how |
|---|---|
| Compliance **Review Queue / All Sales / Transfers / Callbacks / Call Reviews** exports | server middleware on the list endpoints |
| Compliance **Callback Audit Log** export | server middleware |
| **Admin Analytics** dashboard export (sales/transfers/callbacks) | server middleware |
| **Company Detail** export (sales/transfers/callbacks per company) | server middleware |
| **Data Analyzer** export | server-side, direct — **plus true column removal** |
| **Bulk Upload** batch re-export (transfers + sales) | server-side, direct |
| **Client portal recording** playback (confirmed clip *and* live-resolved) | server-side, direct — logs to `export_audit_log` **and** `portal_listens` |
| **Numbers Intelligence** + **Customer Profile** exports | soft client-log (audited + daily-capped; see FAQ) |

---

## 7. How it works under the hood

Three moving parts, one decision function.

### The decision (`backend/utils/egressGuard.js`)
`enforceEgress()` is the single gate everything calls. It:
1. **Resolves limits** — queries `egress_limits` for the role, company, and user
   rows matching this action, and picks the **most specific** (user > company >
   role). Null field = unlimited. If nothing matches, unlimited. It **fails
   open** — a governance-layer error never blocks a legitimate export.
2. **Checks the row cap** against the *full* export size (not per-page) before any
   data is streamed.
3. **Checks the daily count / minutes** from `export_audit_log` (today's allowed
   rows for this user + action).
4. **Logs the result** — allowed or denied — to `export_audit_log`, always.

### The tricky part — client CSV exports reuse normal list endpoints
The compliance/admin CSV exporters don't hit a dedicated "export" route; they
page the *same* `GET` endpoints the UI uses for browsing. So we can't just gate a
route. Instead:

- The frontend export helpers add two markers to the request:
  `__egress=csv_export` and `__dataset=<name>`.
- `backend/middleware/egressAudit.js` is mounted on those routers. **Without the
  marker it does nothing** (normal browsing is untouched). **With the marker**, on
  the *first page* of the export (which carries the total row count), it runs
  `enforceEgress()`, and either lets the page through or replaces it with a
  **429** — which makes the client's paging loop stop immediately. It also
  **deletes disallowed columns** from the response rows (field selection at the
  data layer).

### Dedicated exports call the guard directly
The Data Analyzer export, batch re-exports, and portal recording endpoints aren't
paged list endpoints, so they call `enforceEgress()` inline and return 429 on
denial.

### Config resolution
Export-column and list-layout settings live in `business_config`
(`export.columns.<dataset>.<role>`, `list.layout.<shell>.<role>`) and resolve
company → global → code default — the same cascade the drawer/shell layouts use.

```
┌── client export helper ── adds __egress + __dataset markers ──┐
│                                                               ▼
│  GET /compliance/sales?__egress=csv_export&__dataset=sales&page=1
│                                                               │
│              egressAudit middleware (page 1 only)             │
│                 │ reads `total`                               │
│                 ▼                                             │
│            enforceEgress() ── resolve limits ── over cap? ──► 429 + log DENIED
│                 │ ok                                          │
│                 ├─ strip disallowed columns                  │
│                 └─ log ALLOWED ──► stream the page ──► client drains rest
└───────────────────────────────────────────────────────────────┘
```

---

## 8. For developers — adding a new export

**⚠ The single most important rule:** a new client-side export **must send the
`__egress` marker**, or it silently escapes governance (the middleware no-ops
without it).

- **Paged list-endpoint export** (uses `fetchAllForExport`): pass the dataset as
  the 5th arg — `fetchAllForExport(endpoint, params, dataKey, onProgress, 'sales')`
  — and catch the thrown `err.egressBlocked` to show the message. The helper adds
  the markers for you.
- **Custom client fetch**: add `__egress: 'csv_export', __dataset: '<name>'` to the
  request params on the first/only page, and handle a `429` with
  `code === 'EGRESS_LIMIT'`.
- **Dedicated server export route**: call
  `enforceEgress({ user: req.user, actionType: 'csv_export', dataset, rowCount, filters })`
  before streaming; return `429` if `!allowed`.
- **In-memory export** (data already on the client, no drain): `POST /egress/client-log`
  with `{ dataset, row_count }` — audits it and enforces the daily cap (soft; the
  row count is client-reported).

Then, if you want the surface to appear in the audit filters and column config,
add its `dataset` name to `DATASET_ROWS_KEY` in `egressAudit.js` (for column
stripping) and to `EXPORT_DATASETS` in `EgressGovernance.jsx` (for the column
checklist).

---

## 9. Config & data reference

### Tables (migration 167)
- **`export_audit_log`** — `user_id, company_id, role_level, action_type
  ('csv_export' | 'recording_listen'), dataset, surface, status
  ('allowed' | 'denied'), deny_reason, row_count, duration_seconds,
  filters_applied (jsonb), created_at`. Hot-path index `idx_eal_enforce` on
  `(user_id, action_type, created_at) WHERE status='allowed'`.
- **`egress_limits`** — `scope_type ('role'|'company'|'user'), scope_id,
  action_type, max_rows_per_export, max_exports_per_day,
  max_recording_minutes_per_day` (all nullable = unlimited). Unique on
  `(scope_type, scope_id, action_type)`.

### business_config keys
- `export.columns.<dataset>.<role>` → `["field_key", …]` (allowed export columns)
- `list.layout.<shell>.<role>` → `{ page_size, visible_columns[], default_view }`

### API (`/api/egress`, superadmin unless noted)
- `GET /audit` · `GET /audit/meta` · `GET /audit/stats` — the audit browser + tiles
- `GET /limits` · `PUT /limits` · `DELETE /limits/:id` — numeric limits
- `GET /columns` · `PUT /columns` — export field selection
- `GET /list-layout` · `PUT /list-layout` — list display config
- `GET /my-usage` *(any authed user)* — the client pre-check hint
- `POST /client-log` *(any authed user)* — soft audit for in-memory exports

---

## 10. FAQ / troubleshooting

**"I set a limit but exports still go through unlimited."**
Check the resolution order — a **user or company override** beats the role
default. Also confirm migration 167 is applied and the backend was restarted.

**"An export shows blank columns instead of dropping them."**
Field selection removes the *values* at the data layer for every client export
(the data never leaves), but true *header* removal is currently applied only to
the **Data Analyzer** export. Compliance client tables keep the header with an
emptied column — the data is protected; the empty header is cosmetic and is the
one remaining thread-through (config + API + UI are all in place).

**"Numbers Intelligence / Customer Profile exports aren't hard-capped."**
Those export data already loaded in the browser, so there's no server drain to
intercept. They use a *soft* client-log: the export is audited and the daily-count
cap is enforced, but the row cap is best-effort (client-reported), by design.

**"Do recordings get double-logged?"**
Yes, intentionally — `portal_listens` remains the client-facing listen record;
`export_audit_log` is the governance record. Recording "minutes" counts the
clip's full duration per listen (not seconds actually streamed).

**"A new export button I added isn't in the audit."**
It's missing the `__egress` marker — see §8.

**"Can readonly-admins change limits?"**
No. All egress-config writes are superadmin-only; readonly-admins are blocked by
the standard guard.

**"Where do I see blocked attempts?"**
Audit tab → filter Status = **Denied**. Blocked attempts are logged with their
reason, so you can spot someone repeatedly trying to over-export.
