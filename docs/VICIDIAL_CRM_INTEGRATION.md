# VICIdial ↔ CRM Integration — Design & Implementation Report

**Status:** Approved design, pending implementation
**Owner:** Engineering
**Audience:** Leadership (Sections 1–4) + Engineering reference (Sections 5–17)
**Last updated:** 2026-06-14

---

## 1. Executive Summary

Today, when a fronter connects a call in VICIdial, they do the work twice: they
push the lead into the closer's dialer **and** retype the customer + vehicle
details into the CRM. The closer then searches the phone number, opens the
record, and completes the sale manually. The disposition the closer sets in
VICIdial never automatically comes back to the fronter or to compliance.

This project makes the **CRM the single source of truth** while **VICIdial stays
purely the dialer**. Concretely:

- The fronter's data flows into the CRM **automatically** at transfer time — no
  retyping.
- The closer's disposition (sale / not-interested / callback) flows back into
  the CRM **automatically**, and the **transferring fronter sees the outcome**
  on their dashboard.
- Every transfer is tracked end-to-end (customer, vehicle, plan, transfer
  history, disposition, compliance) inside the CRM.
- Routing is **clash-proof**: even when two different companies transfer the
  **same phone number**, each disposition returns to the correct fronter.

**Cost / risk profile:** Low. It is **mostly VICIdial configuration plus a small
amount of CRM code**, and it **reuses the CRM's existing** transfer, sale,
disposition, and customer-identity machinery. **No new infrastructure** is
required. VICIdial keeps doing the dialing exactly as it does today; the
integration is one-directional (VICIdial → CRM), which keeps it safe and simple.

---

## 2. Current State (the problem)

| Step | Today | Pain |
|---|---|---|
| Fronter connects a call | VICIdial | — |
| Fronter pushes lead to closer | Clicks a **webform button** → VICIdial `add_lead` injects the lead into the closer's dialer | Works, but separate from CRM |
| Fronter records the lead | **Retypes** customer + vehicle into the CRM | Double entry, errors, time |
| Closer works the lead | **Searches the phone** in the CRM, opens the record | Manual lookup |
| Closer dispositions | Sets disposition **in VICIdial** | **Never returns to the CRM / fronter** |
| Tracking | Scattered between VICIdial and CRM | No single lifecycle view |

**Topology:** multiple fronter VICIdials and multiple closer VICIdials, on
different campaigns. Some companies run fronters and closers on the **same**
VICIdial; most are split across **different** VICIdials.

---

## 3. Objectives

1. Enter customer + vehicle data **once** (in the CRM), populated automatically
   from the dialer.
2. Closer's **disposition returns automatically** to the CRM and to the
   transferring fronter's dashboard.
3. CRM holds the **full lifecycle**: lead → transfer → disposition → sale →
   compliance, per customer and per vehicle.
4. **Clash-proof** routing across companies that share phone numbers.
5. Keep VICIdial as the **telephony layer only**; CRM owns business workflow,
   routing, and data.

---

## 4. Solution Overview

Two automatic data flows, both **VICIdial → CRM** (never the reverse — that is
what keeps it safe):

1. **On transfer (fronter):** VICIdial's **Dispo Call URL** fires on the `XFER`
   disposition and sends the lead data to the CRM in the background. The CRM
   creates a **pre-filled, pending transfer**. When the fronter opens the CRM,
   the form is **already filled** — they review and confirm.

2. **On call end (closer):** VICIdial's **Dispo Call URL** fires on the closer's
   disposition and sends it to the CRM. The CRM matches it to the correct
   transfer and shows the outcome on the **fronter's dashboard**. For a **SALE**,
   the closer clicks a **webform button** that opens the CRM sale form
   pre-filled to complete and submit to compliance.

The lead's existing path into the closer's dialer (`add_lead`) is **unchanged**;
we only add **one parameter** to it (a unique correlation code).

---

## 5. Architecture Principles

- **One-directional per concern.** VICIdial → CRM for data and dispositions.
  The CRM does **not** write business state back into VICIdial. This removes the
  hardest class of bugs (two-way sync conflicts) and the need for retry/outbox
  machinery.
- **VICIdial = telephony only.** Dialing, call transfer, recordings stay in
  VICIdial. The CRM owns customers, vehicles, transfers, sales, compliance.
- **Phone is the human key; a correlation code is the machine key.** Matching is
  done on an exact, unique code (Section 6), with phone as a human-readable
  fallback.
- **Reuse, don't rebuild.** The CRM already has the transfer queue, sale form,
  disposition system, fronter feedback, and a deterministic customer identity
  (`customer_uuid` from the normalized phone). This project wires VICIdial into
  that, it does not replace it.
- **Config over code.** Per-company differences (field placement, prefixes,
  agent identities) are configuration the superadmin manages, not code changes.

---

