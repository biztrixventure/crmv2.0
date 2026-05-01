-- ============================================================
-- 027 — Company slug
-- ============================================================
-- Adds an optional short identifier (slug) to companies.
-- Used in transfer phone-search results to show a compact
-- company label instead of the full name.
-- Admins set slugs via the company management UI.
-- ============================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS slug text;

CREATE UNIQUE INDEX IF NOT EXISTS companies_slug_idx
  ON companies(slug)
  WHERE slug IS NOT NULL AND slug <> '';
