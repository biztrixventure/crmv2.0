-- ============================================================================
-- 068_business_config.sql
-- Configurable business rules (resell, dedup, KPIs, compliance windows, etc.)
-- Resolves company-scoped override → global → code default.
-- ============================================================================

CREATE TABLE IF NOT EXISTS business_config (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       TEXT NOT NULL,             -- 'global' | 'company:<uuid>'
  key         TEXT NOT NULL,
  value       JSONB NOT NULL,
  updated_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(scope, key)
);

CREATE INDEX IF NOT EXISTS idx_business_config_scope_key ON business_config(scope, key);
CREATE INDEX IF NOT EXISTS idx_business_config_key       ON business_config(key);

COMMENT ON TABLE business_config IS 'Per-company + global business rule overrides. Resolver: company:<id> → global → code default.';
COMMENT ON COLUMN business_config.scope IS 'global OR company:<uuid>';
COMMENT ON COLUMN business_config.key   IS 'dot.path notation e.g. resell.enabled_statuses';

-- ── Global defaults for resell / re-engagement ─────────────────────────────
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'resell.enabled_statuses',
    '["cancelled","compliance_cancelled","closed_won","sold","closed_lost","expired"]'::jsonb),
  ('global', 'resell.warning_statuses',
    '["chargeback","dispute"]'::jsonb),
  ('global', 'resell.intents',
    '[{"key":"resell","label":"Resell (cancel old policy)","emphasis":"warn"},
      {"key":"additional_car","label":"Additional car","emphasis":"info"},
      {"key":"renewal","label":"Renewal","emphasis":"info"},
      {"key":"other","label":"Other","emphasis":"muted"}]'::jsonb),
  ('global', 'resell.confirm_prompt',
    '"Are you sure you want to resell this policy? Old policy will be marked compliance_cancelled and a fresh sale will start in pending_review."'::jsonb),
  ('global', 'resell.cooldown_days', '7'::jsonb),
  ('global', 'resell.hide_from_fronter',          'true'::jsonb),
  ('global', 'resell.hide_from_fronter_manager',  'true'::jsonb),
  ('global', 'resell.hide_from_compliance',       'false'::jsonb),
  ('global', 'resell.attribution',                '"closer"'::jsonb),       -- closer | fronter | split
  ('global', 'resell.auto_block_after_chargebacks', '2'::jsonb),
  ('global', 'resell.require_reason_text',        'false'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

-- ── Global defaults for dedup / search ─────────────────────────────────────
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'dedup.window_days',              '30'::jsonb),
  ('global', 'dedup.different_fronter_same_co','"new_transfer"'::jsonb),   -- new_transfer | update | conflict
  ('global', 'dedup.cross_company',            '"new_transfer"'::jsonb),   -- new_transfer | warn | block
  ('global', 'search.sort_by',                 '"updated_at"'::jsonb),     -- updated_at | created_at
  ('global', 'search.show_stale',              'true'::jsonb),
  ('global', 'dedup.apply_to_bulk_upload',     'true'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

-- ── Global defaults for stats & KPIs ───────────────────────────────────────
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'kpi.conversion_numerator',   '"closed_won"'::jsonb),
  ('global', 'kpi.conversion_denominator', '"all_transfers"'::jsonb),
  ('global', 'kpi.resell_counts_in',
    '{"closer_total":true,"conversion":false,"fronter_stats":false,"resells_card":true}'::jsonb),
  ('global', 'kpi.today_timezone', '"America/New_York"'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;
