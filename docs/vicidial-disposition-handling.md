# VICIdial Disposition Handling — How It Actually Works

A deep reference for how this CRM ingests, maps, scopes, and records VICIdial
dispositions — campaigns, in-groups, companies, dispo mapping, manual calls, and
the reasoning behind the design. Traced from the code, not from assumptions.

> Companion docs: `docs/VICIDIAL_INTEGRATION.md` (setup + URL templates) and
> `vici.md` (the raw `non_agent_api` reference). This doc explains the *why* and
> the edge behavior.

Primary source files:
- `backend/routes/vicidial.js` — the ingest webhooks + dispo mapping + admin routes
- `backend/utils/dialerBoxes.js` — the 3 dialer boxes + recording/lead lookups
- `backend/routes/transfers.js` — manual (hand-entered) transfers
- `backend/migrations/096`–`099`, `120`, `097` — schema

---

## 1. Disposition mapping — what it is and why

### 1.1 `vicidial_dispo_map` — the schema

Defined in `migrations/097_vicidial_dispo_map.sql`:

| Column | Meaning |
|---|---|
| `company_id` | Owning company, **or `NULL` = a global row** that applies to every company |
| `vici_code` | The raw dialer disposition, uppercased (e.g. `NI`, `CB`, `SALE`) |
| `disposition_name` | The CRM disposition it maps to. **`NULL` = seen but not yet named** (pending) |
| `category` | Optional tag: `sale`/`callback`/`not_interested`/`dnc`/`no_answer`/`dropped`/`other` |
| `hits` | How many times this code has arrived |
| `last_seen_at` | When it last arrived |
| `UNIQUE (company_id, vici_code)` | One row per code per company (and one global row per code) |

A **row represents one dialer code → one CRM disposition name**, scoped either to a
company or globally. A row with `disposition_name IS NULL` is a code the dialer
sent that nobody has mapped yet — it still exists (so the arrival is recorded and
counted), it just doesn't have a friendly name.

### 1.2 Global vs company-specific resolution

Both a global row (`company_id IS NULL`) and a company row can exist for the same
code. **The company-specific row always wins.** Trace:

- `bumpDispoMap(companyId, rawCode)` (`vicidial.js:85`): if a `companyId` is known,
  it looks up the company row first; if that row has a `disposition_name`, it
  returns it. Only if there's no company mapping does it fall back to
  `globalDispoName()` (`vicidial.js:75`), which reads **only** `company_id IS NULL`
  rows.
- The read-only twin `lookupDispoName()` (`vicidial.js:155`) does the same order:
  company row, then global.
- When the disposition is finally written, `applyCloserDispo()` (`vicidial.js:187`)
  resolves the matching `disposition_configs` row with
  `.or('company_id.is.null,company_id.eq.<company>')` **ordered company-first**, so
  the company config beats the global config for colour/id too.

So the precedence is consistent everywhere: **company override → global fallback.**

### 1.3 `bumpDispoMap` end-to-end (auto-register + hit counter)

When a closer disposition arrives (`closer-dispo`), the raw code is upper-cased to
`rawCode` and passed to `bumpDispoMap(companyId, rawCode)`:

