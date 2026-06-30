-- ============================================================================
-- 147_sales_dnc.sql
-- Bulk DNC scan over sales + a join to the cached blacklist results.
--   • sales.normalized_phone : STORED generated last-10 digits of customer_phone,
--     so we can join + filter against blacklist_lookups.phone (same shape).
--   • v_sales_dnc : every sale + its DNC verdict (unchecked / good / blacklisted).
--   • app_unchecked_sale_phones : the next batch of DISTINCT numbers that have no
--     fresh cached result — i.e. exactly what a scan still needs to call (so cost
--     = distinct unchecked numbers, never per-sale, never a repeat).
--   • app_sales_dnc_prepare / _summary : counts for the "what will this cost" +
--     report panels.
-- ============================================================================
ALTER TABLE sales ADD COLUMN IF NOT EXISTS normalized_phone text
  GENERATED ALWAYS AS (
    CASE WHEN length(regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g')) >= 10
         THEN right(regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g'), 10)
         ELSE NULL END
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_sales_normalized_phone ON sales (normalized_phone);

CREATE OR REPLACE VIEW v_sales_dnc AS
  SELECT
    s.*,
    bl.message    AS dnc_message,
    bl.codes      AS dnc_codes,
    bl.wireless   AS dnc_wireless,
    bl.checked_at AS dnc_checked_at,
    CASE
      WHEN bl.phone IS NULL            THEN 'unchecked'
      WHEN lower(bl.message) = 'good'  THEN 'good'
      ELSE 'blacklisted'
    END AS dnc_status
  FROM sales s
  LEFT JOIN blacklist_lookups bl ON bl.phone = s.normalized_phone;

GRANT SELECT ON v_sales_dnc TO service_role, authenticated, anon;

-- Next N distinct sale numbers with NO fresh cached result → the live calls a
-- scan still owes. As each is checked + cached, it drops out, so callers just
-- loop until empty (no offset bookkeeping, no repeats).
CREATE OR REPLACE FUNCTION app_unchecked_sale_phones(p_limit int, p_cache_days int)
RETURNS TABLE(phone text) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT s.normalized_phone
  FROM sales s
  WHERE s.normalized_phone IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM blacklist_lookups bl
      WHERE bl.phone = s.normalized_phone
        AND bl.checked_at > now() - make_interval(days => p_cache_days)
    )
  LIMIT p_limit;
$$;

-- Cost preview: distinct numbers total + how many still need a live call.
CREATE OR REPLACE FUNCTION app_sales_dnc_prepare(p_cache_days int)
RETURNS TABLE(distinct_phones bigint, to_check bigint) LANGUAGE sql STABLE AS $$
  WITH p AS (SELECT DISTINCT normalized_phone AS ph FROM sales WHERE normalized_phone IS NOT NULL)
  SELECT
    (SELECT count(*) FROM p)::bigint,
    (SELECT count(*) FROM p WHERE NOT EXISTS (
       SELECT 1 FROM blacklist_lookups bl
       WHERE bl.phone = p.ph AND bl.checked_at > now() - make_interval(days => p_cache_days)))::bigint;
$$;

-- Report counts by verdict (both #sales and #distinct numbers).
CREATE OR REPLACE FUNCTION app_sales_dnc_summary()
RETURNS TABLE(dnc_status text, sales bigint, phones bigint) LANGUAGE sql STABLE AS $$
  SELECT dnc_status, count(*)::bigint, count(DISTINCT normalized_phone)::bigint
  FROM v_sales_dnc GROUP BY dnc_status;
$$;

NOTIFY pgrst, 'reload schema';
