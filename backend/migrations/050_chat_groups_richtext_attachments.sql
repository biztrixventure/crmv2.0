-- 050_chat_groups_richtext_attachments.sql
-- Group chat enhancements: invite-only joining, rich-text messages, @mentions,
-- and file/image attachments (≤10MB, stored in a public Supabase Storage bucket).

-- ── Rich content + attachments + mentions on messages ──────────────────────────
-- A message may now carry only attachments (no text), so `body` becomes nullable.
ALTER TABLE messages ALTER COLUMN body DROP NOT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS body_html   text;   -- sanitized rich HTML; plain `body` stays as preview/search/push text
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments jsonb;  -- [{ url, name, type, size, kind: 'image'|'file' }]
ALTER TABLE messages ADD COLUMN IF NOT EXISTS mentions    jsonb;  -- [user_id, ...] mentioned in this message

-- ── Invite-only group joining ───────────────────────────────────────────────────
-- Group admins send invites; a user becomes a member only after accepting.
CREATE TABLE IF NOT EXISTS conversation_invites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  invitee_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  inviter_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  responded_at    timestamptz,
  UNIQUE (conversation_id, invitee_id)
);
CREATE INDEX IF NOT EXISTS idx_invites_invitee ON conversation_invites (invitee_id, status);

ALTER TABLE conversation_invites ENABLE ROW LEVEL SECURITY;

-- Realtime needs a SELECT policy; the authoritative reads/writes go through the
-- service-role Express routes. An invitee (and the inviter) may see their invite.
DO $$ BEGIN
  CREATE POLICY "invitee_or_inviter_reads_invite" ON conversation_invites
    FOR SELECT TO authenticated USING (invitee_id = auth.uid() OR inviter_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE conversation_invites; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Storage bucket for chat attachments ─────────────────────────────────────────
-- Public read (served via public URL); uploads happen through the service role in
-- the Express /chat/upload route, so no client INSERT policy is required.
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO NOTHING;
