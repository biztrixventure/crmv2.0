-- 032_disposition_setter_role.sql
-- Adds setter_role to disposition_actions so the drawer can show who (by role)
-- set each disposition without an extra join to custom_roles every time.

ALTER TABLE disposition_actions
  ADD COLUMN IF NOT EXISTS setter_role TEXT;
