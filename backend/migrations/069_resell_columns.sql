-- ============================================================================
-- 069_resell_columns.sql
-- Adds resell tracking columns to sales. A resell = new sale row tied to the
-- same transfer as an existing closed deal. is_resell flag drives the fronter-
-- side privacy filter; original_sale_id links the chain for audit.
-- ============================================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS is_resell        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS original_sale_id UUID REFERENCES sales(id),
  ADD COLUMN IF NOT EXISTS resell_intent    TEXT,         -- 'resell' | 'additional_car' | 'renewal' | 'other' | <custom>
  ADD COLUMN IF NOT EXISTS resell_reason    TEXT;

-- Index on is_resell helps the fronter-scope filter (`WHERE is_resell = false`)
-- which runs on every list/stat query for fronter-side users.
CREATE INDEX IF NOT EXISTS idx_sales_is_resell        ON sales(is_resell);
CREATE INDEX IF NOT EXISTS idx_sales_original_sale_id ON sales(original_sale_id);

COMMENT ON COLUMN sales.is_resell        IS 'true when sale is a resell on an existing transfer. Hidden from fronter views per business_config.';
COMMENT ON COLUMN sales.original_sale_id IS 'FK to the sale this row replaces/follows. NULL for primary sales.';
COMMENT ON COLUMN sales.resell_intent    IS 'Intent key from business_config.resell.intents (resell | additional_car | renewal | other | custom).';
COMMENT ON COLUMN sales.resell_reason    IS 'Optional closer-provided reason. Required if business_config.resell.require_reason_text=true.';
