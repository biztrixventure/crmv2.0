-- 051_chat_group_management.sql
-- Group management: editable name/description/logo and an "only admins can post"
-- policy. Leaving, deleting, removing members and admin succession are all handled
-- in the Express routes (service role) against the existing conversation_members
-- table — no schema change needed for those.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS description      text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS image_url        text;   -- group logo (Supabase Storage URL)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS only_admins_post boolean NOT NULL DEFAULT false;
