# Connecting a dialer that is not VICIdial

*Written for: whoever wires CallTools (or the next dialer) up to BizTrix CRM — operator steps first, then what happens underneath.*

The CRM grew around VICIdial. CallTools does not speak VICIdial's language: it
posts JSON, names its agents differently, and hands the recording over as a URL
instead of a lead id on a box. So "the dialer" is now a row in
`dialer_accounts` (migration 320), and anything that can send an HTTP request
can be that row.

**Nothing about VICIdial changes.** The existing boxes keep `/api/vicidial/*`,
`VICIDIAL_INGEST_TOKEN` and their own admin screen.

---

## 1. Before you start

Apply `backend/migrations/320_dialer_providers.sql` in the Supabase SQL editor.
(The backend is safe to deploy before it is applied — it degrades to "no
connected dialers" and logs a warning rather than failing.)

In the dialer, get:

* an **API token** (CallTools: manager dashboard → API), and
* the ability to fire a **webhook / automation** on a call or disposition event.

## 2. Create the connection

**Admin → Dialers → Connections → Connect a dialer.**

| Field | What it does |
|---|---|
| Dialer | Picks the starting preset. CallTools, VICIdial-as-an-account, or Generic. |
| Name | Yours. Shown in the event log. |
| Company | Leave on *Resolve from the agent* unless every call from this dialer belongs to one company. |
| Lead-code prefix | Makes this dialer's lead ids unique across the estate — lead `88421` becomes `CT88421`. **Set this.** Two dialers both numbering leads from 1 would otherwise collide on the same transfer. |
| API base URL + token | Only needed to fetch recordings the webhook did not carry. |
| Signing secret | Optional. Once set, an unsigned webhook is **refused**. |
| Transfer dispositions | The dispositions that mean "this call was transferred". Only these create a transfer. |
| Default leg | `fronter` for the fronter campaign, `closer` for the closer campaign. |

Save, then copy the **webhook URL**:

```
https://<your-crm>/api/dialer/hook/<token>
```

That URL *is* the credential — anyone holding it can post calls. Rotate it from
the same row if it leaks; the old URL dies immediately.

## 2b. Let the CRM wire the dialer up (CallTools)

**Admin → Dialers → Wiring.** For a provider with an admin API the CRM does the
whole job, so you never copy ids between two panels:

* it reads **the dialer's own disposition list** — tick the ones that mean
  *transferred* (no typing, so "XFER Transferred" can never be configured
  against "XFER Transfered");
* it creates or repairs **one automation + one webhook + the link between
  them**, never a second copy (two automations on one disposition post every
  transfer twice);
* **Dry run is on by default** — the dialer fires, the CRM logs it, nothing is
  written. Going live asks first and names the dispositions involved;
* it writes the chosen dispositions to **both sides at once** — they are what
  the CRM's XFER gate tests, so one set in the dialer and not in the CRM would
  arrive and be filed as an ordinary call;
* **Pause/Resume** stops the automation in the dialer without tearing anything
  down.

The tab also shows what is wired *right now* (automation id, webhook id,
dry-run or live, paused or active), read back from the dialer rather than from
what the CRM last intended.

Other providers keep the manual steps below.

## 3. Point the dialer at it, and fire ONE call

Configure the URL as the dialer's webhook target. While testing, add `?dry=1`:
the call is mapped and logged and **nothing is written**.

Then open **Events**. Every hit is there — the raw payload, what the mapping
made of it, and what the CRM did. It is there even if the mapping failed, which
is the whole point.

`GET /api/dialer/hook/<token>/ping` answers from a browser or from the dialer
host and proves the URL, the token and the network path in one go.

## 4. Finish the mapping

**Mapping** tab. Left: what the CRM needs. Right: every key the dialer really
sent, with example values. Click a CRM field, then click the key that feeds it.

Three fields matter: **Agent id**, **Customer phone**, **Disposition**. Everything
else improves the record.

Transforms handle the usual mismatches — `phone10` (strip formatting to 10
digits), `seconds` (milliseconds → seconds when the number is clearly ms), `iso`
(a zoneless UTC datetime like `2026-09-21 14:03:11`, which must **not** be read
as server-local), `upper`, `digits`, `first_word` / `last_words` for a full name
in one field.

Press **Test it** — it writes nothing and answers in plain words:

> Creates a PENDING TRANSFER for the fronter mapped to agent "ct1001"

When a call landed before the mapping was right, open it in Events and press
**Replay**; the transfer engine's own dedup rules stop a replay double-counting
anything that already worked.

## 5. Map the agents

**Agents** tab → **Pull the roster**. The CRM reads the dialer's own user list
and *suggests* who each login is — from the VICIdial id already on their
profile, or an exact name match — and links them all on one press. Suggested,
never silent: crediting a transfer to the wrong person is worse than leaving it
unmapped, where it at least shows up as a problem.

Both spellings of an id are linked, because the webhook sends the provider's
internal id (CallTools sends `app_user`, a UUID) while a human reads the
username.

The tab also lists ids that have actually arrived in the last 7 days but are
still unmapped. A call from an unmapped agent is logged and goes no further,
because the CRM has nobody to credit the transfer to.

VICIdial agents stay where they are (User Control Center → VICIdial). This list
is per connection, so two dialers can both have an agent called `1001`.

## 6. The closer side

Point the closer campaign at the **same URL** and set its leg to `closer` (or add
a leg rule matching the campaign name). Its dispositions land on the transfer the
fronter created — matched on the lead code, then on the customer's number, and
queued for the closer to attach by hand if neither matches.

## 7. Recordings and QA

* Webhook carries a recording URL → QA has the audio immediately.
* It does not → the row stays `pending` and the recording poller asks the
  dialer's API by call id (needs the base URL + token), then attaches it.
* Playback goes through the existing QA proxy, which adds the account's token
  server-side. The token never reaches the browser.

Provider clips are filed under `box_id = '<provider>:<account-id-prefix>'`, so
one recording still belongs to exactly one call row, and they never collide with
a real VICIdial box id.

## 8. Reading it back: which dialer did this come from?

Every record that came from a dialer carries `dialer_provider` +
`dialer_account_id`, and the UI shows it as a badge — on the transfer drawer
(always, spelled out) and in the compliance list (only when it is *not* the
usual VICIdial, so a badge means "look twice" instead of decorating every
historical row).

The badge reads `/api/dialers/labels`, which returns id, name and provider and
nothing else, so a closer or a QA reviewer sees the source without being a
superadmin. The **account name** wins over the provider name: two CallTools
tenants are two different floors, and "CallTools" on both would answer the
wrong question.

---

## What happens underneath

```
dialer ──POST──► /api/dialer/hook/:token
                    │  identify the account (token), check the signature
                    ▼
              normalize.js   payload ──► canonical call (field_map + rules)
                    │
                    ▼
               bridge.js  ──► the SAME handlers VICIdial calls go through
                              fronterXferHandler / closerDispoHandler
                              + the QA v2 ingest hook
                    │
                    ▼
        transfers · disposition_actions · qa2_call · dialer_webhook_events
```

**The engine is not duplicated.** A CallTools transfer goes through the same
2-minute duplicate window, the same recycled-lead `xfer_seq` rule (migration
291), the same merge with a hand-entered transfer, the same `stripBlank` rule (a
blank from a dialer means "no news", never "clear this field"), the same guard
that stops a fronter being stamped as the closer of their own transfer, and the
same queued-disposition reconcile. A second implementation would relearn every
one of those bugs.

### Why the webhook almost always answers 200

A dialer that receives a 4xx/5xx retries, often forever, and a half-finished
mapping would then be hammered by every agent on the floor. An unusable event is
**recorded with its reason** and answered 200. Only two things are refused: an
unknown token (404) and a failed signature (401) — retrying neither of those can
help.

### Files

| Path | Role |
|---|---|
| `backend/migrations/320_dialer_providers.sql` | accounts, agent links, event log, `dialer_*` columns |
| `backend/utils/dialers/mapping.js` | path/transform/template engine |
| `backend/utils/dialers/providers.js` | canonical field catalog + per-dialer presets |
| `backend/utils/dialers/normalize.js` | payload → canonical call (leg, event type, code) |
| `backend/utils/dialers/bridge.js` | runs the existing ingest handlers in-process |
| `backend/utils/dialers/accounts.js` | account cache, signature check, secret masking |
| `backend/utils/dialers/client.js` | outbound calls to the dialer's API |
| `backend/routes/dialerHooks.js` | the public webhook |
| `backend/routes/dialerAdmin.js` | superadmin API behind the Dialers tab |
| `frontend/src/components/Admin/Dialers/DialerHub.jsx` | the screen |
| `backend/utils/dialers/dialers.test.js` | the rules, pinned |

### Retention

Raw payloads hold customer names and numbers, so `dialer_webhook_events` is
pruned after 14 days by `fn_prune_dialer_events`, run 6-hourly from the
scheduler.
