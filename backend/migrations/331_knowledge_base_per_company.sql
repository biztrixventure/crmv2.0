-- ============================================================================
-- 331_knowledge_base_per_company.sql
--
-- THE KNOWLEDGE BASE BELONGS TO A COMPANY, and the people who coach the floor
-- are the ones who write it.
--
-- Scripts and FAQs (the "Scripts & Rebuttals" surface, migs 038-040) had no
-- company_id at all: every row was estate-wide, and the only people who could
-- write one were a superadmin and the compliance manager (both hardcoded in the
-- routes -- NOT ONE role in the estate holds manage_faqs today). So a fronter
-- manager could not add the rebuttal their own floor needed, and if they could
-- have, every other tenant would have got it too.
--
-- Two changes, and the second is why the first is safe:
--   1. company_id on scripts + faqs. NULL keeps its old meaning -- shared with
--      every company -- so every row that exists today stays exactly as visible
--      as it is now, and only a superadmin may edit those (routes enforce it).
--      A row written by a company's own manager carries that company.
--   2. manage_faqs granted to the roles that actually coach: fronter_manager,
--      closer_manager, operations_manager, company_admin. Team leads are NOT a
--      role -- teams.lead_user_id names them -- so the route grants them the
--      same authority for their own company instead (utils/knowledgeBase.js).
--
-- Also: training.manage was seeded for company_admin, fronter_manager,
-- operations_manager and compliance_manager but NOT closer_manager, so a closer
-- floor could not add its own training. Granted here for the same reason.
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. company scoping ──────────────────────────────────────────────────────
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE faqs    ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;

COMMENT ON COLUMN scripts.company_id IS 'Owning company. NULL = shared with every company (superadmin-only to edit).';
COMMENT ON COLUMN faqs.company_id    IS 'Owning company. NULL = shared with every company (superadmin-only to edit).';

-- Every read is "this company OR shared", so the filter is on company_id.
CREATE INDEX IF NOT EXISTS idx_scripts_company ON scripts(company_id);
CREATE INDEX IF NOT EXISTS idx_faqs_company    ON faqs(company_id);

-- ── 2. who may write it ─────────────────────────────────────────────────────
-- One statement per permission so a missing permission row can never take the
-- other grant down with it. NOT EXISTS rather than ON CONFLICT: role_permissions
-- has no named unique constraint to rely on.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r
CROSS JOIN permissions p
WHERE p.name = 'manage_faqs'
  AND r.level::text IN ('fronter_manager', 'closer_manager', 'operations_manager', 'company_admin')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.permission_id = p.id
  );

-- A closer floor trains its own people too.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r
CROSS JOIN permissions p
WHERE p.name = 'training.manage'
  AND r.level::text = 'closer_manager'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.permission_id = p.id
  );

-- ── 3. what changed ─────────────────────────────────────────────────────────
DO $$
DECLARE
  n_faq int;
  n_train int;
  n_shared_scripts int;
  n_shared_faqs int;
BEGIN
  SELECT count(*) INTO n_faq FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id WHERE p.name = 'manage_faqs';
  SELECT count(*) INTO n_train FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id WHERE p.name = 'training.manage';
  SELECT count(*) INTO n_shared_scripts FROM scripts WHERE company_id IS NULL;
  SELECT count(*) INTO n_shared_faqs FROM faqs WHERE company_id IS NULL;
  RAISE NOTICE 'manage_faqs grants: %, training.manage grants: %, shared scripts kept: %, shared FAQs kept: %',
    n_faq, n_train, n_shared_scripts, n_shared_faqs;
END $$;
