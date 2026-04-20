-- ============================================================================
-- Migration 009: Compliance workflow — pending_review / needs_revision statuses
-- + compliance audit columns on sales table
-- ============================================================================

-- 1. Add new sale status values
DO $$
DECLARE v_typname TEXT;
BEGIN
  SELECT t.typname INTO v_typname
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_type  t ON t.oid = a.atttypid
  WHERE c.relname = 'sales' AND a.attname = 'status' AND t.typcategory = 'E';

  IF v_typname IS NOT NULL THEN
    FOREACH v_val IN ARRAY ARRAY['pending_review','needs_revision'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = v_typname AND e.enumlabel = v_val
      ) THEN
        EXECUTE format('ALTER TYPE %I ADD VALUE %L', v_typname, v_val);
      END IF;
    END LOOP;
  ELSE
    -- CHECK constraint path
    ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_status_check;
    ALTER TABLE sales ADD CONSTRAINT sales_status_check CHECK (status IN (
      'open','sold','cancelled','follow_up',
      'closed_won','closed_lost',
      'compliance_cancelled','dispute','chargeback',
      'pending_review','needs_revision'
    ));
  END IF;
END $$;

-- 2. Compliance audit columns
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS compliance_note           TEXT,
  ADD COLUMN IF NOT EXISTS compliance_reviewed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS compliance_reviewed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_for_review_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. Index for compliance queue (pending_review per company)
CREATE INDEX IF NOT EXISTS idx_sales_status_company ON sales(company_id, status);

-- 4. New permissions
INSERT INTO permissions (name, description, category) VALUES
  ('submit_for_review',   'Can submit a sale for compliance review',       'sales'),
  ('manage_compliance',   'Can approve/return/edit sales for compliance',   'sales')
ON CONFLICT (name) DO NOTHING;