## 6. The Unique-ID / Anti-Clash Mechanism (critical)

**Problem:** two different companies can transfer the **same phone number**.
Matching a returning disposition by phone alone would route it to the wrong
fronter.

**Solution:** thread a globally-unique correlation code from the fronter, onto
the closer lead, and back to the CRM. VICIdial's free **`vendor_lead_code`**
field carries it.

The code = **`<companyPrefix>` + `<fronter lead_id>`**:

- **`lead_id`** is VICIdial's auto-increment primary key for the lead. Every
  lead gets one automatically on load — no typing, never reused. It is unique
  **per dialer**.
- **`companyPrefix`** is a short (2–4 char) code the superadmin assigns **per
  fronter dialer/company**, to make the code unique **across** dialers.

```
Company A (prefix A1):  A1 + 803258  →  A1803258
Company B (prefix B2):  B2 + 803258  →  B2803258
```

Even if both companies have a lead with `lead_id = 803258`, the codes differ →
**no clash**.

**How it threads:**
1. Fronter transfers → the `add_lead` webform stamps `vendor_lead_code =
   A1803258` onto the **closer** lead (one added parameter).
2. The fronter's Dispo Call URL sends the **same** code to the CRM, which stores
   it on the transfer.
3. The closer dispositions → the closer's Dispo Call URL returns
   `--A--vendor_lead_code--B--` = `A1803258` → the CRM finds that exact transfer.

**Where the prefix lives:** only on the **fronter** side, in **both** the
`add_lead` webform and that fronter campaign's Dispo Call URL (they must match).
The **closer** side is generic — it only reads `vendor_lead_code` back, so every
closer campaign uses the same URL.

---

## 7. End-to-End Flow

### 7.1 Fronter

1. Fronter connects a call (VICIdial).
2. Fronter clicks the existing **webform** → `add_lead` injects the lead into the
   closer dialer, now also stamping `&vendor_lead_code=<PREFIX>--A--lead_id--B--`.
3. Fronter sets the **`XFER`** disposition.
4. The fronter campaign's **Dispo Call URL** fires (background, ALT-scoped to the
   `XFER` status) → CRM `/fronter-xfer` with the code + lead fields + agent.
5. CRM creates a **pending, pre-filled transfer** tagged to that fronter.
6. Fronter opens the CRM (when ready) → the pre-filled transfer is waiting in a
   **"pending to confirm"** view → fronter confirms → transfer saved.

> No auto-popup window is used (the dialer only has two webform slots, both in
> use, and the Dispo Call URL is background-only). The CRM simply shows the
> pre-filled pending transfer when the fronter opens it.

### 7.2 Closer

1. Closer works the transferred lead (it carries `vendor_lead_code = A1803258`).
2. Closer ends the call and sets a disposition.
3. The closer campaign's **Dispo Call URL** fires (background, all dispositions)
   → CRM `/closer-dispo` with the code + `dispo` + `talk_time` + agent.
4. CRM matches the code to the transfer → records the disposition → the
   **transferring fronter sees the outcome** on their dashboard.
5. If the disposition is **SALE**, the closer clicks a **webform button**
   ("SALE") → CRM `/closer-sale` opens the sale form **pre-filled** for that
   exact transfer → closer completes → submits to compliance.
   Non-sale dispositions (NI / callback / etc.) need no form — they are just
   recorded.

### 7.3 Same-box companies (fronter + closer on one VICIdial)

The mechanism is identical; only **how the code gets stamped** differs:

- **(a) Lead injected via `add_lead`** (even into a closer list on the same
  server): **no change** — `add_lead` stamps `vendor_lead_code` exactly as in the
  cross-box case.
- **(b) Live call transferred natively** to a closer in-group (same lead, no
  `add_lead`): the fronter webform uses **`update_lead`** instead, to stamp
  `vendor_lead_code = <PREFIX>--A--lead_id--B--` onto the **existing** lead.

In both cases the closer + CRM are unchanged. The only per-company variable is
the fronter webform function: `add_lead` (cross-box / same-box-inject) vs
`update_lead` (same-box-native).

---

## 8. VICIdial Configuration (exact)

Replace `{CRM}` with the CRM base URL, `{PREFIX}` with the company's prefix, and
confirm the exact substitution tokens on your build (lead fields use
`--A--field--B--`).

### Fronter campaign

**Webform (existing `add_lead`, + one new parameter):**
```
http://{CLOSER_HOST}/vicidial/non_agent_api.php?source=crm&user=apiuser&pass=********
  &function=add_lead&list_id={CLOSER_LIST}&phone_number=--A--phone_number--B--
  &first_name=--A--first_name--B--&last_name=--A--last_name--B--
  &address1=--A--address1--B--&address2=--A--address2--B--&address3=--A--address3--B--
  &city=--A--city--B--&state=--A--state--B--&postal_code=--A--postal_code--B--
  &email=--A--email--B--&comments=--A--comments--B--
  &vendor_lead_code={PREFIX}--A--lead_id--B--        ← NEW (the correlation code)
```

