# Status & Disposition Guide — BizTrix CRM

> The one missing guide. Read this and the "confusion" disappears. **Nothing in
> here changes behaviour** — it explains what already exists so every shell reads
> the same way.

## The #1 thing to understand: STATUS ≠ DISPOSITION

There are **two separate labels** on every sale. They look similar, which is why
it feels confusing — but they answer different questions:

| | **STATUS** | **DISPOSITION** |
|---|---|---|
| Answers | "Where is this in the **compliance pipeline**?" | "What did the **closer** mark the call as?" |
| Set by | Compliance / the workflow | The closer, at sale time |
| Field | `sales.status` | `sales.closer_disposition` |
| Example | `Open`, `Pending Review`, `Approved` | `Sale`, `Post Date` |

So a sale that says **"Open" + "Sale"** is **not** a contradiction. It means:
*the closer marked it a Sale* (disposition), and *it's still Open / not yet
approved by compliance* (status). Both are true at once — different questions.

---

## Sale STATUS — the compliance lifecycle (what's actually used)

Only these **6 are enabled**. This is the real pipeline:

```
        ┌─────────┐   closer submits   ┌─────────────────┐  compliance approves  ┌──────────┐
NEW ───▶ │  Open   │ ─────────────────▶ │ Pending Review  │ ────────────────────▶ │ Approved │  ✅ the win
        └─────────┘                    └─────────────────┘                       └──────────┘
                                              │  compliance bounces it back
                                              ▼
                                       ┌────────────────┐
                                       │ Needs Revision │ ──▶ (closer fixes, re-submits)
                                       └────────────────┘

  Any approved/active policy can later become ──▶ ┌───────────┐
                                                  │ Cancelled │  (policy cancelled)
                                                  └───────────┘
```

| Status key (`sales.status`) | Shows as | Meaning | Who sets it |
|---|---|---|---|
| `open` | **Open** | Closer is still working it / not submitted to compliance | Closer / default on create |
| `pending_review` | **Pending Review** | Submitted, waiting on compliance | Closer (submit) |
| `closed_won` | **Approved** | Compliance approved — this is a counted win | Compliance |
| `needs_revision` | **Needs Revision** | Compliance sent it back to fix | Compliance |
| `cancelled` | **Cancelled** | Policy cancelled | Compliance |

> **"Approved" = `closed_won`.** Same thing, two names. The screen shows
> **Approved**; the raw value / some exports show `closed_won`.

### The 8 DISABLED statuses (defined but OFF — ignore them)

These exist in the catalog but are **disabled** (`enabled: false`), so they
don't appear in the compliance dropdown and almost no sale uses them:

`sold`, `follow_up`, `closed_lost` (Lost), `compliance_cancelled`, `chargeback`,
`dispute`, `resold`, `expired`, `refunded`.

They're kept only so old/imported rows that carry one still render with a label.
**You can leave them off.** (Note: the status `sold` is *disabled* — don't
confuse it with the **disposition** "Sold" below.)

---

## Sale DISPOSITION — what the closer marked

| Disposition (`closer_disposition`) | Meaning | Special logic? |
|---|---|---|
| **Sale** | A normal sale was made | none |
| **Post Date** | Sale to be **charged on a future date** | **YES** — opens the charge-date flow (`isPostDateDispo`). The only disposition that changes behaviour. |
| **Sold** | Same as "Sale" — **legacy label from imported spreadsheets only** (the live CRM never writes "Sold") | none |
| **sale** (lowercase) | A one-off typo of "Sale" | none |

> **Sale = Sold = sale** — all three mean "a sale was made" and are treated
> **identically** by every calculation. They're just different spellings.
> Only **Post Date** drives different behaviour.

The **no-sale** outcomes (Not Interested, Callback, Can't Afford, No Answer, …)
are **transfer dispositions** (`transfers.latest_disposition`), not sale
dispositions — they live on the lead/transfer, set from the dialer or manually.

---

## Transfer STATUS (the lead side)

| Status | Shows as | Meaning |
|---|---|---|
| `pending` | Pending | Lead/transfer created, not yet worked to completion |
| `assigned` | Assigned | Assigned to a closer |
| `completed` | Completed | A sale was created from it |
| `rejected` | Rejected | Closer rejected the transfer |
| `cancelled` | Cancelled | Transfer cancelled |

---

## Where each appears (by shell)

| Shell | Sees STATUS | Sees DISPOSITION | Can change STATUS |
|---|---|---|---|
| **Staff** (closer/fronter) | their own sales' status | sets `closer_disposition` on create | submit → Pending Review only |
| **Manager** | company sales/transfers status | yes (read) | per permission |
| **Compliance** | **all** companies' status | yes (read) | **yes** — Approve / Needs Revision / Cancel |
| **Admin** | all + the **Business Rules → Compliance Statuses** catalog editor (enable/disable, label, badge, category) | — | edits the catalog itself |

The status catalog is **admin-configurable**:
`Admin → Business Rules → Compliance Status Rules` (writes
`compliance.status_catalog`). Transfer statuses:
`Admin → Business Rules → Transfer Status Rules` (`transfer.status_catalog`).

---

## Why it felt confusing (and the simple mental model)

1. **Two labels per sale** (status + disposition) that look alike → remember:
   *status = compliance stage, disposition = closer's call result.*
2. **"Approved" vs `closed_won`** are the same.
3. **"Sale" / "Sold" / "sale"** are the same (Sold = old import label).
4. **14 statuses in the catalog but only 6 are on** — the other 8 are off-by-design.

**Simple version to tell the team:**
> A sale moves **Open → Pending Review → Approved** (or → Needs Revision → back).
> "Approved" is the win. The closer's tag (Sale / Post Date) is separate from
> that pipeline. Everything else in the list is turned off.
