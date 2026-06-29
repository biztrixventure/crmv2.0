-- ============================================================================
-- 129_workspace_company_flag.sql
-- Final delegatable surface for the Custom Access workspace: Company management.
-- DEFAULT OFF + strict-gated. No backend change needed — /api/companies is
-- already authorised per-action (list/detail scoped to the user's companies;
-- edit = edit_company permission; members = view_company_members; CREATE stays
-- superadmin-only). This flag just surfaces the Company management UI; the
-- backend still scopes what the delegate can actually see/do.
-- ============================================================================
INSERT INTO feature_flags (key, label, description, category, default_enabled, sort_order)
VALUES (
  'tool_company_admin',
  'Tool · Company Management',
  'View and edit the companies this user belongs to (creating new companies stays superadmin-only).',
  'admin_tools',
  false,
  206
)
ON CONFLICT (key) DO NOTHING;