1. If `companyId` is known, look up the company row for that code.
2. **Row exists** → increment `hits`, set `last_seen_at`.
3. **Row doesn't exist** → **insert** a new row `{ company_id, vici_code, hits: 1,
   last_seen_at }` with `disposition_name = NULL` (fire-and-forget, errors
   swallowed).
4. Return the company row's `disposition_name` if it has one; otherwise
   `globalDispoName(rawCode)`.

So a **brand-new/unrecognized code is auto-registered as an unmapped row with a hit
count** — never rejected. The count exists so the superadmin can see *which*
unknown codes are actually being used and *how often*, and prioritize naming the
frequent ones.

### 1.4 Why auto-register instead of requiring pre-registration

This is a deliberate **"never drop data"** choice. If the CRM required every dispo
code to be pre-configured before accepting it:

- Any code a dialer admin adds (or renames, or a new campaign introduces) would be
  **silently rejected** until someone updated the CRM first — a race the business
  loses, because the dialer is configured by different people at a different time.
- A typo or case difference on the dialer side would drop real dispositions.
- You'd need tight change-coordination between two systems (VICIdial admin ↔ CRM
  admin) that aren't operated in lockstep.

Auto-accept protects against all of that: the disposition is **recorded against the
lead immediately** using the raw code as its display name, and the friendly name is
back-filled later. The code path even says so — `applyCloserDispo` uses
`dispoName = mapped?.disposition_name || dispo || rawCode` (`vicidial.js:451`), i.e.
show the raw code until it's mapped. The cost is cosmetic (a cryptic code shows for
a while); the benefit is **zero lost dispositions**.

### 1.5 The "seen but never named" cleanup queue — YES, it exists

`GET /api/vicidial/dispo-map` (superadmin only, `vicidial.js:1249`) returns the map
**ordered unmapped-first, then by most-hit**:

```js
.order('disposition_name', { ascending: true, nullsFirst: true })
.order('hits', { ascending: false })
```

So unmapped codes (`disposition_name IS NULL`) surface at the top, highest-traffic
first — exactly a cleanup queue. The superadmin maps them via `POST /dispo-map`
(global or per-company, `vicidial.js:1260`), edits with `PUT /dispo-map/:id`, or
deletes with `DELETE /dispo-map/:id`. This is the **Admin → VICIdial → Disposition
map** screen.

---

## 2. Dispo Call URLs — full inventory

### 2.1 What's documented in the codebase

The **URL templates** are documented in `docs/VICIDIAL_INTEGRATION.md` §3, by
*topology* (not per concrete campaign):

- **Same box** (fronter + closer on one server, no `vendor_lead_code`):
  - Fronter campaign → `/api/vicidial/fronter-xfer?key=…&code=--A--lead_id--B--&phone=--A--phone_number--B--&agent=--A--user--B--&dispo=--A--dispo--B--`
  - Closer campaign → `/api/vicidial/closer-dispo?key=…&alt_code=--A--lead_id--B--&phone=…&dispo=…&agent=…`
- **Different boxes** (fronter/closer on separate servers, id rides in `vendor_lead_code`):
  - Fronter webform (`add_lead`) adds `&vendor_lead_code={PREFIX}--A--lead_id--B--`
  - Fronter campaign → `/fronter-xfer?…&code={PREFIX}--A--lead_id--B--&…`
  - Closer campaign → `/closer-dispo?…&code=--A--vendor_lead_code--B--&alt_code=--A--lead_id--B--&…`

The 3 boxes and their prefixes are the source of truth in code
(`dialerBoxes.js:10` fallback + the `vicidial_boxes` table, `migration 120`):

| Box id | Prefix | Base URL |
|---|---|---|
| `wavetech` | `WTI` | `https://wavetechnew.i5.tel` |
| `etc` | `ETC` | `https://wavetech3new.i5.tel` |
| `tmc` | `TMC` | `https://tmcsolihp.i5.tel` |

### 2.2 Is there a single source of truth for "which campaign → which endpoint"? **No — and that's a real gap.**

The codebase documents the **templates** and says *"paste the URLs into the matching
campaigns"* (`VICIDIAL_INTEGRATION.md` §7 step 6). The **actual per-campaign and
per-in-group assignment lives only inside each VICIdial box's admin panel.** There
is **no config file, table, or manifest** in this repo that records "campaign X on
box WTI has Dispo Call URL = /fronter-xfer".

**Consequence:** from the code alone you **cannot verify** that every fronter
campaign and every closer in-group across all 3 boxes is actually wired correctly,
or that none point somewhere stale. That mapping is unverifiable from the repo. If
a campaign is misconfigured on the dialer, the only symptom is "dispositions for
that campaign never arrive," visible via the debug ring buffers
(`/api/vicidial/xfer-debug`, `/api/vicidial/dispo-debug`) — not via any code check.

