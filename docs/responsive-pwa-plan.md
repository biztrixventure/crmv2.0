# Responsive (mobile → 4K) + PWA groundwork — Audit + Plan

Scope: **SuperAdmin (`/admin`)** and **Compliance (`/compliance`)** — shells,
chrome, every tab and sub-tab, modals, drawers, tables, filter bars, KPI strips,
forms, and the login/auth pages. Layout only: no endpoint, payload, permission
or business-logic change.

Status: **steps 1–9 done** — see §6 for what shipped and, more importantly, for
the two places where measuring corrected this audit. PWA groundwork (§5) not
started.

Method: static sweep of `components/Admin`, `components/Compliance`, `shells/`
plus a live probe on https://crm.vertexpakistan.com as superadmin at 390×844 and
768×1024, measuring `body.scrollWidth − documentElement.clientWidth`, per-element
right-edge overflow (ignoring anything a scrollable ancestor absorbs), tab-strip
`scrollWidth > clientWidth`, touch-target rects and computed font sizes.

---

## 1. Measured failures

### 1.1 The page itself overflows — and it's the shared chrome, not the tabs

| Viewport | `body.scrollWidth` | `clientWidth` | Horizontal overflow |
|---|---|---|---|
| 390 (iPhone) | 487 | 380 | **+107px** |
| 768 (tablet portrait) | 976 | 758 | **+218px** |

The offending nodes at both sizes are all in `AdminHeader`: the right cluster
(Mail · Chat · Bell · theme · user pill · Logout) plus the left brand block.
Isolated: `header.scrollWidth = 487` against `clientWidth = 380`.

Why it gets **worse** at 768: the user pill and the divider are gated
`hidden sm:flex` / `hidden sm:block`, so crossing 640px *adds* ~180px of content
to a row that already didn't fit.

**Content is not the problem.** With the header and sidebar hidden (i.e.
simulating the fix), 27 of 30 admin tabs measure **zero** content overflow at
390px. Only three tabs overflow on their own:

| Tab | Content overflow @390 | Cause |
|---|---|---|
| `data-analyzer` | **+304px** | `flex items-center gap-2 flex-wrap flex-shrink-0` toolbar — `flex-shrink-0` defeats the `flex-wrap` |
| `branding` | **+92px** | `p-4 space-y-4` identity/SEO block, un-wrapped label + input row |
| `dashboard` | +25px | pipeline legend `flex items-center gap-3 text-[11px] flex-shrink-0` |

Compliance measures **0px** page overflow at 390 on Companies and on Records →
All Sales. Its `AppHeader` is the pattern that works (`px-3 sm:px-5 lg:px-8`,
`min-w-0` on the left cluster, title `hidden sm:flex`, icon-only Logout).

### 1.2 Sidebar — hardcoded 256px, always mounted

`AdminSidebar.jsx:103-110`: `className="w-64 flex-shrink-0"` +
`height: calc(100vh - 64px)`, `position: sticky`. `AdminPanel.jsx:68` defaults
`sidebarOpen = true` and never persists it, so **every page load on a phone
opens with the sidebar taking 256 of 390px** — measured content width **82px**.
Screenshots confirm KPI tiles rendered one digit wide and a calendar squeezed to
illegibility.

Also `calc(100vh - 64px)` is wrong on mobile browsers (URL-bar chrome) — needs
`100dvh`.

### 1.3 Tab strips

| Strip | Behaviour | Verdict |
|---|---|---|
| `PillTabs` (kit) | `overflow-x-auto`, `nowrap`, fade when it clips | **correct** — the reference |
| `ChromeTabs variant="chrome"` | `overflow-x-auto`, `nowrap`, **no fade**, no scroll-active-into-view | scrolls, but gives no affordance and can open with the active tab off-screen |
| `ChromeTabs variant="pill"` | `flex flex-wrap` | **wrong** — wraps into ragged rows. Confirmed live: Compliance → Records puts "Post Date" alone on a second row |

