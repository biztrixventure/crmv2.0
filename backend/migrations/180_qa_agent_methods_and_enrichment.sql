-- ============================================================================
-- 180_qa_agent_methods_and_enrichment.sql
-- QA manager/agent split — STEP 1 (schema).
--   1. qa_agent_methods : binds a QA agent to RCM and/or TRA (flexible; the
--      manager sets it). An agent can only be assigned / only sees / only scores
--      the method(s) bound here.
--   2. denormalized customer columns on qa_assignments so the agent's task card
--      always has name/phone/zip/state/address/plan — even for day-recording
--      assignments that have no transfer/sale link (filled at creation time,
--      CRM-first with a VICIdial lead_field_info fallback).
--   3. qa.card_fields config default so the manager can toggle which of those
--      fields show on the card.
-- Apply AFTER 170. Idempotent.
-- ============================================================================

-- 1. per-agent method binding ------------------------------------------------
CREATE TABLE IF NOT EXISTS qa_agent_methods (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method      text        NOT NULL CHECK (method IN ('tra','rcm')),
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id, method)
);
CREATE INDEX IF NOT EXISTS idx_qa_agent_methods_user ON qa_agent_methods (user_id);
CREATE INDEX IF NOT EXISTS idx_qa_agent_methods_co   ON qa_agent_methods (company_id);

-- RLS enabled, NO permissive policy → deny-all for anon/authenticated; the
-- service-role backend bypasses RLS. (Matches the mig-179 security posture — do
-- NOT add a USING(true) policy here.)
ALTER TABLE qa_agent_methods ENABLE ROW LEVEL SECURITY;

-- 2. denormalized customer fields on the worklist ----------------------------
ALTER TABLE qa_assignments ADD COLUMN IF NOT EXISTS customer_name    text;
ALTER TABLE qa_assignments ADD COLUMN IF NOT EXISTS customer_phone   text;
ALTER TABLE qa_assignments ADD COLUMN IF NOT EXISTS customer_zip     text;
ALTER TABLE qa_assignments ADD COLUMN IF NOT EXISTS customer_state   text;
ALTER TABLE qa_assignments ADD COLUMN IF NOT EXISTS customer_address text;
ALTER TABLE qa_assignments ADD COLUMN IF NOT EXISTS sale_meta        jsonb;  -- {plan, vehicle, policy_no, ...} when a sale is linked

-- 3. which card fields show (manager-toggleable). global default = all on.
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'qa.card_fields',
   '{"customer_name":true,"customer_phone":true,"zip":true,"state":true,"address":true,"agent":true,"call_date":true,"plan":true}'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;
