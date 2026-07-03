# Sale Lifecycle — how it actually works today

Traced from code on 2026-07-03 (no code changed for this document). Covers: creation,
duplicate-customer handling, multi-vehicle sales, cancellation, resell, what each role
actually sees, and — honestly — where the system relies on humans instead of data.

File references are the source of truth; when this doc and the code disagree, the code won.

---

## 1. Sale creation — the closer's search flow

### 1.1 Who uses Staff Shell

`/staff` → **StaffShell** serves exactly two roles: **closer** and **fronter** (routing in
`App.jsx` / CLAUDE.md role map). The sale-creation flow below is the **closer** side;
fronters use the same shell for transfers/numbers and never see the sale form.

### 1.2 The phone search

Component: `frontend/src/components/Closer/PhoneSearch.jsx` → calls
`GET /transfers/search-by-phone` (`backend/routes/transfers.js:385`).

What the search actually queries:

- **Transfers, not sales.** It ilike-matches the digits against
  `form_data->>customer_phone` and `form_data->>Phone` across **all active fronter
  companies** (the company_links restriction was deliberately dropped — every closer
  searches every fronter company, transfers.js:407). Limit 50, sorted by `updated_at`
  (config `search.sort_by`) so refreshed leads bubble up.
- Each returned transfer row is decorated with: company slug, fronter name, transfer
  status, `latest_disposition`, and — critically — **`has_sale` + `sale_status` +
  `sale_reference_no` + `sale_closer_name` + `sale_is_resell`** for any sale already
  hanging off that transfer, plus a **`cross_company` badge** ("N cos") when the same
  phone exists as transfers in multiple fronter companies.

What the closer sees per result card (`TransferCard` in PhoneSearch.jsx):

- Company chip, transfer status badge, sale status badge (if sold), `↻ resell` chip if
  that sale is a resell, disposition pill, customer name/phone, up to 4 extra form
  fields, fronter attribution, sale ref + closer name if sold.
- A summary strip: "N records found · X already sold · Y available".

### 1.3 What happens when the number already has a sale

- The card's action flips from **"Sale"** to either:
  - **"New on lead"** (purple) — opens the **ResellModal** — shown when the existing
    sale's status is in `resell.enabled_statuses` (business config; fallback list
    includes cancelled / compliance_cancelled / closed_won / sold / closed_lost /
    expired), or
  - a dead **"Already Sold"** pill when the status isn't resell-eligible
    (e.g. `pending_review`).
- So the "warning" for an existing sale is **structural, per transfer**: the plain
  Sale button disappears on that card. It is **not** a customer-level warning — see §2.
- There is also a **manual-entry escape hatch**: "Don't see your lead?" → `ManualEntryModal`
  creates a transfer on behalf of a fronter (credited to them, audit-tagged
  `manual_entry_by`) and drops straight into the sale form.

### 1.4 The sale form and what submit writes

Component: `frontend/src/components/Closer/SaleForm.jsx` (inside `SaleModal`). The form
is **fully dynamic** — it renders only `form_fields` rows configured by the superadmin
(special `field_type`s like `sale_plan`, `sale_down_payment`, `sale_reference_no` map to
typed sale columns). Required/optional is per-field config, not hardcoded.

Submit → `POST /sales` (`backend/routes/sales.js:261`). Server-side pipeline, in order:

1. **Permission**: `create_sale` (per-user toggleable, mig 136); superadmin bypasses.
2. **Transfer link** (optional): validates the transfer, inherits the **fronter
   company's** `company_id`, defaults `fronter_id` from `transfer.created_by`
   (fronter credit survives a blank field), marks the transfer `completed`, and claims
   it for the closer if unassigned. *Multiple sales may share one transfer* — the old
   one-sale-per-transfer guard was removed for multi-vehicle (§3).
3. **Reference collision check**: any typed `reference_no` (primary + additional cars)
   already existing anywhere → `409 REF_COLLISION` (backs the mig 077 unique index with
   a readable error).
4. **Duplicate fingerprint check** (`DUP_FINGERPRINT`): *same transfer* + same vehicle
   (VIN match OR year+make+model) + same client + same sale_date → 409 with a pointer
   to the Resell flow. **Scope is per-transfer only** — see §2 for what this does NOT
   catch.
