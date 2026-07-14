-- ============================================================================
-- 190 — Resync sales.car_vin from the canonical form_data.VIN.
--
-- Bug: Data Cleanup was run on the `VIN` form-data key, but the cleanup's
-- form-field → sales-column map only knew `CarVin` (not the actual stored key
-- `VIN`). So form_data.VIN was updated while the denormalized `car_vin` column
-- went stale — the sale drawer's "Vehicle info" (reads car_vin) showed the OLD
-- VIN while "Additional info" (reads form_data.VIN) showed the NEW one, and the
-- Data Analyzer export (reads car_vin) exported the OLD value.
--
-- The sale form ALWAYS derives car_vin from form_data.VIN on save
-- (SaleForm.jsx), so form_data.VIN is the source of truth. This resyncs the
-- column to match wherever they diverged. Idempotent + safe: only touches rows
-- that actually differ, and never blanks a column (a present VIN is required).
--
-- The recurrence is fixed in code: dataCleanup.js SALE_COL_BY_FIELD now maps
-- VIN → car_vin (and Make/Model aliases), so future cleanups keep them in sync.
-- (Already applied to the live DB via a one-off script; kept here for the record
-- and for other environments.)
-- ============================================================================
UPDATE sales
SET car_vin = upper(trim(form_data->>'VIN'))
WHERE nullif(trim(form_data->>'VIN'), '') IS NOT NULL
  AND upper(trim(form_data->>'VIN')) IS DISTINCT FROM upper(coalesce(car_vin, ''));
