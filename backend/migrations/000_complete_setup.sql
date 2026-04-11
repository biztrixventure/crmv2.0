-- ============================================================================
-- BizTrix CRM v2.0 - Complete Database Setup
-- ============================================================================
-- SINGLE FILE FOR FRESH SUPABASE DEPLOYMENT
--
-- Run this ENTIRE file once in Supabase SQL Editor to set up:
-- - All database tables
-- - Row Level Security (RLS) policies
-- - Role level enum with all 9 role types
-- - Initial seed data (permissions, form fields, roles)
--
-- After this completes, follow the manual setup instructions at the end.
-- ============================================================================

-- ============================================================================
-- PHASE 1: CREATE SCHEMA
-- ============================================================================

-- 1. Companies table
CREATE TABLE IF NOT EXISTS companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  logo_url TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true
);

-- 2. Custom Roles table with updated role_level enum
CREATE TYPE role_level AS ENUM (
  'superadmin',
  'readonly_admin',
  'company_admin',
  'closer',
  'fronter',
  'manager',
  'operations_manager',
  'closer_manager',
  'operations'
);

CREATE TABLE IF NOT EXISTS custom_roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  level role_level NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  parent_role_id UUID REFERENCES custom_roles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint: name should be unique per company (or global for superadmin)
CREATE UNIQUE INDEX idx_roles_name_company ON custom_roles(name, company_id);

-- 3. Permissions table
CREATE TABLE IF NOT EXISTS permissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  category VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Role-Permission mapping table
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  role_id UUID NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(role_id, permission_id)
);

-- 5. User Company Roles mapping table
CREATE TABLE IF NOT EXISTS user_company_roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES custom_roles(id),
  assigned_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(user_id, company_id)
);

-- 6. User Profiles table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  avatar_url TEXT,
  theme_preference VARCHAR(20) DEFAULT 'light',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Form Fields table (global, not per-company)
CREATE TYPE field_type AS ENUM ('text', 'email', 'number', 'textarea', 'select', 'date', 'phone');

