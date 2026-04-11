-- BizTrix CRM v2.0 - Update Role Levels
-- Add missing role types to support all user roles
--
-- This migration updates the role_level enum type. Since RLS policies reference
-- the level column, we must drop those policies first, then update the type.

-- ============================================================================
-- STEP 1: Drop RLS policies that reference the level column
-- ============================================================================

-- Policies on transfers table that check level
DROP POLICY IF EXISTS "managers_can_view_team_transfers" ON transfers;
DROP POLICY IF EXISTS "transfer_creators_can_update" ON transfers;

-- Policies on sales table that check level
DROP POLICY IF EXISTS "managers_can_view_team_sales" ON sales;
DROP POLICY IF EXISTS "sales_creators_can_update" ON sales;

-- ============================================================================
-- STEP 2: Update role_level enum type
-- ============================================================================

-- Create new enum with all role types
CREATE TYPE role_level_new AS ENUM (
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

-- Alter the custom_roles table to use the new enum
ALTER TABLE custom_roles
  ALTER COLUMN level SET DATA TYPE role_level_new
  USING level::text::role_level_new;

-- Drop the old enum type
DROP TYPE role_level;

-- Rename the new enum type to the original name
ALTER TYPE role_level_new RENAME TO role_level;

-- ============================================================================
-- STEP 3: Recreate the dropped RLS policies
-- ============================================================================

-- Transfers: managers (manager, company_admin, superadmin) can view all team transfers
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

-- Transfers: managers can update team transfers
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

-- Sales: managers can view all team sales
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

-- Sales: managers can update team sales
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