5. **Vehicle eligibility** (G22): plan/year/make/miles rules per company can hard-block.
6. **Insert**: one `sales` row per vehicle (shared customer columns, per-car
   vehicle/plan/payment/reference columns; missing `reference_no` auto-generated;
   status from config `compliance.default_new_sale_status`, default `open`).
   `customer_email` empty → sentinel `no@email.com`.
7. **Postgres triggers** (not route code): `customer_uuid` = UUIDv5(normalized phone)
   stamped (mig 079); `policy_events` 'sold' row logged (mig 087); VIN reconcile keeps
   one active policy per VIN (mig 091).
8. A "Sent to Compliance" `disposition_actions` row is auto-logged on the transfer.

Tables written on a normal create: `sales` (1..N rows), `transfers` (status/assignment
update), `disposition_actions` (1 row), plus trigger-fed `policy_events`.

---

## 2. Existing customer / duplicate sale on the same number

### 2.1 The data model answer

**(a) — a fully independent second `sales` row**, with two *implicit* links:

- `customer_uuid` (UUIDv5 of the normalized phone, trigger-stamped on both `sales` and
  `transfers`) — this is the only customer identity. There is **no customers table and
  no FK between two sales of the same person**; the shared uuid is the join key.
- If both sales came from the *same* transfer, they also share `transfer_id`.

Explicit links exist **only** for resells (`original_sale_id`, §5) and VIN supersedes
(`superseded_by`, mig 091 — a new `closed_won` on the same VIN auto-retires the prior
policy, keeping history).

### 2.2 Duplicate detection at the SALE level

What exists:

| Check | Scope | What it blocks |
|---|---|---|
| `DUP_FINGERPRINT` (sales.js:~380) | **same transfer only** | re-keying the same car+client+date — a double-submit |
| `REF_COLLISION` | global | reusing a reference number |
| VIN reconcile (mig 091) | global, after the fact | two *active* policies on one VIN — the older is auto-superseded, not blocked |
| Transfer-level dup rules (mig 048, `onFronterDuplicateEvent`) | transfers, not sales | fronter re-entering a lead — 'refresh' / 'reengage' / **'sale_overlap'** ("new transfer despite a completed sale") — but these only **notify fronter managers**, they don't block and the closer never sees them |

What does **not** exist: any check that fires when a closer creates a sale for a
customer who already has sales **via a different transfer**. A second/third sale on the
same phone through a fresh transfer inserts silently. The only creation-time signal is
the passive "already sold" badge on *other transfer cards* in the phone search — if the
closer scrolls past them, nothing else warns.

Notably: `GET /sales/customer-history/by-phone/:phone` (sales.js:653) was built exactly
for this — a role-scoped "returning customer" summary whose comment says it's "used by
closers in PhoneSearch" — **but no frontend code calls it** (grep: zero consumers).
Dead endpoint; the warning it was meant to power doesn't exist in the UI.

### 2.3 Is there a customer profile aggregating all sales?

Yes — three layers, very unevenly distributed:

1. **Customer Profiles tool** (`/api/customer-profile`, `CustomerProfile.jsx`) — full
   aggregate: identity, all vehicles, all plans, transfers, sales, cancellations,
   linked fronter/closer/client, financials, segments (matview `v_customer_segments`,
   mig 137). **Gated**: superadmin/readonly_admin always; others only if granted the
   `tool_customer_profiles` feature. Rank-and-file roles never see it.
2. **SaleDetailDrawer** (all roles that can open a sale): fetches the resell **chain**
   (`/sales/:id/chain`) and the **lifetime** rollup (`/sales/lifetime/by-phone`) and
   shows a cross-company banner when one phone produced sales at multiple companies —
   but the rows inside are **role-scoped server-side** (closer → own rows only;
   fronter → own non-resell rows only; compliance/admin → everything).
3. **CustomerTimeline** (inside the drawer) — unified feed from transfers +
   `transfer_assignments` + `policy_events`, same role scoping.

