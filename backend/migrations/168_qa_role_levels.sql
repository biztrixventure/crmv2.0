-- ============================================================================
-- 168_qa_role_levels.sql
-- QA Department — STEP 1 of the build. Add two new authority levels to the
-- role_level enum so custom_roles can be created at these levels:
--   qa_manager : runs QA for one or more companies (config, assignment, reports)
--   qa_agent   : does the actual call listening + scoring
--
-- IMPORTANT (Postgres rule): `ALTER TYPE … ADD VALUE` cannot be used in the same
-- transaction that later references the new value. This migration therefore does
-- ONLY the ADD VALUEs and nothing else — apply it, let it commit, THEN apply 169
-- (permissions) and 170 (schema), which reference the new levels. `IF NOT EXISTS`
-- makes it idempotent (safe to re-run).
--
-- role_level today: superadmin, readonly_admin, company_admin, operations_manager,
-- fronter_manager, closer_manager, compliance_manager, closer, fronter,
-- (+ legacy: manager, operations, disposition_setter, portal_client).
-- ============================================================================

ALTER TYPE role_level ADD VALUE IF NOT EXISTS 'qa_manager';
ALTER TYPE role_level ADD VALUE IF NOT EXISTS 'qa_agent';
