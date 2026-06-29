-- ============================================================================
-- 133_review_perms.sql
-- Make Call Review + Disposition TOGGLEABLE per user. reviews.js gated these by
-- "assigned closer / manager"; now they ALSO require submit_call_review /
-- submit_call_dispo, so a superadmin can revoke them per user. This grants those
-- permissions to exactly the roles that perform these actions today, so nothing
-- changes until a toggle is flipped.
--   submit_call_review : the assigned closer reviews their own call.
--   submit_call_dispo  : the assigned closer or a manager sets the disposition.
-- Idempotent.
-- ============================================================================
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r CROSS JOIN permissions p
WHERE p.name = 'submit_call_review'
  AND r.level::text IN ('closer', 'closer_manager')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r CROSS JOIN permissions p
WHERE p.name = 'submit_call_dispo'
  AND r.level::text IN (
        'closer', 'closer_manager', 'company_admin',
        'operations_manager', 'fronter_manager'
      )
ON CONFLICT DO NOTHING;
