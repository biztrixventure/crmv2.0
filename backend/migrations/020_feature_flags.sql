-- Feature flags table — superadmin controls which features are live
CREATE TABLE IF NOT EXISTS feature_flags (
  key         text PRIMARY KEY,
  label       text NOT NULL,
  description text,
  is_enabled  boolean NOT NULL DEFAULT false,
  enabled_at  timestamptz,
  enabled_by  uuid,
  disabled_at timestamptz,
  disabled_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed the two features (no-op if already present)
INSERT INTO feature_flags (key, label, description, is_enabled) VALUES
  (
    'callback_numbers',
    'Callback Numbers',
    'Callback number tracking system — closers and fronters can claim, track, and log call attempts on callback numbers. Managers can reassign and monitor.',
    false
  ),
  (
    'number_assignment',
    'Number Assignment',
    'Managers upload CSV/XLSX number lists and assign batches to fronters. Fronters work through their assigned numbers and update statuses.',
    false
  )
ON CONFLICT (key) DO NOTHING;