### 2.3 Does every fronter campaign → `/fronter-xfer` and every closer in-group → `/closer-dispo`?

**Cannot be confirmed from code** (see 2.2). The *intended* design is exactly that:
fronter campaigns fire `/fronter-xfer`, closer in-groups fire `/closer-dispo`. But
because the assignment is dialer-side, this doc cannot assert there are no
exceptions, legacy campaigns, or a box configured differently. **Treat "all
campaigns are correctly wired" as an operational assumption to audit in each
VICIdial admin, not a code guarantee.**

### 2.4 Webhook origin validation — only the shared token

The **only** protection is a shared secret. `requireToken` (`vicidial.js:35`)
checks `req.query.key` (or header `x-vici-key`) against `VICIDIAL_INGEST_TOKEN`. If
it matches, the webhook is accepted. There is **no** validation that the request
actually came from a known campaign, in-group, box IP, or signature. Anyone with
the token can post any `code`/`phone`/`agent`/`dispo`. There's also no replay
protection (a re-fired `closer-dispo` re-runs and can insert a duplicate
`disposition_actions` row). This matches the earlier audit: **origin protection is
essentially the token and nothing more.**

---

## 3. Companies — how multi-company scoping actually works

### 3.1 How `company_id` attaches to a transfer/dispo

**Company is inferred from the AGENT, not the box or the prefix.** `resolveAgent()`
(`vicidial.js:43`):

1. Take the `agent` id from the webhook (`--A--user--B--`).
2. Find the `user_profiles` row whose `vicidial_agent_ids[]` contains that id
   (case-insensitive; falls back to the legacy single `vicidial_agent_id`).
3. Look up that user's **active** `user_company_roles`, ordered by `created_at`
   ascending, take the **first** → that's the `company_id`.

- **fronter-xfer**: the pending transfer's `company_id` = the **fronter agent's**
  company (`vicidial.js:242`). Unmapped agent → no transfer created (200, logged).
- **closer-dispo**: the disposition is scoped to the **closer agent's** company
  (`closerCompanyId`, `vicidial.js:371`); if the closer isn't resolvable it falls
  back to the matched transfer's own `company_id`.

The **vendor-code prefix (WTI/ETC/TMC) identifies the BOX, not the company.** The
box is never used to decide the company.

### 3.2 One box serving multiple companies

This is fully supported *because* company comes from the agent, not the box.
Several companies can share a single dialer box; two dispositions from the same box
are told apart by **which CRM user each agent id maps to** and that user's active
company. There is no per-box company assumption anywhere in the code.

Caveat: if one CRM user legitimately belongs to **multiple active companies**,
`resolveAgent` picks the **earliest-created** membership. That's a tie-break, not a
cross-company leak — but it means multi-company users are attributed to their first
company. Keep one agent id → one company for clean attribution.

### 3.3 Does the per-company dispo override leak across companies?

**No leak found.** Every path scopes consistently (see §1.2): `bumpDispoMap`,
`globalDispoName`, `lookupDispoName`, and the `disposition_configs` lookup in
`applyCloserDispo` all resolve **company row first, global (`company_id IS NULL`)
second**, and global rows are only ever matched via an explicit `company_id IS NULL`
predicate. A global mapping is a *fallback*, never an override of a company row, and
a company row is never visible to a different company. The bulk backfill path
(`vicidial.js:1026`) reads the same map with company scoping too.

---

## 4. Does every dispo create a record?

### 4.1 The exact fate of each disposition category

Trace of `closer-dispo` (`vicidial.js:333`). After matching attempts
(code → prefixed-id+phone → phone), the outcomes are:

