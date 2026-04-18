-- ============================================================================
-- 014_user_permission_overrides.sql
-- Per-user permission overrides on top of role-level permissions.
-- override_type = 'grant'  → user gets this permission even if role doesn't have it
-- override_type = 'revoke' → user loses this permission even if role has it
-- Applied in GET /auth/me after resolving role permissions.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL,
  company_id      UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  permission_id   UUID        NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  override_type   TEXT        NOT NULL CHECK (override_type IN ('grant', 'revoke')),
  set_by          UUID        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, company_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_upo_user_company
  ON user_permission_overrides (user_id, company_id);