Measured live at 390 with the sidebar mounted: chrome strip `client 82 / scroll
1029`, pill strip `client 80 / scroll 866` — reachable only by scrolling an
82px-wide window.

`ComplianceShell.jsx:223` puts the chrome strip and the "Numbers info" button in
one `flex-wrap` row, so the button steals width from the tabs instead of moving
below them.

### 1.4 Tables — 30 files, no shared strategy

30 files under `components/Admin` + `components/Compliance` + `shells` render a
`<table>`. Most sit in an ad-hoc `overflow-x-auto` div; **four have none at all**
(`Chat/ChatAdmin.jsx` — 4 tables, `Chat/ClientPortalTab.jsx`,
`Engagement/AnnouncementsManager.jsx`, `Engagement/SpiffManager.jsx`).

Even where the wrapper exists it's only half a solution: Compliance → All Sales
at 390 measures table `851px` inside a `346px` viewport with **no sticky first
column**, so scrolling right loses the customer name — the only column that
identifies the row.

### 1.5 Touch targets

20 sub-44px interactive targets on a single admin screen at 390. The icon
buttons are `w-9 h-9` (36px) in both `AdminHeader` and `AppHeader`;
`NotificationBell`/`MailLauncher`/`ChatLauncher` measure 38×38; Logout measures
39×31.

### 1.6 Text

`text-[10px]` renders at 10px on mobile — measured on PillTabs/ChromeTabs count
badges and on role labels ("compliance manager", "closer"). Below the 11px floor
this plan sets.

### 1.7 Non-responsive grids

13 `grid-cols-3..7` with no breakpoint prefix. Confirmed offenders:
`ActivityPanel:244` (cols-3), `AdminAnalyticsDashboard:214,222` (cols-7),
`:611` (cols-4), `Engagement/AnnouncementsManager:53`, `Engagement/SpiffManager:112`,
`FeatureFlagsManager:78`, `FormBuilder:1880,1910` (cols-5),
`LeadIntelligence:326`, `Compliance/CallbacksTab:144` (cols-4),
`Compliance/CompaniesTab:102`.

### 1.8 Modals / drawers

- `UI/Modal.jsx` — `max-w-md` + `p-4` + `max-h-[90vh]`, centered. Fits 390 but
  wastes it: it should be a full-screen sheet below `sm`. Header `p-6` +
  `text-2xl` title is oversized on a phone.
- Detail drawers (`Sale`, `Transfer`) already use `width: min(480px, 100vw)` —
  **already correct**; they need `100dvh` and safe-area padding only.
- `Callback`/`UserDetail` drawers use `w-full max-w-md`/`max-w-lg` — also fine.
- `ActivityPanel` (the right-edge slide-out, mounted on every admin screen) uses
  `min(440px, 100vw)` — fine — but its pull-tab is `fixed right-0 top-1/2`,
  which on a phone overlaps content with no way to dismiss it.

### 1.9 Not yet measured (called out honestly)

The live probe drives tabs through the `admin-nav` event, which lands each tab
on its **default** sub-tab. These inner tabs were **not** measured and must be
swept in the migration: VICIdial (7), Chat Control (8), User Control Center (11),
Business Rules panels, Clients & Plans (5), and each hub's members beyond the
first. Also unmeasured: 1600/2560 (expected clean — the shell is full-width with
no `max-w` cap, one exception `QAShell:1095 max-w-[1480px]`, out of scope), and
dark mode at each size.

Pre-existing, unrelated: `GET /api/note-shortcodes` 500s in the console. Not a
layout issue, not in this scope.

---

## 2. Shared offenders — fix these five and most screens fix themselves

1. **`AdminHeader`** → the entire 107px/218px page overflow.
2. **`AdminSidebar` + `AdminPanel`'s flex row** → the 82px content column.
3. **`ChromeTabs`** (pill wrap + chrome fade) → every tab strip in both shells.
4. **A shared table wrapper** → all 30 table files.
5. **`UI/Modal`** → every dialog in both shells.

