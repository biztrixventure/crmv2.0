-- ============================================================================
-- 123_exports_feature_flag.sql
-- Make CSV/Excel export a toggleable option without breaking anything. Adds an
-- 'exports' feature flag DEFAULT ENABLED, so every export stays on for everyone
-- (and the frontend treats an unknown flag as on anyway → zero breakdown). Once
-- this is in the catalog it appears in the per-user "Tabs & Features" panel, so a
-- superadmin can switch exports off for an individual user (or a company).
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================
INSERT INTO feature_flags (key, label, description, category, default_enabled, sort_order)
VALUES (
  'exports',
  'Export / CSV downloads',
  'Show the Export-CSV buttons on list, report and analytics views.',
  'data',
  true,
  90
)
ON CONFLICT (key) DO NOTHING;
