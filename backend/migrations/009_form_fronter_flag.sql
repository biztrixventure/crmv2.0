-- ============================================================================
-- Migration 009: form_fields fronter visibility + sales form_data column
-- ============================================================================

-- 1. Add show_to_fronter flag to form_fields (default true = visible to fronters)
ALTER TABLE form_fields
  ADD COLUMN IF NOT EXISTS show_to_fronter BOOLEAN NOT NULL DEFAULT true;

-- 2. Add form_data JSONB to sales for storing dynamic custom field values
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS form_data JSONB DEFAULT '{}'::jsonb;