---

## 3. Proposed strategy

### 3.1 Breakpoints

Tailwind defaults, already in use — no new system:
`sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536`.
**Sidebar boundary = `lg` (1024).** Below it, off-canvas; at and above,
persistent. Tested at 360 · 390 · 768 · 1024 · 1280 · 1600 · 2560, light + dark.

### 3.2 Sidebar — off-canvas drawer below `lg`

- `sidebarOpen` splits into `desktopCollapsed` (persisted, `lg+` only) and
  `mobileOpen` (transient, always starts closed).
- Below `lg`: `fixed inset-y-0 left-0 z-50 w-[min(280px,85vw)]`, translate-X
  transition, dimmed backdrop, closes on backdrop click, on Escape, and on tab
  change. `role="dialog"`, focus moves into the panel, focus returns to the
  hamburger on close.
- At `lg+`: today's sticky column, unchanged.
- Header shows a hamburger below `lg`; the existing `PanelLeftClose` collapse
  toggle only at `lg+`.
- `calc(100vh - 64px)` → `calc(100dvh - 64px)`.

### 3.3 Header — copy the `AppHeader` pattern into `AdminHeader`

Three zones, all `min-w-0`, padding `px-3 sm:px-4 lg:px-6`:
brand text `hidden md:block` · Live chip `hidden lg:flex` · user pill
`hidden xl:flex` (avatar-only button below that, same click target) · Logout
icon-only below `sm`. Nothing is removed on mobile — the profile modal is still
one tap away, logout is still one tap away.

### 3.4 Tables — one strategy: scroll + sticky first column

New kit component `<TableScroll>`:
`overflow-x-auto` wrapper · `min-w-max` table · first `th`/`td`
`position:sticky; left:0` with a surface background and a right hairline ·
right-edge fade only when it clips (same rule as `PillTabs`) ·
`tabindex="0"` + `role="region"` so it's keyboard-scrollable.

**Not** card-per-row: 30 tables is too much rewriting, and the compliance tables
are dense comparison grids where cards destroy scanability. Sticky-first-column
keeps the identifying column pinned, which is the actual complaint.

### 3.5 Tab overflow

- `ChromeTabs variant="pill"` drops `flex-wrap` and gains the `PillTabs`
  behaviour (scroll + conditional fade).
- `ChromeTabs variant="chrome"` gains the same conditional fade plus
  `scrollIntoView({ inline: 'nearest' })` on the active tab.
- `ComplianceShell:223` — the "Numbers info" button moves out of the tab row
  below `sm`.
- No "More" overflow menu for now: with scroll + fade + active-into-view, every
  strip in scope is reachable, and a hidden menu would bury tabs. Revisit only if
  a strip proves unusable at 360.

### 3.6 Touch targets

Kit `<IconButton>` at 44×44 below `sm`, 36×36 at `sm+`
(`w-11 h-11 sm:w-9 sm:h-9`) — pointer-coarse gets the big target, desktop keeps
today's density. Adopted by `AdminHeader`, `AppHeader`, `NotificationBell`,
`MailLauncher`, `ChatLauncher`, and row action buttons.

### 3.7 Modals / drawers

- `UI/Modal`: full-screen sheet below `sm`
  (`max-sm:inset-0 max-sm:rounded-none max-sm:max-h-none`), header
  `p-4 sm:p-6` + `text-lg sm:text-2xl`, footer actions stack full-width below
  `sm`.
- Drawers: `100dvh` + `env(safe-area-inset-bottom)` padding. Widths are already
  correct.
- Portaled dropdowns stay at `zIndex 10000` (unchanged rule).

### 3.8 Type floor

No rendered text below **11px**. `text-[10px]` → `text-[11px]` (with
`leading-none`, per the existing Tailwind-arbitrary-size rule). Page `h1`s get
`text-2xl sm:text-3xl` so "All Sales" stops eating four lines at 390.

