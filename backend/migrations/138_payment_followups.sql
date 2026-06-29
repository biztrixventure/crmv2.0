-- ============================================================================
-- 138_payment_followups.sql
-- Monthly-payment retention workflow. One row per (active sale, monthly due
-- cycle): the closer calls the customer to confirm the monthly payment; the
-- outcome is logged here. at_risk soft-notifies compliance for a possible
-- cancellation. Fed by the scheduler scan (utils/paymentReminders.js).
--
--   status: pending   — surfaced, awaiting the closer's call
--           collected — customer paid this cycle
--           at_risk   — couldn't collect → compliance review
--           cancelled — compliance cancelled the policy
-- ============================================================================
CREATE TABLE IF NOT EXISTS payment_followups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id       UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  company_id    UUID,
  closer_id     UUID,
  customer_uuid UUID,
  due_date      DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  note          TEXT,
  handled_by    UUID,
  handled_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sale_id, due_date)
);

CREATE INDEX IF NOT EXISTS idx_payment_followups_closer  ON payment_followups (closer_id, due_date);
CREATE INDEX IF NOT EXISTS idx_payment_followups_company ON payment_followups (company_id, due_date);
CREATE INDEX IF NOT EXISTS idx_payment_followups_status  ON payment_followups (status, due_date);

-- Superadmin-tunable defaults (business_config global). enabled / how-far-ahead /
-- which day-offsets fire a reminder / which extra roles get notified.
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'payment_reminder.enabled',          'true'::jsonb),
  ('global', 'payment_reminder.window_days',      '7'::jsonb),
  ('global', 'payment_reminder.reminder_offsets', '[7,3,1]'::jsonb),
  ('global', 'payment_reminder.notify_roles',     '["closer"]'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;
