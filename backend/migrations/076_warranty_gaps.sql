-- ============================================================================
-- 076_warranty_gaps.sql
-- Closes the auto-warranty audit gaps in one pass:
--   G4  chargeback_date + chargeback_amount distinct from cancellation_date
--   G8  cancellation_reason_key (FK-by-text into the new reasons catalog)
--   G11 original_fronter_id on resell rows so lifetime-customer credit
--       chains across re-fronts
--   Config seeds:
--     - cancellation_reasons      (catalog of canonical reason keys + labels)
--     - bulk.renewal_window_days  (G10 — per-company)
--     - kpi.cancel_count_keys_on  (G7 — 'cancellation_date' | 'sale_date')
--
-- All idempotent. Safe to re-run.
-- ============================================================================

-- ── Schema additions ───────────────────────────────────────────────────────
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS chargeback_date         date,
  ADD COLUMN IF NOT EXISTS chargeback_amount       numeric,
  ADD COLUMN IF NOT EXISTS cancellation_reason_key text,
  ADD COLUMN IF NOT EXISTS original_fronter_id     uuid REFERENCES auth.users(id);

COMMENT ON COLUMN sales.chargeback_date IS
  'Date the chargeback was filed by the customer/bank. Distinct from cancellation_date because chargebacks happen after money has moved.';
COMMENT ON COLUMN sales.chargeback_amount IS
  'USD amount charged back. NULL unless status=chargeback. Used in net-revenue reports.';
COMMENT ON COLUMN sales.cancellation_reason_key IS
  'Canonical reason key from business_config cancellation_reasons catalog. Free-text reason still lives in compliance_note for context.';
COMMENT ON COLUMN sales.original_fronter_id IS
  'On resell rows: the fronter who originally brought this customer. NULL on primary sales. Lets lifetime-customer reports credit the original lead source even after re-fronts.';

CREATE INDEX IF NOT EXISTS idx_sales_chargeback_date
  ON sales(chargeback_date) WHERE chargeback_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_cancellation_reason
  ON sales(cancellation_reason_key) WHERE cancellation_reason_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_original_fronter
  ON sales(original_fronter_id) WHERE original_fronter_id IS NOT NULL;

-- ── Cancellation reasons catalog ───────────────────────────────────────────
-- Catalog shape:
--   [
--     { "key": "customer_request", "label": "Customer requested cancel", "category": "customer", "enabled": true },
--     ...
--   ]
-- New reasons added later are picked up by the UI automatically (same
-- pattern as compliance.status_catalog).
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'cancellation_reasons',
    '[
      {"key":"customer_request",     "label":"Customer requested cancel",       "category":"customer", "enabled":true},
      {"key":"buyers_remorse",       "label":"Buyer''s remorse (cooling-off)",  "category":"customer", "enabled":true},
      {"key":"affordability",        "label":"Affordability / payment issue",   "category":"customer", "enabled":true},
      {"key":"misrepresentation",    "label":"Plan misrepresented at close",    "category":"compliance","enabled":true},
      {"key":"failed_verification",  "label":"Failed verification call",        "category":"compliance","enabled":true},
      {"key":"failed_underwriting",  "label":"Client/underwriting rejected",    "category":"compliance","enabled":true},
      {"key":"chargeback_fraud",     "label":"Chargeback — fraud",              "category":"chargeback","enabled":true},
      {"key":"chargeback_dispute",   "label":"Chargeback — dispute",            "category":"chargeback","enabled":true},
      {"key":"duplicate_sale",       "label":"Duplicate sale on same VIN",      "category":"system",   "enabled":true},
      {"key":"closer_error",         "label":"Closer error / mis-keyed",        "category":"system",   "enabled":true},
      {"key":"vehicle_ineligible",   "label":"Vehicle ineligible (year/miles)", "category":"system",   "enabled":true},
      {"key":"other",                "label":"Other (see compliance note)",     "category":"system",   "enabled":true}
    ]'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

-- ── Renewal window default (G10) ───────────────────────────────────────────
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'bulk.renewal_window_days', '30'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

-- ── Cancellation report keying (G7) ────────────────────────────────────────
-- 'cancellation_date' = report shows "cancellations in May" by the date the
-- cancel actually happened (matches what auditors expect).
-- 'sale_date'         = legacy behavior — counts sales SOLD in May regardless
-- of when cancelled. Kept switchable so a single migration doesn't surprise
-- downstream BI tools.
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'kpi.cancel_count_keys_on', '"cancellation_date"'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;
