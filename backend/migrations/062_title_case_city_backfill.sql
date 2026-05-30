-- ============================================================================
-- 062_title_case_city_backfill.sql
--
-- Back-fill callbacks.customer_city to title case so the column matches what
-- new writes land as (zip-autofill returns properly cased cities already, but
-- manual disposition entries and old imports vary). Reuses app_title_case
-- from migration 059, so run 059 first.
--
-- Address columns (sales.customer_address) intentionally NOT touched —
-- mixed numeric/abbreviation tokens like "PO Box", "NW", apartment letters
-- would title-case incorrectly. Address normalization needs a dedicated
-- parser and is out of scope here.
-- ============================================================================

UPDATE callbacks
SET    customer_city = app_title_case(customer_city)
WHERE  customer_city IS NOT NULL
  AND  customer_city IS DISTINCT FROM app_title_case(customer_city);
