-- ============================================================================
-- 058_vehicles.sql — Vehicle make/model registry powering the form pickers.
--
-- Lets a superadmin paste a CSV of makes ("Toyota,Ford,Honda") and, per make,
-- a CSV of models ("Camry,Corolla,RAV4"). The customer-facing form then
-- renders typeaheads against these lists instead of free-text, so reports
-- get clean groupable values.
--
-- Case-insensitive dedupe uses lower(name) expression indexes, since inline
-- UNIQUE on an expression isn't supported in a column constraint.
-- ============================================================================

CREATE TABLE IF NOT EXISTS vehicle_makes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  created_at   timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_makes_name_uidx ON vehicle_makes (lower(name));

CREATE TABLE IF NOT EXISTS vehicle_models (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make_id      uuid NOT NULL REFERENCES vehicle_makes(id) ON DELETE CASCADE,
  name         text NOT NULL,
  created_at   timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_models_make_name_uidx ON vehicle_models (make_id, lower(name));
CREATE INDEX IF NOT EXISTS vehicle_models_make_id_idx ON vehicle_models(make_id);
