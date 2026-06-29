-- ============================================================================
-- 136_create_perms.sql
-- Make Sale + Transfer CREATE toggleable. POST /sales and POST /transfers were
-- OPEN to any authenticated user; now they require create_sale / create_transfer.
-- Because creating was open to everyone, we grant BOTH perms to every role
-- (except superadmin, which bypasses, and readonly_admin, blocked from writes) so
-- nobody loses the ability to create until a superadmin revokes it per user.
--
-- NOTE: the VICIdial ingest creates transfers via its own server path (shared
-- token, no authMiddleware) and bulk uploads run as superadmin, so neither is
-- affected by the route-level gate. Idempotent.
-- ============================================================================
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r
CROSS JOIN permissions p
WHERE r.level::text NOT IN ('superadmin', 'readonly_admin')
  AND p.name IN ('create_sale', 'create_transfer')
ON CONFLICT DO NOTHING;
