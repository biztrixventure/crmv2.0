-- 047_chat_moderation_actions.sql
-- Relax the chat_moderation_log.action CHECK so new superadmin controls
-- (mute/unmute/remove members, etc.) can be audited without further migrations.
-- action stays free text; the app supplies a stable vocabulary.

ALTER TABLE chat_moderation_log DROP CONSTRAINT IF EXISTS chat_moderation_log_action_check;
