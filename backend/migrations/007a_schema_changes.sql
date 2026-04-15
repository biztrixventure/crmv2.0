-- ============================================================================
-- Migration 007a: Schema changes — enum additions, new columns, new permissions
-- RUN THIS FIRST. Commit before running 007b.
-- ============================================================================

-- ============================================================================
-- 1. ADD new values to custom_roles.level enum
-- ============================================================================
DO $$
DECLARE
  v_typname TEXT;
  v_val     TEXT;
BEGIN
  SELECT t.typname INTO v_typname
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_type t  ON t.oid = a.atttypid
  WHERE c.relname = 'custom_roles' AND a.attname = 'level' AND t.typcategory = 'E';

  IF v_typname IS NOT NULL THEN
    FOREACH v_val IN ARRAY ARRAY['compliance_manager','fronter_manager','closer_manager','operations_manager','company_admin'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = v_typname AND e.enumlabel = v_val
      ) THEN
        EXECUTE format('ALTER TYPE %I ADD VALUE %L', v_typname, v_val);
      END IF;
    END LOOP;
  ELSE
    -- CHECK constraint path: drop it (level will be free-text)
    EXECUTE (
      SELECT COALESCE(
        (SELECT 'ALTER TABLE custom_roles DROP CONSTRAINT ' || constraint_name
         FROM information_schema.table_constraints
         WHERE table_name = 'custom_roles' AND constraint_type = 'CHECK'
         AND constraint_name LIKE '%level%'
         LIMIT 1),
        'SELECT 1'
      )
    );
  END IF;
END $$;

-- ============================================================================
-- 2. TRANSFERS TABLE: closer assignment + rejection + audit trail columns
-- ============================================================================
ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS assigned_closer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS rejected_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_count  INTEGER DEFAULT 0;

ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS edit_history JSONB DEFAULT '[]'::jsonb;

-- Add 'rejected' to transfer status
DO $$
DECLARE
  v_typname TEXT;
BEGIN
  SELECT t.typname INTO v_typname
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_type t  ON t.oid = a.atttypid
  WHERE c.relname = 'transfers' AND a.attname = 'status' AND t.typcategory = 'E';

  IF v_typname IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = v_typname AND e.enumlabel = 'rejected'
    ) THEN
      EXECUTE format('ALTER TYPE %I ADD VALUE %L', v_typname, 'rejected');
    END IF;
  ELSE
    ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_status_check;
    ALTER TABLE transfers
      ADD CONSTRAINT transfers_status_check
      CHECK (status IN ('pending', 'assigned', 'completed', 'cancelled', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transfers_assigned_closer ON transfers(assigned_closer_id);

-- ============================================================================
-- 3. SALES TABLE: audit trail + compliance statuses
-- ============================================================================
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS edit_history JSONB DEFAULT '[]'::jsonb;

DO $$
DECLARE
  v_typname TEXT;
  v_val     TEXT;
BEGIN
  SELECT t.typname INTO v_typname
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_type t  ON t.oid = a.atttypid
  WHERE c.relname = 'sales' AND a.attname = 'status' AND t.typcategory = 'E';

  IF v_typname IS NOT NULL THEN
    FOREACH v_val IN ARRAY ARRAY['compliance_cancelled','dispute','chargeback'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = v_typname AND e.enumlabel = v_val
      ) THEN
        EXECUTE format('ALTER TYPE %I ADD VALUE %L', v_typname, v_val);
      END IF;
    END LOOP;
  ELSE
    ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_status_check;
    ALTER TABLE sales
      ADD CONSTRAINT sales_status_check
      CHECK (status IN (
        'open', 'sold', 'cancelled', 'follow_up',
        'closed_won', 'closed_lost',
        'compliance_cancelled', 'dispute', 'chargeback'
      ));
  END IF;
END $$;

-- ============================================================================
-- 4. NEW PERMISSIONS
-- ============================================================================
INSERT INTO permissions (name, description, category) VALUES
  ('reject_transfer',            'Can reject an assigned transfer',               'transfers'),
  ('reassign_transfer',          'Can reassign a rejected/returned transfer',      'transfers'),
  ('edit_transfer_reason',       'Can edit transfer data with a reason',           'transfers'),
  ('view_all_company_transfers', 'Can view all transfers in the company',          'transfers'),
  ('manage_compliance',          'Can edit sale records for compliance purposes',  'sales'),
  ('view_all_company_sales',     'Can view all sales across all companies',        'sales'),
  ('view_fronter_stats',         'Can view fronter team leaderboard and stats',    'reports'),
  ('view_closer_stats',          'Can view closer team leaderboard and stats',     'reports'),
  ('manage_company_users',       'Can manage users within own company',            'users'),
  ('manage_company_roles',       'Can manage roles within own company',            'users'),
  ('view_company_reports',       'Can view reports for own company',               'reports')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- 5. FORM FIELDS: 3-col layout columns
-- ============================================================================
ALTER TABLE form_fields
  ADD COLUMN IF NOT EXISTS column_span   INTEGER DEFAULT 1 CHECK (column_span IN (1,2,3)),
  ADD COLUMN IF NOT EXISTS row_index     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS col_index     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS placeholder   TEXT,
  ADD COLUMN IF NOT EXISTS default_value TEXT,
  ADD COLUMN IF NOT EXISTS section       TEXT DEFAULT 'default';
