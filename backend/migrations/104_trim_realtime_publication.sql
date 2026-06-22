-- ============================================================================
-- 104_trim_realtime_publication.sql
-- Disk-IO fix #1 (the big one). pg_stat_statements showed ~72% of DB time in
-- realtime.list_changes — Supabase Realtime decoding the WAL for every table in
-- the `supabase_realtime` publication. The app only subscribes to a handful of
-- tables (notifications, messages, callbacks, announcements, marquee_items,
-- spiff_entries, spiff_campaigns — see the frontend .channel() calls), yet the
-- heavy-write tables (a single bulk upload inserts ~21k transfers) were being
-- WAL-decoded by Realtime for no subscriber.
--
-- This removes the known heavy-write, non-subscribed tables from the Realtime
-- publication. Fully defensive:
--   • does nothing if the publication is FOR ALL TABLES (manage via dashboard),
--   • drops a table only if it is actually a member,
-- so it is safe + idempotent and can never break an active subscription.
--
-- To re-enable Realtime for any table later: Supabase Dashboard →
-- Database → Replication → supabase_realtime → toggle the table.
-- ============================================================================
DO $$
DECLARE
  t        text;
  all_tbls boolean;
  drop_list text[] := ARRAY[
    'transfers', 'sales', 'disposition_actions', 'policy_events',
    'transfer_assignments', 'transfer_dedup_events', 'sale_spiffs',
    'user_company_roles', 'user_permission_overrides', 'audit_logs'
  ];
BEGIN
  SELECT puballtables INTO all_tbls FROM pg_publication WHERE pubname = 'supabase_realtime';
  IF all_tbls IS NULL THEN
    RAISE NOTICE 'No supabase_realtime publication found — nothing to trim.';
    RETURN;
  END IF;
  IF all_tbls THEN
    RAISE NOTICE 'supabase_realtime is FOR ALL TABLES — trim heavy-write tables via the dashboard (Database → Replication).';
    RETURN;
  END IF;

  FOREACH t IN ARRAY drop_list LOOP
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
      RAISE NOTICE 'Removed public.% from supabase_realtime.', t;
    END IF;
  END LOOP;
END $$;
