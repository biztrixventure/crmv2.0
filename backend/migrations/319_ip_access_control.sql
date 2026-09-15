-- ============================================================================
-- 319_ip_access_control.sql -- decide WHICH NETWORKS each CRM user may use.
--
-- DORMANT BY DEFAULT. After this migration: the master switch is OFF, every
-- user is 'anywhere' (no row in user_ip_access means 'anywhere'), and there are
-- no rules. Nothing changes until a superadmin turns it on -- and even then an
-- 'anywhere' user can never be blocked, so the switch alone locks nobody out.
--
-- WHY A SIDECAR TABLE and not columns on user_profiles:
--   user_profiles carries the RLS policy users_can_update_own_profile and the
--   `authenticated` role holds UPDATE on it. With the public anon key and their
--   own JWT, a restricted user could PATCH their own row through PostgREST and
--   set ip_access_mode = 'anywhere'. user_ip_access is RLS-on with NO policies
--   and nothing granted to anon/authenticated -- only the backend's service role
--   can read or write it (same posture as app_secrets, mig 146).
--
-- ENFORCEMENT lives in the backend (utils/ipAccess.js): at login, refresh and
-- magic-link exchange, and on every authenticated API request. The master
-- switch is business_config 'security.ip_restriction.enabled' -- the generic
-- GET /business-config strips every security.* key, so no user can see it.
--
-- AUDIT: module_audit_log (mig 313, module 'access') via fn_module_audit:
--   * every rule created / edited / deleted (user_ip_rules)
--   * every access-mode change (user_ip_access, mode column ONLY -- the
--     last-seen stamps written every few minutes are deliberately NOT logged)
--   * every change to a security.* setting (the master switch)
--
-- Verify after applying:
--   SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_module_audit%'
--     AND tgrelid IN ('user_ip_rules'::regclass,'user_ip_access'::regclass,'business_config'::regclass);  -- 5
--   SELECT key, value FROM business_config WHERE key LIKE 'security.ip_restriction.%';             -- enabled=false, 90
--   SELECT name FROM permissions WHERE name LIKE 'ip_access.%';                                   -- 2 rows
-- ============================================================================

