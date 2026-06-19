-- ============================================================================
-- 098_chat_message_reply.sql
-- WhatsApp-style reply: a message may quote an earlier message in the SAME
-- conversation. reply_to points at the quoted message; ON DELETE SET NULL keeps
-- the reply intact if the quoted message is hard-deleted (soft-delete keeps the
-- row anyway). Idempotent.
-- ============================================================================
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to uuid REFERENCES messages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages (reply_to) WHERE reply_to IS NOT NULL;
