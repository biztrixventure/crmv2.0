-- ============================================================================
-- 134_callback_number_perms.sql
-- Make callback-number management TOGGLEABLE. callbackNumbers.js gated the
-- manager actions (edit any number, delete/release any, reassign) by ROLE; now
-- they gate on manage_callback_numbers (edit/delete) and reassign_callback_numbers
-- (reassign). Owner self-actions (log attempt, claim, edit/delete own) are
-- unchanged. This grants those permissions to the manager roles that had access,
-- so nothing changes until a superadmin toggles per user. Idempotent.
-- ============================================================================
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r CROSS JOIN permissions p
WHERE r.level::text IN (
        'company_admin', 'manager', 'operations_manager',
        'closer_manager', 'fronter_manager'
      )
  AND p.name IN ('manage_callback_numbers', 'reassign_callback_numbers')
ON CONFLICT DO NOTHING;
