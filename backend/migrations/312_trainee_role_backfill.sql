-- ============================================================================
-- 312_trainee_role_backfill.sql -- give every company that ALREADY exists a
-- Trainee role.
--
-- Mig 311 added the `trainee` role LEVEL and the training permissions, but a
-- level is not a role: a company can only assign a role that exists in its own
-- custom_roles. So after 311 the portal was live and there was still nobody who
-- could be made a trainee without someone hand-building the role six times.
--
-- New companies are covered in code -- TRAINEE_ROLE is in both BLP default sets
-- in backend/routes/roles.js, so POST /roles/seed-defaults creates it. This file
-- is only for the companies that were seeded before that existed.
--
-- THE PERMISSION SET IS DELIBERATELY TINY, and that is the point: no
-- create_transfer, no create_sale. Promotion to Fronter or Closer is what grants
-- those, so a trainee cannot touch a live lead before someone signs them off.
-- It must stay in step with TRAINEE_ROLE in backend/routes/roles.js.
--
-- Idempotent, and safe to run again after new companies appear: the NOT EXISTS
-- skips any company that already has a role named Trainee, and the grants are
-- ON CONFLICT DO NOTHING against role_permissions' UNIQUE(role_id, permission_id).
-- ============================================================================

-- -- 1. The role, one per company that does not have it -------------------------
-- Both company types. A closer floor trains new hires exactly the way a fronter
-- floor does, which is why this is not filtered on company_type.
INSERT INTO custom_roles (name, description, level, company_id)
SELECT
  'Trainee',
  'New hire in training — works through the training material, no live leads yet',
  'trainee'::role_level,
  c.id
FROM companies c
WHERE c.is_active
  AND NOT EXISTS (
    SELECT 1 FROM custom_roles r
    WHERE r.company_id = c.id AND r.name = 'Trainee'
  );

-- -- 2. Its permissions ---------------------------------------------------------
-- Applied to EVERY trainee-level role, not just the ones inserted above, so a
-- re-run also repairs a role whose grants were cleared by hand.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r
CROSS JOIN permissions p
WHERE r.level::text = 'trainee'
  AND p.name IN ('training.view', 'view_notifications')
ON CONFLICT DO NOTHING;

-- -- 3. Verify ------------------------------------------------------------------
-- Expected after this runs: one Trainee role per active company, each holding
-- exactly the two permissions above.
--
--   SELECT c.name, r.id IS NOT NULL AS has_trainee, count(rp.permission_id) AS perms
--   FROM companies c
--   LEFT JOIN custom_roles r ON r.company_id = c.id AND r.name = 'Trainee'
--   LEFT JOIN role_permissions rp ON rp.role_id = r.id
--   WHERE c.is_active
--   GROUP BY c.name, r.id
--   ORDER BY c.name;
