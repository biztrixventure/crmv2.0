-- 038_faqs.sql
-- FAQ knowledge base: superadmin-managed questions/rebuttals + optional call
-- scripts, scoped to an audience (closer / fronter / both) so agents see only
-- the FAQs relevant to their role.

CREATE TABLE IF NOT EXISTS faqs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question    text NOT NULL,
  answer      text NOT NULL,
  script      text,                                   -- optional call script / rebuttal
  keywords    text,                                   -- comma-separated tags for search
  audience    text NOT NULL DEFAULT 'both'
              CHECK (audience IN ('closer', 'fronter', 'both')),
  is_active   boolean NOT NULL DEFAULT true,          -- soft delete / show-hide
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Fast audience filtering for the agent view.
CREATE INDEX IF NOT EXISTS idx_faqs_audience ON faqs(audience) WHERE is_active;

-- Trigram indexes for fast partial-match search on question + keywords.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_faqs_question_trgm ON faqs USING gin (question gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_faqs_keywords_trgm ON faqs USING gin (keywords gin_trgm_ops);

-- Permission catalog entry (superadmin always bypasses; this allows future
-- delegation of FAQ management to other roles via role_permissions/overrides).
INSERT INTO permissions (name, description, category) VALUES
  ('manage_faqs', 'Can create and manage the FAQ knowledge base', 'forms')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r, permissions p
WHERE r.level = 'superadmin' AND p.name = 'manage_faqs'
ON CONFLICT DO NOTHING;
