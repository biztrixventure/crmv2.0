-- ============================================================================
-- 245_sales_payout_confirmed_tristate_fix.sql
-- Fixes a partial apply of mig 244. That file's ALTER TABLE used
-- `ADD COLUMN IF NOT EXISTS`, but `payout_confirmed` had already been created
-- as a plain `boolean` by mig 244's ORIGINAL (pre-tri-state) content before it
-- was rewritten — so the IF NOT EXISTS silently skipped the real column, while
-- the same run's `CREATE OR REPLACE FUNCTION payout_confirmed_kpis(...)` went
-- through fine (function replace doesn't care about the table). Net effect:
-- the RPC exists and returns 'true'/'false' as text (boolean's own string
-- form), which never matches the app's 'pending'/'yes'/'no' keys — every
-- Payout Status KPI tile silently reads zero.
--
-- This migration does the actual type conversion. Verified before writing:
-- every existing row is `false` (nobody has ever flipped the old boolean —
-- the Yes/No toggle was live only briefly before being replaced by the
-- tri-state field), so `false → 'pending'` is the correct mapping (it was
-- never actually decided), not `false → 'no'`. `true → 'yes'` is included
-- for correctness even though no row currently has it.
-- ============================================================================
ALTER TABLE sales ALTER COLUMN payout_confirmed DROP DEFAULT;
ALTER TABLE sales ALTER COLUMN payout_confirmed TYPE text
  USING (CASE WHEN payout_confirmed THEN 'yes' ELSE 'pending' END);
ALTER TABLE sales ALTER COLUMN payout_confirmed SET DEFAULT 'pending';
ALTER TABLE sales ALTER COLUMN payout_confirmed SET NOT NULL;
ALTER TABLE sales ADD CONSTRAINT sales_payout_confirmed_check
  CHECK (payout_confirmed IN ('pending', 'yes', 'no'));

INSERT INTO schema_migrations (filename, note)
VALUES ('245_sales_payout_confirmed_tristate_fix.sql', 'Converts payout_confirmed boolean (stuck from a partial mig-244 apply) to the intended pending/yes/no text column')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
