-- ============================================================================
-- 065_user_preferences.sql
--
-- Generic per-user preference store. First consumer: superadmin's custom
-- ordering of the Companies list. Designed so other "remember my UI state"
-- features (preferred filters, column widths, sidebar collapse, etc.) can
-- reuse the same table without another migration.
--
-- Shape:
--   user_id | key            | value (jsonb)
--   abc-…   | companies.order| ["uuid-A","uuid-Z","uuid-M",…]
--
-- PK is (user_id, key) so each user gets at most one row per preference key.
-- value is jsonb so callers can store arrays, objects, or scalars without
-- another schema change.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id     uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key         text          NOT NULL,
  value       jsonb         NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS user_preferences_user_idx ON user_preferences (user_id);

-- Backend uses the service-role client, so the only thing RLS buys us is
-- defense-in-depth against a leaked anon key trying to read someone else's
-- prefs. Service role bypasses RLS regardless.
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_preferences_owner_all ON user_preferences;
CREATE POLICY user_preferences_owner_all ON user_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
