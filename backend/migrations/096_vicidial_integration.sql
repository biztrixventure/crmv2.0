-- ============================================================================
-- 096_vicidial_integration.sql
-- VICIdial -> CRM integration (one-directional). On XFER the fronter dialer
-- fires a Dispo Call URL that creates a PENDING transfer holding just the
-- correlation code (prefix+lead_id) + phone; the fronter later opens it, fills
-- the rest, and confirms. On the closer's disposition another Dispo Call URL
-- returns the same code so the disposition is mapped back onto that transfer.
--
-- Matching key = transfers.vicidial_vendor_code (the VICIdial vendor_lead_code).
-- Routing key  = user_profiles.vicidial_agent_id (VICIdial agent -> CRM user).
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ── transfers: correlation code + pending flag + closer disposition ─────────
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS vicidial_vendor_code text;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS vicidial_pending     boolean NOT NULL DEFAULT false;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS vicidial_agent       text;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS vicidial_dispo       text;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS vicidial_dispo_at    timestamptz;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS vicidial_talk_time   integer;

-- Exact-match lookup for inbound dispositions; partial so it stays small.
CREATE UNIQUE INDEX IF NOT EXISTS uq_transfers_vicidial_code
  ON transfers (vicidial_vendor_code) WHERE vicidial_vendor_code IS NOT NULL;
-- A fronter's "pending from dialer" list.
CREATE INDEX IF NOT EXISTS idx_transfers_vicidial_pending
  ON transfers (created_by) WHERE vicidial_pending;

-- ── user_profiles: VICIdial agent id -> this CRM user ───────────────────────
-- One agent id maps to exactly one CRM user (unique) so inbound routing is
-- unambiguous.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS vicidial_agent_id text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profiles_vici_agent
  ON user_profiles (vicidial_agent_id) WHERE vicidial_agent_id IS NOT NULL;

-- ── per-company VICIdial config (prefix registry + field map) ───────────────
CREATE TABLE IF NOT EXISTS vicidial_config (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  prefix     text UNIQUE,                         -- per fronter dialer; makes the code globally unique
  field_map  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- dialer field -> CRM field (per company)
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vicidial_config_company ON vicidial_config (company_id);

ALTER TABLE vicidial_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vicidial_config_all ON vicidial_config;
CREATE POLICY vicidial_config_all ON vicidial_config FOR ALL USING (true);
