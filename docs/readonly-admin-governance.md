# Read-only Admin Governance (SuperAdmin control)

Superadmin-controlled, per-user (with a role-wide default) governance for the
`readonly_admin` role. Same AdminPanel shell as superadmin — governance hides or
disables parts and enforces data boundaries server-side; it never gives the RO a
different-looking app.

## Model
Config lives in `business_config` (scope `global`) under `readonly_admin.*`,
resolved by `backend/utils/readonlyGovernance.js` (`resolveGovernance(uid)`,
cached 30s). **Posture: full parity, opt-out** — an unconfigured RO sees
everything a superadmin can (minus superadmin-only tabs). Per-user overrides beat
the role default (`readonly_admin.defaults`) beats parity.

| Facet | key | absent = |
|---|---|---|
| Tabs | `readonly_admin.nav.<uid>` (array) | all eligible tabs |
| Flags | `readonly_admin.flags.<uid>` (`view_pii`, `view_financial_data`, `view_audit_history`, `can_export`, `no_copy`) | parity (no_copy=false) |
| Companies | `readonly_admin.companies.<uid>` (array) | all companies |
| Export areas | `readonly_admin.export.<uid>` (`{area:bool}`) | all on |
| Role template | `readonly_admin.defaults` (`{tabs,flags,companies,export}`) | none |

## What's enforced server-side (built)
- **Auth payload** (`routes/auth.js`) — `/auth/me`, `/login`, `/exchange` embed a
  `governance` blob on the RO user object → frontend hydrates it synchronously
  (no flash).
- **Writes** — `middleware/readonlyGuard.js` 403s every non-GET (unchanged) and now
  logs `blocked_write` to `readonly_activity_log`.
- **Exports** — `utils/egressGuard.js` denies an export when `can_export=false` or
  the per-area toggle is off; `egress_limits.dataset` (mig 209) adds per-area
  numeric caps.
- **Company isolation + PII/financial masking** — inline on
  `GET /compliance/{sales,transfers,callbacks}` (filter + `maskForReadonly`), AND
  forget-proof on the raw `/api/{sales,transfers,callbacks}` mounts via
  `middleware/readonlyDataGuard.js` (wraps `res.json` → drops out-of-scope rows +
  masks). The compliance router guard now also fast-passes `readonly_admin`.
- **Activity** — `readonly_activity_log` (mig 209) + `/api/activity/beacon`
  (client tab/view/copy) + `GET /readonly-admins/:id/activity` (merged timeline).
- **Frontend** — `AuthContext` (`roTabAllowed/roExportAllowed/roCan/roNoCopy`),
  `AdminPanel` (nav gating + copy guard), `useCopyGuard` + `.copy-locked`,
  `ReadonlyAdminManager` (the full control UI), shared `config/adminTabs.js`.

## Remaining company-isolation injection points (TODO — from the route audit)
`readonlyAllowedCompanyIds(req)` returns `null` (unrestricted) or an id array.
Apply `scopeToCompanies(query, allowed, column)` (or a 403 clamp) + `maskForReadonly`.
readonlyGuard already blocks the POST-only reads, so those are low priority.

HIGH (currently reachable, cross-company PII/financial):
- `routes/compliance.js`
  - `GET /companies` — filter the company list + `p_ids` to `allowed` (the RO's
    company dropdown; also gates `company_data`).
  - `GET /companies/:id/report` — 403 if `:id` not in `allowed`.
  - `GET /double-sold` — keep groups whose `closer_company_ids` intersect `allowed`.
  - `GET /duplicate-sold` — keep groups whose `company_ids` intersect `allowed`;
    constrain the drill-down sales `.in('company_id', allowed)`.
  - `GET /recordings/queue` — pass `p_company_ids: allowed`.
  - `GET /recordings/candidates|client-sales|stream` — resolve the clip's
    sale.company_id and 403 if not in `allowed` (or block phone/lead_id/recording_id
    modes for RO).
- `routes/sales.js` / `routes/transfers.js` / `routes/callbacks.js` — the raw
  list/detail reads lump RO with superadmin, BUT are now covered response-side by
  `readonlyDataGuard` (row-drop + mask). Optional hardening: also inject the
  company filter at the QUERY level so paging `total` counts are exact.
- `routes/customerProfile.js` `/*` — `requireToolAccess('tool_customer_profiles')`
  admits RO unconditionally; thread `allowed` into the repo reads
  (`.in('company_id', allowed)`), and for `/browse` (v_customer_segments has no
  company_id) restrict to customer_uuids in allowed companies. Interim hard-stop:
  `allowReadonly:false`. Use `maskProfile` for masking.
- `routes/numberLists.js` — remove `readonly_admin` from `SUPERADMIN_LEVELS` /
  `CROSS_COMPANY_LEVELS` and force `.in('company_id', allowed)`; `/companies`
  returns only `allowed`.

MEDIUM:
- `routes/compliance.js` `GET /users`, `/callbacks/phone-history`,
  `/callback-numbers(/:id)`, `/callback-audit-log` — `.in('company_id', allowed)`.
- `routes/stats.js` `GET /dashboard`, `/team-trends`, `/user-performance/:userId`
  — add an RO branch to `scopeSales`/`scopeTransfers` (`.in('company_id', allowed)`)
  and require the target user be in an allowed company.
- `routes/companies.js` `GET /` — source the allowed set from
  `readonly_admin.companies.<uid>` so the picker matches enforcement.
- `routes/activityLogs.js`, `routes/presence.js` — restrict to `allowed`.

LOW (POST-only, blocked by readonlyGuard today): `dataAnalyzer.js`
`/query|/export|/breakdown`, `compliance.js` `/sales/bulk-search`,
`leadIntelligence.js` (already effectively closed for RO).

## Migration
`backend/migrations/209_readonly_governance.sql` — `readonly_activity_log` +
`egress_limits.dataset`. Apply AFTER 208 (confirm 208 is applied first).
