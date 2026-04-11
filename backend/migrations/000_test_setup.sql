-- ============================================================================
-- QUICK TEST SETUP - Run this in Supabase SQL Editor
-- ============================================================================
-- After running 001 and 002 migrations, run this to set up test data

-- 1. Create test company
INSERT INTO companies (name, is_active, created_by)
SELECT 'Test Company', true, id
FROM auth.users
WHERE email = 'your-test-email@example.com'
LIMIT 1;

-- 2. Create SuperAdmin role
INSERT INTO custom_roles (name, description, level, company_id, created_by)
SELECT 'SuperAdmin', 'System Administrator', 1, NULL, id
FROM auth.users
WHERE email = 'your-test-email@example.com'
LIMIT 1;

-- 3. Assign permissions to SuperAdmin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT cr.id, p.id
FROM custom_roles cr, permissions p
WHERE cr.name = 'SuperAdmin'
AND p.name = ANY(ARRAY['create_user', 'view_users', 'view_transfers', 'view_sales']);

-- 4. Assign user to company with SuperAdmin role
INSERT INTO user_company_roles (user_id, company_id, role_id, assigned_by, is_active)
SELECT
  au.id,
  c.id,
  cr.id,
  au.id,
  true
FROM auth.users au
CROSS JOIN companies c
CROSS JOIN custom_roles cr
WHERE au.email = 'your-test-email@example.com'
AND c.name = 'Test Company'
AND cr.name = 'SuperAdmin';

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check company created
SELECT id, name FROM companies LIMIT 5;

-- Check role created
SELECT id, name, level FROM custom_roles LIMIT 5;

-- Check user assignment
SELECT uc.user_id, uc.company_id, cr.name as role_name
FROM user_company_roles uc
JOIN custom_roles cr ON uc.role_id = cr.id;

-- Check permissions
SELECT cr.name as role, p.name as permission
FROM role_permissions rp
JOIN custom_roles cr ON rp.role_id = cr.id
JOIN permissions p ON rp.permission_id = p.id;
