-- ============================================================================
-- 113_backfill_fill_code.sql
-- The list-CSV backfill now also stamps the matched dialer lead_id onto the
-- transfer as vicidial_vendor_code (= <BOXPREFIX><lead_id>), so the transfer
-- becomes retroactively "coded" and the normal Fetch Dispo / reconcile path
-- works on it forever. Record the code we wrote so an undo can clear it too.
-- (prev_code is always NULL — we only ever fill transfers with no code yet.)
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================
ALTER TABLE vicidial_backfill_fills ADD COLUMN IF NOT EXISTS new_code text;
