-- ============================================================================
-- Migration 007: Roles, Transfer Flow, Compliance, Form Layout
-- ============================================================================

-- ============================================================================
-- 1. ADD compliance_manager TO custom_roles level CHECK (if constrained)
--    Also allow fronter_manager as a distinct level
-- ============================================================================
-- If your custom_roles.level column has a CHECK constraint, alter it.
-- Run this only if the constraint exists — safe to run either way via DO block.
DO $$
BEGIN
  -- Drop old level check if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'custom_roles' AND constraint_type = 'CHECK'
    AND constraint_name LIKE '%level%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE custom_roles DROP CONSTRAINT ' || constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'custom_roles' AND constraint_type = 'CHECK'
      AND constraint_name LIKE '%level%'
      LIMIT 1
    );
  END IF;
END $$;

-- ============================================================================
-- 2. TRANSFERS TABLE: add closer assignment + rejection + audit trail
-- ============================================================================

-- assigned_closer_id: the specific closer the fronter chose at creation time
ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS assigned_closer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- rejection tracking
ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS rejected_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_count  INTEGER DEFAULT 0;

-- edit audit trail (JSONB array of {editor_id, reason, changed_fields, edited_at})
ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS edit_history JSONB DEFAULT '[]'::jsonb;

-- add 'rejected' to transfers status
-- Handles both ENUM type column and TEXT+CHECK column
DO $$
DECLARE
  v_typname TEXT;
BEGIN
  -- Find enum type used by transfers.status column (if any)
  SELECT t.typname INTO v_typname
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_type t  ON t.oid = a.atttypid
  WHERE c.relname = 'transfers' AND a.attname = 'status' AND t.typcategory = 'E';

  IF v_typname IS NOT NULL THEN
    -- It's an ENUM — add value only if missing
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = v_typname AND e.enumlabel = 'rejected'
    ) THEN
      EXECUTE format('ALTER TYPE %I ADD VALUE ''rejected''', v_typname);
    END IF;
  ELSE
    -- TEXT + CHECK constraint fallback
    ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_status_check;
    ALTER TABLE transfers
      ADD CONSTRAINT transfers_status_check
      CHECK (status IN ('pending', 'assigned', 'completed', 'cancelled', 'rejected'));
  END IF;
END $$;

-- index for closer lookup
CREATE INDEX IF NOT EXISTS idx_transfers_assigned_closer ON transfers(assigned_closer_id);

-- ============================================================================
-- 3. SALES TABLE: compliance edit audit trail
-- ============================================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS edit_history JSONB DEFAULT '[]'::jsonb;

-- add compliance statuses to sales.status
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
  ('reject_transfer',       'Can reject an assigned transfer',                  'transfers'),
  ('reassign_transfer',     'Can reassign a rejected/returned transfer',        'transfers'),
  ('edit_transfer_reason',  'Can edit transfer data with a reason',             'transfers'),
  ('view_all_company_transfers', 'Can view all transfers in the company',       'transfers'),
  ('manage_compliance',     'Can edit sale records for compliance purposes',    'sales'),
  ('view_all_company_sales','Can view all sales across all companies',          'sales'),
  ('view_fronter_stats',    'Can view fronter team leaderboard and stats',      'reports'),
  ('view_closer_stats',     'Can view closer team leaderboard and stats',       'reports'),
  ('manage_company_users',  'Can manage users within own company',              'users'),
  ('manage_company_roles',  'Can manage roles within own company',              'users'),
  ('view_company_reports',  'Can view reports for own company',                 'reports')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- 5. FORM FIELDS: add column_span + row_break for 3-col layout
-- ============================================================================
ALTER TABLE form_fields
  ADD COLUMN IF NOT EXISTS column_span  INTEGER DEFAULT 1 CHECK (column_span IN (1,2,3)),
  ADD COLUMN IF NOT EXISTS row_index    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS col_index    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS placeholder  TEXT,
  ADD COLUMN IF NOT EXISTS default_value TEXT,
  ADD COLUMN IF NOT EXISTS section      TEXT DEFAULT 'default';

-- ============================================================================
-- 6. SEED: compliance_manager role for biztrixventure (system-level, null company)
-- ============================================================================
-- This inserts a system-level compliance_manager role template.
-- The actual company-specific one gets created via seed-defaults.
INSERT INTO custom_roles (name, description, level, company_id)
VALUES (
  'Compliance Manager',
  'Reviews and updates sale records for compliance, disputes, and chargebacks',
  'compliance_manager',
  NULL  -- system level template
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 7. RLS POLICIES for new columns (transfers rejection visible to managers)
-- ============================================================================
-- Existing transfer policies already allow managers to see all company transfers
-- No new policies needed — the new columns are covered by existing row policies.

-- ============================================================================
-- 8. REMOVE DUPLICATE superadmin system roles (keep only one with NULL company_id)
-- ============================================================================
-- Delete extra superadmin roles keeping the oldest one per level for system roles
DELETE FROM custom_roles
WHERE company_id IS NULL
  AND level = 'superadmin'
  AND id NOT IN (
    SELECT MIN(id) FROM custom_roles
    WHERE company_id IS NULL AND level = 'superadmin'
  );
