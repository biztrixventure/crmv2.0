# Manual Testing Guide — recent sale-lifecycle & portal changes

How to hand-test everything shipped in this pass. No automated harness — this is a
click-through checklist. Pair it with **[sale-lifecycle.md](sale-lifecycle.md)** (the
behavior spec each test verifies) and, for exports, **[export-governance-README.md](export-governance-README.md)**.

Each test: **Who** (role) · **Where** (path) · **Do** (steps) · **Expect** (pass condition).
Tick `[ ]` → `[x]` as you go.

> **Ground rules**
> - **Prod has real users.** Do these on staging, or with disposable test leads/sales you
>   create yourself. Never cancel/delete a real customer's live policy to test.
> - Migrations **165, 166, 167** must be applied first (Supabase SQL editor, in order).
>   Verify: `node backend/verify_migrations.js`.
> - Two browsers/profiles help: one signed in as **closer**, one as **compliance/superadmin**,
>   one **incognito** for the client **portal** login.

---

## 0. Pre-flight

- [ ] `node backend/verify_migrations.js` → 165/166/167 report present.
- [ ] Backend up (`PORT` default 3001); frontend `npm run dev` (or built) loads.
- [ ] You have a test customer **phone number** you can reuse across tests.
- [ ] That number has at least **one existing sale** (create one if not — §A gives you the flow).

---

## A. Multi-vehicle sale + `sale_group_id` bundle  (mig 165)

**Verifies:** §3 — "Add Another Car" writes one row per car, now sharing a group id.

- **Who:** closer · **Where:** `/staff` → phone search → **Sale**
1. [ ] Search a number, open the **Sale** form.
2. [ ] Fill the car/plan fields, click **Add Another Car**, fill a *second* car (different
       year/make/model), submit.
3. [ ] **Expect:** submit succeeds, **two** sales created (not one).
4. [ ] Open the sales list (closer dashboard / Compliance → Sales). **Expect:** each of the
       two rows shows a **group count badge** ("2" / "part of 2-car deal" indicator).
5. [ ] Open one row's drawer. **Expect:** the sibling car is discoverable
       (`GET /sales/:id/siblings` powers it) — the other vehicle of the same deal is shown.

**Negative / regression:**
- [ ] Create a **single-car** sale. **Expect:** no group badge, `group_count` = 0, behaves
      exactly as before.
- [ ] Two cars with the **same VIN** in one submit still succeed (no 500 — the bulk-safe VIN
      reconcile, mig 091).

---

## B. Returning-customer / active-policy banner  (FIX 2)

**Verifies:** §2.2 — the previously-dead `customer-history` endpoint now warns closers.

- **Who:** closer · **Where:** `/staff` → phone search + Sale form
1. [ ] Search the number from §0 (the one with an existing sale). In the results, the card
       area shows a **history banner**.
2. [ ] If that prior sale is **approved/sold** (`closed_won`/`sold`): **Expect a RED**
       "Active policy exists — this customer already holds an approved policy" callout.
3. [ ] If the prior sale is cancelled/lost only: **Expect an AMBER** "Returning customer —
       N prior sales" callout.
4. [ ] Open the **Sale form** for that number. **Expect:** the same banner renders at the top
       of the form (warning at the exact moment a dup could be created).
5. [ ] **Expect:** it's **informational, never blocking** — you can still submit (Resell is
       the intended path, but nothing is hard-blocked here).

**Scope-safety (cross-agent):**
- [ ] As a closer who does **not** own the customer's active policy (another closer made it),
      search the number. **Expect:** a red **"active policy exists through another agent —
      details restricted"** line still shows, even though your own scoped list is empty.
- [ ] Search a **brand-new** number with no history. **Expect:** no banner at all.

---

## C. Closer self-cancel accountability  (FIX 3)

**Verifies:** §4.1 — self-cancel now stamps date + requires a reason.

- **Who:** closer (creator of the sale) · **Where:** sale drawer → status change
1. [ ] Open one of **your own** non-finalized sales (status `open`/`sold`, not
       `pending_review`/`closed_won`, within the lock window).
2. [ ] Change status to **Cancelled** **without** picking a reason. Submit.
3. [ ] **Expect:** `400` — "A cancellation reason is required…" (`CANCEL_REASON_REQUIRED`).
       The cancel is refused.
4. [ ] Pick a **cancellation reason** from the list, submit again.
5. [ ] **Expect:** status flips to Cancelled; the sale now carries a **cancellation date**
       (today) and the reason; the drawer **Audit Trail** shows a
       `status: open→cancelled` entry with who/when/reason.

**Regression:**
- [ ] Change a sale to **`closed_lost`** without a reason. **Expect:** allowed (reason optional
      for a lost deal, required only for a true cancel) — but `cancellation_date` still stamped.
