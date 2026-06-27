-- ============================================================================
-- 117_closer_display_alias.sql
-- Pseudonyms for closers shown to EXTERNAL viewers (client recording portal +
-- guest chat links) so real closer names are never exposed. Admin sets an alias
-- per user; when blank, a stable non-identifying fallback ("Agent XXXX") is used.
-- Internal CRM views + the portal listen audit keep the real name.
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS display_alias text;
