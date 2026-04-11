-- BizTrix CRM v2.0 - Row Level Security (RLS) Policies
-- Run this in Supabase SQL Editor after 001_create_schema.sql
-- Phase 2: RLS Setup

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

CREATE POLICY "service_role_can_create_logs" ON audit_logs
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
