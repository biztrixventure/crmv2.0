-- 046_chat_reactions.sql
-- Emoji reactions on chat messages. Reactions sync live over Supabase Broadcast
-- (instant, no DB round-trip) and persist here via the service-role API. RLS is
-- a defence-in-depth SELECT policy scoped to conversation members.

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions (message_id);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "member_reads_reactions" ON message_reactions
    FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM messages m
       WHERE m.id = message_reactions.message_id
         AND public.is_conversation_member(m.conversation_id, auth.uid())
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
