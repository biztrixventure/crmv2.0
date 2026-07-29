# Team Quotas — handoff prompt (paste this into a fresh chat)

---

Build a two-tier **team quota** system in BizTrix CRM: a company-level admin
sets a target on a TEAM, the TEAM LEAD sub-allocates that target across their
members, and all three tiers get a progress report.

## The business rule, exactly

- **superadmin** and **company_admin** assign a quota to a TEAM.
  Superadmin can do this for any company; company_admin only for their own.
  Example: "this team must produce 1,500 transfers this month."
- **The team lead** then decides how to spend that number across their members.
  They must be able to allocate per member on their own schedule — 50 transfers
  a week for fronter A, a bulk 300 over 7 days for fronter B, 3 sales this month
  for fronter C. The lead's allocations do **not** have to sum to the parent
  quota; over- and under-allocation are both normal, but the UI must show the
  gap so the lead can see it.
- Quotas exist for **transfers** and for **sales**, and the operator wants to be
  able to define **other quota kinds later** — do not hardcode a fixed pair.
- Periods must be flexible: a day, a week, a month, or an explicit date range.
- **Reports**: the team lead sees their own team, the company_admin sees every
  team in their company, superadmin sees every company. This mirrors the
  existing Teams tab visibility, which is already correct — do not change it.

## READ FIRST — this is NOT greenfield

A partial version already ships. Extending it is the job; rebuilding it is a
regression.

- `backend/migrations/211_teams.sql` — `teams` + `team_members`. **`teams`
  already has `goal_monthly_sales` and `goal_monthly_transfers`.** That is a
  team-level target with two fixed metrics and a monthly-only period. Your model
  must either supersede these columns or migrate their values in; leaving two
  competing target systems is the failure mode.
- `backend/migrations/212_team_lead_edit.sql` — `teams.allow_lead_edit`, the
  per-team switch for whether the LEAD may edit their own team. This is the
  natural gate for "may this lead sub-allocate", so check it rather than
  inventing a new permission.
- `backend/routes/teams.js` — `GET /:id/report` **already returns** totals,
  per-member leaderboard, trend, goal %, and prior-window momentum. The quota
  report is an extension of this endpoint.
- `backend/migrations/043_announcements_marquee_spiff.sql` — **the modelling
  precedent.** SPIFF already encodes `metric`, `target_value`, `starts_at`,
  `ends_at`, `target_type` + `target_user_ids[]`. Follow that shape for quota
  metric/period instead of inventing a new one, and check whether quotas and
  SPIFFs should share a table or stay separate — say which and why.
- `backend/routes/stats.js` → `GET /stats/agent-performance` — **this is your
  measurement layer.** It already computes per-agent transfers / sales /
  approved / cancelled / conversion / approval for a date range, scoped by
  company and side, server-side and paginated. Attainment = actuals from here
  vs the allocation. Do not write a second counter.
- `frontend/src/components/Admin/Teams/TeamManager.jsx` (Teams tab) and
  `MyTeam.jsx` (team-lead home) — the two surfaces this lands in.

## MEASURE FIRST — report before writing code

1. How many teams exist per company, how many have a lead assigned, and how
   many already have `goal_monthly_*` set? If almost none do, say so — it
   changes whether migrating those columns is worth any complexity.
2. How many users are in a team vs not? Members outside every team cannot
   receive an allocation, and that gap needs a stated answer.
3. Does `GET /teams/:id/report` already produce the per-member actuals you
   need, or does it disagree with `/stats/agent-performance`? If two endpoints
   report different numbers for the same person, fix that before building on
   either.

Report those counts before building.

## Hard requirements

- **Scoping is server-side.** A company_admin must never read or write a quota
  for another company. Use `resolveScopedCompanyId(req)` and
  `isCloserSideScope(role, companyId)` from `backend/models/helpers.js` — never
  add another hardcoded role-name list.