| Category | What arrives | Fate |
|---|---|---|
| **Matched, normal dispo** | code/phone matches a transfer, mapped or not | **Recorded**: stamps `vicidial_dispo` + inserts a `disposition_actions` row on the transfer, claims the closer, promotes `pending → assigned` (`applyCloserDispo`). Mapped → friendly name; unmapped → raw code shown. |
| **Matched, sale-form dispo** | matched, and the mapped disposition has `disposition_configs.opens_sale_form = true` | **Does NOT auto-apply.** Queues a "Confirm → open sale form" item in `vicidial_closer_dispo_queue` **with** the transfer id; the closer confirms and fills the sale form (`vicidial.js:457`). |
| **No match, real outcome** | SALE / CALLBK / NI / DNC / post-date etc. with no matching transfer | **Recorded but queued for manual match** in `vicidial_closer_dispo_queue` (status `pending`) for the closer to attach to a lead by hand (`vicidial.js:480`). Never dropped. |
| **No match, no agent** | no transfer AND the agent isn't mapped | **Not recorded** — returns `ok:false, reason:'no matching transfer and agent not mapped'` and logs a warning (`vicidial.js:497`). Nothing to attribute it to. |
| **No-connect with no lead + no phone** | `A`/`N`/`NA`/`DAIR`/`DROP`/`AFTHRS`/`B`/`DC`/`AB`/`ADC`/`PDROP`/`AA`/`NANQUE`/`TIMEOT`/`CXHNGP` **and** no code **and** no phone | **Dropped silently** (`ignored: true`) — a no-customer-contact call with no lead context is noise (`vicidial.js:426`). |
| **Unrecognized code** | any code not in the map | **Recorded** (auto-registered in `vicidial_dispo_map`, applied with the raw code as its name). Unknown ≠ dropped. |

On the **fronter** side (`fronter-xfer`), a disposition only creates a *pending
transfer* if it's in the company's configured `xfer_dispos` list
(`vicidial_config.field_map.xfer_dispos`, `vicidial.js:254`) — every other fronter
disposition is intentionally ignored (200, no record) so non-transfer calls don't
spam the CRM. If no `xfer_dispos` are configured, any dispo is accepted
(back-compat).

**So the earlier audit still holds:** the *only* silent drop is a no-connect code
with neither lead nor phone. Everything with any lead context or any real outcome
is recorded — matched-and-applied, or queued for manual match.

### 4.2 Dispos that arguably *should* create something useful but don't

- **CALLBK (callback) dispositions**: these are recorded as a **disposition on the
  transfer** (a `disposition_actions` row + the pill), but the integration does
  **not** create a row in the CRM's own `callbacks` system or schedule a
  `callback_at`. So a dialer callback is *visible* as a disposition but is **not
  wired into the CRM's callback scheduler / reminders**. If the business relies on
  the CRM to surface "call this person back at time T," a dialer CALLBK won't do
  that on its own — it's informational only.
- **DNC dispositions**: likewise recorded as a disposition, but they do **not**
  feed the CRM's DNC/blacklist tooling (the Blacklist Alliance lookup is a separate,
  on-demand check). A dialer DNC is a label on the record, not an entry in any CRM
  suppression list.
- **Post-date / sale-form dispos**: handled well — they open the sale form
  (§4.1), so those *do* drive downstream work.

None of these are bugs per se (the disposition is never lost), but callback/DNC
codes are **"recorded and shown, then effectively forgotten"** rather than driving
the corresponding CRM subsystem. That's the honest gap.

---

## 5. Manual calls — how they're handled

### 5.1 Hand-entered transfers (no webhook, no code)

VICIdial does **not** fire the Dispo Call URL for a manual dial with no bound lead
(`VICIDIAL_INTEGRATION.md` §1 — a documented VICIdial behavior). So the CRM lets a
closer create the transfer by hand:

- Endpoint: **`POST /api/transfers/manual-entry`** (`transfers.js:660`).
- Guarded to closer-side roles only (`closer`, `closer_manager`, `company_admin`,
  `operations_manager`, `compliance_manager`, `superadmin`).
