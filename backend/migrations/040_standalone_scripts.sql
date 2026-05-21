-- 040_standalone_scripts.sql
-- Scripts become a standalone knowledge base, fully independent of FAQs.
-- FAQs   = questions + answers + keywords (searchable Q&A).
-- Scripts = self-contained call scripts (large paragraphs), role-scoped.
-- Migrates any existing per-FAQ scripts into the standalone table, then drops
-- the obsolete faq_scripts link table.

CREATE TABLE IF NOT EXISTS scripts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  content     text NOT NULL,
  audience    text NOT NULL DEFAULT 'both'
              CHECK (audience IN ('closer', 'fronter', 'both')),
  keywords    text,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scripts_audience ON scripts(audience) WHERE is_active;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_scripts_title_trgm    ON scripts USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_scripts_keywords_trgm ON scripts USING gin (keywords gin_trgm_ops);

-- Migrate prior script data into the standalone table, then remove the old link.
DO $$
BEGIN
  IF to_regclass('public.faq_scripts') IS NOT NULL THEN
    INSERT INTO scripts (title, content, audience, created_at)
    SELECT COALESCE(NULLIF(btrim(label), ''), 'Script'), content, role, created_at
    FROM faq_scripts
    WHERE content IS NOT NULL AND btrim(content) <> '';
    DROP TABLE faq_scripts;
  ELSE
    -- 039 may not have run; pull from the legacy single-script column instead.
    INSERT INTO scripts (title, content, audience, created_at)
    SELECT 'Script', script, 'both', created_at
    FROM faqs
    WHERE script IS NOT NULL AND btrim(script) <> '';
  END IF;
END $$;