### 3.9 Guardrail

A repeatable Playwright probe asserting
`body.scrollWidth <= clientWidth + 1` at all seven widths, so a regression is
caught by measurement rather than by eye.

---

## 4. Migration order (one surface / tight group per commit)

| # | Commit | Why here |
|---|---|---|
| 1 | `AdminHeader` + `AdminSidebar` + `AdminPanel` shell row | kills the 107/218px page overflow and the 82px content column — the single biggest win |
| 2 | Kit: `IconButton`, `TableScroll`, `ChromeTabs` pill-scroll + chrome fade, `Modal` sheet | pure additions/central fixes; nothing else can land cleanly first |
| 3 | `ComplianceShell` chrome (tab row, title/action row, KPI strip) | second shell, same treatment |
| 4 | Tables → `TableScroll`, Compliance batch (9 files) | highest-traffic tables |
| 5 | Tables → `TableScroll`, Admin batch (15 files, incl. the 4 with no wrapper) | |
| 6 | The three measured content offenders: `DataAnalyzer`, `BrandingManager`, `AdminAnalyticsDashboard` | |
| 7 | Non-responsive grids (13 sites) + the 11px type floor | mechanical sweep |
| 8 | Hub sub-tab sweep: VICIdial 7 · Chat 8 · UCC 11 · Business Rules · Clients & Plans 5 | the surfaces the probe couldn't reach |
| 9 | Login / auth pages | |
| 10 | Full verification sweep: 7 widths × 2 themes, programmatic overflow assert + screenshots | |

Per-commit gate: `npx vite build --minify false`, then live verification at the
affected breakpoints in light and dark with a clean console.

**Hard constraints honoured throughout:** no admin tab id renamed or deleted
(`config/adminTabs.js` is the RO-governance domain); deep links and the persisted
`biztrix.adminTab` keep working; no hex literals; `<p>` gets `m-0`; arbitrary
font sizes get `leading-none`; no native `<select>`/`<input type="date">`.

---

## 5. PWA groundwork — LAST, after responsive is verified

### What already exists

- `frontend/public/sw.js` — **push only** (`push`, `notificationclick`,
  `install → skipWaiting`, `activate → clients.claim`). No caching, no fetch
  handler.
- It is registered **on demand** by `usePushNotifications.js:145`, only after the
  user grants notification permission — not at boot.
- `index.html` already has `theme-color`, `mobile-web-app-capable` and the Apple
  meta. **No `manifest.json`.**
- `frontend/server.cjs` already fetches the public `GET /api/branding` and
  injects OG meta per request — the natural place to serve a **dynamic**
  `/manifest.webmanifest` (name / short_name / theme_color / icons from Branding
  & SEO) instead of a static file.

### Conflicts to flag before implementing

1. **One service worker, two jobs.** Adding a fetch/caching handler means
   editing the *same* `sw.js` that carries push. A bad deploy silently kills
   push for everyone. Mitigation: keep push handlers first and untouched, add
   caching behind a version constant, and ship push + cache as separate commits.
2. **Registration timing.** Today the SW registers only after a permission
   grant; an app-shell SW must register at boot. That changes who has an SW —
   including users who declined notifications. Needs an explicit decision.
