-- ============================================================================
-- 126_admin_tool_flags.sql
-- Make the superadmin-only Intelligence tools DELEGATABLE. Adds feature flags
-- (DEFAULT DISABLED) for each tool so a superadmin can grant them to a single
-- user (user_feature_flags), a company (company_feature_flags) or everyone — all
-- through the access panel / feature matrix we already have. Superadmin and
-- readonly_admin always keep access (the route guards bypass the flag for them).
--
-- Default OFF is important: the frontend treats an unknown flag as ON, but a
-- catalogued flag uses default_enabled — so nobody gets these tools until granted.
-- Idempotent.
-- ============================================================================
INSERT INTO feature_flags (key, label, description, category, default_enabled, sort_order) VALUES
  ('tool_customer_profiles', 'Tool · Customer Profiles', 'Access the Customer Profiles browser (per-customer history + segments).', 'admin_tools', false, 200),
  ('tool_data_analyzer',     'Tool · Data Analyzer',     'Access the Data Analyzer.',                                              'admin_tools', false, 201),
  ('tool_chat_control',      'Tool · Chat Control',      'Access Chat Control — view chat activity and conversations.',            'admin_tools', false, 202)
ON CONFLICT (key) DO NOTHING;
