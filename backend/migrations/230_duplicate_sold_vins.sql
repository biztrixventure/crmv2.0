-- ============================================================================
-- 230_duplicate_sold_vins.sql
-- VIN counterpart to v_duplicate_sold_customers (mig 193). The compliance
-- Sale Record highlight (Business Rules → Sale Highlight) can now tint rows
-- by duplicate VIN instead of duplicate customer number — same shape, grouped
-- by car_vin instead of customer_uuid, so backend/routes/compliance.js can
-- attach vin_dupe_sale_count / vin_dupe_active_count alongside the existing
-- dupe_sale_count / dupe_active_count and the frontend picks whichever the
-- superadmin has configured as the active field.
-- ============================================================================
CREATE OR REPLACE VIEW public.v_duplicate_sold_vins AS
SELECT
  s.car_vin,
  count(*)                                                            AS sale_count,
  count(*) FILTER (WHERE s.status IN ('closed_won','pending_review')) AS active_sale_count
FROM public.sales s
WHERE s.car_vin IS NOT NULL AND btrim(s.car_vin) <> ''
  AND s.status <> 'open'                     -- ignore un-submitted drafts, same as the phone view
GROUP BY s.car_vin
HAVING count(*) >= 2;

-- Backend-only, same posture as v_duplicate_sold_customers.
REVOKE ALL ON public.v_duplicate_sold_vins FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_duplicate_sold_vins TO service_role;

-- Makes the per-VIN highlight lookups (car_vin IN (...)) and the view's
-- grouping cheap. idx_sales_active_vin (mig 091) is a narrower partial index
-- (closed_won + superseded_by IS NULL only) and doesn't cover this broader
-- "every non-open status" grouping.
CREATE INDEX IF NOT EXISTS idx_sales_car_vin_status
  ON public.sales (car_vin, status) WHERE car_vin IS NOT NULL AND btrim(car_vin) <> '';

NOTIFY pgrst, 'reload schema';
