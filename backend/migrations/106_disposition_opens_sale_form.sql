-- ============================================================================
-- 106_disposition_opens_sale_form.sql
-- Per-disposition toggle: when a dialer disposition with opens_sale_form=true
-- matches a lead, the closer doesn't get it auto-applied — instead it lands in
-- their "dialer dispositions" banner with a Confirm → open sale form action
-- (the closer fills the sale + submits to compliance, exactly like the manual
-- search → sale flow). Everything else keeps auto-applying.
-- Idempotent.
-- ============================================================================
ALTER TABLE disposition_configs
  ADD COLUMN IF NOT EXISTS opens_sale_form boolean NOT NULL DEFAULT false;
