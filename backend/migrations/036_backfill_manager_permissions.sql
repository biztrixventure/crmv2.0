-- ============================================================================
-- Migration 036: Backfill missing permissions for existing manager roles
-- ============================================================================
-- Migration 016 only seeded permissions for roles with ZERO permissions.
-- Company roles that already had some permissions assigned were skipped,
-- leaving view_team_callbacks / view_team_transfers / view_team_sales etc.
-- missing from manager roles.
--
-- This migration safely adds the missing permissions to ALL existing roles
-- of each level using ON CONFLICT DO NOTHING — existing permissions are
-- never removed or duplicated.
-- ============================================================================

DO $$
DECLARE
  v_role_id   UUID;
  v_perm_id   UUID;
  v_perm_name TEXT;
  v_level     TEXT;
  v_perms     TEXT[];

  -- Minimum permissions each manager level MUST have (additive — never removes)
  FRONTER_MGR_REQUIRED TEXT[] := ARRAY[
    'create_transfer', 'view_own_transfers', 'assign_transfer',
    'view_callbacks', 'manage_callbacks', 'submit_call_review', 'submit_call_dispo',
    'view_team_transfers', 'view_all_company_transfers',
    'reassign_transfer', 'edit_transfer_reason',
    'view_fronter_stats', 'view_team_callbacks',
    'view_call_reviews', 'view_company_reports',
    'view_company_members', 'create_user', 'edit_user'
  ];

  CLOSER_MGR_REQUIRED TEXT[] := ARRAY[
    'create_sale', 'view_own_sales', 'update_sale', 'view_own_transfers',
    'reject_transfer', 'submit_call_review', 'submit_call_dispo',
    'search_sales', 'submit_for_review',
    'view_team_sales', 'view_financial_data',
    'view_closer_stats', 'view_all_call_reviews',
    'view_company_members', 'create_user', 'edit_user',
    'view_company_reports', 'view_team_callbacks'
  ];

  OPS_MGR_REQUIRED TEXT[] := ARRAY[
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
    'manage_roles', 'manage_forms', 'submit_for_review'
  ];

  FRONTER_REQUIRED TEXT[] := ARRAY[
    'create_transfer', 'view_own_transfers', 'assign_transfer',
    'view_callbacks', 'manage_callbacks',
    'submit_call_review', 'submit_call_dispo'
  ];

  CLOSER_REQUIRED TEXT[] := ARRAY[
    'create_sale', 'view_own_sales', 'update_sale',
    'view_own_transfers', 'reject_transfer',
    'submit_call_review', 'submit_call_dispo',
    'search_sales', 'submit_for_review'
  ];

BEGIN
  FOR v_level, v_perms IN
    SELECT * FROM (VALUES
      ('fronter',            FRONTER_REQUIRED),
      ('closer',             CLOSER_REQUIRED),
      ('fronter_manager',    FRONTER_MGR_REQUIRED),
      ('manager',            FRONTER_MGR_REQUIRED),
      ('closer_manager',     CLOSER_MGR_REQUIRED),
      ('operations_manager', OPS_MGR_REQUIRED),
      ('company_admin',      OPS_MGR_REQUIRED)
    ) AS t(lvl, perms)
  LOOP
    FOR v_role_id IN
      SELECT id FROM custom_roles WHERE level::text = v_level
    LOOP
      FOREACH v_perm_name IN ARRAY v_perms LOOP
        SELECT id INTO v_perm_id FROM permissions WHERE name = v_perm_name;
        IF v_perm_id IS NOT NULL THEN
          INSERT INTO role_permissions (role_id, permission_id)
          VALUES (v_role_id, v_perm_id)
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Migration 036 complete — missing permissions backfilled for all manager roles.';
END $$;
