-- 357: the support desk without a compliance step, plus closer tags and
-- follow-up reminders. ADDITIVE ONLY -- nothing is dropped.
--
-- 1. NO COMPLIANCE APPROVAL (operator, 2026-11-24). 356 sent a saved customer
--    to compliance, whose approval reinstated the sale. That step is gone IN
--    THE CODE: the agent marking a customer Saved is the end of the case, and
--    it records the save ONLY -- the sale's own status is never changed by the
--    support desk. The statuses in use are open ("In Progress") / saved / lost.
--    What 356 created for the approval step is left in place and unused:
--      retention_cases.submitted_at / reviewed_by / reviewed_at / review_note /
--      sale_reinstated, the wider status CHECK ('pending_approval', 'approved',
--      'returned'), sales.reinstated_at / reinstated_by / reinstate_reason and
--      the 'reinstated' branch in fn_log_policy_event.
--    A first draft of this migration dropped those columns and was declined;
--    always-NULL columns cost nothing, so they stay.
--
-- 2. last_outcome on the case = how the most recent call ended. It is what
--    colours a row in the support lists, so a list reads at a glance.
--
-- 3. follow_up_notified_at: the scheduler (utils/supportReminders.js) notifies
--    the agent when next_follow_up_at arrives and stamps this, so one follow-up
--    rings once. Logging a call with a new follow-up time clears it.
--
-- 4. retention_tags: a support agent tags a CLOSER on a policy ("please look at
--    this one"). The closer sees it under Support Requests in their own
--    dashboard and marks it done. One OPEN tag per (sale, closer).

ALTER TABLE public.retention_cases ADD COLUMN IF NOT EXISTS last_outcome text;
ALTER TABLE public.retention_cases ADD COLUMN IF NOT EXISTS follow_up_notified_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_retention_cases_followup_due
  ON public.retention_cases (next_follow_up_at)
  WHERE next_follow_up_at IS NOT NULL AND follow_up_notified_at IS NULL AND status = 'open';

CREATE TABLE IF NOT EXISTS public.retention_tags (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id        uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  case_id        uuid REFERENCES public.retention_cases(id) ON DELETE SET NULL,
  tagged_user_id uuid NOT NULL,
  tagged_by      uuid NOT NULL,
  note           text,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  closer_note    text,
  done_at        timestamptz,
  client_name    text,
  customer_name  text,
  reference_no   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_retention_open_tag
  ON public.retention_tags (sale_id, tagged_user_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_retention_tags_user ON public.retention_tags (tagged_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retention_tags_sale ON public.retention_tags (sale_id);
CREATE INDEX IF NOT EXISTS idx_retention_tags_by   ON public.retention_tags (tagged_by, created_at DESC);

ALTER TABLE public.retention_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retention_tags FROM anon, authenticated;