**Dispo Call URL (ALT → fire only on `XFER`):**
```
{CRM}/api/vicidial/fronter-xfer?code={PREFIX}--A--lead_id--B--&agent=--A--user--B--
  &phone=--A--phone_number--B--&first=--A--first_name--B--&last=--A--last_name--B--
  &car_make=--A--address2--B--&car_model=--A--address3--B--&car_year=--A--province--B--
  &address=--A--address1--B--&city=--A--city--B--&state=--A--state--B--
  &zip=--A--postal_code--B--&email=--A--email--B--
```

**Same-box-native variant** — replace the webform `add_lead` with:
```
http://{SAME_HOST}/vicidial/non_agent_api.php?source=crm&user=apiuser&pass=********
  &function=update_lead&lead_id=--A--lead_id--B--
  &vendor_lead_code={PREFIX}--A--lead_id--B--
```

### Closer campaign (generic — same for all closers)

**Dispo Call URL (fires on every disposition):**
```
{CRM}/api/vicidial/closer-dispo?code=--A--vendor_lead_code--B--&dispo=--A--dispo--B--
  &talk_time=--A--talk_time--B--&term=--A--term_reason--B--
  &phone=--A--phone_number--B--&agent=--A--user--B--
```

**Webform "SALE" button (opens the CRM sale form):**
```
{CRM}/closer-sale?code=--A--vendor_lead_code--B--&phone=--A--phone_number--B--&agent=--A--user--B--
```

> **Dispo Call URL notes (from VICIdial):** background call, not seen by the
> agent; fires on every disposition if populated; supports `dispo`,
> `callback_lead_status`, `talk_time`, `term_reason`; must be an absolute URL;
> entering `ALT` opens a page to define multiple URLs and the specific statuses
> that trigger them (used to scope the fronter URL to `XFER`).

---

## 9. CRM Build (what we add)

**Database (one migration):**
- `transfers.vicidial_vendor_code` — text, indexed. The correlation key.
- `user_profiles.vicidial_agent_id` — maps a VICIdial agent (e.g. `TMC100682`)
  to a CRM user, so pending transfers and feedback route to the right person.
- `vicidial_config` (per company): `prefix`, `company_id`, field-map (JSONB),
  and optional server/credential registry. Drives the superadmin mapping UI.

**Endpoints (ingestion, idempotent on the code):**
- `POST/GET /api/vicidial/fronter-xfer` — create/update a **pending** pre-filled
  transfer (applies the company field map).
- `POST/GET /api/vicidial/closer-dispo` — match by code → record the
  disposition → surface to the fronter dashboard.
- `GET /closer-sale` — match by code → open the **sale form pre-filled**.

**UI:**
- Fronter "pending transfers to confirm" view (pre-filled; confirm → save).
- Closer sale form opened pre-filled from the code (reuses existing SaleForm).
- Disposition outcome shown on the fronter dashboard (reuses existing feedback).

**Admin (superadmin):**
- Per-company **field-map** editor (dialer field → CRM field).
- **Prefix registry** (`A1 → Company A`).
- **Agent-ID** mapping on user profiles.

**Idempotency:** all ingestion keys on `vicidial_vendor_code` (and `normalized_phone`
as fallback) — a duplicate fire updates, never duplicates.

---

## 10. Per-Company Configuration (superadmin owns)

| Setting | Example | Purpose |
|---|---|---|
| Prefix (per fronter dialer) | `A1` | Global uniqueness of the code |
| Field map | `address2 → car_make` | Translate dialer fields to CRM fields |
| Webform function | `add_lead` or `update_lead` | Cross-box vs same-box-native |
| Agent-ID map | `TMC100682 → fronter@coA` | Route pending transfers + feedback |

---

## 11. Field Mapping (real example)

From a live lead (William Baker, `lead_id 803258`):

| VICIdial field | Value | → CRM field |
|---|---|---|
| `lead_id` | 803258 | correlation seed (`A1803258`) |
| `first_name` / `last_name` | william / baker | customer name |
| `address1` | 315 Green Tree Ct | customer address |
| **`address2`** | HONDA | **car_make** |
| **`address3`** | ACCORD LX | **car_model** |
| **`province`** | **2012** | **car_year** ⚠️ (year lives in `province`, not an address field) |
| `postal_code` | 29302 | zip |
| `phone_number` | 8642374901 | customer_phone |
| `email` | wmbaker100@gmail.com | customer_email |
| `vendor_lead_code` ("Vendor ID") | *(blank)* | → we write `A1803258` here |
| `comments` | "…MILES MORE THAN…" | notes (miles unreliable — confirm in CRM) |

