-- Migration 031: Timezone support
-- Companies get an internal_timezone for their office (e.g. Asia/Karachi for Pakistan-based call centers)
-- Callbacks get customer_timezone (derived from US ZIP/state) so the scheduler fires at the right moment

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS internal_timezone TEXT NOT NULL DEFAULT 'Asia/Karachi';

ALTER TABLE callbacks
  ADD COLUMN IF NOT EXISTS customer_timezone TEXT,
  ADD COLUMN IF NOT EXISTS customer_state    TEXT,
  ADD COLUMN IF NOT EXISTS customer_city     TEXT;

COMMENT ON COLUMN companies.internal_timezone IS 'IANA timezone for office/agents, e.g. Asia/Karachi';
COMMENT ON COLUMN callbacks.customer_timezone  IS 'IANA timezone of the US customer, derived from ZIP/state';
COMMENT ON COLUMN callbacks.customer_state     IS 'US state name, e.g. California';
COMMENT ON COLUMN callbacks.customer_city      IS 'US city name, e.g. Beverly Hills';
