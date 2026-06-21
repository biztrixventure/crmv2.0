# VICIdial ↔ BizTrix CRM Integration

One‑directional integration: **VICIdial → CRM**. On a fronter transfer (XFER) the CRM
captures a *pending transfer*; on a closer disposition the CRM records the disposition
against the matching lead automatically. Nothing is written back to VICIdial.

---

## 1. How it works (read this first)

VICIdial fires a **Dispo Call URL** in the background whenever an agent dispositions a
call. The URL can contain substitution tokens. There are two kinds:

| Token type | Tokens | Fires on |
|---|---|---|
| **Session** (always present) | `--A--dispo--B--`, `--A--user--B--` | every disposition |
| **Lead/Call** (need a bound lead) | `--A--lead_id--B--`, `--A--phone_number--B--`, `--A--vendor_lead_code--B--` | **only lead‑bound calls** |

**Key fact:** the Dispo Call URL only carries lead data (lead_id / phone /
vendor_lead_code) when the call is **lead‑bound** — i.e. a real dialed/transferred
call. On a **manual dial with no lead**, those tokens resolve to empty and VICIdial
**does not fire the URL at all**.

> **Therefore the integration works on regular (lead‑bound) calls and transfers — NOT
> on manual test dials.** A manual dial that isn't attached to a lead will not reach the
> CRM. This is a VICIdial behavior, not a CRM limitation.

---

## 2. The CRM endpoints

All under `https://crm.vertexpakistan.com/api/vicidial/…`, protected by a shared token
(`?key=<INGEST_TOKEN>`). The token is set in the backend env var `VICIDIAL_INGEST_TOKEN`.

| Endpoint | Purpose |
|---|---|
| `POST/GET /fronter-xfer` | Fronter XFER → create a *pending transfer* (lead_id + phone) |
| `POST/GET /closer-dispo` | Closer disposition → match a lead → apply the mapped disposition |
| `GET /dispo-debug?key=…` | Last 20 closer‑dispo hits (for troubleshooting) |

> Note: the **Dispo Call URL** field takes a **plain `https://…` URL — do NOT prefix it
> with `VAR`.** `VAR` is only for the agent **Web Form** (the `add_lead` webform used in
> the different‑box case).

---

## 3. The URLs per campaign

Replace `<INGEST_TOKEN>` with the value of `VICIDIAL_INGEST_TOKEN`. Replace `{PREFIX}`
with the company's prefix from **Admin → VICIdial → Prefix registry** (different‑box only).

### Same VICIdial box (fronter + closer on one server)

The transfer keeps (or re‑creates) the lead on the same box, and the **customer phone is
identical** on both sides. There is **no vendor_lead_code** in this case.

**Fronter campaign → Dispo Call URL**
```
https://crm.vertexpakistan.com/api/vicidial/fronter-xfer?key=<INGEST_TOKEN>&code=--A--lead_id--B--&phone=--A--phone_number--B--&agent=--A--user--B--&dispo=--A--dispo--B--
```

**Closer campaign → Dispo Call URL**
```
https://crm.vertexpakistan.com/api/vicidial/closer-dispo?key=<INGEST_TOKEN>&alt_code=--A--lead_id--B--&phone=--A--phone_number--B--&dispo=--A--dispo--B--&agent=--A--user--B--
```

### Different VICIdial boxes (fronter and closer on separate servers)

The closer box assigns its **own** lead_id, so the fronter's id must ride across in
**`vendor_lead_code`**, set by the fronter webform.

**Fronter agent → Web Form (`add_lead`)** — add this parameter, pointed at the closer box:
```
&vendor_lead_code={PREFIX}--A--lead_id--B--
```

**Fronter campaign → Dispo Call URL**
```
https://crm.vertexpakistan.com/api/vicidial/fronter-xfer?key=<INGEST_TOKEN>&code={PREFIX}--A--lead_id--B--&phone=--A--phone_number--B--&agent=--A--user--B--&dispo=--A--dispo--B--
```

**Closer campaign → Dispo Call URL**
```
https://crm.vertexpakistan.com/api/vicidial/closer-dispo?key=<INGEST_TOKEN>&code=--A--vendor_lead_code--B--&alt_code=--A--lead_id--B--&phone=--A--phone_number--B--&dispo=--A--dispo--B--&agent=--A--user--B--
```

---

## 4. Matching logic

The CRM matches a closer disposition to a lead by trying, in order:

1. `code` → `transfers.vicidial_vendor_code` (different‑box: vendor_lead_code; same‑box: empty)
2. `alt_code` (lead_id) → `transfers.vicidial_vendor_code`
3. `phone` → `transfers.normalized_phone` (most recent)

| Box | Primary match | Safety net |
|---|---|---|
| **Same** | `lead_id` (only when the transfer keeps the same lead) | **phone** |
| **Different** | `vendor_lead_code` = `{PREFIX}{lead_id}` (identical on both URLs) | **phone** |

**Phone is the universal fallback** — identical on both sides, both topologies. When the
lead_id/vendor_lead_code path misses (common in same‑box, where the closer often gets a
different lead_id), the phone match catches it.

---

## 5. End‑to‑end flow

