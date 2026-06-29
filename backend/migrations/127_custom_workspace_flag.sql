-- ============================================================================
-- 127_custom_workspace_flag.sql
-- "Custom Access workspace" — an opt-in, permission-driven unified shell. When a
-- superadmin enables this flag for a user (user_feature_flags) that user is
-- routed to /workspace instead of their role's shell, and sees exactly the
-- tabs/tools/records the superadmin has granted them (every surface is still
-- gated by its own permission/flag). Existing role shells are untouched.
--
-- DEFAULT DISABLED + strict gating on the frontend, so no one gets the workspace
-- until explicitly granted. Idempotent.
-- ============================================================================
INSERT INTO feature_flags (key, label, description, category, default_enabled, sort_order)
VALUES (
  'custom_workspace',
  'Custom Access workspace',
  'Route this user to the unified, permission-driven workspace (instead of their role shell). They see only what you grant them.',
  'admin_tools',
  false,
  210
)
ON CONFLICT (key) DO NOTHING;