**Note:** field placement varies by company (e.g. year in `province`). This is
exactly why the field map is **per-company configuration**, not hardcoded.

---

## 12. What This Reuses (already built in the CRM)

- Transfer record + closer queue (no phone search needed).
- Sale form + submit-to-compliance.
- Disposition system + fronter feedback on the dashboard.
- `customer_uuid` — deterministic customer identity from the normalized phone.
- `transfer_assignments` (who transferred to whom) and `policy_events`
  (sold/approved/cancelled/… lifecycle).

The integration is largely **wiring these to three new ingestion endpoints**.

---

## 13. Scope Boundaries (v1)

**In scope:** auto-capture of the transfer (pre-filled, confirmed), closer
disposition feedback, SALE form pre-fill, clash-proof routing, per-company
mapping.

**Deliberately out of v1 (add later if needed):**
- CRM **pushing/auto-dialing** leads into closer dialers (the reverse
  direction).
- Pulling **call recordings / full call logs** (store references only when
  added).
- Real-time per-call-state events (we fire on transfer + disposition only).
- Auto-opening browser windows with zero clicks (not supported cleanly by
  VICIdial; we use background capture + manual open + webform-button popups).

---

## 14. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Same phone, different companies → wrong routing | The `vendor_lead_code` correlation code (Section 6) — exact match, never clashes |
| Duplicate Dispo Call URL fires | Idempotent ingestion keyed on the code |
| Screen-pop / CRM not authenticated | VICIdial + CRM run in the **same Chrome**, agents logged into both → session shared. Routes also fall back to login-then-return |
| CRM backend can't reach a dialer | Confirm HTTP reachability + VICIdial `api_allowed_ip` per dialer |
| Wrong field captured (year in `province`, etc.) | Per-company field map; verify with a live lead before go-live |
| Weak API credentials (`apiuser` / `apiuser123` seen in URLs) | **Rotate to a strong password**; credentials travel in URLs by VICIdial design, so restrict by IP |
| Miles only in free-text `comments` | Don't auto-trust; fronter/closer confirms in the CRM |
| Disposition token names differ by build | Verify `--A--dispo--B--` / `--A--talk_time--B--` on the actual VICIdial version |

---

## 15. Prerequisites / Open Items

- [ ] Confirm `vendor_lead_code` is free on all relevant dialers (verified blank
      on the sampled lead; confirm across lists).
- [ ] Confirm CRM backend can reach each dialer over HTTP (IP allowlist).
- [ ] Confirm the exact substitution tokens for `dispo` / `talk_time` on the
      build.
- [ ] For each same-box company, confirm `add_lead` (inject) vs native transfer
      (`update_lead`).
- [ ] Assign a unique prefix per fronter dialer.
- [ ] Collect VICIdial agent-ID → CRM-user mapping.
- [ ] **Rotate the API password.**

---

## 16. Phased Rollout

1. **Phase 0 — Discovery (1 dialer):** confirm reachability, tokens, and that a
   test `add_lead` with `vendor_lead_code` round-trips. (One fronter+closer
   pair, one test lead — e.g. `A1803258`.)
2. **Phase 1 — Fronter capture:** Dispo Call URL on `XFER` → CRM pending
   pre-filled transfer → fronter confirms. (Kills double entry.)
3. **Phase 2 — Closer feedback:** closer Dispo Call URL → CRM records
   disposition → fronter dashboard.
4. **Phase 3 — SALE pop:** closer SALE webform → CRM sale form pre-filled →
   compliance.
5. **Phase 4 — Per-company mapping UI + prefix registry + agent map** (superadmin).
6. **Phase 5 — Roll out** company by company; handle same-box variants.

Each phase is independently testable on one dialer pair before fleet rollout.

---

## 17. Appendix

### Glossary
- **`lead_id`** — VICIdial's auto-increment lead primary key (unique per dialer).
- **`vendor_lead_code`** — free VICIdial lead field; carries our correlation code.
- **Dispo Call URL** — VICIdial campaign setting; a background URL fired on every
  disposition.
- **Webform** — VICIdial campaign setting; a button that opens a URL in the
  agent's browser (this build has two slots, both used, no custom naming, no
  third slot).
- **Prefix** — short per-fronter-dialer code prepended to `lead_id` for global
  uniqueness.
- **Correlation code** — `<prefix><lead_id>` (e.g. `A1803258`); the exact match
  key between VICIdial and the CRM.

### One-line summary of the whole design
> VICIdial keeps dialing. On transfer and on disposition it fires background URLs
> carrying a unique `prefix+lead_id` code; the CRM captures the pre-filled
> transfer, lets the fronter confirm, completes the sale, and routes the closer's
> disposition back to the right fronter — clash-proof, one-directional, mostly
> configuration, no new infrastructure.
