-- ============================================================================
-- Migration 008b: Seed — MUST run AFTER 008a is committed
-- ============================================================================

-- ============================================================================
-- 1. Mark BizTrix System as the closer pool
-- ============================================================================
UPDATE companies
SET is_closer_pool = true
WHERE name = 'BizTrix System';

-- ============================================================================
-- 2. Detach superadmin user from all companies
--    (superadmin867673@biztrixventure.com should be system-level only)
-- ============================================================================
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT u.id INTO v_user_id
  FROM auth.users u
  WHERE u.email = 'superadmin867673@biztrixventure.com';

  IF v_user_id IS NOT NULL THEN
    DELETE FROM user_company_roles
    WHERE user_id = v_user_id;
  END IF;
END $$;

-- ============================================================================
-- 3. Merge company_admin → operations_manager
--    Update existing company_admin roles to operations_manager level
-- ============================================================================
DO $$
DECLARE
  v_typname TEXT;
BEGIN
  SELECT t.typname INTO v_typname
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_type t  ON t.oid = a.atttypid
  WHERE c.relname = 'custom_roles' AND a.attname = 'level' AND t.typcategory = 'E';

  IF v_typname IS NOT NULL THEN
    -- ENUM: add operations_manager if missing (should already exist from 007a)
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = v_typname AND e.enumlabel = 'operations_manager'
    ) THEN
      EXECUTE format('ALTER TYPE %I ADD VALUE %L', v_typname, 'operations_manager');
    END IF;
  END IF;
END $$;

-- Now safe to update: company_admin → operations_manager
UPDATE custom_roles
SET level = 'operations_manager'
WHERE level = 'company_admin';