CREATE TABLE IF NOT EXISTS form_fields (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  label VARCHAR(255) NOT NULL,
  field_type field_type NOT NULL,
  is_required BOOLEAN DEFAULT false,
  options JSONB,
  "order" INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Transfers table
CREATE TYPE transfer_status AS ENUM ('pending', 'assigned', 'completed', 'cancelled');

CREATE TABLE IF NOT EXISTS transfers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  assigned_to UUID REFERENCES auth.users(id),
  form_data JSONB NOT NULL,
  status transfer_status DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. Sales table
CREATE TYPE sale_status AS ENUM ('open', 'closed_won', 'closed_lost');

CREATE TABLE IF NOT EXISTS sales (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  transfer_id UUID NOT NULL UNIQUE REFERENCES transfers(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status sale_status DEFAULT 'open',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10. Audit Log table (for tracking changes)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  table_name VARCHAR(100) NOT NULL,
  operation VARCHAR(20) NOT NULL,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_transfers_company_id ON transfers(company_id);
CREATE INDEX idx_transfers_created_by ON transfers(created_by);
CREATE INDEX idx_transfers_assigned_to ON transfers(assigned_to);
CREATE INDEX idx_sales_company_id ON sales(company_id);
CREATE INDEX idx_sales_created_by ON sales(created_by);
CREATE INDEX idx_user_company_roles_user_id ON user_company_roles(user_id);
CREATE INDEX idx_user_company_roles_company_id ON user_company_roles(company_id);
CREATE INDEX idx_custom_roles_company_id ON custom_roles(company_id);

-- Enable RLS on all tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_company_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PHASE 2: ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Trust the SERVICE ROLE for admin operations
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres;

-- ============================================================================
-- USER PROFILES - Users can only see their own profile
-- ============================================================================
CREATE POLICY "users_can_view_own_profile" ON user_profiles
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "users_can_update_own_profile" ON user_profiles
  FOR UPDATE USING (user_id = auth.uid());

-- Service role can do everything
CREATE POLICY "service_role_can_insert_profiles" ON user_profiles
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_can_update_profiles" ON user_profiles
  FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "service_role_can_delete_profiles" ON user_profiles
  FOR DELETE USING (auth.role() = 'service_role');

-- ============================================================================
-- COMPANIES - Users can only see companies they belong to
-- ============================================================================
CREATE POLICY "users_can_view_their_companies" ON companies
  FOR SELECT USING (
    id IN (
      SELECT company_id FROM user_company_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- Service role can see all
CREATE POLICY "service_role_can_view_all_companies" ON companies
  FOR SELECT USING (auth.role() = 'service_role');

-- ============================================================================
-- CUSTOM_ROLES - Users can view roles in their company
-- ============================================================================
CREATE POLICY "users_can_view_company_roles" ON custom_roles
  FOR SELECT USING (
    company_id IS NULL -- SuperAdmin roles
    OR company_id IN (
      SELECT company_id FROM user_company_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "service_role_can_insert_roles" ON custom_roles
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_can_update_roles" ON custom_roles
  FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "service_role_can_delete_roles" ON custom_roles
  FOR DELETE USING (auth.role() = 'service_role');

-- ============================================================================
-- PERMISSIONS - View only
-- ============================================================================
CREATE POLICY "authenticated_users_can_view_permissions" ON permissions
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));

-- ============================================================================
-- ROLE_PERMISSIONS - Users can view permissions for company roles
-- ============================================================================
CREATE POLICY "users_can_view_role_permissions" ON role_permissions
  FOR SELECT USING (
    role_id IN (
      SELECT id FROM custom_roles WHERE
        company_id IS NULL
        OR company_id IN (
          SELECT company_id FROM user_company_roles
          WHERE user_id = auth.uid() AND is_active = true
        )
    )
  );

CREATE POLICY "service_role_can_insert_permissions" ON role_permissions
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_can_update_permissions" ON role_permissions
  FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "service_role_can_delete_permissions" ON role_permissions
  FOR DELETE USING (auth.role() = 'service_role');

-- ============================================================================
-- USER_COMPANY_ROLES - Users can view team members in their company
-- ============================================================================
CREATE POLICY "users_can_view_company_members" ON user_company_roles
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM user_company_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "service_role_can_insert_user_roles" ON user_company_roles
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_can_update_user_roles" ON user_company_roles
  FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "service_role_can_delete_user_roles" ON user_company_roles
  FOR DELETE USING (auth.role() = 'service_role');

-- ============================================================================
-- FORM_FIELDS - Everyone can view (forms are global)
-- ============================================================================
CREATE POLICY "authenticated_users_can_view_forms" ON form_fields
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));

CREATE POLICY "service_role_can_insert_forms" ON form_fields
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_can_update_forms" ON form_fields
  FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "service_role_can_delete_forms" ON form_fields
  FOR DELETE USING (auth.role() = 'service_role');

-- ============================================================================
-- TRANSFERS - Role-based visibility
-- ============================================================================
CREATE POLICY "fronters_can_view_own_transfers" ON transfers
  FOR SELECT USING (
    created_by = auth.uid() AND
    company_id IN (
      SELECT company_id FROM user_company_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "closers_can_view_assigned_transfers" ON transfers
  FOR SELECT USING (
    assigned_to = auth.uid() AND
    company_id IN (
      SELECT company_id FROM user_company_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "managers_can_view_team_transfers" ON transfers
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM user_company_roles
      WHERE user_id = auth.uid() AND is_active = true
      AND role_id IN (
        SELECT id FROM custom_roles WHERE level IN ('manager', 'company_admin', 'superadmin')
      )
    )
  );

CREATE POLICY "fronters_can_create_transfers" ON transfers
  FOR INSERT WITH CHECK (
    created_by = auth.uid() AND
    company_id IN (
      SELECT company_id FROM user_company_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "transfer_creators_can_update" ON transfers
  FOR UPDATE USING (
    created_by = auth.uid() OR
    assigned_to = auth.uid() OR
    company_id IN (
      SELECT company_id FROM user_company_roles
      WHERE user_id = auth.uid() AND is_active = true
      AND role_id IN (
        SELECT id FROM custom_roles WHERE level IN ('manager', 'company_admin', 'superadmin')
      )
    )
  );

CREATE POLICY "service_role_can_insert_transfers" ON transfers
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_can_update_transfers" ON transfers
  FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "service_role_can_delete_transfers" ON transfers
  FOR DELETE USING (auth.role() = 'service_role');

-- ============================================================================
-- SALES - Role-based visibility
-- ============================================================================
CREATE POLICY "closers_can_view_own_sales" ON sales
  FOR SELECT USING (
    created_by = auth.uid() AND
    company_id IN (
      SELECT company_id FROM user_company_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "managers_can_view_team_sales" ON sales
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM user_company_roles
      WHERE user_id = auth.uid() AND is_active = true
      AND role_id IN (
        SELECT id FROM custom_roles WHERE level IN ('manager', 'company_admin', 'superadmin')
      )
    )
  );

CREATE POLICY "closers_can_create_sales" ON sales
  FOR INSERT WITH CHECK (
    created_by = auth.uid() AND
    company_id IN (
      SELECT company_id FROM user_company_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "sales_creators_can_update" ON sales
  FOR UPDATE USING (
    created_by = auth.uid() OR
    company_id IN (
      SELECT company_id FROM user_company_roles
      WHERE user_id = auth.uid() AND is_active = true
      AND role_id IN (
        SELECT id FROM custom_roles WHERE level IN ('manager', 'company_admin', 'superadmin')
      )
    )
  );

CREATE POLICY "service_role_can_insert_sales" ON sales
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_can_update_sales" ON sales
  FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "service_role_can_delete_sales" ON sales
  FOR DELETE USING (auth.role() = 'service_role');

-- ============================================================================
-- AUDIT_LOGS - Admins and service role only
-- ============================================================================
CREATE POLICY "service_role_can_view_logs" ON audit_logs
  FOR SELECT USING (auth.role() = 'service_role');

CREATE POLICY "service_role_can_insert_logs" ON audit_logs
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- PHASE 3: SEED DATA
-- ============================================================================

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
-- CUSTOM_ROLES - Predefined system roles
-- ============================================================================
INSERT INTO custom_roles (name, description, level, company_id, parent_role_id) VALUES
('Super Admin', 'Full system access - can manage all companies', 'superadmin', NULL, NULL)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SETUP COMPLETE
-- ============================================================================

/*
================================================================================
NEXT STEPS - Manual Setup Required
================================================================================

After this script completes successfully, follow these steps:

1. CREATE YOUR FIRST COMPANY
   - Go to Supabase Console → Companies table
   - OR run: INSERT INTO companies (name, is_active) VALUES ('Your Company Name', true);

2. CREATE ROLES FOR THIS COMPANY
   - Get the company_id from step 1
   - Run the following SQL (replace <COMPANY_ID>):

   INSERT INTO custom_roles (name, description, level, company_id) VALUES
   ('Company Admin', 'Full company access', 'company_admin', '<COMPANY_ID>'),
   ('Fronter Manager', 'Manage fronter team', 'manager', '<COMPANY_ID>'),
   ('Closer Manager', 'Manage closer team', 'manager', '<COMPANY_ID>'),
   ('Fronter', 'Create and manage transfers', 'fronter', '<COMPANY_ID>'),
   ('Closer', 'Manage sales from transfers', 'closer', '<COMPANY_ID>');

3. ASSIGN PERMISSIONS TO ROLES
   - Insert role-permission mappings for each role

4. CREATE YOUR FIRST SUPER ADMIN USER
   - Go to Supabase Auth → Users tab
   - Click "Add User" and create a user with:
     * Email: admin@yourdomain.com
     * Password: (strong password)

5. LINK USER TO COMPANY AND SUPER ADMIN ROLE
   - Get the user_id from step 4 and super admin role_id
   - Run the following SQL:

   INSERT INTO user_company_roles (user_id, company_id, role_id, is_active)
   VALUES ('<USER_ID>', '<COMPANY_ID>',
           (SELECT id FROM custom_roles WHERE name = 'Super Admin' LIMIT 1),
           true);

6. CREATE USER PROFILE
   - Run the following SQL (replace <USER_ID>):

   INSERT INTO user_profiles (user_id, first_name, last_name, theme_preference)
   VALUES ('<USER_ID>', 'System', 'Administrator', 'light');

7. TEST YOUR SETUP
   - Go to your app login page
   - Log in with the email and password from step 4
   - You should be redirected to the admin dashboard
   - Verify you can see the admin interface

================================================================================
AVAILABLE ROLES
================================================================================
- superadmin, readonly_admin, company_admin, closer, fronter,
  manager, operations_manager, closer_manager, operations

================================================================================
FRONTEND ENVIRONMENT VARIABLES (Set in Coolify/Deployment)
================================================================================
BUILDTIME + RUNTIME:
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY
- VITE_API_URL

RUNTIME ONLY:
- SUPABASE_SERVICE_ROLE_KEY
- DATABASE_URL
- NODE_ENV
- PORT
- CORS_ORIGIN

================================================================================
*/
