-- 359: the support desk's two paper sheets, in the CRM.
--
-- SHEET 1 "First Monthly call". Every new policy has a first monthly payment
-- (sales.form_data->>'Monthly_Date'). Support calls the customer three times
-- before it -- 1 week, 3 days and 1 day ahead -- and then records what happened
-- to the payment. The policy date, monthly date, phone, policy number and
-- status are already on the sale; only the three calls and the final status
-- are new, so that is all this table holds: ONE ROW PER (sale, step).
--   step   = fu1 | fu2 | fu3 | final
--   result = a key from the catalogs in backend/utils/firstMonthly.js
-- "N/A - customer agreed on the first call" is NOT stored: it is worked out
-- from an earlier step whose result is 'agreed'.
-- sale_id is ON DELETE SET NULL with the customer snapshotted, the mig 352
-- rule: deleting a sale must not erase logged work.
--
-- SHEET 2 "Support and Retention". Name, phone, policy and the inquiry are a
-- logged call already (retention_calls.notes). Three answers are new, on the
-- call: was it a cancellation request, was a refund processed, and what the
-- agent did (saved / escalated / guided). "Escalated to the closer" is the
-- closer tag that already exists. Recording a refund here changes NOTHING on
-- the sale -- the support desk never does (mig 357).
--
-- support_fm_digest: one "N first-monthly calls are due today" notification
-- per agent per day; the row is the claim.
--
-- ADDITIVE ONLY. Verify:
--   SELECT count(*) FROM first_monthly_steps;                       -- 0
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='retention_calls'
--      AND column_name IN ('cancel_request','refund_processed','action');  -- 3

CREATE TABLE IF NOT EXISTS first_monthly_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id       uuid REFERENCES sales(id) ON DELETE SET NULL,
  step          text NOT NULL CHECK (step IN ('fu1','fu2','fu3','final')),
  result        text NOT NULL,
  note          text,
  agent_id      uuid NOT NULL,
  client_name   text,
  customer_name text,
  reference_no  text,
  monthly_date  date,
  done_at       timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_first_monthly_step UNIQUE (sale_id, step)
);
CREATE INDEX IF NOT EXISTS idx_fm_steps_agent_done ON first_monthly_steps (agent_id, done_at DESC);
CREATE INDEX IF NOT EXISTS idx_fm_steps_done ON first_monthly_steps (done_at DESC);

ALTER TABLE first_monthly_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON first_monthly_steps FROM anon, authenticated;

ALTER TABLE retention_calls
  ADD COLUMN IF NOT EXISTS cancel_request   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refund_processed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS action           text;
ALTER TABLE retention_calls DROP CONSTRAINT IF EXISTS retention_calls_action_check;
ALTER TABLE retention_calls
  ADD CONSTRAINT retention_calls_action_check
  CHECK (action IS NULL OR action IN ('saved','escalated','guided'));

CREATE TABLE IF NOT EXISTS support_fm_digest (
  agent_id uuid NOT NULL,
  day      date NOT NULL,
  due      integer NOT NULL DEFAULT 0,
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, day)
);
ALTER TABLE support_fm_digest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON support_fm_digest FROM anon, authenticated;
