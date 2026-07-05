-- ============================================================================
-- 181_qa_compliance_admin.sql
-- Put the whole QA department under COMPLIANCE. Adds a scoped admin permission,
-- grants it (+ the QA management perms) to compliance_manager roles, and seeds
-- GLOBAL qa_manager / qa_agent roles (company_id NULL) so one role can be
-- assigned across MANY companies — a compliance-managed QA manager/agent can
-- cover multiple companies with a single role.
-- Apply AFTER 169. Idempotent.
-- ============================================================================

-- 1. scoped permission: manage the QA department (users + company enablement).
--    QA-only by design — the /qa/admin endpoints never touch non-QA roles.
INSERT INTO permissions (name, description, category) VALUES
  ('manage_qa_department', 'Compliance: manage the QA department — create/assign QA managers & agents across companies, enable/disable QA', 'qa')
ON CONFLICT (name) DO NOTHING;

-- 2. grant it + the QA management perms to every compliance_manager role.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r CROSS JOIN permissions p
WHERE r.level::text = 'compliance_manager'
  AND p.name IN ('manage_qa_department', 'view_all_qa_reviews', 'view_qa_reports',
                 'manage_qa_config', 'assign_qa_tasks', 'view_qa_queue', 'override_qa_review')
ON CONFLICT DO NOTHING;

-- 3. GLOBAL QA roles (company_id NULL) — reusable across companies.
INSERT INTO custom_roles (name, level, description, company_id)
SELECT 'QA Manager', 'qa_manager', 'Global QA Manager (compliance-managed, multi-company)', NULL
WHERE NOT EXISTS (SELECT 1 FROM custom_roles WHERE company_id IS NULL AND level::text = 'qa_manager');

INSERT INTO custom_roles (name, level, description, company_id)
SELECT 'QA Agent', 'qa_agent', 'Global QA Agent (compliance-managed, multi-company)', NULL
WHERE NOT EXISTS (SELECT 1 FROM custom_roles WHERE company_id IS NULL AND level::text = 'qa_agent');

-- 4. grant the global QA roles their permissions.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r CROSS JOIN permissions p
WHERE r.company_id IS NULL AND r.level::text = 'qa_manager'
  AND p.name IN ('view_qa_queue', 'submit_qa_review', 'assign_qa_tasks', 'manage_qa_config', 'view_qa_reports', 'view_all_qa_reviews', 'override_qa_review')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r CROSS JOIN permissions p
WHERE r.company_id IS NULL AND r.level::text = 'qa_agent'
  AND p.name IN ('view_qa_queue', 'submit_qa_review')
ON CONFLICT DO NOTHING;
