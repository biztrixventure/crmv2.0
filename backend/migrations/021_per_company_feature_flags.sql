-- Migration 021: Per-company feature flags
-- Replaces the old global feature_flags table with a catalog + per-company override design.

-- Drop old global table if it exists (was never applied, but guard anyway)
DROP TABLE IF EXISTS feature_flags CASCADE;

-- ── Global flag catalog ───────────────────────────────────────────────────────
CREATE TABLE feature_flags (
  key             text PRIMARY KEY,
  label           text NOT NULL,
  description     text,
  category        text NOT NULL DEFAULT 'general',
  default_enabled boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ── Per-company flag states ───────────────────────────────────────────────────
CREATE TABLE company_feature_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES feature_flags(key) ON DELETE CASCADE,
  is_enabled  boolean NOT NULL DEFAULT false,
  enabled_at  timestamptz,
  enabled_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  disabled_at timestamptz,
  disabled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, feature_key)
);

-- ── Seed: 12 feature definitions ─────────────────────────────────────────────
INSERT INTO feature_flags (key, label, description, category, default_enabled, sort_order) VALUES
  ('transfers',           'Transfer Pipeline',       'Fronters create and send leads to closers via the transfer form.',                            'core',       true,  1),
  ('sales',               'Sales Management',        'Closers create, track, and submit sale records through the full deal lifecycle.',              'core',       true,  2),
  ('compliance_workflow', 'Compliance Workflow',     'Compliance managers review, approve, or return sales before they are marked closed-won.',     'core',       true,  3),
  ('callbacks',           'Callback Reminders',      'Users schedule timed callbacks with OS push + in-app notifications when due.',                'operations', true,  4),
  ('callback_numbers',    'Callback Number Tracking','Track individual phone numbers, log call attempts, manage claims and 7-day lock/expiry.',      'operations', false, 5),
  ('number_assignment',   'Number List Assignment',  'Managers upload CSV number lists and assign batches to fronters to work through.',            'operations', false, 6),
  ('call_reviews',        'Call Reviews',            'Closers and fronters rate call quality (excellent → bad) and set dispositions.',              'quality',    true,  7),
  ('reports',             'Reports & Analytics',     'Dashboard stats, fronter/closer leaderboards, and conversion rate analytics.',                'analytics',  true,  8),
  ('form_builder',        'Form Builder',            'Admins customise the transfer form fields, types, sections, and required status.',            'admin',      false, 9),
  ('push_notifications',  'Push Notifications',      'Browser/OS-level push notifications for callbacks, approvals, and assignments.',              'operations', true,  10),
  ('search_sales',        'Sale Search',             'Full-text search across all sales by name, phone, email, reference number, or VIN.',         'analytics',  false, 11),
  ('csv_export',          'CSV Export',              'Compliance and managers export filtered sale records to CSV.',                                 'analytics',  false, 12)
ON CONFLICT (key) DO NOTHING;

-- ── Backfill: create enabled rows for all existing companies ──────────────────
-- All companies get the default state for each flag (mirrors default_enabled).
INSERT INTO company_feature_flags (company_id, feature_key, is_enabled)
SELECT c.id, f.key, f.default_enabled
FROM companies c
CROSS JOIN feature_flags f
ON CONFLICT (company_id, feature_key) DO NOTHING;

-- ── Index for fast lookup ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_company_feature_flags_company ON company_feature_flags (company_id);
CREATE INDEX IF NOT EXISTS idx_company_feature_flags_key ON company_feature_flags (feature_key);
