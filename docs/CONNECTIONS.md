# Connections: connecting another app to the CRM

Any app with an HTTP client can connect to the CRM in two ways. The HRMS
(hr.vertexpakistan.com), the QA platform (qa.vertexpakistan.com), a BI tool and
a cron script all connect the same way.

- **Pull**: the app calls the machine API at `/api/ext/v1` with an API key.
- **Push**: the CRM POSTs signed events (a sale approved, a new transfer, ...)
  to a webhook URL in the other app.

Other apps can also **push numbers in** (QA scores, attendance hours, ...) with
`POST /api/ext/v1/metrics`.

Nothing in the CRM changes for its users until a superadmin sets something up.
Two per-company switches can also replace the CRM's own HR and QA navigation
with a link to the external app (see [The two switches](#the-two-switches)).

---

## 0. One-time setup: migration 348

Apply `backend/migrations/348_connections.sql` in the Supabase SQL editor. It
is idempotent and registers itself in `schema_migrations`. It creates
`integration_keys`, `integration_webhooks`, `integration_deliveries`,
`integration_cursors` and `external_metrics`. All of them are service-role
only. It also adds the `external_hr` and `external_qa` feature flags, which are
OFF.

Before the migration is applied:

| Part | What happens |
|---|---|
| `/api/ext/v1/*` | `503 {"error":"Connections are not set up yet: run migration 348"}` |
| Admin → Connections | A banner tells you to run migration 348. The Keys and Webhooks tabs stay empty. |
| Webhook job | Logs one warning, then does nothing every 30 s |
| HR / QA navigation | Unchanged. The flags do not exist yet, and a missing flag reads as OFF. |

Optional server env:

| Variable | Default | Meaning |
|---|---|---|
| `HR_APP_URL` | `https://hr.vertexpakistan.com` | Where the HR link goes when `external_hr` is on |
| `QA_APP_URL` | `https://qa.vertexpakistan.com` | Where the QA link goes when `external_qa` is on |
| `EXT_API_RATE_PER_MIN` | `600` | Requests per minute per API key |
| `WEBHOOK_DISPATCH_SECONDS` | `30` | Webhook job interval. Set `0` to turn it off. |

If `GEO_GATE_ENABLED=true`, add `/api/ext` to `GEO_EXEMPT_PREFIXES` when the
other app's server is outside the allowed countries. The machine API does not
use the per-user IP access rules, because those apply to people.

---

## 1. Create an API key

Go to **Admin → System → Connections → API keys → New API key**. Then:

1. Name the key after the app that will use it.
2. Tick only the scopes the app needs.
3. Choose **All companies**, or tick specific companies.
4. Copy the key (`crm_` + 43 characters). The CRM shows it **once** and stores
   only its SHA-256. If the key is lost, revoke it and create a new one.
   Revoking takes effect immediately.

Every request sends the key in the `Authorization` header:

```
Authorization: Bearer crm_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Scopes

| Scope | Grants |
|---|---|
| `companies.read` | `GET /companies` |
| `agents.read` | `GET /agents`: people, their VICIdial users and company memberships |
| `sales.read` | `GET /sales`, without customer contact details |
| `sales.read_pii` | Adds `customer_name` and `customer_phone` to `/sales` rows. Also needs `sales.read`. |
| `transfers.read` | `GET /transfers`, without form data |
| `transfers.read_pii` | Adds `form_data` (the customer details) to `/transfers` rows. Also needs `transfers.read`. |
| `metrics.write` | `POST /metrics` |

A key limited to some companies only ever sees those companies.
`?company=<other id>` answers 403.

### Errors

| Status | Meaning |
|---|---|
| 400 | Bad parameter. `error` says which one. |
| 401 | Missing, malformed, unknown or revoked key |
| 403 | The key lacks the scope (`needed` names it), or the company is outside the key's companies |
| 429 | Rate limit. Wait for `Retry-After` seconds. |
| 503 | Migration 348 not applied, or the database is unreachable |

---

## 2. The machine API: `https://<crm-host>/api/ext/v1`

### Paging and filters

Every list answers:

```json
{ "data": [ ... ], "has_more": true, "next_cursor": "eyJjIjoiY3JlYXRlZF9hdCIs..." }
```

- `limit`: 1 to 1000 rows per page. The default is 100.
- `cursor`: pass the previous page's `next_cursor`. Cursor paging stays
  correct while new rows are being written. Prefer it.
- `offset`: plain offset paging. The response then also has `next_offset`.
- `company=<uuid>[,<uuid>]`: narrow to some companies.
- `from` / `to`: `YYYY-MM-DD` or an ISO timestamp. On `/sales` they filter
  `sale_date`. On `/transfers` they filter `created_at` (UTC; a bare `to` day
  includes the whole day).
- `updated_since=<ISO>`: only rows updated since then, ordered by `updated_at`.
  Use it for incremental sync: save the newest `updated_at` you saw and pass it
  next time.

People are given as `{ "user_id", "vicidial_agent_ids": ["ABC123"] }`.
VICIdial users are uppercase. They are how the HRMS and the QA platform
identify a person.

### `GET /me`: test the connection (no scope needed)

```bash
curl -s https://crm.example.com/api/ext/v1/me -H "Authorization: Bearer $CRM_KEY"
```

```json
{
  "id": "8f0c...", "name": "HRMS", "key_prefix": "crm_Ab3x",
  "scopes": ["sales.read", "agents.read"],
  "companies": [{ "id": "c1...", "name": "Vertex Closers", "slug": "vc" }],
  "all_companies": false
}
```

`companies` is `null` when `all_companies` is true.

### `GET /companies` (`companies.read`)

```bash
curl -s "https://crm.example.com/api/ext/v1/companies" -H "Authorization: Bearer $CRM_KEY"
```

```json
{
  "data": [
    { "id": "c1...", "name": "Vertex Closers", "slug": "vc", "company_type": "closer", "is_active": true }
  ],
  "has_more": false, "next_offset": null, "next_cursor": null
}
```

### `GET /agents` (`agents.read`)

Returns everyone with a membership in a company the key can read.
`?include=email` adds the login email. That costs one auth lookup per person,
so `limit` is capped at 200 with it.

```bash
curl -s "https://crm.example.com/api/ext/v1/agents?limit=500" -H "Authorization: Bearer $CRM_KEY"
```

```json
{
  "data": [
    {
      "user_id": "u1...", "name": "Ali Khan", "first_name": "Ali", "last_name": "Khan",
      "vicidial_agent_ids": ["ALI01", "ALI02"],
      "companies": [
        { "company_id": "c1...", "company_name": "Vertex Closers", "role": "Closer", "role_level": "closer", "is_active": true }
      ],
      "is_active": true
    }
  ],
  "has_more": false, "next_cursor": null
}
```

### `GET /sales` (`sales.read`)

Extra filter: `status=closed_won[,cancelled,...]`.

```bash
curl -s "https://crm.example.com/api/ext/v1/sales?from=2026-11-01&to=2026-11-30&status=closed_won&limit=1000" \
  -H "Authorization: Bearer $CRM_KEY"
```

```json
{
  "data": [
    {
      "id": "s1...",
      "company": { "id": "c1...", "name": "Vertex Closers", "slug": "vc" },
      "status": "closed_won",
      "sale_date": "2026-11-04",
      "created_at": "2026-11-04T15:02:11.12+00:00",
      "updated_at": "2026-11-05T09:30:00+00:00",
      "reference_no": "VC-10442",
      "client_name": "AutoShield",
      "plan": "Gold 60",
      "down_payment": 199, "monthly_payment": 129,
      "closer":  { "user_id": "u1...", "vicidial_agent_ids": ["ALI01"] },
      "fronter": { "user_id": "u7...", "vicidial_agent_ids": ["SARA3"] },
      "vicidial_agent": "ALI01",
      "transfer_id": "t1...",
      "compliance_reviewed_at": "2026-11-05T09:30:00+00:00",
      "cancellation_date": null, "cancellation_reason_key": null,
      "chargeback_date": null, "chargeback_amount": null,
      "superseded_at": null
    }
  ],
  "has_more": true,
  "next_cursor": "eyJjIjoiY3JlYXRlZF9hdCIsInYiOiIyMDI2LTExLTA0VDE1OjAyOjExLjEyKzAwOjAwIiwiaWQiOiJzMS4uLiJ9"
}
```

With `sales.read_pii`, each row also has `customer_name` and `customer_phone`.
Address, email and VIN are never returned.

### `GET /transfers` (`transfers.read`)

```bash
curl -s "https://crm.example.com/api/ext/v1/transfers?updated_since=2026-11-06T00:00:00Z" \
  -H "Authorization: Bearer $CRM_KEY"
```

```json
{
  "data": [
    {
      "id": "t1...",
      "company": { "id": "c2...", "name": "Vertex Fronters", "slug": "vf" },
      "status": "completed",
      "created_at": "2026-11-06T10:01:00+00:00",
      "updated_at": "2026-11-06T10:20:00+00:00",
      "created_by": { "user_id": "u7...", "vicidial_agent_ids": ["SARA3"] },
      "vicidial_agent": "SARA3",
      "vicidial_vendor_code": "1029384",
      "latest_disposition": "SALE"
    }
  ],
  "has_more": false, "next_cursor": null
}
```

With `transfers.read_pii`, each row also has `form_data`.

### `POST /metrics` (`metrics.write`)

Push numbers per VICIdial agent and period. A period is `YYYY-MM` or
`YYYY-MM-DD`. Rows upsert on (source, agent, metric, period): send a period
again and its rows are replaced. At most 5000 items per call. `agent` matching
ignores case.

```bash
curl -s -X POST https://crm.example.com/api/ext/v1/metrics \
  -H "Authorization: Bearer $CRM_KEY" -H "Content-Type: application/json" \
  -d '{
    "source": "qa",
    "items": [
      { "agent": "ali01", "metric": "qa_score",  "period": "2026-11",    "value": 87.5, "unit": "%" },
      { "agent": "SARA3", "metric": "hours",     "period": "2026-11-05", "value": 7.75, "unit": "h",
        "details": { "late_minutes": 12 } }
    ]
  }'
```

```json
{ "received": 2, "saved": 2, "unknown": [] }
```

- `unknown`: agents no CRM profile carries. Their rows are still saved with
  `user_id: null`, and they link up once someone adds that VICIdial user to a
  profile.
- `rejected` (only when not empty): agents who are real CRM people but sit
  outside this key's companies. Their rows are not saved.
- `errors` (only when not empty): `[{ "index", "error" }]` for malformed items.
  The other items are still saved.

The CRM stores these numbers in `external_metrics`. It does not show them on
any screen yet.

---

## 3. Webhooks: the CRM tells your app

Go to **Admin → Connections → Webhooks → New webhook**. Enter the URL, pick
events and limit companies if needed. Copy the **signing secret**
(`whsec_...`). The CRM shows it once. Use **New secret** to rotate it.

- **Test** sends a `ping` immediately and shows the HTTP result.
- **Deliveries** lists the last 50 deliveries with their status.

### Events

| Event | When |
|---|---|
| `sale.sold` | A sale is created. Resold sales come as `sale.renewed` or `sale.replaced`. |
| `sale.submitted` | Sent to compliance (`pending_review`) |
| `sale.approved` | Compliance approved it (`closed_won`) |
| `sale.returned` | Sent back for revision |
| `sale.cancelled` | Cancelled, or a cancellation date was set |
| `sale.chargeback` | Chargeback recorded |
| `sale.reinstated`, `sale.superseded`, `sale.expired`, `sale.lost`, `sale.resold`, `sale.charged`, `sale.post_dated`, `sale.dispute`, `sale.refunded`, `sale.note`, `sale.renewed`, `sale.replaced` | The other policy lifecycle events (`policy_events`, mig 087) |
| `transfer.created` | A new transfer |
| `ping` | Test button only |

A subscription can be `*` (everything, including events added later), a group
such as `sale.*` or `transfer.*`, or exact event names.

### What arrives

```
POST <your url>
Content-Type: application/json
x-crm-event: sale.approved
x-crm-delivery: 5b0e...            (outbox row id; the same id on every retry)
x-crm-timestamp: 1762430400        (unix seconds)
x-crm-signature: 3f9a...           (hex HMAC-SHA256)
```

```json
{
  "id": "pe_0c4f...",
  "event": "sale.approved",
  "at": "2026-11-05T09:30:00+00:00",
  "sale": { "...": "same shape as a GET /sales row" }
}
```

A `transfer.created` event has `"transfer": { ...GET /transfers row... }`
instead of `"sale"`.

- `id` is stable per event: `pe_<policy event id>` or `tr_<transfer id>`.
  Delivery is **at least once**, so deduplicate on `id`.
- `sale` is the sale **as it is when the event is sent**, not a snapshot from
  the moment of the event. Treat it as "this record changed; here it is now".
- Events start from the moment the job first runs. No history is replayed. To
  backfill, page `GET /sales` once.
- Events usually arrive within about 45 seconds: a 30 s tick plus a 15 s
  safety lag for late commits.

### Verify the signature (Node)

Sign the **raw** body. Re-serialising parsed JSON changes the bytes, and the
check then fails.

```js
const crypto = require('crypto');
const express = require('express');
const app = express();

app.post('/crm-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.CRM_WEBHOOK_SECRET;          // whsec_...
  const ts = req.get('x-crm-timestamp');
  const sig = req.get('x-crm-signature') || '';
  const raw = req.body.toString('utf8');

  // Reject replays older than 5 minutes.
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return res.sendStatus(400);

  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  const ok = sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) return res.sendStatus(401);

  const event = JSON.parse(raw);
  // ...dedupe on event.id, then handle event.event...
  res.sendStatus(204);                                     // any 2xx = delivered
});
```

### Retries

- Any 2xx response means delivered.
- Anything else counts as a failure: another status, a redirect, a network
  error, or no answer within **10 s**.
- After a failure the CRM retries after **1 min, 5 min, 30 min, 2 h, 6 h,
  12 h**, about 21 hours in total, then gives up on that delivery.
- **Retry now** in Deliveries sends a failed delivery again.
- Up to 4 deliveries go out in parallel.
- Switching a webhook off pauses its queue. Switching it back on resumes the
  queue.
- Deliveries are deleted after 14 days.

---

## The two switches

There are two feature flags, both OFF by default. Set them per company under
**Admin → Connections → External modules**, or in **Admin → Feature Flags**.

| Flag | When ON for a company |
|---|---|
| `external_hr` | The CRM's HR entries (the header "HR" module link and the **My HR** tab in the Staff, Manager and Compliance shells) become one **HR** link. The link opens `HR_APP_URL` in a new tab. |
| `external_qa` | The CRM's QA entries (**QA Department** in the Compliance shell and **QA Scores** in the Staff shell) become one **QA** link. The link opens `QA_APP_URL` in a new tab. |

With a flag OFF, the CRM looks exactly as before. With a flag ON, nothing is
deleted: the `/hr`, `/qa` and `/qa2` pages, their routes and their data stay.
Turn the flag off and the old entries come back.

The superadmin panel follows the same flags for the superadmin's own account.
A superadmin has no company, so the panel only changes when a per-user
override is set.
