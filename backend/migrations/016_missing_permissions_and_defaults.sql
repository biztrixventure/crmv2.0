-- ============================================================================
-- Migration 016: Missing permissions + default role-permission templates
-- ============================================================================
-- Fixes:
--   1. view_financial_data permission was never seeded (used in UI shells)
--   2. Seeds a role_level_defaults table so AdminPanel can auto-suggest perms
--   3. Auto-assigns default permissions to any existing company role that has
--      zero permissions (safe to re-run — uses ON CONFLICT DO NOTHING)
-- ============================================================================

-- ============================================================================
-- 1. Add missing permissions
-- ============================================================================
INSERT INTO permissions (name, description, category) VALUES
  ('view_financial_data', 'Can view deal financial details (monthly payment, down payment)', 'sales')
ON CONFLICT (name) DO NOTHING;

-- Ensure manage_compliance exists (was in 007, but 009 duplicated; safe either way)
INSERT INTO permissions (name, description, category) VALUES
  ('manage_compliance', 'Can approve/return/edit sales for compliance', 'sales'),
  ('submit_for_review',  'Can submit a sale for compliance review',     'sales')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- 2. Ensure role_level enum has all current values (for 000_complete_setup path)
-- ============================================================================
DO $$
DECLARE
  v_typname TEXT;
  v_val     TEXT;
BEGIN
  SELECT t.typname INTO v_typname
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_type  t ON t.oid = a.atttypid
  WHERE c.relname = 'custom_roles' AND a.attname = 'level' AND t.typcategory = 'E';

  IF v_typname IS NOT NULL THEN
    FOREACH v_val IN ARRAY ARRAY[
      'fronter_manager', 'compliance_manager', 'closer_manager',
      'operations_manager', 'fronter', 'closer', 'readonly_admin'
    ] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = v_typname AND e.enumlabel = v_val
      ) THEN
        EXECUTE format('ALTER TYPE %I ADD VALUE %L', v_typname, v_val);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ============================================================================
-- 3. Default permission sets per role level
--    Applied to system-level role templates (company_id IS NULL).
--    Also auto-fills any company role with 0 permissions assigned.
-- ============================================================================

-- Helper: assign a list of permission names to a role (by role id)
-- We do this via a DO block so we can use arrays

DO $$
DECLARE
  v_role_id   UUID;
  v_perm_id   UUID;
  v_perm_name TEXT;

  -- Permission bundles per role level
  FRONTER_PERMS TEXT[] := ARRAY[
    'create_transfer', 'view_own_transfers', 'assign_transfer',
    'view_callbacks', 'manage_callbacks',
    'submit_call_review', 'submit_call_dispo'
  ];

  CLOSER_PERMS TEXT[] := ARRAY[
    'create_sale', 'view_own_sales', 'update_sale',
    'view_own_transfers', 'reject_transfer',
    'submit_call_review', 'submit_call_dispo',
    'search_sales', 'submit_for_review'
  ];

  FRONTER_MGR_PERMS TEXT[] := ARRAY[
    -- All fronter perms
    'create_transfer', 'view_own_transfers', 'assign_transfer',
    'view_callbacks', 'manage_callbacks', 'submit_call_review', 'submit_call_dispo',
    -- Manager additions
    'view_team_transfers', 'view_all_company_transfers',
    'reassign_transfer', 'edit_transfer_reason',
    'view_fronter_stats', 'view_team_callbacks',
    'view_call_reviews', 'view_company_reports',
    'view_company_members', 'create_user', 'edit_user'
  ];

  CLOSER_MGR_PERMS TEXT[] := ARRAY[
    -- All closer perms
    'create_sale', 'view_own_sales', 'update_sale', 'view_own_transfers',
    'reject_transfer', 'submit_call_review', 'submit_call_dispo',
    'search_sales', 'submit_for_review',
    -- Manager additions
    'view_team_sales', 'view_financial_data',
    'view_closer_stats', 'view_all_call_reviews',
    'view_company_members', 'create_user', 'edit_user',
    'view_company_reports', 'view_team_callbacks'
  ];

  OPS_MGR_PERMS TEXT[] := ARRAY[
    -- Full company management
    'create_transfer', 'view_own_transfers', 'assign_transfer',
    'view_team_transfers', 'view_all_company_transfers',
    'reassign_transfer', 'edit_transfer_reason',
    'create_sale', 'view_own_sales', 'update_sale',
    'view_team_sales', 'view_financial_data', 'search_sales',
    'submit_call_review', 'submit_call_dispo',
    'view_call_reviews', 'view_all_call_reviews',
    'view_callbacks', 'manage_callbacks', 'view_team_callbacks',
    'manage_callback_numbers',
    'view_fronter_stats', 'view_closer_stats', 'view_company_reports',
    'view_company_members', 'create_user', 'edit_user', 'delete_user',
    'manage_roles', 'manage_forms',
    'submit_for_review'
  ];

  COMPLIANCE_MGR_PERMS TEXT[] := ARRAY[
    'view_team_sales', 'view_financial_data', 'search_sales',
    'manage_compliance', 'view_all_company_sales',
    'view_all_call_reviews', 'view_company_members'
  ];

  v_level TEXT;
  v_perms TEXT[];

BEGIN
  -- Process each role level
  FOR v_level, v_perms IN
    SELECT * FROM (VALUES
      ('fronter',            FRONTER_PERMS),
      ('manager',            FRONTER_MGR_PERMS),
      ('fronter_manager',    FRONTER_MGR_PERMS),
      ('closer',             CLOSER_PERMS),
      ('closer_manager',     CLOSER_MGR_PERMS),
      ('operations_manager', OPS_MGR_PERMS),
      ('company_admin',      OPS_MGR_PERMS),
      ('compliance_manager', COMPLIANCE_MGR_PERMS)
    ) AS t(lvl, perms)
  LOOP
    -- For each system-level role template (company_id IS NULL)
    FOR v_role_id IN
      SELECT id FROM custom_roles WHERE level::text = v_level
    LOOP
      -- Skip if role already has permissions (don't overwrite manual config)
      IF NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = v_role_id) THEN
        FOREACH v_perm_name IN ARRAY v_perms LOOP
          SELECT id INTO v_perm_id FROM permissions WHERE name = v_perm_name;
          IF v_perm_id IS NOT NULL THEN
            INSERT INTO role_permissions (role_id, permission_id)
            VALUES (v_role_id, v_perm_id)
            ON CONFLICT DO NOTHING;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
END $$;
