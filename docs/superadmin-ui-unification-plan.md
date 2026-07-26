# SuperAdmin UI Unification — Audit + Plan

Goal: every superadmin surface follows ONE design language, matching
`frontend/src/shells/ComplianceShell.jsx` (DotGridBg, roomy responsive padding,
ChromeTabs chrome+pill, rounded-xl/2xl surfaces, theme-var only, light+dark).

Status: **audit complete, awaiting go-ahead before mass migration.**

---

## 1. Concrete inconsistencies found

### 1.1 Loading states — 9 distinct treatments (+1 surface with none)

| # | Treatment | Files |
|---|---|---|
| 1 | `Loader2` centered `py-10` size 22 primary-600 | UCC `ActivitySection`, `GovernanceSection`, `QaSection`, `TeamSection`, `EgressSection` |
| 2 | `Loader2` centered `py-12` size 24 | UCC `ClientAccessSection` |
| 3 | `Loader2` centered `py-16` size 28 / size 26 | `UserControlCenter` root, `UserDirectory` |
| 4 | **`Loader`** (different lucide icon) + text "Loading access settings…" `py-12 gap-3` | `UserPermissionsPanel:230` |
| 5 | CSS border spinner `animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600` | `UserRecordViewsPanel:38`, `CompanyManagement:477`, `AdminPanel` Suspense (h-8 w-8) |
| 6 | Italic text `Loading…` centered `py-6` | `ReadonlyAdminManager:284`, `TeamManager:138,257` |
| 7 | `p-8 text-center` inline `Loader2` size 20 | `BrandingManager:91`, `AppearanceManager:179`; `BlacklistSettings:37` = text only |
| 8 | Ring spinner `w-8 h-8 rounded-full border-2 border-t-transparent` | `FeatureFlagsManager:114,147,224,276` |
| 9 | `flex justify-center py-10` `Loader2` in **text-tertiary** (not primary) | `TaskBoardsAdmin:55` |
| — | **no loading state at all** | UCC `AccountSection` (the tab the user opens first) |