So each sale is *not* an island in the schema — `customer_uuid` connects everything —
but for a closer or fronter the UI presents mostly their own slice.

---

## 3. Multi-vehicle / "Add Another Car"

### 3.1 What it actually is

**(b) — separate sale rows, one per vehicle**, created in a single submit.
`SaleForm.jsx:823-872`: "Add Another Car" repeats only the fields the superadmin marked
`repeats_per_car`; every extra car becomes an entry in `additional_cars[]`;
`POST /sales` builds one row per car sharing the customer/identity columns
(`buildCarRow`, sales.js:~446) and inserts them in **one** statement. Multi-car is only
offered on *create* (`allowMultiCar = !existingSale && carFieldsSorted.length > 0`) —
adding a vehicle later goes through the Resell flow's `additional_car` intent (§5).

### 3.2 Storage and treatment

- No vehicles table, no JSONB array: `car_year/make/model/miles/vin` are columns **on
  each sales row**. The rows are tied together only by `transfer_id` (+ shared
  `customer_uuid`) — there is **no "sale group" id**.
- Pricing/compliance/commission treat **each row independently**: own plan, own
  down/monthly payment, own auto-generated `reference_no`, own status journey through
  compliance. Nothing aggregates "this was one 3-car deal".

### 3.3 Interaction with the recording system

The recording review queue (`app_recording_review_queue`, migs 150→163) is keyed by
**sale id**. A 3-car submit creates 3 queue entries for what was one phone call:

- Compliance must confirm clips **three times** (or the portal live-resolves the same
  longest call three times in hybrid mode). `sale_recording_confirmations` has no
  concept of "these sales share a call".
- Nothing breaks — each row resolves to the same lead/agent/date and typically the same
  recording — but the work and the confirmations are duplicated per vehicle, and a
  reviewer sees three identical-looking rows (same customer/phone/date) with no
  "multi-vehicle" indicator.

---

## 4. Cancellation

There are **three distinct paths** with very different rigor:

### 4.1 Closer/creator self-cancel — `PUT /sales/:id`

- **Who**: the sale's creator/closer, anyone with `update_sale` (per-user toggleable),
  compliance, superadmin (sales.js:960+).
