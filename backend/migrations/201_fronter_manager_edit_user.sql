-- ============================================================================
-- 201 — Let fronter managers edit their fronters (details + password reset).
--
-- Editing a user and resetting a password both require the `edit_user`
-- permission on the target's company (routes/users.js). fronter_manager roles
-- generally didn't have it, so a fronter manager couldn't change a fronter's
-- details or password. Grant edit_user to every fronter_manager custom role.
--
-- This is safe: the update + password endpoints ALSO enforce a hierarchy guard
-- (a manager can only edit / reset users strictly BELOW their own authority and
-- only within their own company), so this grant lets a fronter manager manage
-- their fronters — not peers or superiors, not other tenants.
-- ============================================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT cr.id, p.id
FROM custom_roles cr
CROSS JOIN permissions p
WHERE cr.level = 'fronter_manager'
  AND p.name = 'edit_user'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = cr.id AND rp.permission_id = p.id
  );
