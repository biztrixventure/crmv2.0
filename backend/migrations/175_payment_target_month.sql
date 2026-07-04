-- ============================================================================
-- 175_payment_target_month.sql
-- Monthly-payment reminder → RECENCY-WINDOW collection. The superadmin sets how
-- many months back to chase (payment_reminder.window_months, default 2): only
-- policies CLOSED within the last N months are shown to closers + reminded, with
-- their upcoming monthly due date. Old (e.g. 2025) policies drop out.
-- Apply anytime. Idempotent.
-- ============================================================================
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'payment_reminder.window_months', '2'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;
