-- BizTrix CRM v2.0 - Initial Seed Data
-- Run this in Supabase SQL Editor after 002_enable_rls_policies.sql
-- Phase 2: Seed Data

-- ============================================================================
-- PERMISSIONS - Define all app permissions
-- ============================================================================
INSERT INTO permissions (name, description, category) VALUES
-- User Management
('create_user', 'Can create new users', 'user_management'),
('edit_user', 'Can edit user details', 'user_management'),
('delete_user', 'Can delete users', 'user_management'),
('manage_roles', 'Can create and manage roles', 'user_management'),

-- Company Management
('create_company', 'Can create new companies', 'company_management'),
('edit_company', 'Can edit company details', 'company_management'),
('delete_company', 'Can delete companies', 'company_management'),
('view_company_members', 'Can view company members', 'company_management'),

-- Transfers
('create_transfer', 'Can create transfers', 'transfers'),
('view_own_transfers', 'Can view own transfers', 'transfers'),
('view_team_transfers', 'Can view team transfers', 'transfers'),
('assign_transfer', 'Can assign transfer to closer', 'transfers'),
('update_transfer', 'Can update transfer status', 'transfers'),

-- Sales
('create_sale', 'Can create sales from transfers', 'sales'),
('view_own_sales', 'Can view own sales', 'sales'),
('view_team_sales', 'Can view team sales', 'sales'),
('update_sale', 'Can update sale status', 'sales'),

-- Reports
('view_reports', 'Can view reports and analytics', 'reports'),

-- Form Management
('manage_forms', 'Can manage form fields', 'forms')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- FORM_FIELDS - Default transfer form structure
-- ============================================================================
INSERT INTO form_fields (name, label, field_type, is_required, "order") VALUES
('customer_name', 'Customer Name', 'text', true, 1),
('customer_email', 'Email Address', 'email', true, 2),
('customer_phone', 'Phone Number', 'phone', true, 3),
('customer_company', 'Company Name', 'text', false, 4),
('product_service', 'Product/Service Type', 'select', true, 5),
('deal_value', 'Deal Value', 'number', false, 6),
('deal_currency', 'Currency', 'select', false, 7),
('notes', 'Additional Notes', 'textarea', false, 8),
('follow_up_date', 'Follow-up Date', 'date', false, 9)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- CUSTOM_ROLES - Predefined system roles (with level hierarchy)
-- ============================================================================

-- Note: These should be inserted as service_role since we need to bypass RLS
-- SuperAdmin role (system-level)
INSERT INTO custom_roles (name, description, level, company_id, parent_role_id) VALUES
('Super Admin', 'Full system access - can manage all companies', 'superadmin', NULL, NULL)
ON CONFLICT DO NOTHING;

-- Assign all permissions to Super Admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM custom_roles r, permissions p
WHERE r.name = 'Super Admin'
ON CONFLICT DO NOTHING;

-- You will need to run this query to get the superadmin role ID, then use it for other inserts
-- OR run this script with a service role context

-- Example - run this AFTER creating a test company:
-- Company Admin role per company
-- INSERT INTO custom_roles (name, description, level, company_id, parent_role_id) VALUES
-- ('Company Admin', 'Full company access', 'company_admin', <COMPANY_ID>, NULL)
-- ON CONFLICT DO NOTHING;

-- Manager roles
-- INSERT INTO custom_roles (name, description, level, company_id, parent_role_id) VALUES
-- ('Fronter Manager', 'Manage fronters and their transfers', 'manager', <COMPANY_ID>, NULL),
-- ('Closer Manager', 'Manage closers and their sales', 'manager', <COMPANY_ID>, NULL)
-- ON CONFLICT DO NOTHING;

-- Operations roles
-- INSERT INTO custom_roles (name, description, level, company_id, parent_role_id) VALUES
-- ('Fronter', 'Create and manage transfers', 'operations', <COMPANY_ID>, <MANAGER_ID>),
-- ('Closer', 'Receive transfers and create sales', 'operations', <COMPANY_ID>, <MANAGER_ID>)
-- ON CONFLICT DO NOTHING;

-- ============================================================================
-- INSTRUCTIONS FOR MANUAL SETUP
-- ============================================================================

/*
After running this seed script, you need to:

1. Create your first company:
   INSERT INTO companies (name, logo_url, is_active)
   VALUES ('Your Company Name', NULL, true);

2. Get the company ID from the insert (let's call it <COMPANY_ID>)

3. Create roles for this company:
   INSERT INTO custom_roles (name, description, level, company_id, parent_role_id) VALUES
   ('Company Admin', 'Full company access', 'company_admin', '<COMPANY_ID>', NULL),
   ('Fronter Manager', 'Manage fronter team', 'manager', '<COMPANY_ID>', NULL),
   ('Closer Manager', 'Manage closer team', 'manager', '<COMPANY_ID>', NULL),
   ('Fronter', 'Create transfers', 'operations', '<COMPANY_ID>', NULL),
   ('Closer', 'Close sales', 'operations', '<COMPANY_ID>', NULL);

4. Assign permissions to roles using the role IDs from step 3

5. Create your first super admin user in Supabase Auth dashboard

6. Link the user to the company and super admin role:
   INSERT INTO user_company_roles (user_id, company_id, role_id, is_active)
   VALUES ('<USER_ID>', '<COMPANY_ID>', '<SUPERADMIN_ROLE_ID>', true);

*/
