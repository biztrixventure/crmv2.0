-- ============================================================================
-- 169_qa_permissions.sql
-- QA Department — STEP 2. Seed the QA permission catalog + grant to any QA roles
-- that already exist. Apply AFTER 168 has committed. Idempotent.
--
-- Permission keys (snake_case verb_noun, matching existing conventions like
-- submit_call_review / view_all_call_reviews / manage_closer_pool):
--   view_qa_queue        — see the QA worklist (own assignments; pool if manager)
--   submit_qa_review     — score a call against a scorecard
--   assign_qa_tasks      — assign unassigned queue items to a qa_agent
--   manage_qa_config     — edit per-company QA config + scorecards
--   view_qa_reports      — QA scoring dashboards / exports
--   view_all_qa_reviews  — cross-company QA visibility (a QA org covering >1 co)
--
-- NOTE ON GRANTS: role_permissions rows are (custom_role, permission). Custom
-- roles at the qa_* levels are created at RUNTIME by a superadmin (per company),
-- so at apply time the grant SELECTs below usually match ZERO rows — that's
-- expected. Re-running this migration AFTER the qa roles exist grants them (it's
-- idempotent), OR the superadmin picks these permissions in the role editor when
-- creating the role. Seeding the CATALOG (the INSERT INTO permissions) is the
-- part that must happen now so the keys are grantable at all.
-- ============================================================================

-- 1. Catalog ------------------------------------------------------------------
INSERT INTO permissions (name, description, category) VALUES
  ('view_qa_queue',       'Can see the QA review worklist',                    'qa'),
  ('submit_qa_review',    'Can score a call against a QA scorecard',           'qa'),
  ('assign_qa_tasks',     'Can assign QA queue items to a QA agent',           'qa'),
  ('manage_qa_config',    'Can edit per-company QA config and scorecards',     'qa'),
  ('view_qa_reports',     'Can view QA scoring reports for own company',       'qa'),
  ('view_all_qa_reviews', 'Can view QA reviews across all companies',          'qa')
ON CONFLICT (name) DO NOTHING;

-- 2. Default grants for existing QA roles (forward-compatible; usually a no-op
--    on first apply — see note above). qa_manager gets everything; qa_agent gets
--    the queue + review verbs only.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r CROSS JOIN permissions p
WHERE r.level::text = 'qa_manager'
  AND p.name IN ('view_qa_queue','submit_qa_review','assign_qa_tasks',
                 'manage_qa_config','view_qa_reports','view_all_qa_reviews')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r CROSS JOIN permissions p
WHERE r.level::text = 'qa_agent'
  AND p.name IN ('view_qa_queue','submit_qa_review')
ON CONFLICT DO NOTHING;
