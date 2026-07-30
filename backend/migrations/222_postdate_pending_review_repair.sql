-- ============================================================================
-- 222_postdate_pending_review_repair.sql
-- Send un-charged post-dates that leaked into compliance review back to 'open'.
--
-- ── THE SYMPTOM ─────────────────────────────────────────────────────────────
-- Compliance → Post Date showed 5 records sitting at status 'pending_review'.
-- They should be 'open': the card has not been charged, so there is nothing for
-- compliance to approve. A post-date is meant to enter review ONLY via
-- "Charge → Sale", which flips closer_disposition off post-date first.
--
-- ── THE CAUSE ───────────────────────────────────────────────────────────────
-- POST /sales/:id/submit-review had no idea what a post-date was. Five call
-- sites reach it and only ONE carried a guard — StaffShell.handleSaleEdit — and
-- that guard read the disposition off the SUBMITTED FORM:
--
--     const nowPostDate = isPostDateDispo(formData.closer_disposition);
--
-- SaleForm sends `closer_disposition: dynVal('sale_disposition') || ... || null`,
-- so any edit whose form had no resolvable disposition field sent null. null is
-- not a post-date, so the guard resubmitted the exact records it existed to
-- protect. handleSubmitForReview and compliance's SalesTab had no check at all.
--
-- The timestamps split the 5 cleanly and confirm both paths:
--   Scheron Williams  created 21:23:58.759 → submitted 21:23:59.270  (+0.5s, creation)
--   Linda Davis       created 20:15:52     → submitted 22:00:03      (+1h45m, edit)
--   James Reddick     created 23:02:45     → submitted 23:34:46      (+32m,   edit)
--   Jonathan Leonard  created 06-24 17:27  → submitted 06-24 22:45   (+5h,    edit)
--   Charles Spruiel   created 07-11 21:36  → submitted 07-13 18:26   (+2d,    edit)
--
-- Both are now closed in code (same commit): a state guard inside submit-review
-- itself, which is the choke point every call site passes through, plus the
-- frontend fallback so a closer editing a post-date never triggers it. This
-- migration only repairs the rows that already leaked.
--
-- ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
-- It does NOT clear the policy_events 'submitted' rows those submissions wrote.
-- That timeline is immutable by design (mig 087) and the submissions genuinely
-- happened — erasing them would be falsifying history to make a bug tidy. The
-- 'open' write here logs no new event (fn_log_policy_event maps no event type
-- for 'open'), so the timeline simply ends at the submission, which is accurate.
--
-- It does not touch the 3 CANCELLED post-dates. Cancelled is a deliberate human
-- decision, not a leak — a closer cancelling a post-date the customer backed out
-- of is exactly right, and reopening them would resurrect dead records.
--
-- ── SAFETY ──────────────────────────────────────────────────────────────────
-- Scoped three ways: still post-dated, currently pending_review, and never
-- compliance-reviewed. That last clause matters — if compliance HAD already
-- approved or returned one, flipping it to 'open' would silently undo their
-- decision. Any such row is left alone and reported by verification query 3.
--
-- Apply: paste into the Supabase SQL editor. Plain DML, 5 rows.
-- Idempotent: re-running matches nothing once applied.
-- ============================================================================

UPDATE sales
   SET status                  = 'open',
       submitted_for_review_at = NULL,
       submitted_by            = NULL,
       updated_at              = now()
 WHERE closer_disposition ILIKE '%post%date%'
   AND status = 'pending_review'
   AND compliance_reviewed_at IS NULL;

-- ── post-apply verification ─────────────────────────────────────────────────
-- 1. No un-charged post-date is in review any more. Expect 0.
--    SELECT count(*) FROM sales
--     WHERE closer_disposition ILIKE '%post%date%' AND status = 'pending_review';
--
-- 2. The 5 are back to open. Measured immediately before writing this file:
--    open = 35, pending_review = 5, cancelled = 3. Expect 40 / 0 / 3 after.
--    SELECT status, count(*) FROM sales
--     WHERE closer_disposition ILIKE '%post%date%' GROUP BY status ORDER BY 2 DESC;
--
-- 3. Anything the guard clause deliberately skipped — a post-date compliance had
--    already reviewed. Expect 0 rows; if any appear, decide case by case rather
--    than widening the UPDATE, because reopening them discards a real decision.
--    SELECT id, customer_name, status, compliance_reviewed_at FROM sales
--     WHERE closer_disposition ILIKE '%post%date%'
--       AND status = 'pending_review' AND compliance_reviewed_at IS NOT NULL;
--
-- 4. The guard holds going forward — this must now 400, not 200:
--      POST /api/sales/<a post-dated sale id>/submit-review
--    → "This sale is post-dated — charge the card first…"
