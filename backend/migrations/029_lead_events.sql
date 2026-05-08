-- 029_lead_events.sql
-- Universal event log for every action touching a lead (transfer/sale/callback).
-- Powers the Lead Intelligence timeline and audit trail.

CREATE TABLE IF NOT EXISTS lead_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT        NOT NULL,   -- 'transfer' | 'sale' | 'callback'
  entity_id    UUID        NOT NULL,
  phone        TEXT,
  email        TEXT,
  action_type  TEXT        NOT NULL,   -- 'created' | 'updated' | 'deleted' | 'status_change' | 'rescheduled' | 'approved' | 'returned' | 'assigned'
  performed_by UUID,
  company_id   UUID,
  old_value    JSONB,
  new_value    JSONB,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_events_phone       ON lead_events (phone)       WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_events_email       ON lead_events (email)       WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_events_entity      ON lead_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_performed_by ON lead_events (performed_by);
CREATE INDEX IF NOT EXISTS idx_lead_events_company     ON lead_events (company_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_created_at  ON lead_events (created_at DESC);
