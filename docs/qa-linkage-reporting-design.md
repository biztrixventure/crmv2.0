# QA Linkage & Reporting — architecture direction

Design record (not a feature spec to build now). It states how QA review data is
linked today and the invariants any future QA work MUST preserve, so the planned
manager-facing reports can be attached later without rework.

## The vision (future)

The QA department evaluates the calls of fronters and closers who already have
CRM accounts. Every transfer and sale is in the CRM. So every QA review must stay
**linked** to: the call, the CRM record (transfer/sale), the person reviewed
(fronter/closer), and the reviewer — and remain **editable with an audit trail**
and **routable** so that, in future:

- Compliance sees all QA reports for transfers and sales (already can).
- The QA department can surface/attach a report to the **fronter's manager** and
  the **closer's manager** so each manager sees the QA of their team's calls.

## What already exists (do NOT break these invariants)

**Linkage — `qa_reviews` is the join hub.** Columns: `assignment_id`,
`company_id`, `method`, `subject_role` (fronter|closer), `subject_user_id`
(the reviewed CRM user), `reviewer_id`, `scorecard_id`, score fields
(`final_score`, `quality_score`, `passed`, `total_score`, `autofail_result`),
`overall_notes`, `meta`, `status`, `edit_history`, `finalized_at/by`,
`created_at`. Via `assignment_id → qa_assignments.transfer_id / sale_id` it links
to the CRM record. `subject_user_id` is set on submit by `resolveSubjectUser(a)`
(fronter=`transfers.created_by`, closer=`sales.closer_id` / `transfers.assigned_closer_id`,
raw-dialer=`vicidial_agent_ids` map). **Invariant:** every review keeps a valid
`subject_user_id` + `reviewer_id` + `assignment_id` (→ transfer/sale). Never write
a review that can't be traced to a person AND a CRM record.

**Manager routing — `notifyReviewed(a, subjectUserId, reviewerId, …)`** already
resolves the reviewed agent + their managers by role level
(`getUserIdsByLevel(company, [fronter_manager|closer_manager, operations_manager,
company_admin])`) and notifies them (never the reviewer). **Invariant:** the
fronter/closer manager set is derivable from `subject_role` + `company_id`; keep
it that way (a future report view reuses the same resolution).

**Edit + audit — `PUT /qa/reviews/:id`.** Agent edits own while `status='submitted'`;
`override_qa_review`/superadmin edits any; `finalized` locks for the agent. Every
change appends `{edited_at, by, role, override, changes:{field:{from,to}}}` to
`edit_history`; sheet edits also rewrite `qa_review_scores` (raw values). Status
set ∈ {submitted, finalized, disputed, void}. **Invariant:** never mutate a review
without appending to `edit_history`; never let a non-owner edit without `override`.

**Notes/remarks/comments.** `qa_reviews.overall_notes` (per review) +
`qa_review_scores.note`/`raw_value` (per criterion) + `qa_reviews.meta` (call
context). All editable + audited via the same endpoint.

## The future piece (build later, on this foundation)

A **manager-facing QA report surface** — no schema change needed:

- Reuse `GET /qa/admin/team` + `GET /qa/admin/activity` shapes, but scoped to a
  manager's team: filter `qa_reviews` by `company_id` + `subject_user_id ∈ the
  manager's fronters/closers` (resolve via `user_company_roles` + role level).
- A `GET /qa/reports/for-my-team` (fronter_manager/closer_manager gated) →
  per-agent QA rollups + the review timeline for their team's transfers/sales,
  each row deep-linking to the CRM transfer/sale.
- Compliance keeps the all-company view; managers get their slice. "Attach to
  manager" = the same report filtered by team + surfaced in the Manager shell,
  plus the existing `qa_review` notification already lands in their bell.
- Reviews are already editable + audited, so a manager report can show the latest
  score AND its `edit_history` (who changed what, when).

Keep new QA code consistent with these invariants and the manager report is a
thin read layer, not a migration. See memory `qa_linkage_reporting`,
`qa_command_center`, `qa_scorecard_audit`.
