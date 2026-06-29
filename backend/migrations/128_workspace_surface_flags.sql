-- ============================================================================
-- 128_workspace_surface_flags.sql
-- More delegatable surfaces for the Custom Access workspace. All DEFAULT OFF +
-- strict-gated, so nobody gets them until a superadmin grants them per user.
--
--   tool_compliance_review : full Compliance review (cross-company sales /
--                            transfers / callbacks). Equivalent to the
--                            compliance_manager surface, granted by flag.
--   tool_business_rules    : the Business Rules hub. Backend delegates
--                            business_config writes EXCEPT sensitive keys
--                            (per-user record views, access/record templates,
--                            chat limits, readonly nav) which stay superadmin-only.
--   tool_feature_admin     : the per-company Feature Flags matrix.
-- ============================================================================
INSERT INTO feature_flags (key, label, description, category, default_enabled, sort_order) VALUES
  ('tool_compliance_review', 'Tool · Compliance Review', 'Cross-company Compliance review of sales, transfers and callbacks.', 'admin_tools', false, 203),
  ('tool_business_rules',    'Tool · Business Rules',    'Configure Business Rules (dispositions, KPIs, drawer layouts, resell, dedup, …).', 'admin_tools', false, 204),
  ('tool_feature_admin',     'Tool · Feature Flags',     'Manage the per-company feature-flag matrix.', 'admin_tools', false, 205)
ON CONFLICT (key) DO NOTHING;
