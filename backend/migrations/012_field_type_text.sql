-- ============================================================================
-- 012_field_type_text.sql
-- Convert field_type column from custom ENUM to TEXT.
-- Allows values like 'tel', 'zip', 'checkbox', 'sale_client', 'sale_plan'
-- without requiring ALTER TYPE ... ADD VALUE for each new type.
-- ============================================================================

ALTER TABLE form_fields
  ALTER COLUMN field_type TYPE TEXT
  USING field_type::TEXT;
