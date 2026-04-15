-- ============================================================================
-- Migration 007b: Seed data — MUST run AFTER 007a is committed
-- New enum values from 007a must be committed before they can be used here.
-- ============================================================================

-- ============================================================================
-- 1. SEED: compliance_manager system-level role template
-- ============================================================================
INSERT INTO custom_roles (name, description, level, company_id)
VALUES (
  'Compliance Manager',
  'Reviews and updates sale records for compliance, disputes, and chargebacks',
  'compliance_manager',
  NULL
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 2. REMOVE DUPLICATE superadmin system roles (keep oldest by id)
-- ============================================================================
DELETE FROM custom_roles
WHERE company_id IS NULL
  AND level = 'superadmin'
  AND id NOT IN (
    SELECT MIN(id) FROM custom_roles
    WHERE company_id IS NULL AND level = 'superadmin'
  );
