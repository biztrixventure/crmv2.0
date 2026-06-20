-- ============================================================================
-- 099_vicidial_closer_dispo_queue.sql
-- The closer's dialer Dispo Call URL can only send dispo + agent (VICIdial does
-- not expose lead_id/phone to it for the closer's calls). So when a closer
-- disposition can't be matched to a lead, we park it here as a "pending closer
-- disposition" — the closer sees it in their CRM (like the fronter's pending
-- transfer) and clicks to attach it to the right lead.
-- Idempotent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS vicidial_closer_dispo_queue (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closer_user_id   uuid,
  company_id       uuid,                         -- closer's company
  vici_code        text,                         -- raw dialer code (uppercased)
  disposition_name text,                         -- mapped CRM dispo (NULL = unmapped)
  raw_dispo        text,                         -- exact dialer string
  status           text NOT NULL DEFAULT 'pending',  -- pending | assigned | dismissed
  transfer_id      uuid,                         -- set when assigned
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vcdq_closer ON vicidial_closer_dispo_queue (closer_user_id, status);

ALTER TABLE vicidial_closer_dispo_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vcdq_all ON vicidial_closer_dispo_queue;
CREATE POLICY vcdq_all ON vicidial_closer_dispo_queue FOR ALL USING (true);
