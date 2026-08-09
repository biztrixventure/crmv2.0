-- ============================================================================
-- 238_qa2_permissions.sql
-- QA v2 — Phase 1, part 7: permission catalog. Mirrors mig 169's exact
-- pattern (qa_* v1's permission seed) — idempotent, and the grant SELECTs
-- below usually match ZERO rows at apply time since qa_manager/qa_agent
-- custom_roles are created at runtime per company. Seeding the CATALOG (the
-- permissions INSERT) is what must happen now so the keys are grantable at
-- all, either by re-running this migration after the roles exist or by a
-- superadmin picking them in the role editor.
--
-- Namespaced qa2.* rather than v1's flat snake_case (view_qa_queue, etc.) —
-- deliberate deviation from mig 169's documented "snake_case verb_noun"
-- convention, to keep the two generations visually distinct in the role
-- editor while this brief's build order has both live in parallel.
--
-- IMPORTANT — the compliance-manager-toggle case is NOT expressed here.
-- compliance_manager's role_permissions below grant ONLY manage_org +
-- view_all_teams (org-chart wiring + cross-manager visibility) — never
-- manage_methods/manage_forms/manage_team/score. A compliance manager with a
-- LIVE qa2_manager_access grant (mig 232) gets IDENTICAL operational
-- authority to a real qa_manager, but that's a runtime check the Phase 3
-- scoping helper performs (role = compliance_manager AND an unrevoked
-- qa2_manager_access row exists), not an extra role_permissions grant here.
-- Baking it into role_permissions would give it to EVERY compliance manager
-- whether or not superadmin ever toggled them on.
-- ============================================================================

-- 1. Catalog ------------------------------------------------------------------
INSERT INTO permissions (name, description, category) VALUES
  ('qa2.manage_methods',   'Can create/edit/archive QA v2 methods and classification rules', 'qa2'),
  ('qa2.manage_forms',     'Can build, version and publish QA v2 scorecards',                 'qa2'),
  ('qa2.manage_org',       'Can wire the QA v2 org chart: toggle access, assign companies/agents to managers', 'qa2'),
  ('qa2.manage_team',      'Can sub-assign own companies/methods to own agents, set targets', 'qa2'),
  ('qa2.view_queue',       'Can see the QA v2 assignment queue and self-claim pool',          'qa2'),
  ('qa2.score',            'Can submit an evaluation against a QA v2 scorecard',              'qa2'),
  ('qa2.view_reports',     'Can view QA v2 scoring reports and export',                       'qa2'),
  ('qa2.view_all_teams',   'Cross-manager QA v2 visibility (compliance command-center view)', 'qa2'),
  ('qa2.view_own_scores',  'Fronter/closer read-only view of their own submitted evaluations','qa2')
ON CONFLICT (name) DO NOTHING;

-- 2. compliance_manager — org-chart wiring + cross-team visibility ONLY.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r CROSS JOIN permissions p
WHERE r.level::text = 'compliance_manager'
  AND p.name IN ('qa2.manage_org','qa2.view_all_teams')
ON CONFLICT DO NOTHING;

-- 3. qa_manager — full operational authority.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r CROSS JOIN permissions p
WHERE r.level::text = 'qa_manager'
  AND p.name IN ('qa2.manage_methods','qa2.manage_forms','qa2.manage_team',
                 'qa2.view_queue','qa2.score','qa2.view_reports')
ON CONFLICT DO NOTHING;

-- 4. qa_agent — queue + scoring only, same subset v1 grants (mig 169).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r CROSS JOIN permissions p
WHERE r.level::text = 'qa_agent'
  AND p.name IN ('qa2.view_queue','qa2.score')
ON CONFLICT DO NOTHING;

-- 5. fronter / closer — read-only "My Scores" (final score + pass/fail only,
--    per the build brief's Q&A — never per-parameter detail or comments).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r CROSS JOIN permissions p
WHERE r.level::text IN ('fronter','closer')
  AND p.name = 'qa2.view_own_scores'
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations (filename, note)
VALUES ('238_qa2_permissions.sql', 'QA v2 phase 1 — permission catalog + default role grants')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
