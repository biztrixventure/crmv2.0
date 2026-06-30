-- ============================================================================
-- 146_blacklist_lookup.sql
-- Blacklist Alliance DNC / litigation lookup (single number, on-demand) for
-- closers + compliance.
--   • app_secrets: the API key lives here, NOT in business_config (that GET is
--     open to any authenticated user). RLS on + no policies → only the backend
--     service role can read it; never reachable from the public API.
--   • blacklist_lookups: cache of results, keyed by normalized 10-digit phone,
--     re-checked after blacklist.cache_days (avoids repeat API cost).
--   • business_config: non-secret toggles. feature_flags: per-company gate.
-- ============================================================================
CREATE TABLE IF NOT EXISTS app_secrets (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;   -- no policies → anon/authenticated blocked; service role bypasses
REVOKE ALL ON app_secrets FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS blacklist_lookups (
  phone      text PRIMARY KEY,                 -- normalized 10-digit
  status     text,                             -- success
  message    text,                             -- Good | Blacklisted | FederalDNC | StateDNC | Suppressed
  codes      text[] NOT NULL DEFAULT '{}',     -- federal-dnc, attorney-primary, prelitigation1, …
  wireless   boolean,
  carrier    jsonb,
  results    integer,
  raw        jsonb,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_blacklist_lookups_checked ON blacklist_lookups (checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_blacklist_lookups_message ON blacklist_lookups (message);

INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'blacklist.enabled',    'false'::jsonb),
  ('global', 'blacklist.cache_days', '30'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

INSERT INTO feature_flags (key, label, description, is_enabled) VALUES
  ('tool_blacklist_lookup', 'Blacklist / DNC Lookup',
   'Closers + compliance can check a phone against the Blacklist Alliance DNC / litigation database.', false)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