-- -- 1. Per-user access mode + where they were last seen ----------------------------
CREATE TABLE IF NOT EXISTS user_ip_access (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'anywhere'   exempt: may use the CRM from any network, even with the switch ON
  -- 'restricted' only from networks their allow rules (or a global one) cover
  ip_access_mode   text NOT NULL DEFAULT 'anywhere'
                   CHECK (ip_access_mode IN ('anywhere', 'restricted')),
  last_login_ip    text,
  last_login_at    timestamptz,
  last_seen_ip     text,
  last_seen_at     timestamptz,
  mode_changed_by  uuid,
  mode_changed_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_ip_access IS
  'IP access control (mig 319): per-user mode + last login/seen IP. No row = anywhere. Backend-only (RLS on, no policies).';

-- -- 2. Allow / deny rules ----------------------------------------------------------------
-- ip_value is Postgres cidr: the database itself rejects a malformed address and
-- stores the canonical form (a single address is /32 or /128). The backend
-- normalises before writing (host bits masked), so a valid entry never fails here.
CREATE TABLE IF NOT EXISTS user_ip_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,   -- NULL = global rule
  type        text NOT NULL CHECK (type IN ('allow', 'deny')),
  ip_value    cidr NOT NULL,
  label       text CHECK (label IS NULL OR char_length(label) <= 120),
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One rule per (user, type, network); globals are their own namespace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_ip_rules_user
  ON user_ip_rules (user_id, type, ip_value) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_ip_rules_global
  ON user_ip_rules (type, ip_value) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_ip_rules_user
  ON user_ip_rules (user_id) WHERE is_active;

COMMENT ON TABLE user_ip_rules IS
  'IP access control (mig 319): allow/deny rules. user_id NULL = applies to every restricted user. Deny always beats allow.';

-- -- 3. Access attempts --------------------------------------------------------------------
-- 'blocked' on every denial; 'allowed' on each successful login only (never per
-- request -- that would flood it). Pruned by the scheduler after
-- security.ip_restriction.log_retention_days (default 90).
-- No FK on user_id: the record of an attempt must outlive the account.
CREATE TABLE IF NOT EXISTS ip_access_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid,
  ip_address  text,
  result      text NOT NULL CHECK (result IN ('allowed', 'blocked')),
  reason      text,
  event       text NOT NULL DEFAULT 'request'
              CHECK (event IN ('login', 'refresh', 'exchange', 'request')),
  user_agent  text,
  path        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ip_access_logs_created ON ip_access_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ip_access_logs_user    ON ip_access_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ip_access_logs_blocked ON ip_access_logs (created_at DESC) WHERE result = 'blocked';

COMMENT ON TABLE ip_access_logs IS
  'IP access control (mig 319): login/request attempts. blocked = every denial, allowed = successful logins only.';

-- -- 4. Backend-only ---------------------------------------------------------------------------
ALTER TABLE user_ip_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_ip_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ip_access_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_ip_access FROM anon, authenticated;
REVOKE ALL ON user_ip_rules  FROM anon, authenticated;
REVOKE ALL ON ip_access_logs FROM anon, authenticated;

-- -- 5. Settings (OFF) -------------------------------------------------------------------------
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'security.ip_restriction.enabled',            'false'::jsonb),
  ('global', 'security.ip_restriction.log_retention_days', '90'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

-- -- 6. Audit ---------------------------------------------------------------------------------
-- Rules: every insert / update / delete. parent_id = the user the rule belongs to.
DROP TRIGGER IF EXISTS trg_module_audit ON user_ip_rules;
CREATE TRIGGER trg_module_audit
  AFTER INSERT OR UPDATE OR DELETE ON user_ip_rules
  FOR EACH ROW EXECUTE FUNCTION fn_module_audit('access', 'user_id');

-- Access mode: only when the MODE actually changes. The last-seen stamps are
-- written every few minutes per user and must never reach the history.
DROP TRIGGER IF EXISTS trg_module_audit_mode ON user_ip_access;
CREATE TRIGGER trg_module_audit_mode
  AFTER UPDATE OF ip_access_mode ON user_ip_access
  FOR EACH ROW WHEN (OLD.ip_access_mode IS DISTINCT FROM NEW.ip_access_mode)
  EXECUTE FUNCTION fn_module_audit('access', 'user_id');

-- A row born 'restricted' is a mode change too. A row born 'anywhere' is just
-- the first last-seen stamp for that user -- not an event.
DROP TRIGGER IF EXISTS trg_module_audit_mode_ins ON user_ip_access;
CREATE TRIGGER trg_module_audit_mode_ins
  AFTER INSERT ON user_ip_access
  FOR EACH ROW WHEN (NEW.ip_access_mode <> 'anywhere')
  EXECUTE FUNCTION fn_module_audit('access', 'user_id');

-- The master switch (and any other security.* setting). Two triggers because a
-- WHEN clause may not name NEW on DELETE or OLD on INSERT.
DROP TRIGGER IF EXISTS trg_module_audit_security ON business_config;
CREATE TRIGGER trg_module_audit_security
  AFTER INSERT OR UPDATE ON business_config
  FOR EACH ROW WHEN (NEW.key LIKE 'security.%')
  EXECUTE FUNCTION fn_module_audit('access', '');

DROP TRIGGER IF EXISTS trg_module_audit_security_del ON business_config;
CREATE TRIGGER trg_module_audit_security_del
  AFTER DELETE ON business_config
  FOR EACH ROW WHEN (OLD.key LIKE 'security.%')
  EXECUTE FUNCTION fn_module_audit('access', '');

-- -- 7. Permissions ------------------------------------------------------------------------------
-- Granted to NO role. Superadmin holds every permission implicitly, so by
-- default only superadmins can manage this or bypass it. A superadmin may grant
-- either one per role or per user from the permissions screen.
-- ip_access.manage is SYSTEM-WIDE, not company-scoped: the switch and global
-- rules have no company, so whoever holds it manages every user in every
-- company. The description says so, because that is who it should go to.
INSERT INTO permissions (name, description, category) VALUES
  ('ip_access.manage', 'Manage IP access control for the WHOLE CRM (every company): the master switch, every user''s access mode, allow/deny rules and the access-attempt log', 'security'),
  ('ip_access.bypass', 'Always allowed from any network while IP restriction is on (skips every IP rule)', 'security')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, category = EXCLUDED.category;

INSERT INTO schema_migrations (filename, note)
VALUES ('319_ip_access_control.sql',
        'IP access control: user_ip_access (sidecar, backend-only), user_ip_rules (cidr), ip_access_logs; security.ip_restriction.* settings OFF; access-module audit triggers; ip_access.manage/bypass perms (no grants)')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
