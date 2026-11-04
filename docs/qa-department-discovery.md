# QA Department — Discovery & Architecture Report

Read-only investigation ahead of building a QA (Quality Assurance) system to replace the
manual Google-Sheets call review. **Nothing was changed.** This maps the existing
landscape against the corrected model:

- **TRA** = full-coverage review — *every transferred call* is listened to + scored
  (fronter-side quality).
- **RCM** = Random Call Monitoring — a *sampled subset* spot-checked (fronters, closers,
  or both, per company).
- Every company has **some** QA need. Some want TRA only; some want TRA + RCM covering
  closers too. One QA user may cover **2+ companies**.

File references are the source of truth. `path:line` links are clickable.

---

## TL;DR — recommendations up front

1. **Make the review *method* a first-class concept.** compliance / TRA / RCM are three
   siblings that share *infrastructure* (recording resolution, listening UI, audit) but
   have **different population/query shapes**. Do **not** overload the compliance
   `app_recording_review_queue` — it is sale-linked and confirmation-shaped, wrong for
   both TRA and RCM.
2. **Build a thin QA layer, reuse the heavy machinery.** New: `qa_assignments` (worklist,
   one row per call-to-review, tagged method + sampled), `qa_reviews` + `qa_review_scores`
   (rubric results). Reuse as-is: `dialerBoxes.js` recording resolution, the
   candidate-listening UI, `business_config`, `notificationService`, `utils/scheduler.js`
   cron.
3. **Rubric from day one, data-driven.** A weighted-criteria scorecard that *degrades* to
   pass/fail (one criterion) — not a hardcoded pass/fail you'd have to migrate later.
4. **Per-company config in `business_config`** using the existing `scope='company:<uuid>'`
   resolver (company → global → default), **not** company-id-in-the-key.
5. **RCM sampling is new** (nothing samples today except a JS array shuffle). Materialize
   the sample via a scheduled job + `ORDER BY random()` into `qa_assignments` so the
   sample is *frozen* and the worklist/reporting surface is identical for TRA and RCM.

---

## 1. Company structure — what scoping QA actually needs

### 1.1 Companies / entities
- `companies` table. Columns of interest: `company_type` ∈ {`fronter`,`closer`}
  (mig `010_company_types_links.sql`), `is_active`, `is_closer_pool`
  (mig `008a`), `slug`, theme/logo.
- Fronter↔closer wiring via `company_links` (`fronter_company_id ↔ closer_company_id`).
- **Live enumeration not available from this checkout** (no `.env`; prod creds live on
  Coolify). Run this to list them:
  ```sql
  select name, company_type, is_active, is_closer_pool
  from companies order by company_type, name;
  ```

### 1.2 Is there any per-company QA config today?
**No.** `grep` for `qa_` / `quality_assurance` → zero. `business_config` (mig 068) holds
resell/dedup/kpi/status-catalog keys but **nothing QA**. This needs a **new config from
scratch** — see §6.3 for the proposed shape. Good news: the mechanism already exists
(`business_config`, per-company override resolver), so it's config *values*, not new infra.

