-- ============================================================================
-- 132_callback_crud_perms.sql
-- Make Callback Create / Update / Delete TOGGLEABLE per user. callbacks.js gated
-- these by ROLE + ownership; now each gates on a dedicated permission, defaulting
-- to EXACTLY today's behaviour:
--   create_callback : everyone can create today  -> granted to every role.
--   edit_callback   : managers edit team callbacks -> granted to manager roles.
--                     (owners always edit their own, no perm needed.)
--   delete_callback : only owner/superadmin delete today -> granted to NOBODY.
--                     Granting it lets a user delete any callback in their company.
-- So nothing changes until a superadmin grants/revokes per user. Idempotent.
-- ============================================================================
INSERT INTO permissions (name, description, category) VALUES
  ('create_callback', 'Can create callbacks',                                         'callbacks'),
  ('edit_callback',   'Can edit team callbacks in their company (own always editable)','callbacks'),
  ('delete_callback', 'Can delete callbacks in their company (owner can delete own)',  'callbacks')
ON CONFLICT (name) DO NOTHING;

-- create_callback → every role except superadmin (bypasses) / readonly_admin (no writes)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r CROSS JOIN permissions p
WHERE p.name = 'create_callback'
  AND r.level::text NOT IN ('superadmin', 'readonly_admin')
ON CONFLICT DO NOTHING;

-- edit_callback → the manager roles that could edit team callbacks today
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r CROSS JOIN permissions p
WHERE p.name = 'edit_callback'
  AND r.level::text IN (
        'company_admin', 'operations_manager', 'closer_manager',
        'fronter_manager', 'manager', 'compliance_manager'
      )
ON CONFLICT DO NOTHING;

-- delete_callback → intentionally granted to NO role (default = owner/superadmin
-- only, matching current behaviour). Grant per-user from the access panel to
-- allow company-wide callback deletion.
