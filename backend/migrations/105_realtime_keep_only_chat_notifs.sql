-- ============================================================================
-- 105_realtime_keep_only_chat_notifs.sql
-- Disk-IO fix #1 (the real one). The realtime publication held 9 tables
-- (announcements, conversation_invites, conversations, events, marquee_items,
-- messages, notifications, spiff_campaigns, spiff_entries) but only TWO need
-- instant push: messages (chat) and notifications. The rest were either:
--   • low-value banners (announcements / marquee_items / spiff_*) — the widgets
--     now poll instead of holding a per-client Realtime channel, or
--   • published but never subscribed (conversations / conversation_invites /
--     events — chat invites + calendar already refetch on poll).
--
-- Every extra published table is WAL-decoded by realtime.list_changes (which
-- pg_stat_statements showed at ~72% of DB time). Trim to the two that matter.
--
-- Defensive: drop a table only if it's a member; no-op if the publication is
-- FOR ALL TABLES. Idempotent. Re-enable any table later via
-- Dashboard → Database → Replication → supabase_realtime.
-- ============================================================================
DO $$
DECLARE
  t        text;
  all_tbls boolean;
  drop_list text[] := ARRAY[
    'announcements', 'marquee_items', 'spiff_entries', 'spiff_campaigns',
    'conversations', 'conversation_invites', 'events'
  ];
BEGIN
  SELECT puballtables INTO all_tbls FROM pg_publication WHERE pubname = 'supabase_realtime';
  IF all_tbls IS NULL THEN
    RAISE NOTICE 'No supabase_realtime publication — nothing to trim.';
    RETURN;
  END IF;
  IF all_tbls THEN
    RAISE NOTICE 'supabase_realtime is FOR ALL TABLES — trim via the dashboard instead.';
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
