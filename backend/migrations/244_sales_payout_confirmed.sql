-- ============================================================================
-- 244_sales_payout_confirmed.sql
-- Second, independent payout field for the merged Compliance Sales / Payout
-- section (mig 243 added the first one, `payout_status` pending/paid/reverted,
-- now labeled "DP Status" in the UI). `payout_confirmed` is a plain manual
-- Yes/No checkbox a superadmin sets by hand — labeled "Payout Status" in the
-- UI — with no derived meaning or automation behind it.
-- ============================================================================
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payout_confirmed boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (filename, note)
VALUES ('244_sales_payout_confirmed.sql', 'Manual Yes/No Payout Status flag alongside the pending/paid/reverted DP Status')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