- [ ] Try to self-cancel a `pending_review` or `closed_won` sale. **Expect:** blocked by the
      existing guards (unchanged).

---

## D. Recording review queue ignores dead deals  (mig 166)

**Verifies:** §4.4 — cancelled / lost sales drop out of "pending review".

- **Who:** compliance / superadmin · **Where:** Compliance shell → **Recording Review**
1. [ ] Note a sale currently sitting in the **pending review** queue.
2. [ ] Cancel that sale (compliance cancel, or the closer self-cancel from §C).
3. [ ] Reload the Recording Review queue. **Expect:** the cancelled sale is **gone** from
       pending review; the pending **count drops** by one.
4. [ ] **Expect:** an active `pending_review` sale with a real recording still appears (only
       dead statuses are filtered, not everything).

---

## E. Client portal — dead-status filter + multi-recording inline expand

**Verifies:** portal zero-sales fix (enum-safe) + the new inline expand UI.

- **Who:** portal client · **Where:** incognito → portal login (`/portal`)
1. [ ] Log in as a **portal client**. **Expect:** their confirmed sales **list** (this is the
       bug that was returning ZERO — it must show sales again).
2. [ ] **Expect:** **cancelled** sales do **not** appear and cannot be played.
3. [ ] Find a sale with a **single** recording. Click it. **Expect:** it plays directly in the
       docked bottom player (no expand, no dialog).
4. [ ] Find a sale with **multiple** recordings — it shows a **Layers icon**, an
       **"N recordings"** pill, and a **chevron ▾** on the right.
5. [ ] Click the row (or the chevron). **Expect:** it **expands IN PLACE** (no dialog box) into
       a nested list of recording cards — each with a number badge, duration, play button,
       and its own download. Chevron rotates.
6. [ ] Click **Recording 2**. **Expect:** it plays that specific clip in the docked player;
       the active card shows a pause/now-playing state.
7. [ ] Click a card's **download**. **Expect:** that single clip downloads as an mp3.
8. [ ] Click the chevron again. **Expect:** it **collapses** in place.

**Performance:**
- [ ] Expand a multi-recording sale twice. **Expect:** the second expand is instant (clips are
      cached per sale after the first fetch).

---

## F. Data-egress governance  (mig 167)

**Verifies:** export/recording audit + limits + field selection. Full spec:
[export-governance-README.md](export-governance-README.md).

- **Who:** superadmin · **Where:** Admin → **Egress Governance**
1. [ ] Open the tool. **Expect:** three tabs — **Audit**, **Limits**, **Fields & Display** —
       plus today's summary tiles (exports / denied / recordings / users).
2. [ ] **Audit tab:** perform a CSV export somewhere (e.g. a compliance list export), then
       reload Audit. **Expect:** a new `csv_export` row with your name (searchable picker, not
       a raw UUID), dataset, row count, status `allowed`.
3. [ ] **Limits tab:** set a tiny **max rows per export** (e.g. 5) for your role (or a specific
       user via the search picker). Save.
4. [ ] Export a list with **more** than that many rows. **Expect:** `429` /
       "egress limit" — the export is refused before draining, and an audit row logs
       `denied`.
5. [ ] Raise/remove the limit. **Expect:** export works again.
6. [ ] **Fields & Display tab:** restrict the columns for a dataset+role, export as that role.
       **Expect:** the removed columns are **absent from the CSV** (redacted at the data layer,
       not just hidden).
7. [ ] Play a portal recording as a limited role after setting a
       **recording-minutes-per-day** cap. **Expect:** it blocks once the cap is hit and logs a
       `recording_listen` audit row.

**Client pre-check:**
- [ ] As a near-limit user, open an export surface. **Expect:** a "you're near your limit"
      hint (from `GET /egress/my-usage`) before you hit the hard 429.

---

## G. Cross-cutting regression sweep

- [ ] **Resell flow** still works: on an existing sale, **New on lead** → ResellModal →
      pick intent (`resell` / `renewal` / `additional_car` / `other`) → new linked row with
      `is_resell`, correct old-status transition, cooldown respected.
- [ ] **Reference collision:** reuse an existing `reference_no` → `409 REF_COLLISION`.
- [ ] **Same-transfer dup:** re-submit identical car+client+date on one transfer →
      `409 DUP_FINGERPRINT`.
- [ ] **Roles:** fronter never sees the sale form or resell rows; compliance sees all rows +
      chain + timeline; superadmin sees Customer Profiles + Data Analyzer.
- [ ] **Notifications:** a new sale still auto-logs "Sent to Compliance" on the transfer.

---

## Reporting a failure

For any `[ ]` that fails, capture: role, exact page/path, the step, what you expected vs. saw,
and any `4xx/5xx` from the network tab or `backend` logs (the portal and sales routes now log
query errors instead of swallowing them). File it against the matching section number here.
