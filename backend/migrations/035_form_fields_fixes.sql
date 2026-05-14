-- Fix column_span constraint: was IN (1,2,3), UI supports 1-5 columns
ALTER TABLE form_fields DROP CONSTRAINT IF EXISTS form_fields_column_span_check;
ALTER TABLE form_fields
  ADD CONSTRAINT form_fields_column_span_check
  CHECK (column_span BETWEEN 1 AND 5);

-- Ensure field_type is TEXT (not ENUM) so any string value can be stored.
-- Migration 012 should have done this, but guard in case it was skipped.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'form_fields'
      AND column_name = 'field_type'
      AND data_type = 'USER-DEFINED'
  ) THEN
    ALTER TABLE form_fields
      ALTER COLUMN field_type TYPE TEXT
      USING field_type::TEXT;
  END IF;
END $$;
