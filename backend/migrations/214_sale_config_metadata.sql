-- 214_sale_config_metadata.sql
-- Clients & Plans command center — structured product metadata for catalog rows.
--
-- ADDITIVE ONLY. The load-bearing contract is unchanged: sales.plan and
-- sales.client_name stay free-text, and every runtime consumer keeps reading the
-- same sale_configs value + the sale_plan field's options mapping. This column
-- only ENRICHES a catalog row (a plan/client) with optional attributes so a plan
-- can be a real product (tier, term, mileage, deductible, price) instead of just
-- a label. NULL for every existing row → zero behavioural change until an admin
-- fills it in from the new "Plan details" tab.
--
-- Suggested shape (not enforced — jsonb):
--   plan:   { tier, coverage_type('vsc'|'manufacturer'|'other'),
--             term_months, mileage_cap, deductible, price, cost, notes }
--   client: { underwriter, notes }

ALTER TABLE sale_configs ADD COLUMN IF NOT EXISTS metadata jsonb;

COMMENT ON COLUMN sale_configs.metadata IS
  'Optional structured attributes for the Clients & Plans command center (mig 214). Additive; does not affect the free-text value persisted on sales.plan / sales.client_name.';
