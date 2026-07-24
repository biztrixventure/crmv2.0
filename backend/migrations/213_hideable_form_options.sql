-- 213_hideable_form_options.sql
-- "Hide from the form" (eye-off) for catalog options WITHOUT deleting them.
-- A hidden row stays in the admin managers (so it can be un-hidden) but is
-- excluded from the form-facing reads (GET /sale-configs, GET /vehicles) so it
-- no longer appears as an option on the Sale/Transfer forms.
-- Apply in the Supabase SQL editor.

ALTER TABLE sale_configs   ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
ALTER TABLE vehicle_makes  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
ALTER TABLE vehicle_models ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN sale_configs.hidden   IS 'When true, this client/plan is hidden from the form (still in the admin manager; not deleted).';
COMMENT ON COLUMN vehicle_makes.hidden  IS 'When true, this make is hidden from the form typeaheads (still in the admin manager; not deleted).';
COMMENT ON COLUMN vehicle_models.hidden IS 'When true, this model/variant is hidden from the form typeaheads (still in the admin manager; not deleted).';