- **company_admin is company-type aware.** A fronter company is judged on
  transfers, a closer company on sales. See memory `company_admin_two_sided`.
- **Never count by fetching rows.** PostgREST silently caps every request at
  **5,000 rows** on this project and `.limit(20000)` is ignored. Use
  `{ count: 'exact', head: true }` or page with `.range(p*1000, …)`. This has
  already caused one production undercount.
- **UI comes from the kit**: `frontend/src/components/UI/kit` +
  `docs/ui-design-system.md`. `Panel` / `SectionHeader` / `KpiTile` /
  `TableScroll stickyFirst` / `Loading` / `EmptyState` / `Field` / `PillTabs`.
  No native `<select>` or `<input type="date">` — `ThemedSelect` / `ThemedDate`.
  Every `<p>` needs `m-0` (global `p { margin: 12px 0 }`). 11px type floor on
  mobile. No hex literals — dark mode inverts the `-50` scales, so use
  `color-mix(in srgb, var(--color-x) 18%, transparent)`.
- **Mobile first at 390.** Tables scroll inside `TableScroll`, never the page.
  Charts use Chart.js (already a dependency) with `interaction: {mode:'index',
  intersect:false}` and a tap-to-pin summary — a native `title` tooltip does not
  fire on touch.
- **Never rename or delete a tab id** — readonly-admin governance stores them.

## Build / verify / ship

- Migrations: highest is **215**, so the next free number is **216**. The
  Supabase MCP server is not authorized — write the numbered `.sql`, commit it,
  and ASK THE USER to run it, then verify via the API that it took effect.
- **A green build proves nothing.** Production builds with `minify: "terser"`
  while the documented local command passes `--minify false`, so the local build
  is not the artefact that ships, and neither build catches an undefined
  identifier or a temporal-dead-zone read. Both have blanked production here.
  The only real check:
  ```
  cd frontend
  VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... \
    NODE_OPTIONS=--max-old-space-size=8192 npx vite build
  npx vite preview --port 4173
  ```
  then load it in a browser and read `window.onerror` stacks. The
  "terser OOMs this machine" note is stale — 8 GB works.
- After editing any React file, grep every `<Component` and `useX(` in it
  against its import block. `Panel`, `LayoutGrid` and `safeUuid` were each used
  before being imported in this codebase and every build stayed green.
- Backend: `node --check` each changed file.
- Verify as a REAL company_admin, not superadmin — superadmin bypasses the very
  checks you are adding. `cadmin@etc.com` (EasyTech, fronter) and
  `cadmin@vertex.com` (1-Vertex, closer), password `12345678`. Live at
  https://crm.vertexpakistan.com — production auto-deploys from `main` in ~2–4
  min. Backend-only changes do not change the frontend bundle hash; probe the
  endpoint instead of polling `index.html`.
- Commit per stage. Author **Abdul Manan**, never `mibrahim`. Co-author:
  `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.
  `git push` needs `GIT_TERMINAL_PROMPT=1` and often a retry — GitHub DNS is
  flaky on this machine.

## Do not lose

- Transfer status `assigned` (~15.7k rows) and sale status `open` (28 rows) were
  investigated for removal and deliberately KEPT — both are live workflow
  states. The genuinely dead ones are transfer `rejected` (3 rows) and sale
  `sold` / `closed_lost` / `follow_up` (0 in every company). Those filter pills
  are config-driven via `transfer.status_catalog` and
  `compliance.status_catalog` in `business-config`, so any removal is a config
  edit, not code.
- Migration `155_note_shortcodes.sql` has been applied; the personal-shortcode
  tier works.
- Migration 215's egress half never took: `closer` and `fronter` are still
  `__global: false` and only `dataset=sales` is blocked. `StaffShell.jsx:943`
  ORs `sales || transfers || callbacks`, so blocking only `sales` will not hide
  that button. Staff export is currently off because the `staff_export` feature
  flag is off, not because of egress.
