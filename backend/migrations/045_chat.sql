-- 045_chat.sql
-- Global real-time chat: any user can DM any other user across ALL companies,
-- plus group rooms and superadmin-controlled broadcasts.
--
-- Access is enforced in the Express routes (service-role client, which bypasses
-- RLS). RLS here exists so the frontend's anon-key Realtime client can RECEIVE
-- postgres_changes events on `messages` (realtime requires a SELECT policy) and
-- as a defence-in-depth layer; the authoritative, scoped data is always fetched
-- via the Express API. Superadmin moderation runs through supabaseAdmin in the
-- routes (gated by isSuperAdmin) — RLS is never widened for superadmin.

-- ── Conversations ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL DEFAULT 'dm' CHECK (type IN ('dm', 'group', 'broadcast')),
  title           text,                       -- null for dm (resolved from the other member)
  -- For DMs: deterministic sorted "uidLow:uidHigh" key so a pair can only ever
  -- have one DM row. Null for group/broadcast (Postgres treats nulls as distinct
  -- so the UNIQUE constraint does not collide on multiple group rooms).
  dm_key          text UNIQUE,
  is_locked       boolean NOT NULL DEFAULT false,   -- superadmin can freeze a room
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_role     text NOT NULL DEFAULT 'member' CHECK (member_role IN ('admin', 'member')),
  last_read_at    timestamptz,
  is_muted        boolean NOT NULL DEFAULT false,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,                -- soft delete
  deleted_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL  -- who removed it (moderation)
);

-- ── Global per-user chat settings (superadmin ban/mute) ───────────────────────
CREATE TABLE IF NOT EXISTS chat_user_settings (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_chat_banned boolean NOT NULL DEFAULT false,
  banned_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  banned_at      timestamptz,
  ban_reason     text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ── Moderation audit trail (superadmin actions) ───────────────────────────────
CREATE TABLE IF NOT EXISTS chat_moderation_log (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action                 text NOT NULL CHECK (action IN (
                           'delete_message', 'ban_user', 'unban_user',
                           'lock_room', 'unlock_room', 'delete_room',
                           'broadcast', 'feature_toggle')),
  target_user_id         uuid,
  target_conversation_id uuid,
  target_message_id      uuid,
  detail                 jsonb,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_messages_conversation       ON messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_members_user   ON conversation_members (user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message  ON conversations (last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_moderation_created     ON chat_moderation_log (created_at DESC);

-- ── Bump conversation activity on each new message ────────────────────────────
CREATE OR REPLACE FUNCTION public.bump_conversation_on_message()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE conversations
     SET last_message_at = NEW.created_at,
         updated_at      = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_bump_conversation ON messages;
CREATE TRIGGER trg_bump_conversation
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_conversation_on_message();

-- ── Membership check helper (SECURITY DEFINER avoids RLS self-recursion) ──────
-- A SELECT policy on conversation_members that itself queries conversation_members
-- would recurse; routing the lookup through a definer function reads the table
-- with RLS bypassed, breaking the cycle.
CREATE OR REPLACE FUNCTION public.is_conversation_member(c_id uuid, u_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_members
     WHERE conversation_id = c_id AND user_id = u_id
  );
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_user_settings   ENABLE ROW LEVEL SECURITY;

-- A user sees a conversation only if they are a member.
DO $$ BEGIN
  CREATE POLICY "member_reads_conversation" ON conversations
    FOR SELECT TO authenticated
    USING (public.is_conversation_member(id, auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Membership rows are visible to members of the same conversation.
DO $$ BEGIN
  CREATE POLICY "member_reads_members" ON conversation_members
    FOR SELECT TO authenticated
    USING (public.is_conversation_member(conversation_id, auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Messages are visible only to members of the conversation (powers realtime).
DO $$ BEGIN
  CREATE POLICY "member_reads_messages" ON messages
    FOR SELECT TO authenticated
    USING (public.is_conversation_member(conversation_id, auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Defence-in-depth INSERT policy: sender must be self, a non-muted member, the
-- room not locked, and the sender not globally banned. (App writes via service
-- role, which bypasses this — but this blocks any direct anon-key insert.)
DO $$ BEGIN
  CREATE POLICY "member_sends_messages" ON messages
    FOR INSERT TO authenticated
    WITH CHECK (
      sender_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM conversation_members m
         WHERE m.conversation_id = messages.conversation_id
           AND m.user_id = auth.uid()
           AND m.is_muted = false
      )
      AND NOT EXISTS (
        SELECT 1 FROM conversations c
         WHERE c.id = messages.conversation_id AND c.is_locked = true
      )
      AND NOT EXISTS (
        SELECT 1 FROM chat_user_settings s
         WHERE s.user_id = auth.uid() AND s.is_chat_banned = true
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A user can read their own chat settings (ban/mute status banner).
DO $$ BEGIN
  CREATE POLICY "own_chat_settings" ON chat_user_settings
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Enable Realtime on messages (postgres_changes for live delivery) ──────────
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE messages;      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE conversations; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Feature flag (mirrors migration 021 catalog + per-company backfill) ───────
INSERT INTO feature_flags (key, label, description, category, default_enabled, sort_order) VALUES
  ('chat', 'Team Chat',
   'Real-time direct messages and group rooms across all companies, with offline web-push delivery and superadmin moderation.',
   'operations', true, 13)
ON CONFLICT (key) DO NOTHING;

INSERT INTO company_feature_flags (company_id, feature_key, is_enabled)
SELECT c.id, 'chat', (SELECT default_enabled FROM feature_flags WHERE key = 'chat')
FROM companies c
ON CONFLICT (company_id, feature_key) DO NOTHING;
