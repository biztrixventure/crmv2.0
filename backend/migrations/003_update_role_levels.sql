-- BizTrix CRM v2.0 - Update Role Levels
-- Add missing role types to support all user roles

-- First, we need to recreate the enum type to add missing values
-- PostgreSQL doesn't support adding values to enums easily, so we need to:
-- 1. Create a new enum type with all values
-- 2. Alter the column to use the new type
-- 3. Drop the old enum

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
