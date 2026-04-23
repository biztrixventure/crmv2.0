-- ============================================================================
-- Migration 019: Structural cleanup + correct permission sets
-- ============================================================================
-- 1. Remove stray closer-side roles from fronter companies
--    (Closer / Closer Manager / Compliance Manager should never be in a
--     fronter company — they were seeded incorrectly by earlier migrations)
--
-- 2. Fix Fronter role permissions
--    Remove dead permissions that have no UI for fronters:
--      - view_own_sales        (fronter shell has no "My Sales" tab)
--      - submit_call_review    (Rate Call button is closer-only UI)
--      - submit_call_dispo     (Set Dispo button is closer-only UI)
--
-- 3. Fix Fronter Manager permissions
--    Add what was missing (backup to migration 018):
--      - view_all_call_reviews (Reviews tab was invisible)
--      - search_sales          (Search Sales tab was invisible)
--
-- 4. Fix Closer permissions
--    Add what was missing (backup to migration 018):
--      - view_financial_data   (monthly payment was hidden on own sales)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Remove stray closer-side roles from FRONTER companies
--    Safe: only removes roles that have ZERO users assigned to them.
--    If a role has users, it is NOT deleted (operator must reassign first).
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM custom_roles cr
WHERE cr.level IN ('closer', 'closer_manager', 'compliance_manager')
  AND cr.company_id IN (
    SELECT id FROM companies WHERE company_type = 'fronter'
  )
  AND NOT EXISTS (
    SELECT 1 FROM user_company_roles ucr WHERE ucr.role_id = cr.id
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fix Fronter role: REMOVE dead permissions
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM role_permissions
WHERE role_id IN (
  SELECT id FROM custom_roles WHERE name = 'Fronter'
)
AND permission_id IN (
  SELECT id FROM permissions
  WHERE name IN ('view_own_sales', 'submit_call_review', 'submit_call_dispo')
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Fix Fronter Manager: ADD missing permissions (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT cr.id, p.id
FROM custom_roles cr
CROSS JOIN permissions p
WHERE cr.name = 'Fronter Manager'
  AND p.name IN ('view_all_call_reviews', 'search_sales')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = cr.id AND rp.permission_id = p.id
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Fix Closer: ADD missing permissions (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT cr.id, p.id
FROM custom_roles cr
CROSS JOIN permissions p
WHERE cr.name = 'Closer'
  AND p.name IN ('view_financial_data')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = cr.id AND rp.permission_id = p.id
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify results
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_stray_count   INT;
  v_fronter_dead  INT;
BEGIN
  -- Count remaining stray roles in fronter companies
  SELECT COUNT(*) INTO v_stray_count
  FROM custom_roles cr
  JOIN companies c ON c.id = cr.company_id
  WHERE c.company_type = 'fronter'
    AND cr.level IN ('closer', 'closer_manager', 'compliance_manager');

  -- Count dead perms still on Fronter roles
  SELECT COUNT(*) INTO v_fronter_dead
  FROM role_permissions rp
  JOIN custom_roles cr ON cr.id = rp.role_id
  JOIN permissions p   ON p.id  = rp.permission_id
  WHERE cr.name = 'Fronter'
    AND p.name IN ('view_own_sales', 'submit_call_review', 'submit_call_dispo');

  RAISE NOTICE 'Migration 019 complete.';
  RAISE NOTICE '  Remaining stray closer roles in fronter companies: %', v_stray_count;
  RAISE NOTICE '  Dead permissions remaining on Fronter roles: %', v_fronter_dead;

  IF v_stray_count > 0 THEN
    RAISE NOTICE '  NOTE: Some stray roles were NOT deleted because users are still assigned to them.';
    RAISE NOTICE '        Reassign those users to a correct role then re-run this migration.';
  END IF;
END $$;