This is exactly the reported symptom: Account (none) → Data Egress (#1) →
Permissions (#4) are three different looks inside the same tab strip.
`components/UI/Skeleton.jsx` exists and is used by **zero** Admin files.

### 1.2 Page headers — 4 families

- **A. Gradient banner card** — `rounded-2xl p-5/p-6`, `background: var(--gradient-sidebar)`, white
  text, radial blob overlay. ~15 tabs: ChatAdmin, VicidialAdmin, DataCleanup,
  TaskBoardsAdmin, ReadonlyAdminManager, TeamManager, FAQManager, ScriptManager,
  DataAnalyzer, BulkUploader/BulkSaleUploader, ClientPlanManager, CompanyManagement…
  **The Compliance shell has no gradient banners at all.**
- **B. Plain `h1` + subtitle, icon tinted primary** — `UserControlCenter`, `ClientsPlansHub`.
- **C. Icon chip (10×10 rounded-xl gradient square) + `h1` + subtitle** — `BusinessRulesHub:116`.
- **D. Bare `flex items-center gap-2` + `h2 text-lg`** — `EgressGovernance:667`,
  `BlacklistSettings:42`, `BrandingManager:102`, `AppearanceManager:187`.

Inside panels, section headings are also split: `h3 text-sm font-bold` (UCC) vs
`h4 text-xs font-bold uppercase tracking-wider` (UCC inner) vs `h2 text-xl font-bold`
+ `font-display` (all BusinessRules panels) vs `h3 text-lg font-bold`.

### 1.3 Sub-navigation — 4 families

1. `ChromeTabs variant="pill"` — only 3 files: `UserControlCenter`, `ClientsPlansHub`, `UserDirectory`.
2. **Inset segmented track** — `flex gap-1 p-1 rounded-xl` on `--color-bg-secondary` + gradient
   active pill: `EgressGovernance:670`, `VicidialAdmin:962`, `BulkUploadHub:18`, `DataCleanup:638`.
3. **Free-floating gradient pills** — `rounded-xl` bordered buttons: `ChatAdmin:824`.
4. **Ad-hoc `rounded-lg` buttons** — `ChatAdmin:165`, `CompanyDetail:1292`,
   `LeadIntelligence:298`, `UserModal:64`.

### 1.4 Radii + surfaces

Class histogram across `components/Admin`: `rounded-lg` 355, `rounded-xl` 285,
`rounded-2xl` 191, `rounded-full` 189, `rounded-md` 57, `rounded-sm` 1 — mixed
*within single screens*, e.g. UCC outer card `rounded-2xl` → inner panels
`rounded-xl` (Activity/Governance/Qa/Team/Egress) but `rounded-2xl` in
`ClientAccessSection:78,93`. Inner-card background is also inconsistent:
`var(--color-bg)` (most UCC sections) vs `var(--color-bg-secondary)` (segmented
tracks) vs `var(--color-surface)`.

Tokens already exist in `styles/global.css:128-134` (`--radius-xs…--radius-full`,
`lg`=8px, `xl`=12px, `2xl`=16px) and are barely referenced from JSX.

### 1.5 Empty states — 6 shapes

`text-center py-12 text-sm` (UCC `Empty`), `py-8 text-center` (AccountSection,
TeamSection, GovernanceSection, ClientAccessSection), `py-6 italic`
(ReadonlyAdminManager, TeamManager), `py-8 italic` (TeamManager), plain
`<p className="text-sm font-medium mb-3">No FAQs yet.</p>` (FAQManager, ScriptManager),
and one genuinely good dashed-box-with-icon (`NumbersIntelligence:145`) used nowhere else.

### 1.6 Controls

- `ThemedSelect` broadly adopted (43 Admin files) — good baseline.
- **Native controls remaining:** `<select>` and `<input type="date">` in
  `Teams/TeamManager.jsx` and `Teams/MyTeam.jsx` only.
- Raw checkboxes styled ad-hoc: `<input type="checkbox" className="accent-[var(--color-primary-600)]">`
  (EgressSection ×2, QaSection, GovernanceSection, ReadonlyAdminManager…). No shared Toggle/Switch.
- Field labels: at least 4 idioms (`text-[10px]`/`text-[11px]`/`text-xs` × uppercase/not).

### 1.7 Alerts / flash messages

21 Admin files import `Alert`; the rest hand-roll inline colored divs, e.g.
`UserControlCenter:133` (error), `AccountSection:104` (delete confirm),
`UserPermissionsPanel:260` (warning). Every UCC section re-implements its own
`flash(type, text)` + `setTimeout(…, 4000|5000)` — same logic, 8 copies, two
different durations.

### 1.8 Hardcoded hex → light-mode-only colors (dark-mode breakage)

Top offenders (hex literal count per file): `LeadIntelligence` 69,
`CustomerProfile` 42, `LeadGraph` 35, `Teams/TeamAnalytics` 33,
`UserManagement/UserPermissionsPanel` 31, `BusinessRules/ResellRules` 30,
`NumbersIntelligence` 25, `FormBuilder` 23, `DispositionManager` 23, `ChatAdmin` 18.
Concrete example: `UserPermissionsPanel:260` `backgroundColor: '#fffbeb', border: '1px solid #fde68a'`
— unreadable in dark; `:355-356` `#bbf7d0/#16a34a/#fecaca/#dc2626`;
`AdminSidebar:160` `#ef4444`; `TeamManager:258` `#dc2626`.

### 1.9 Layout / padding

- `AdminPanel:186` wraps every tab in `px-4 sm:px-6 lg:px-8 py-5 w-full`.
- But `UserControlCenter:101` and `ClientsPlansHub:31` add **their own**
  `p-6 max-w-[1400px] mx-auto` → double padding **and** a max-width cap that
  contradicts the shell's own full-width comment (`AdminPanel:181-184`).
- Compliance reference: `px-4 sm:px-6 lg:px-8 xl:px-10 py-6 sm:py-8`, no cap.
- `DotGridBg` is already mounted in `AdminPanel:153`. Good.

---

## 2. Proposed UI kit — `frontend/src/components/UI/kit/`

New directory so the legacy `UI/Card.jsx` (Tailwind `bg-surface`, `rounded-lg`,
near-unused in Admin) stays untouched and nothing existing breaks.

| Component | Props | Replaces |
|---|---|---|
| `Panel` | `tone='surface'\|'inset'\|'ghost'`, `pad='none'\|'sm'\|'md'\|'lg'`, `radius='xl'\|'2xl'`, `as`, `className`, `children` | every ad-hoc `rounded-xl/2xl p-4 style={{background,border}}` div (§1.4) |
| `SectionHeader` | `icon`, `title`, `subtitle`, `actions`, `level='page'\|'section'\|'sub'` | header families A–D + the 4 inner-heading idioms (§1.2) |
| `Loading` | `variant='rows'\|'cards'\|'block'\|'inline'`, `rows=3`, `label` | all 9 loading treatments (§1.1). Default = shimmer skeleton reusing `--color-skeleton` + existing `animate-shimmer` |
| `EmptyState` | `icon`, `title`, `hint`, `action` | all 6 empty shapes (§1.5); dashed rounded-2xl box modeled on `NumbersIntelligence:145` |
| `KpiTile` | `icon`, `label`, `value`, `sub`, `tone` | Compliance-style KPI strip; new capability for admin tabs |
| `Toggle` / `CheckRow` | `checked`, `onChange`, `label`, `hint`, `busy`, `disabled` | raw `accent-[…]` checkboxes (§1.6) |
| `PillTabs` | `items`, `value`, `onChange` — thin wrapper over `ChromeTabs variant="pill" size="sm"` | sub-nav families 2–4 (§1.3); one-line swap, central restyle later |
| `Field` | `label`, `hint`, `error`, `children` | the 4 label idioms; wraps `ThemedSelect`/`ThemedDate`/`.input` |
| `ActionRow` | `icon`, `label`, `hint`, `onClick`, `busy`, `tone` | `AccountSection.ActionBtn`, and the same shape re-rolled in Governance/QA |
| `useFlash()` | `[msg, flash]` → renders through `Alert` | 8 duplicated `flash()`+timeout copies (§1.7), single 4s duration |
| `tokens.js` | `RADIUS`, `PAD`, `TONE` maps | stops inline styles guessing radii/colors |

Barrel: `UI/kit/index.js`. Docs: `docs/ui-design-system.md` (radius scale,
spacing scale, tone map, chrome-vs-pill rule, "never hardcode hex", loading rule,
migration checklist).

Reused as-is, not rebuilt: `ChromeTabs`, `ThemedSelect`, `ThemedDate`,
`DateRangePicker`, `Alert`, `Badge`, `Modal`, `DotGridBg`, `Skeleton`.

---

## 3. Migration order (one surface per commit, build-verified each)

**Phase 0** — kit + `docs/ui-design-system.md`. Zero surfaces touched (pure add).

**Phase 1 — the flagged trio**
1. `UserControlCenter` shell (kill double `p-6`/`max-w` cap, unify sticky header + card)
2. `AccountSection` (gains a real loading state)
3. `EgressSection`
4. `UserPermissionsPanel` + `UserRecordViewsPanel` (also kills 31 hardcoded hex)

**Phase 2 — rest of UCC:** `CompaniesRoleSection`, `ClientAccessSection`,
`TeamSection`, `VicidialSection`, `GovernanceSection`, `QaSection`,
`ActivitySection`, `UserDirectory`.

**Phase 3 — Clients & Plans:** `ClientsPlansHub`, `PlanMetadataPanel`,
`ClientUsagePanel`, `GuestLinksPanel`, `ClientPortalTab`, `ClientPlanManager`.

**Phase 4 — shell chrome:** `AdminPanel` wrapper padding (match Compliance
`xl:px-10 py-6 sm:py-8`), `AdminSidebar` (radius/tone/`#ef4444` badge),
`AdminHeader`, the Suspense fallback → `Loading`.

**Phase 5 — remaining tabs**, heaviest-used first: Companies (+CompanyDetail),
Business Rules hub + 10 rule panels, Chat Control, Data Analyzer,
Egress Governance, Readonly Admins, Teams (**also kills the last native
select/date**), Feature Flags, FAQs, Scripts, Branding, Appearance,
Numbers Intelligence, Bulk Upload, Data Cleanup, VICIdial, Task Boards,
Blacklist, Announcements/Marquee/SPIFF, Customer Profiles, Lead Search, Dashboard.

Per-commit gate: `npx vite build --minify false` (this machine OOMs the minifier),
then live check on https://crm.vertexpakistan.com in light **and** dark, console clean.

---

## 4. Decisions — CONFIRMED (2026-07-26)

1. **Gradient banner headers → DROPPED.** All ~15 become
   `<SectionHeader level="page">`: small 10×10 gradient icon chip + h1 + subtitle
   + right-aligned actions. Matches Compliance exactly.
2. **Loading → shimmer skeleton.** `<Loading>` defaults to skeleton rows
   (`variant="rows"|"cards"|"table"|"block"`); `variant="inline"` is the only
   spinner, for buttons/rows. Reuses the theme-aware `.animate-shimmer`.
3. **Full width, cap dropped.** `max-w-[1400px]` + the duplicate `p-6` come out of
   UCC and ClientsPlansHub; the AdminPanel wrapper becomes the single padding
   source, bumped to `px-4 sm:px-6 lg:px-8 xl:px-10 py-6 sm:py-8`.
4. **Sub-nav → ChromeTabs pill everywhere**, via the `PillTabs` wrapper. The inset
   segmented track, gradient pill row and ad-hoc button rows are retired. Chrome
   variant stays reserved for a shell's primary nav (the AdminPanel's primary nav
   is its sidebar, so admin tabs don't use it).

## 8. Phases 4 + 5 — DONE (verified live)

**Native controls (reported from testing).** The first audit only grepped
`components/Admin` and missed the Teams surfaces: 6 native `<select>` + 4 native
`<input type="date">` in `TeamManager` / `MyTeam`. All now ThemedSelect /
ThemedDate. **App-wide sweep: zero native selects, zero native date inputs**
outside the two themed implementations. The Compliance/Callbacks `type="date"`
hits were false positives — `FInput` (Compliance/shared.jsx:240) already routes
them to ThemedDate.

**Phase 4** — AdminPanel wrapper adopts the Compliance padding
(`px-4 sm:px-6 lg:px-8 xl:px-10 py-6 sm:py-8`); FormBuilder's Suspense spinner →
skeleton; sidebar `#ef4444` and header `#22c55e` → tokens. The UCC sticky header
gained `xl:-mx-10 xl:px-10` so its bleed tracks the new padding step.

**Phase 5** — every page-level gradient banner dropped (16 tabs); all four
sub-nav families collapsed to PillTabs; page-level spinners → skeleton in ~20
files.

### Final live sweep (all 36 superadmin tabs, production)
`native-select: 0 · native-date: 0 · gradient-banner: 0` — one deliberate
exception, **Calendar**: its banner lives in the SHARED `EventsCalendar`, which
the Compliance and Manager shells also render, so changing it is cross-shell work
that was explicitly deferred ("other shells come later").

### Deliberately NOT changed
- **Loader2 inside buttons** — `Loading variant="inline"` renders that exact
  spinner, so they were already identical to the kit. Only page/panel-level
  treatments differed.
- **Gradient modal title bars** (`rounded-t-2xl`) and **gradient primary buttons**
  — dialog affordance and brand action color, both used by the Compliance shell.

## 6. Phase 1 — DONE (verified live)

`UserControlCenter`, `AccountSection`, `EgressSection`, `UserPermissionsPanel`,
`UserRecordViewsPanel` (commit `ca828bc`) + a dark-mode badge fix found during
verification (`ee52ef4`).

Live check on https://crm.vertexpakistan.com as superadmin: Account, Data Egress
and Permissions all render the SAME shimmer skeleton (probed on tab switch —
`role="status" .animate-shimmer` present, zero `.animate-spin`), the page h1 is
the `SectionHeader level="page"` Playfair title, `max-w-[1400px]` is gone (0
nodes), light and dark both correct, no console errors beyond a pre-existing 404.

Bug caught live and fixed: the Egress source badge used a solid `-600` fill with
white text. Dark inverts the scales (`--color-warning-600` = `#FCD34D`), so the
Role/Company labels were unreadable. Now uses the kit's soft-fill + same-tone-text
pattern. **General rule this proves: never put white text on a `-600` token.**

## 5. Phase 0 — DONE

`frontend/src/components/UI/kit/`: `tokens.js`, `Panel.jsx`, `SectionHeader.jsx`,
`Loading.jsx`, `EmptyState.jsx`, `KpiTile.jsx`, `Toggle.jsx` (Toggle + CheckRow),
`PillTabs.jsx`, `Field.jsx`, `ActionRow.jsx`, `useFlash.js`, `index.js`
+ [ui-design-system.md](ui-design-system.md). Pure addition — no existing file
touched, nothing imports the kit yet.
