-- ============================================================================
-- 066_company_theme_logos.sql
--
-- Per-theme logo variants so the loader / 404 / brand surfaces can swap to a
-- light-on-dark mark in dark mode (and vice versa) instead of forcing one
-- asset to work in both. Existing logo_url stays as the universal fallback
-- when a theme variant isn't uploaded.
-- ============================================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS logo_light_url text,
  ADD COLUMN IF NOT EXISTS logo_dark_url  text;

COMMENT ON COLUMN companies.logo_light_url IS 'Logo asset to use when the app theme = light. Falls back to logo_url if NULL.';
COMMENT ON COLUMN companies.logo_dark_url  IS 'Logo asset to use when the app theme = dark.  Falls back to logo_url if NULL.';
