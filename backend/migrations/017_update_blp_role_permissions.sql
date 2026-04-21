-- ============================================================================
-- Migration 017: Update BLP default role permission sets
-- ============================================================================
-- Updates permissions for roles whose names match the standard BLP defaults.
-- This replaces the bundles from migration 016 with the revised business logic:
--
--   Fronter          → create transfers, callbacks, tracked numbers, see own sales
--   Closer           → receive/reject transfers, create sales, callbacks, rate calls
--   Fronter Manager  → all fronter + team visibility, user mgmt, reports
--   Closer Manager   → all closer + team visibility, financial data, analytics
--   Operations Mgr   → full analytics, leaderboards, create/delete users
--   Compliance Mgr   → review/approve/reject submitted sales
--   Company Admin    → everything
-- ============================================================================

DO $$
DECLARE
  v_role_id   UUID;
  v_perm_id   UUID;
  v_perm_name TEXT;
  v_role_name TEXT;
  v_perms     TEXT[];

  FRONTER_PERMS TEXT[] := ARRAY[
    'create_transfer', 'view_own_transfers',
    'manage_callbacks', 'view_callbacks', 'manage_callback_numbers',
    'view_own_sales',
    'submit_call_review', 'submit_call_dispo',
    'view_notifications'
  ];

  CLOSER_PERMS TEXT[] := ARRAY[
    'view_own_transfers', 'reject_transfer',
    'create_sale', 'view_own_sales', 'update_sale', 'submit_for_review',
    'manage_callbacks', 'view_callbacks',
    'submit_call_review', 'submit_call_dispo',
    'view_notifications'
  ];

  FRONTER_MGR_PERMS TEXT[] := ARRAY[
    'create_transfer', 'view_own_transfers', 'view_team_transfers', 'view_all_company_transfers',
    'assign_transfer', 'reassign_transfer', 'edit_transfer_reason',
    'manage_callbacks', 'view_callbacks', 'view_team_callbacks', 'manage_callback_numbers',
    'view_own_sales', 'view_team_sales',
    'submit_call_review', 'submit_call_dispo', 'view_call_reviews',
    'view_fronter_stats', 'view_company_reports',
    'view_company_members', 'create_user', 'edit_user',
    'view_notifications'
  ];

  CLOSER_MGR_PERMS TEXT[] := ARRAY[
    'view_own_transfers', 'reject_transfer',
    'view_team_transfers', 'view_all_company_transfers',
    'assign_transfer', 'reassign_transfer', 'edit_transfer_reason',
    'create_sale', 'view_own_sales', 'update_sale', 'submit_for_review',
    'view_team_sales', 'view_financial_data', 'search_sales',
    'manage_callbacks', 'view_callbacks', 'view_team_callbacks',
    'submit_call_review', 'submit_call_dispo',
    'view_call_reviews', 'view_all_call_reviews',
    'view_closer_stats', 'view_company_reports',
    'view_company_members', 'create_user', 'edit_user',
    'view_notifications'
  ];

  OPS_MGR_PERMS TEXT[] := ARRAY[
    'view_own_transfers', 'view_team_transfers', 'view_all_company_transfers',
    'assign_transfer', 'reassign_transfer', 'edit_transfer_reason',
    'view_team_sales', 'view_all_company_sales', 'view_financial_data', 'search_sales',
    'view_callbacks', 'view_team_callbacks', 'manage_callback_numbers', 'view_team_callback_numbers',
    'submit_call_review', 'submit_call_dispo',
    'view_call_reviews', 'view_all_call_reviews',
    'view_fronter_stats', 'view_closer_stats', 'view_company_reports', 'view_reports',
    'view_company_members', 'create_user', 'edit_user', 'delete_user',
    'manage_roles', 'manage_forms',
    'view_notifications'
  ];

  COMPLIANCE_MGR_PERMS TEXT[] := ARRAY[
    'manage_compliance',
    'view_team_sales', 'view_all_company_sales', 'view_financial_data', 'search_sales',
    'view_company_members',
    'view_all_call_reviews',
    'view_notifications'
  ];

  COMPANY_ADMIN_PERMS TEXT[] := ARRAY[
    'create_user', 'edit_user', 'delete_user', 'manage_roles', 'manage_forms',
    'view_company_members',
    'create_transfer', 'view_own_transfers', 'view_team_transfers', 'view_all_company_transfers',
    'assign_transfer', 'reassign_transfer', 'edit_transfer_reason', 'delete_transfer', 'reject_transfer',
    'create_sale', 'view_own_sales', 'view_team_sales', 'view_all_company_sales',
    'update_sale', 'delete_sale', 'submit_for_review',
    'view_financial_data', 'search_sales', 'manage_compliance',
    'manage_callbacks', 'view_callbacks', 'view_team_callbacks',
    'manage_callback_numbers', 'view_team_callback_numbers',
    'submit_call_review', 'submit_call_dispo',
    'view_call_reviews', 'view_all_call_reviews',
    'view_fronter_stats', 'view_closer_stats', 'view_company_reports', 'view_reports',
    'view_notifications'
  ];

BEGIN
  FOR v_role_name, v_perms IN
    SELECT * FROM (VALUES
      ('Fronter',             FRONTER_PERMS),
      ('Closer',              CLOSER_PERMS),
      ('Fronter Manager',     FRONTER_MGR_PERMS),
      ('Closer Manager',      CLOSER_MGR_PERMS),
      ('Operations Manager',  OPS_MGR_PERMS),
      ('Compliance Manager',  COMPLIANCE_MGR_PERMS),
      ('Company Admin',       COMPANY_ADMIN_PERMS)
    ) AS t(rname, perms)
  LOOP
    FOR v_role_id IN
      SELECT id FROM custom_roles WHERE name = v_role_name
    LOOP
      -- Replace all permissions for this role
      DELETE FROM role_permissions WHERE role_id = v_role_id;

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

  RAISE NOTICE 'Migration 017: BLP role permissions updated successfully.';
END $$;
