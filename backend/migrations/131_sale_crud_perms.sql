-- ============================================================================
-- 131_sale_crud_perms.sql
-- Make Sale Update/Delete TOGGLEABLE per user. sales.js gated edit/delete by
-- ROLE; now it gates on hasPermission(update_sale / delete_sale). This grants
-- those permissions to exactly the manager roles that had role-based access, so
-- the switch changes NOTHING for them — it just makes the per-user grant/revoke
-- override take effect.
--
-- Closers/fronters are NOT granted these: they already edit/delete their OWN
-- sales via the creator/closer_id check (unchanged). A superadmin can still
-- grant update_sale/delete_sale to an individual closer to let them touch team
-- sales. compliance_manager + superadmin keep full access via their own path
-- (no row needed). readonly_admin is blocked from writes by readonlyGuard.
-- Idempotent.
-- ============================================================================
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r
CROSS JOIN permissions p
WHERE r.level::text IN (
        'company_admin', 'operations_manager', 'closer_manager',
        'fronter_manager', 'manager'
      )
  AND p.name IN ('update_sale', 'delete_sale')
ON CONFLICT DO NOTHING;