- Requires `fronter_company_id` + `fronter_user_id` (validated to be an active
  **fronter** in that company) + `form_data`.
- Inserts a `transfers` row: `company_id = fronter_company_id`, `created_by =
  fronter_user_id` (fronter attribution preserved), `assigned_closer_id = the
  closer` (self-assigned), `status = 'assigned'`, `normalized_phone` from the form,
  and a `form_data.manual_entry_by` breadcrumb. **No `vicidial_vendor_code`.**

So the record exists with full lead detail and correct company — it simply has **no
dialer identity** at creation time.

### 5.2 The 30-minute merge window (in detail)

The problem it solves: a fronter (or closer) sometimes **hand-enters** the transfer
in the CRM seconds *before* the dialer's XFER webhook fires for the same call. Both
would otherwise exist — the manual one (rich, code-less) and the webhook one
(code-only) — because idempotency keys on the code, which the manual one lacks.

The fix, in `fronter-xfer` (`vicidial.js:275`): before inserting a new pending
transfer, look for a **just-created hand-entered transfer** matching:

- same `company_id`, **and**
- same `normalized_phone`, **and**
- `vicidial_vendor_code IS NULL` (code-less = manual), **and**
- `created_at >= now − 30 min`,

ordered newest-first, take one. If found → **stamp the code + agent onto that manual
row** instead of inserting a duplicate, keeping its richer form_data/status.

**Edge cases:**
- **Two different manual transfers for the same number within the window** → the
  webhook merges into the **most recent** code-less one (the `order by created_at
  desc, limit 1`). The older manual entry is left code-less. Not wrong, but the
  code lands on whichever manual row is newest, which may not be the intended one if
  a number was hand-entered twice quickly.
- **A webhook for a genuinely different call that shares the phone** (a real repeat
  customer within 30 min) → it would merge into the stale manual entry, since the
  match is phone+company+code-less+30min with no other discriminator. The 30-minute
  bound + code-less requirement keeps this rare, but it is theoretically possible
  for a fast repeat.
- **Manual entry older than 30 min before the XFER** → **not** merged → the webhook
  creates a **second** (code-only) transfer = a duplicate. The window is a
  heuristic, not a guarantee.

### 5.3 Do manual transfers ever get a `vendor_lead_code` retroactively?

**Sometimes — via three best-effort paths — but not guaranteed:**

1. **30-min merge** (§5.2): the XFER stamps the code onto the manual row.
2. **Closer-dispo match by phone**: if a closer disposition matches the manual lead
   by phone and the closer's URL carried a real prefixed `vendor_lead_code`, it's
   stamped onto the transfer (`vicidial.js:441`).
3. **Fetch-dispo learning**: `fetchAndApplyDispo` → `resolveLeadIdByAgentDate` finds
   the lead_id from a **recording** (closer agent + call day + phone in the
   filename) and stamps `{PREFIX}{lead_id}` (`vicidial.js:634`). Best-effort — only
   works if a recording exists.

If **none** of these fire, the transfer stays **code-less forever.**

**Impact on the recording-review workflow:** the review queue's eligibility is
`transfers.vicidial_vendor_code ~ '^[A-Za-z]+[0-9]+$'` **AND** the closer has a
mapped `vicidial_agent_id` (`migration 151`, `app_recording_review_queue`). So a
**permanently code-less manual transfer is EXCLUDED from the recording-review
queue** — there's no dialer identity to resolve a recording from. (The agent+date
recording fallback in `findSaleRecording` still needs the closer's agent id + a
date and a phone match, which a code-less manual sale may or may not satisfy, but
the *queue* itself gates on a vendor code.) In short: **manual-entry sales that
never get a code are effectively invisible to the recording-review backlog** — by
design, because there's nothing on the dialer to point at.

---

## 6. The bigger picture — why it's built this way

