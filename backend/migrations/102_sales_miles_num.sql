-- ============================================================================
-- 102_sales_miles_num.sql
-- Numeric mileage for range filtering in the Data Analyzer.
--
-- form_data->>'Miles' is free text ("33,000", "56000", "" …) and the legacy
-- car_miles column is NULL across the board, so a numeric range on mileage was
-- impossible (text gte/lte compares lexicographically: "9000" > "10000").
--
-- Add miles_num (bigint) = digits-only of form_data.Miles, kept in sync by a
-- BEFORE trigger that NEVER blocks a sale write (any cast error → NULL). The
-- analyzer maps the "Miles" field to this column for correct numeric ranges.
-- Idempotent.
-- ============================================================================
ALTER TABLE sales ADD COLUMN IF NOT EXISTS miles_num bigint;
CREATE INDEX IF NOT EXISTS idx_sales_miles_num ON sales (miles_num);

CREATE OR REPLACE FUNCTION fn_sync_sale_miles_num() RETURNS trigger AS $$
BEGIN
  BEGIN
    NEW.miles_num := NULLIF(regexp_replace(COALESCE(NEW.form_data->>'Miles', ''), '[^0-9]', '', 'g'), '')::bigint;
  EXCEPTION WHEN OTHERS THEN
    NEW.miles_num := NULL;   -- never block a sale insert/update over this
  END;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_sale_miles_num ON sales;
CREATE TRIGGER trg_sync_sale_miles_num
  BEFORE INSERT OR UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION fn_sync_sale_miles_num();

-- Backfill existing rows (digits only; "33,000" → 33000, blank/junk → NULL).
-- The ~ '^[0-9]{1,18}$' guard keeps a single oversized junk value from
-- overflowing bigint and aborting the whole statement.
UPDATE sales
SET miles_num = CASE
    WHEN regexp_replace(COALESCE(form_data->>'Miles', ''), '[^0-9]', '', 'g') ~ '^[0-9]{1,18}$'
    THEN regexp_replace(COALESCE(form_data->>'Miles', ''), '[^0-9]', '', 'g')::bigint
    ELSE NULL END
WHERE miles_num IS NULL;
