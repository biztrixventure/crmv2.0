-- ============================================================================
-- 175_payment_target_month.sql
-- Monthly-payment reminder → MONTH-based collection. The superadmin picks a
-- target month; only active policies whose monthly payment date falls in that
-- month are shown to closers + trigger the reminder (goal: make one monthly
-- collection call per active customer that month). 'current' = this month.
-- Apply anytime. Idempotent.
-- ============================================================================
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'payment_reminder.target_month', '"current"'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;