1. **Fronter dispositions `XFER`** → `fronter-xfer` fires → CRM creates a **pending
   transfer** holding only `lead_id` (correlation code) + phone. It appears in the
   fronter's CRM as a *"transfer from the dialer — confirm to send"* banner.
   - Only the disposition(s) configured under **Prefix registry → Transfer dispos**
     (e.g. `XFER`) create a pending transfer. All other fronter dispositions are ignored,
     so non‑transfer calls don't create noise.
2. **Fronter clicks Confirm** → the normal create‑transfer form opens (phone pre‑filled)
   → fronter fills the lead details → submit → it becomes a **real transfer** (and counts).
3. **Closer dispositions the transferred call** → `closer-dispo` fires → CRM matches the
   lead → records the mapped CRM disposition + **claims the closer** (so the fronter sees
   the closer's name, not "Unassigned"). This mirrors a manual CRM disposition exactly.
4. The disposition shows:
   - on the fronter's **pending banner** immediately (mapped name + closer name), and
   - as the **disposition pill** on the record **after the fronter confirms** the transfer.

---

## 6. Disposition mapping

VICIdial sends raw codes (`NI`, `N`, `A`, `SALE`, `CALLBK`…). The CRM maps each raw code
to a CRM disposition name in **Admin → VICIdial → Disposition map**.

- Use **🌐 Global (all companies)** to map a code once for every company (recommended —
  dialer codes are the same everywhere). A company‑specific row overrides the global.
- Any code the dialer sends that isn't mapped is **auto‑recorded** (with a hit count) in
  the same screen, so nothing is ever lost — the superadmin maps it later.
- Map every code you use, including `SALE`.

---

## 7. Setup checklist

1. Set `VICIDIAL_INGEST_TOKEN` in the backend env and restart the backend.
2. Apply migrations `096`–`099` in Supabase.
3. **Admin → VICIdial → Prefix registry**: add a prefix per fronter company; set
   **Transfer dispos = `XFER`** (or your transfer disposition).
4. **Agent mapping**: map every VICIdial agent id (`user`) → its CRM user. Disposition
   routing + closer claiming depend on this.
5. **Disposition map → 🌐 Global**: map every raw code → CRM disposition.
6. Paste the URLs (Section 3) into the matching campaigns.

---

## 8. Edge cases & how they're handled

| Scenario | Behaviour / Solution |
|---|---|
| **Manual dial (no lead) at the closer** | Lead tokens are empty → URL doesn't fire → CRM receives nothing. **Disposition that call manually in the CRM** (dropdown next to Sale). Auto‑capture only works on lead‑bound calls. |
| **Same‑box closer has a different lead_id than the fronter** | `alt_code` won't match `code`; the **phone** fallback matches the lead. No action needed. |
| **Same phone on multiple transfers (resell/repeat)** | Phone match attaches to the **most recent** transfer for that phone (normally the active one). |
| **Closer code not mapped** | Disposition is still recorded against the lead; the **pill** appears once the code is mapped (map it Global). The closer is still claimed. |
| **Agent id not mapped** | The disposition isn't routed (no closer resolved). **Map every closer agent.** |
| **Different‑box prefix mismatch** | The fronter URL/webform and the closer URL must produce the **identical** code. Keep the same `{PREFIX}` on all three. |
| **Closer dispositions before the fronter confirms** | The disposition is applied to the still‑pending transfer; it shows on the fronter's **pending banner** immediately and on the record once confirmed. |
| **Closer dispositions before the transfer exists (race)** | No lead to match → the disposition is **queued** in the closer's CRM ("dispositions from the dialer"); the closer assigns it to the lead with one click. |
| **Non‑transfer fronter disposition** | Ignored — only **Transfer dispos** (`XFER`) create a pending transfer, so the fronter's counts stay clean. |
| **Pending transfers inflating counts** | Pending‑from‑dialer transfers are hidden from all lists/counts until the fronter confirms. |

---

## 9. Troubleshooting

**See exactly what the dialer sent** (last 20 closer‑dispo hits):
```
https://crm.vertexpakistan.com/api/vicidial/dispo-debug?key=<INGEST_TOKEN>
```
Each entry shows `code`, `alt_code`, `phone`, `dispo`, `agent`, and the `outcome`
(matched transfer / queued / no match).

- **Entry present, `matched transfer …`** → working.
- **Entry present, `NO MATCH`** → the dialer sent a code/phone with no matching transfer
  (fronter‑xfer didn't run for that lead, or a prefix mismatch — the `hint` field shows
  near‑matches).
- **No entry for a call** → the URL never fired = the call wasn't lead‑bound (manual dial)
  → disposition it manually.

---

## 10. Summary

- Works automatically on **regular lead‑bound calls and transfers**; **not** on manual
  dials (VICIdial limitation — those don't fire the URL).
- **Same box:** fronter sends `lead_id`; closer matches by `lead_id` or **phone**. No
  vendor_lead_code.
- **Different box:** fronter webform + URL send `vendor_lead_code` (`{PREFIX}{lead_id}`);
  closer matches by `vendor_lead_code` or **phone**.
- **Phone is the universal safety net** in both topologies.
- The closer's dialer disposition mirrors a manual CRM disposition (mapped name + colored
  pill + closer claimed), visible on the pending banner immediately and on the record
  after the fronter confirms.
- Any call that doesn't reach the CRM is handled by **manual disposition** in the CRM —
  nothing is ever lost.