- **Guards**: blocked while `pending_review` (unless it's a post-dated sale), blocked
  once `closed_won`/`closed_lost`, blocked past the compliance lock window
  (`compliance.lock_window_days`, default 90, anchored on sale_date).
- **What it records**: `status='cancelled'` and… that's it. `cancellation_date` and
  `cancellation_reason_key` are **compliance-only** fields in this route (sales.js:1161,
  1174) — a closer self-cancel stores **no reason and no cancellation date**.
- **Approval step: none.** Within the guards above it's unilateral.

### 4.2 Compliance cancellation — `POST /sales/:id/compliance`

- **Who**: compliance_manager / superadmin (plus the tool_compliance_review delegation).
- Statuses: `cancelled`, `compliance_cancelled`, `chargeback`, `dispute` (+ restores).
- **Mandatory** canonical `cancellation_reason_key` for any cancel-like status
  (sales.js:1519; free text goes to `compliance_note`); `cancellation_date` defaults to
  today if not provided; terminal statuses stamp `compliance_locked_at` (G24) so
  closers can't quietly revert.
- Everything lands in `edit_history` and trigger-fed `policy_events` ('cancelled', …).

### 4.3 Hard delete — `DELETE /sales/:id`

Creator/compliance/superadmin/`delete_sale` grant can **permanently delete** the row
(sales.js:1604). No soft-delete, no tombstone — the sale vanishes from chains,
lifetime rollups, and reporting.

### 4.4 Downstream effects

- **Visibility**: cancellation is a status change — the row stays visible everywhere
  with a red/grey "Cancelled" badge. Nothing is hidden.
- **SPIFF**: `spiffOnSalesChanged()` recalcs on status transitions (sales.js:1591 and
  the compliance bulk paths) — cancellations do flow into spiff metrics.
- **Recording review queue: cancelled sales do NOT drop out.** The queue RPC
  (mig 163) filters only post-dated sales; there is **no sale-status filter**, so a
  cancelled (or needs_revision) sale still sits in "pending review" asking for a
  recording confirmation. Reviewers burn time on dead deals.
- **Client portal**: browse scoping filters by closers/clients/post-date — not by
  cancelled status. In hybrid (gate-off) mode a cancelled sale can still list and play.

---

## 5. Resell

### 5.1 What "resell" means here — four intents, one mechanism

Dedicated flow: **"New on lead"** button (PhoneSearch card / SaleDetailDrawer) →
`ResellModal` → `POST /sales/:id/resell` (sales.js:1656). The intent disambiguates the
business cases:

| Intent | Old sale | New sale | Vehicle fields |
|---|---|---|---|
| `resell` | → `compliance_cancelled` | fresh row | copied |
| `renewal` | → `expired` (if not already terminal) | fresh row | copied |
| `additional_car` | **untouched** | fresh row | blanked — closer enters the new car |
| `other` | → `compliance_cancelled` (same as resell) | fresh row | copied |

So: "cancelled-then-resold", "returning customer, new vehicle", and "renewal" are all
first-class and distinguished by `resell_intent`. It is **not** "just create a new sale
and remember" — but only *if the closer uses the button*; nothing stops them from
creating an unlinked plain sale instead (§2.2).

### 5.2 Guardrails (all business-config driven)

`resell.enabled_statuses` (old status must qualify), `resell.warning_statuses`
(reason text forced), `resell.require_reason_text`, `resell.cooldown_days`
(default 7 — blocks a second resell of the same sale inside the window),
`resell.auto_block_after_chargebacks` (default 2 — customer-level block on repeat
chargebacks, superadmin override only). Permission: closer (own sales only) and
manager+ roles.

### 5.3 Linkage — yes, they're really linked

The new row carries `is_resell=true`, `original_sale_id` (chain FK), `resell_intent`,
`resell_reason`, and `original_fronter_id` (G19 — the *first* fronter's credit survives
any number of resells). The old row gets an `edit_history` entry naming the new sale id.
`GET /sales/:id/chain` walks the chain both directions; the drawer renders it as a
timeline. Reporting can distinguish resells (`is_resell` filter in the analytics/data
sources), and a disposition row (`Resell: <intent>`) lands on the transfer for lead
intelligence.

---

## 6. Role-by-role visibility

| Scenario | Fronter | Closer | Compliance | Superadmin / co-admin / ops |
|---|---|---|---|---|
| **Repeat customer** | Nothing proactive. Own transfer list only; duplicate-transfer alerts (refresh/reengage/sale_overlap) go to their **managers**, not them. Lifetime/history endpoints scope them to their own **non-resell** rows | "already sold" badges + counts on the phone-search cards (per transfer); cross-company "N cos" chip; drawer lifetime rollup **limited to their own** past sales with this customer | Full: drawer chain + lifetime + timeline show every row across companies, with the cross-company banner | Full, plus the Customer Profiles tool (segments, repeat buyers, matview) and Data Analyzer |
| **Multi-vehicle sale** | Sees the transfer completed; nothing marks it multi-car | Creates it; afterwards each car is just another sale row in their list | **No indicator.** N same-customer rows in the sales list & recording queue; only `transfer_id`/phone equality reveals the bundle | Same — no grouped view anywhere |
| **Cancellation** | Own view: sale badge flips to Cancelled (their transfer stats reflect it) | Badge flips; can self-cancel own non-finalized sale (no reason captured, §4.1) | Full control: reasons catalog, dates, locks; bulk paths; sees closer self-cancels but **without** reason/date | Analytics status filters include Cancelled; cancellation *rates/reasons* rollups only inside Customer Profiles / exports |
| **Resell** | **Deliberately blinded**: fronter-facing queries exclude `is_resell` rows (privacy spec); resell button hidden client-side for fronter roles | "↻ resell" chip on search cards; "New on lead" button; drawer chain shows their own chain rows | `is_resell` badge in SalesTab (SalesTab.jsx:366); full chain in drawer; resell disposition rows in lead intelligence | Full; resell config lives in Business Rules; `resell_intent` is filterable in analytics/exports |

**What requires manual cross-referencing today**: for anyone below compliance, the full
picture of "this customer, all companies, all sales, all vehicles" only assembles inside
(a) the sale drawer's lifetime section — role-trimmed — or (b) the superadmin-gated
Customer Profiles tool. The compliance recording queue and sales list show flat rows;
a reviewer connecting three multi-car rows or a cancel→resell pair does it by noticing
matching phones/dates, not because the UI groups them.

---

## 7. Gaps — where humans are the integrity layer (ranked by business risk)

### HIGH

1. **Closer self-cancel records nothing.** `PUT /sales/:id` with `status='cancelled'`
   captures no `cancellation_date` and no `cancellation_reason_key` (both are
   compliance-only in that route) and needs no approval. Result: cancellation
   analytics/pattern detection are blind to every closer-initiated cancel, and a
   closer can cancel + freshly re-sell (dodging the resell chain and its cooldown /
   chargeback guards) with nothing linking the two rows. *(Mitigant: once a sale is
   pending_review/closed_won, or past the lock window, the route blocks them.)*

2. **Cross-transfer duplicate sales are silent at the point of sale.** The only hard
   dup check is per-transfer (`DUP_FINGERPRINT`). Same customer through a new transfer
   → new sale inserts with zero warning to the closer. The transfer-level
   `sale_overlap` alert fires — to fronter managers, after the fact. The endpoint built
   to warn closers (`/sales/customer-history/by-phone`) is **wired to nothing**.
   Real risk: double-selling the same coverage, awkward compliance calls, chargebacks.

3. **Recording review queue ignores sale status.** Cancelled / needs_revision rows sit
   in "pending review" forever (mig 163's WHERE has no sale-status clause). Compliance
   wastes review effort on dead deals, and the pending count is permanently inflated —
   which erodes trust in the queue as a to-do list. Same root cause: in hybrid portal
   mode a cancelled sale can still play to a client.

4. **Hard delete erases history.** `DELETE /sales/:id` is available to creators (via
   default grants) and physically removes the row — chain links, lifetime rollups, and
   VIN/policy history lose a node with no tombstone. Anything reconciled against
   external systems (VICIdial counts, client reports) can silently stop adding up.

### MEDIUM

5. **Multi-vehicle bundles have no group identity.** N rows share only
   `transfer_id`/`customer_uuid`. Compliance reviews the same call N times; nothing in
   any list says "these three are one deal"; a per-deal commission or refund view has
   to be reconstructed by hand.

6. **Fronter-side blindness is total by design — including where it hurts.** A fronter
   re-working a number has no signal that the customer holds an active policy (their
   history scope hides resells and other fronters' sales), so wasted transfers and
   awkward "you already sold me this" calls are only caught by the manager-directed
   alerts, which nobody at the desk sees.

7. **`other` resell intent cancels the old policy** exactly like `resell`
   (sales.js:1793). A closer picking "Other" for an innocuous reason terminally
   cancels a live policy. `renewal` similarly force-expires a not-yet-expired policy.

### LOW / friction

8. **Dead endpoint drift**: `customer-history/by-phone` (and its comment claiming
   PhoneSearch uses it) — unused code that misleads future work.
9. **Cross-company chip counts fronter companies only** — a closer-company duplicate
   doesn't light it up.
10. **Cancellation reasons are catalog-enforced only on the compliance path**, so the
    "top cancellation reasons" report is really "top *compliance-observed* reasons".

### Cheapest high-leverage fixes (if/when wanted — not done in this pass)

- Wire the existing `customer-history` endpoint into PhoneSearch + SaleForm open
  (one banner: "3 prior sales for this customer — 1 active, 1 cancelled, 1 chargeback").
- Add `AND (status-filter)` to the recording-queue RPC (one migration, mirrors the
  post-date exclusion pattern).
- Require a reason (or at least stamp `cancellation_date`) on the closer self-cancel
  path; or route closer cancels through a lightweight compliance ack.
- A `sale_group_id` stamped by `POST /sales` on multi-car inserts (one uuid, zero
  behavior change) would let every downstream surface group bundles later.
