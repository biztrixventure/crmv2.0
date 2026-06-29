-- ============================================================================
-- 135_role_crud_perms.sql
-- Split the coarse manage_roles into granular create_role / update_role /
-- delete_role so a superadmin can grant e.g. "edit roles but not delete". The
-- role routes now gate POST→create_role, PUT→update_role, DELETE→delete_role.
--
-- To change NOTHING for existing users, grant all three to every role that holds
-- manage_roles today (they keep full role CRUD). manage_roles itself stays in the
-- catalog as the "all three" convenience; revoke it + grant the granular ones to
-- restrict a user to a subset. Idempotent.
-- ============================================================================
INSERT INTO permissions (name, description, category) VALUES
  ('create_role', 'Can create roles',  'user_management'),
  ('update_role', 'Can edit roles',    'user_management'),
  ('delete_role', 'Can delete roles',  'user_management')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions mp ON mp.id = rp.permission_id AND mp.name = 'manage_roles'
CROSS JOIN permissions p
WHERE p.name IN ('create_role', 'update_role', 'delete_role')
ON CONFLICT DO NOTHING;