### 6.1 Deliberate "fire-and-forget, reconcile-as-needed" — genuinely by design

This reads as a **coherent, deliberate** architecture, not accidental sprawl. The
same principle recurs in every path:

- **Never hard-fail on the CRM side.** Unknown code? Auto-register. No matching
  lead? Queue it. Manual dial the dialer didn't report? Hand-enter it. Logging
  triggers swallow errors so a dispo write can never block. Every branch has a
  "don't lose it" escape hatch.
- **Reconcile later, by human when needed.** Unmapped codes → superadmin names them
  from a cleanup queue. Unmatched dispos → closer attaches them. Code-less transfers
  → best-effort back-stamping. Recording ambiguity → compliance confirms.
- **Idempotent where it can be, tolerant where it can't.** fronter-xfer is
  idempotent on the code; closer-dispo can't be (no stable per-call id from the
  dialer), so it queues/merges instead of rejecting.

The consistency of that pattern across many endpoints, plus the explanatory
comments and the dedicated debug ring buffers, indicate a **designed** posture:
*absorb the dialer's messiness, surface it for human cleanup, never drop data.*

### 6.2 What VICIdial would have to guarantee for a stricter model

A stricter model (reject unknown dispos, require pre-registered campaigns, validate
webhook origin) would only be safe if VICIdial guaranteed:

- **Reliable, exactly-once delivery** — so rejecting a dispo can't lose a real one,
  and no retries create duplicates. (VICIdial fires a best-effort background URL
  with **no delivery guarantee and possible re-fires** — incompatible.)
- **Complete, consistent fields on every fire** — a stable per-call id (uniqueid),
  always-present lead_id/phone, consistent agent-id casing. (VICIdial sends lead
  tokens **only for lead-bound calls**, omits them for manual dials, and casing
  varies — incompatible with "require the id.")
- **A stable, enumerable campaign/in-group registry the CRM can validate against,
  with signed or IP-authenticated webhooks.** (VICIdial offers a shared-token URL
  only; origin isn't authenticated — incompatible with strict origin validation.)

VICIdial provides **none** of these guarantees. So the loose model isn't laziness —
it exists **because the dialer itself is unreliable enough that strictness would
convert dialer weirdness into dropped business data.** Given VICIdial's actual
behavior, "accept everything, reconcile deliberately" is the correct trade-off. The
places worth *tightening* are the ones where looseness costs correctness rather than
completeness — e.g. capturing `uniqueid` for exact recording/idempotency, and
feeding CALLBK/DNC dispos into the CRM's own callback/suppression subsystems (§4.2)
— none of which require rejecting data to fix.

---

## Quick reference — key code locations

| Thing | Location |
|---|---|
| 3 dialer boxes + prefixes | `dialerBoxes.js:10`, `migration 120` |
| Ingest token guard | `vicidial.js:35` (`requireToken`) |
| fronter-xfer ingest | `vicidial.js:214` |
| closer-dispo ingest | `vicidial.js:333` |
| Agent → user → company | `vicidial.js:43` (`resolveAgent`) |
| Dispo map bump/auto-register | `vicidial.js:85` (`bumpDispoMap`) |
| Global fallback | `vicidial.js:75` (`globalDispoName`) |
| Apply a closer dispo | `vicidial.js:168` (`applyCloserDispo`) |
| Sale-form queue branch | `vicidial.js:457` |
| No-match manual queue | `vicidial.js:480` |
| No-connect silent drop | `vicidial.js:426` |
| 30-min manual merge | `vicidial.js:275` |
| Dispo-map admin (cleanup queue) | `vicidial.js:1249` (unmapped-first) |
| Manual transfer create | `transfers.js:660` (`/manual-entry`) |
| Recording-review eligibility | `migration 151` (`app_recording_review_queue`) |
| Schema | `migrations/096`–`099`, `097` (dispo map), `120` (boxes) |
| Setup + URL templates | `docs/VICIDIAL_INTEGRATION.md` |
