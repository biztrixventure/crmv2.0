-- ============================================================================
-- 145_chat_message_controls.sql
-- Message edit / delete controls + superadmin settings.
--   • hidden_for: per-user "delete for me" — the user's id is appended; the
--     messages list excludes anything hidden for the requester. Soft delete
--     (deleted_at) stays as "delete for everyone".
--   • business_config chat.* : superadmin toggles + time windows (minutes;
--     0 = unlimited). Drives which actions the client offers + the server allows.
-- ============================================================================
ALTER TABLE messages ADD COLUMN IF NOT EXISTS hidden_for uuid[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_messages_hidden_for ON messages USING gin (hidden_for);

INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'chat.edit_enabled',                'true'::jsonb),
  ('global', 'chat.delete_enabled',              'true'::jsonb),   -- delete for everyone
  ('global', 'chat.edit_window_min',             '15'::jsonb),     -- 0 = no limit
  ('global', 'chat.delete_everyone_window_min',  '60'::jsonb)      -- 0 = no limit
ON CONFLICT (scope, key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
