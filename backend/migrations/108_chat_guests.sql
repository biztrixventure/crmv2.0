-- ============================================================================
-- 108_chat_guests.sql
-- "Outsider" guest chat links. A superadmin creates a named guest tied to ONE
-- group (conversation). The guest reaches that single group through a tokenized
-- link only — no auth account, no other groups, no directory/search. Superadmin
-- can disable (link stops working) and re-enable (same link works again).
-- Guests see messages only from joined_at onward (chosen behaviour). Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS chat_guests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  token           text NOT NULL UNIQUE,            -- the credential in the URL
  is_active       boolean NOT NULL DEFAULT true,   -- superadmin on/off switch
  joined_at       timestamptz NOT NULL DEFAULT now(), -- history cutoff (see-from)
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_chat_guests_conversation ON chat_guests (conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_guests_token        ON chat_guests (token);

-- Guest-authored messages: sender_id stays NULL, guest_id identifies the writer.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS guest_id uuid REFERENCES chat_guests(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_guest ON messages (guest_id) WHERE guest_id IS NOT NULL;

-- The guest token is verified server-side (service role); guests never get a
-- Supabase session, so no RLS policy is needed for chat_guests.
ALTER TABLE chat_guests ENABLE ROW LEVEL SECURITY;
