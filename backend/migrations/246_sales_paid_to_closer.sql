-- ============================================================================
-- 246_sales_paid_to_closer.sql
-- Adds a superadmin-only checkbox ("Paid to closer") alongside the existing
-- payout_confirmed tri-state (mig 244/245). payout_confirmed says whether the
-- sale IS eligible for a closer incentive at all (pending/yes/no); this new
-- flag says whether that eligible payout has actually been PAID OUT yet — a
-- separate fact, not a fourth tri-state value, so existing payout_confirmed
-- filters/KPIs stay untouched.
--
-- Surfaced to the closer on their own Sale card as "Incentive: ..." —
-- pending -> Pending, no -> Not Eligible, yes+unpaid -> Eligible,
-- yes+paid -> Paid.
-- ============================================================================
ALTER TABLE sales ADD COLUMN IF NOT EXISTS paid_to_closer boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (filename, note)
VALUES ('246_sales_paid_to_closer.sql', 'Adds sales.paid_to_closer — superadmin-set flag surfaced to the closer as the Incentive pill''s Paid state')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
