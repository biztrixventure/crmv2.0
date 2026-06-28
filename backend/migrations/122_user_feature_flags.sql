-- ============================================================================
-- 122_user_feature_flags.sql
-- Per-USER feature overrides — the final layer so a superadmin can toggle ANY
-- feature/tab on or off for one individual user. Resolution order everywhere:
--   user override  >  company override (company_feature_flags)  >  catalog default
-- A missing row = "inherit" (no override). Mirrors user_permission_overrides.
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_feature_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  company_id  uuid,
  feature_key text NOT NULL REFERENCES feature_flags(key) ON DELETE CASCADE,
  is_enabled  boolean NOT NULL,
  set_by      uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One override per (user, company, feature). COALESCE keeps it unique even when
-- company_id is null (system users with no company assignment).
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_feature_flags
  ON user_feature_flags (user_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), feature_key);

CREATE INDEX IF NOT EXISTS idx_user_feature_flags_lookup
  ON user_feature_flags (user_id, company_id);