### 1.3 Cross-company QA scope — already supported
**A user can already span multiple companies.** `user_company_roles` is one row per
(user, company, role); [`getUserCompanies()`](backend/models/helpers.js#L180) returns
*all* active companies for a user, and [`isSuperAdmin()`](backend/models/helpers.js#L247)
already iterates the plural set. So "one QA person covers 2 companies" = give them a QA
role row in each company. **No new membership/scoping logic** — a QA queue just needs to
accept `p_company_ids uuid[]` (exactly what the compliance queue already does).
Caveat: **role is per-company** (`custom_roles.level` is resolved per company row), so a
QA user needs the qa role assigned in *each* company they cover.

### 1.4 TRA's data source — "every transferred call"
The population is the **`transfers`** table (one row per transfer). Relevant columns
(migs `007`, `048`, `100`): `created_by` (fronter), `assigned_closer_id`, `company_id`
(fronter company), `status` (catalog: pending/assigned/completed/rejected/cancelled, mig
073), `latest_disposition` (mig 100), `vicidial_vendor_code` (prefix+lead_id → the recording
key), `normalized_phone` (mig 048).
- **"100% coverage" as a query** = every `transfers` row in the company scope, optionally
  filtered by status/date. Whether TRA should include *rejected/cancelled* transfers or
  only those that reached the closer is a **policy choice** → expose it as
  `qa.tra.population` config (default: all).
- **TRA reviews the FRONTER's leg.** `dialerBoxes.js` can isolate it: the lead_id lookup
  returns *every* leg (fronter + closer + redials); scoring the fronter means picking the
  fronter's leg (the non-closer-agent leg, or the XFER-adjacent one). This is the inverse
  of `findSaleRecording`, which deliberately *drops* the fronter leg to keep only the
  closer's — see §2.3.

### 1.5 RCM's sampling need
- **No existing random-sampling pattern in SQL.** `grep TABLESAMPLE|random()` → nothing.
  The only randomness is JS: [`shuffleInPlace()`](backend/routes/distributionBatches.js#L247)
  (Fisher-Yates) for batch distribution, and token/id generators. **Sampling is new.**
- **What RCM samples from:** the same `transfers` population as TRA when covering fronters,
  **plus closer-side calls** when a company opts into closer coverage. Closer calls are
  reachable two ways: (a) `sales` rows (closer-linked, already the compliance queue's
  population), or (b) directly from the dialer by the closer's `vicidial_agent_ids` + date.
  For RCM "closer" coverage, sampling from **transfers that converted / the closer's
  dialer legs** is the realistic source (a sale isn't required to review a closer call, but
  sale-linked rows are the cleanest handle).

---

## 2. Existing patterns to reuse

### 2.1 The compliance recording-review workflow (closest structural template)
- **Queue RPC** `app_recording_review_queue` (migs 150 → 151 → … → 166). Shape:
  `FROM sales s JOIN transfers t … WHERE NOT EXISTS (confirmation)` — i.e. **sale-linked,
  "give me everything unconfirmed."** Filters: company_ids[], date range, closer, status,
  free-text search; page-1 window count.
- **Route** [`compliance.js`](backend/routes/compliance.js): `GET /recordings/candidates`
  (L122) → `POST /recordings/confirm` (L204, writes `sale_recording_confirmations`, supports
  group-apply to sibling cars) → `DELETE /recordings/confirm/:saleId` (L273) →
  `GET /recordings/stream` (L352) → `GET /recordings/queue` (L383).
- **Confirmation store** `sale_recording_confirmations` (mig 150): lightweight *reference*
  to a dialer recording (box/lead/recording_id + duration/agent), **never audio**. Portal
  re-streams live.

**Recommendation — extend or parallel?** *Parallel table, shared library.* Reasoning:
- Compliance's model is **confirmation** (attach the right recording), not **scoring**.
  TRA/RCM produce a *scorecard*, a different artifact.
- The **query shapes genuinely differ**: compliance/TRA = "everything unreviewed"
  (anti-join), RCM = "a frozen random N." One RPC with a `p_method` discriminator would
  become a tangle of conditional population logic.
- But the *recording resolution, candidate listing, streaming, and audit* are identical
  needs → **reuse them as a shared library**, don't fork.
- So: **`qa_assignments`** (worklist) + **`qa_reviews`** (result) as new tables; the
  compliance queue stays untouched. Both feed the *same* listening UI.

### 2.2 Listening / candidate UI — directly reusable
`RecordingReviewTab.jsx` (compliance) already: lists queue rows, opens a candidate list,
plays each candidate, confirms/rejects, shows an audit trail. The **candidate-listening
panel is directly reusable** for QA — only the surrounding queue query + the
"confirm" action (→ "score") change. Portal player UX (the multi-clip inline expand we
just shipped in `ClientPortal.jsx`) is also a reuse reference for multi-leg playback.

### 2.3 Recording resolution — can it find a fronter-only call? **Yes, already.**
[`dialerBoxes.js`](backend/utils/dialerBoxes.js) has the pieces:
- `listCandidatesByLeadId(leadId)` (L352) — **every leg on the lead across all boxes,
  no agent mapping, no sale required.** This is exactly what TRA needs for a transfer that
  never converted: the transfer carries `vicidial_vendor_code` = prefix+lead_id → all legs,
  including the **fronter's**.
- `listCandidatesByPhone({phone, dateFrom, dateTo})` (L321) — phone-based fallback.
- `findSaleRecording()` (L205) deliberately **drops the fronter leg** (agent-scoped to the
  closer). For TRA you want the opposite selection — same data, different pick.
- **Gap, precisely stated:** resolution is *not* the gap. **Queue population is.** The
  existing queue only surfaces **sale-linked** calls; a transfer with **no sale** (didn't
  convert, or fronter-only) never appears. TRA needs a population built from `transfers`,
  not `sales`. The recording for those transfers *is* resolvable via
  `listCandidatesByLeadId`.

### 2.4 Existing scoring / rubric concept
- **`call_reviews`** (mig `008a_closer_pool_reviews.sql`) already exists: reviews a
  **transfer** (`transfer_id`), `rating` ∈ {excellent,good,average,below_average,bad} +
  notes, scoped to the fronter `company_id`. Plus `call_dispositions`. Route:
  [`reviews.js`](backend/routes/reviews.js) — `POST /transfer/:id/review`,
  `POST /transfer/:id/dispo`, `GET /`, `GET /dispositions`. Permissions:
  `submit_call_review`, `view_call_reviews`, `view_all_call_reviews`.
- **This is a TRA-shaped precedent** (review the fronter's transfer, rate it) — but it's
  **single-dimension rating**, built for the "closer pool" peer-review case, and narrow.
  Reuse the *idea* (review keyed on transfer, company-scoped, rating enum); replace the
  single rating with a **rubric** (§4). No weighted/criteria/scorecard concept exists
  anywhere else.

### 2.5 ROLE_HIERARCHY — room for qa roles?
[`ROLE_HIERARCHY`](backend/models/helpers.js#L9) is a fixed code map,
`superadmin(0) … fronter(6)`, **no qa tier.** `custom_roles.level` is a **Postgres enum**
(hence the `r.level::text` cast seen in perm migrations). Adding `qa_manager` / `qa_agent`
requires **all three**:
1. `ALTER TYPE … ADD VALUE 'qa_manager'` / `'qa_agent'` (enum extension migration),
2. add them to the `ROLE_HIERARCHY` map (suggest `compliance_manager`-level 4 for
   qa_manager, `closer`-level 5 for qa_agent),
3. add them to [`getCompanyTypeLevels()`](backend/models/helpers.js#L295) so they're
   assignable per company type.
Then seed `role_permissions` for new `qa_*` permission keys (mirrors mig 133's pattern).

---

## 3. Task assignment

- **`distribution_batches`** (mig 153) is the closest assignment engine: a batch has
  `sent_to_user_id` (assign to a user), parent→child lineage, cascading soft-delete,
  and items with a work-status lifecycle (`new/called/callback/completed/skip/transferred`).
  **But its unit is a normalized phone number**, and its semantics are "leads to *call*,"
  not "calls to *review*." Reusing the table directly would overload its meaning.
- **Recommendation:** a **dedicated `qa_assignments`** modeled *on* the batch pattern
  (assignee = `qa_agent_id`, item = a transfer_id/recording reference, status =
  `pending/in_review/scored/skipped`, plus `method` + `sampled` flags). This gives TRA and
  RCM one uniform worklist while keeping distribution_batches' phone-centric meaning intact.
- No other generic ticket/task-queue exists (the compliance queue is computed, not an
  assignment table; `internal_email` mig 164 is messaging, not tasks). So QA assignment is
  new, but the *shape* is proven by distribution_batches.

---

## 4. Reporting / scoring needs

- **Reporting patterns to extend:** Compliance Reports + Manager Reports + Admin Analytics
  (`stats.js`, `spiffMetrics.js`, `compliance_company_kpis` RPC mig 103, the
  `v_customer_segments` matview mig 137). A QA dashboard can follow the same
  RPC-or-matview + page-1-count pattern the rest of the app uses. The **Data Egress**
  governance (mig 167) already gates CSV exports — QA exports would inherit it for free.
- **Scoring model recommendation — rubric from day one, but minimal:**
  - `qa_scorecards` — a rubric *template* (per company + method), a list of criteria each
    with a `weight` / `max_points` and optional auto-fail flag; `pass_threshold`.
  - `qa_reviews` — one per reviewed call: assignment_id, method, subject_role
    (fronter/closer), reviewer_id, total_score, pass/fail, overall notes, status.
  - `qa_review_scores` — one row per criterion per review (criterion_key, points, note).
  - Why not pass/fail-only: call-QA industry standard is a weighted scorecard (greeting,
    disclosure, compliance statements, rebuttal, close, etc.). A rubric with a **single**
    "Overall" criterion *is* pass/fail — so start with a 1-criterion seed if you want to
    launch light, and add criteria later with **zero migration** of past reviews. Hardcoded
    pass/fail would force a schema+backfill when you inevitably add criteria.

---

## 5. Future connection points (awareness only)

- **Agent dashboards** already surface performance (sales/conversion via `stats.js`,
  spiff via `spiffMetrics.js`, announcements/marquee). A future QA score tile can sit
  alongside these — the surfaces exist.
- **Feedback-to-agent:** `notificationService` + web-push + Supabase realtime (used by
  callbacks, compliance, internal email) is the reuse point for "your call was scored /
  coaching note." `call_reviews` today does *not* notify — QA would add that.
- **Customer/policy timeline** (`policy_events`, `CustomerTimeline`) is a model for a
  per-agent QA timeline if wanted later.

---

## 6. Open questions — my recommendations

### 6.1 Shared/extended vs parallel schema
**Parallel QA tables + shared infra, with `method` as a first-class column.** compliance,
tra, rcm are **three sibling review types**. Don't unify them into one table with a
discriminator — compliance is *confirmation* (no score) while TRA/RCM are *scoring*, and
TRA (full-coverage anti-join) vs RCM (frozen random sample) have incompatible population
queries. Unify what's *actually* shared: recording resolution, listening UI, audit,
config, notifications. Concretely:
```
qa_scorecards      (rubric templates, per company+method)
qa_assignments     (worklist: 1 row per call-to-review; method, subject_role, sampled)
qa_reviews         (result header: total, pass/fail, reviewer, status)
qa_review_scores   (per-criterion scores)
```
Compliance's `app_recording_review_queue` + `sale_recording_confirmations` stay as-is.

### 6.2 Minimal-but-real scoring
**Weighted rubric, data-driven, seedable to 1 criterion.** (See §4.) Standard for call-QA;
cheapest to extend because criteria live in data, not schema.

### 6.3 Per-company config shape
Use `business_config` with the **existing `scope='company:<uuid>'` resolver** (company →
global → code default) — this is more idiomatic than putting the company id *in the key*.
Proposed keys:
```
scope=company:<uuid>  key=qa.methods        value=["tra"]            # or ["tra","rcm"]
scope=company:<uuid>  key=qa.rcm.covers     value=["fronter"]        # or ["fronter","closer"]
scope=company:<uuid>  key=qa.rcm.sample     value={"mode":"percentage","value":10,"period":"day"}
scope=company:<uuid>  key=qa.tra.population value={"statuses":["all"]}   # which transfers count
scope=company:<uuid>  key=qa.scorecard.tra value="<scorecard_uuid>"
scope=company:<uuid>  key=qa.scorecard.rcm value="<scorecard_uuid>"
```
This is your proposed `qa.methods.<company_id>` idea, refined to use the `scope` column
(so the company→global→default cascade + the existing admin config UI work unchanged), and
extended with sampling params, population filter, and scorecard binding.

### 6.4 RCM sampling mechanics
**Superadmin-configurable per company, supporting both fixed-N and percentage, evaluated
per period, materialized (frozen).** Mechanics:
- A scheduled job on the existing `utils/scheduler.js` cron runs per company per period.
- Eligible population = `transfers` (+ closer legs when `qa.rcm.covers` includes closer),
  scoped to the company + period.
- Sample: `mode:'fixed'` → `LIMIT n`; `mode:'percentage'` → `n = ceil(pct * count)`; pick
  via `ORDER BY random() LIMIT n` (fine at this data volume — transfers is not billions;
  no need for `TABLESAMPLE`).
- **Write the sampled rows into `qa_assignments`** so the sample is *frozen* (re-running
  the report can't reshuffle it) and TRA + RCM share one worklist/queue/reporting surface.
- TRA needs no sampling: every in-scope transfer gets a `qa_assignments` row (or a live
  "unreviewed" query if you'd rather not materialize full coverage — but materializing
  makes assignment-to-agent + progress reporting uniform with RCM).

---

## Appendix — key files

| Concern | File |
|---|---|
| Recording resolution (all legs, fronter-capable) | [`backend/utils/dialerBoxes.js`](backend/utils/dialerBoxes.js) |
| Compliance queue RPC | `backend/migrations/151_recording_queue_v2.sql` (+150,152,157,160–163,166) |
| Compliance review routes | [`backend/routes/compliance.js`](backend/routes/compliance.js) (L122–383) |
| Confirmation store | `backend/migrations/150_sale_recording_confirmations.sql` |
| Existing transfer review precedent | `backend/migrations/008a_closer_pool_reviews.sql` · [`backend/routes/reviews.js`](backend/routes/reviews.js) |
| Roles / multi-company / hierarchy | [`backend/models/helpers.js`](backend/models/helpers.js) |
| Per-company config resolver | `backend/migrations/068_business_config.sql` · `backend/utils/businessConfig.js` |
| Assignment pattern to mirror | `backend/migrations/153_distribution_batches.sql` · [`backend/routes/distributionBatches.js`](backend/routes/distributionBatches.js) |
| Cron infra for sampling job | `backend/utils/scheduler.js` |
| Listening UI to reuse | `frontend/src/components/Compliance/RecordingReviewTab.jsx` |
| Transfer population columns | `backend/migrations/007_roles_transfers_compliance.sql`, `073_transfer_status_catalog.sql`, `100_transfer_latest_disposition.sql` |

*Report generated 2026-07-03. No code changed.*
