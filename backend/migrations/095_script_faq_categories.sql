-- ============================================================================
-- 095_script_faq_categories.sql
-- Categories for Scripts and FAQs (independent sets). Each script/FAQ can belong
-- to many categories, stored as a uuid[] on the row (GIN-indexed for fast
-- "in this category" filtering). Superadmin/manage_faqs create+manage categories.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS faq_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS script_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Many-to-many assignment as an array on the content row.
ALTER TABLE faqs    ADD COLUMN IF NOT EXISTS category_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS category_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_faqs_category_ids    ON faqs    USING GIN (category_ids);
CREATE INDEX IF NOT EXISTS idx_scripts_category_ids ON scripts USING GIN (category_ids);

-- Reads go through the backend (service role), but enable RLS with a permissive
-- policy so the tables are consistent with the rest of the schema.
ALTER TABLE faq_categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE script_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS faq_categories_all    ON faq_categories;
DROP POLICY IF EXISTS script_categories_all ON script_categories;
CREATE POLICY faq_categories_all    ON faq_categories    FOR ALL USING (true);
CREATE POLICY script_categories_all ON script_categories FOR ALL USING (true);
