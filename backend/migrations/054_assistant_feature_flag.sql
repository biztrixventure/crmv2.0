-- 054_assistant_feature_flag.sql
-- System-wide on/off switch for the CRM assistant mascot ("Trix").
--
-- Seeded into the feature_flags CATALOG only (no per-company override rows), so
-- resolution falls back to default_enabled for every company. The superadmin
-- flips it system-wide in Admin → Features (edit flag → default_enabled toggle),
-- which calls PUT /feature-flags/crm_assistant. Per-company overrides remain
-- possible later via the Features matrix if ever needed.

INSERT INTO feature_flags (key, label, description, category, default_enabled, sort_order)
VALUES (
  'crm_assistant',
  'CRM Assistant (Trix)',
  'Floating guidance mascot for all users. Turn its default off to disable it system-wide.',
  'general',
  true,
  95
)
ON CONFLICT (key) DO NOTHING;
