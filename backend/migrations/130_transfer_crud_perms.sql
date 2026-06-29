-- ============================================================================
-- 130_transfer_crud_perms.sql
-- Make Transfer Update/Delete TOGGLEABLE per user. Today transfers.js gates
-- edit/delete by ROLE (MANAGER_ROLES), so the update_transfer / delete_transfer
-- permissions exist but aren't enforced — a superadmin can't actually revoke
-- them from a manager. We're switching the backend gate to hasPermission(); this
-- migration first grants those permissions to exactly the roles that have
-- role-based access today, so the switch changes NOTHING for existing users —
-- it just makes the per-user grant/revoke override take effect.
--
-- superadmin bypasses; readonly_admin is blocked by readonlyGuard on writes, so
-- neither needs a row. Idempotent.
-- ============================================================================
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r
CROSS JOIN permissions p
WHERE r.level::text IN (
        'company_admin', 'operations_manager', 'closer_manager',
        'fronter_manager', 'manager', 'compliance_manager'
      )
  AND p.name IN ('update_transfer', 'delete_transfer')
ON CONFLICT DO NOTHING;
