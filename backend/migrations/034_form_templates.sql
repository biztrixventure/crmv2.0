-- Form templates — named snapshots of form_fields canvas layout
CREATE TABLE IF NOT EXISTS form_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  description TEXT,
  fields      JSONB       NOT NULL DEFAULT '[]',
  created_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS form_templates_name_key ON form_templates (lower(name));