3. **Never cache `/api`.** This is a live multi-tenant CRM: a cached
   authenticated response served to the wrong tenant or after a permission
   change is a data-leak class bug. Rule: network-only for `/api/*`, cache only
   the app shell + hashed static assets (cache-first, they're content-hashed).
4. **Auth/refresh.** Supabase refreshes JWTs client-side; a cached
   `index.html` served to a signed-out user must still boot into the normal auth
   flow. Stale-shell + fresh-API is safe here, but the shell must never embed
   user state.
5. **`skipWaiting` + the existing `useVersionCheck`/`UpdateBanner`.** The app
   already has an update-available banner. An SW that calls `skipWaiting()`
   unconditionally can swap the bundle under a live session. The two update
   paths must be reconciled, not stacked.
6. **`theme-color` is hardcoded `#6E5838`** in `index.html` while branding is
   dynamic — it should move into the `server.cjs` injection alongside the
   manifest.

### Deliverables (prepared, shipped only on your say-so)

Dynamic `/manifest.webmanifest` from branding · maskable icons · boot-time SW
registration with an app-shell + hashed-asset cache and network-only `/api` ·
`beforeinstallprompt` capture + an install affordance · offline / reconnect
states wired to the existing banner infrastructure.

---

## 6. Results — steps 1–9

### Measured outcome (superadmin, production, dark + light)

| Viewport | page overflow before | after |
|---|---|---|
| 360 / 390 | +107px | **0** |
| 768 | +218px | **0** |
| 1024 / 1280 / 1600 / 2560 | — | **0** |

Admin content column at 390: **82px → 380px**. At 1024 the sidebar returns as
the 256px column, the hamburger hides and the collapse toggle reappears — the
`lg` boundary switches cleanly in both directions. Login page at 360: no
overflow, fits without scrolling.

### Commits

| Commit | Scope |
|---|---|
| `403c425` | Admin shell chrome — off-canvas sidebar, header, `main` min-w-0, dvh |
| `ca90c64` | Kit — `TableScroll`, `IconButton`, ChromeTabs scroll, Modal sheet |
| `e4c8010` | Compliance chrome — tab row, TabHeader stacking, modal sheets |
| `6269fc5` | Compliance record tables — pinned identifying column |
| `a407d90` | The three tabs whose own content overflowed |
| `2fb24be` | Admin tables, non-responsive grids, 10px type floor |
| `1e6ef6b` | 44px touch targets via `pointer: coarse` |

### Where measuring corrected the audit

**1. The table work was polish, not bug-fixing.** §1.4 implied 30 broken
tables. Probing every one at 390 showed *no admin table overflows the page* —
they all sit in a scroll parent already. The real defect was that they scroll
**blind**: the dashboard renders a 2527px table in a 346px window with no
pinned column and no hint there is more to the right. That reframed the work
from "wrap 30 tables" to "pin the identifying column on the tables people
actually live in", which is what shipped.

**2. The hubs were clean.** §1.9 flagged VICIdial (7 sub-tabs), Chat (8), User
Control Center (11), Business Rules and Clients & Plans as unmeasured risk. A
sweep of all 21 admin tabs **and every one of their sub-tabs** at 390 found the
only content overflows anywhere were Data Analyzer and Branding — both already
known. No hidden breakage.

**3. One cause explained two thirds of the content overflow.** `SectionHeader`
paired `flex-wrap` with `flex-shrink-0` on its actions container. Those cancel:
the container refuses to narrow, so it overflows instead of wrapping. Being in
the kit, every admin tab inherited it.

### Also corrected

§1.4's "four files with no overflow wrapper" (ChatAdmin, ClientPortalTab,
AnnouncementsManager, SpiffManager) could **not** be confirmed — those tables
don't render in the default view, so the claim is from static reading only and
remains unverified.

### Deliberately not changed

- `flex-shrink-0` on the ActivityPanel and ChatAdmin toolbars — those sit in
  flex-**column** parents, where it prevents vertical squashing and is correct.
- `text-[10px]` on desktop. The floor is `text-[11px] sm:text-[10px]`: 11px on
  a phone, byte-identical at `sm`+. Raising it everywhere would reflow every
  dense table on the desktop this CRM is mostly used on.
- Touch targets are gated on `pointer: coarse`, not on width — a 1024px tablet
  is touch, a 700px desktop window is not.

### Still open

- Remaining lower-traffic tables (EgressGovernance ×5, VICIdial, Teams,
  CompanyDetail, BulkUploader, the 4 unverified ones above).
- A repeatable overflow probe checked into the repo (§3.9) — the sweeps in this
  work were run ad hoc against production.
- PWA groundwork (§5), including the conflicts listed there.
