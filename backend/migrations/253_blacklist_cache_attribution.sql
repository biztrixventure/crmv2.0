-- ============================================================================
-- 253_blacklist_cache_attribution.sql
-- Every DNC lookup (any role — closer, compliance, superadmin) already writes
-- its verdict into blacklist_lookups. That cache was invisible: compliance could
-- only see numbers that happen to be attached to a sale (v_sales_dnc). This
-- makes the cache itself a first-class compliance report:
--   • who searched it, from where (lookup / bulk / scan), how many times
--   • v_blacklist_cache : one row per cached number + verdict + searcher name
--     + how many sales carry that number
--   • app_record_blacklist_lookup : atomic upsert that increments the counter
--     (a plain upsert can't read the old count)
--   • app_blacklist_cache_summary : verdict counts for the KPI strip
-- Service-role only (backend reads it) — never granted to anon/authenticated.
-- ============================================================================
ALTER TABLE blacklist_lookups
  ADD COLUMN IF NOT EXISTS first_checked_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_searched_at  timestamptz,   -- last time ANYONE searched (cache hit included)
  ADD COLUMN IF NOT EXISTS last_checked_by   uuid,
  ADD COLUMN IF NOT EXISTS last_source       text,
  ADD COLUMN IF NOT EXISTS lookup_count      integer NOT NULL DEFAULT 1;

-- Existing rows predate attribution: seed the timestamps so ordering works.
UPDATE blacklist_lookups SET first_checked_at = checked_at WHERE first_checked_at IS NULL;
UPDATE blacklist_lookups SET last_searched_at = checked_at WHERE last_searched_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_blacklist_lookups_searched ON blacklist_lookups (last_searched_at DESC);

CREATE INDEX IF NOT EXISTS idx_blacklist_lookups_last_by ON blacklist_lookups (last_checked_by);

-- ── upsert + increment in one statement ──────────────────────────────────────
CREATE OR REPLACE FUNCTION app_record_blacklist_lookup(
  p_phone    text,
  p_status   text,
  p_message  text,
  p_codes    text[],
  p_wireless boolean,
  p_carrier  jsonb,
  p_results  integer,
  p_raw      jsonb,
  p_user     uuid,
  p_source   text
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO blacklist_lookups (
    phone, status, message, codes, wireless, carrier, results, raw,
    checked_at, first_checked_at, last_searched_at, last_checked_by, last_source, lookup_count
  ) VALUES (
    p_phone, p_status, p_message, COALESCE(p_codes, '{}'), p_wireless, p_carrier, p_results, p_raw,
    now(), now(), now(), p_user, COALESCE(p_source, 'lookup'), 1
  )
  ON CONFLICT (phone) DO UPDATE SET
    status           = EXCLUDED.status,
    message          = EXCLUDED.message,
    codes            = EXCLUDED.codes,
    wireless         = EXCLUDED.wireless,
    carrier          = EXCLUDED.carrier,
    results          = EXCLUDED.results,
    raw              = EXCLUDED.raw,
    checked_at       = EXCLUDED.checked_at,
    first_checked_at = COALESCE(blacklist_lookups.first_checked_at, EXCLUDED.checked_at),
    last_searched_at = EXCLUDED.checked_at,
    last_checked_by  = COALESCE(EXCLUDED.last_checked_by, blacklist_lookups.last_checked_by),
    last_source      = EXCLUDED.last_source,
    lookup_count     = blacklist_lookups.lookup_count + 1;
$$;

-- Cache HIT: no new API call, but the search still happened — count it and move
-- the "last searched by" to the person who just asked. checked_at is NOT moved:
-- it is the age of the verdict and drives cache expiry.
CREATE OR REPLACE FUNCTION app_touch_blacklist_lookup(p_phone text, p_user uuid, p_source text)
RETURNS void LANGUAGE sql AS $$
  UPDATE blacklist_lookups SET
    lookup_count    = lookup_count + 1,
    last_checked_by = COALESCE(p_user, last_checked_by),
    last_source     = COALESCE(p_source, last_source),
    last_searched_at = now()
  WHERE phone = p_phone;
$$;

-- ── the searched-numbers report ──────────────────────────────────────────────
CREATE OR REPLACE VIEW v_blacklist_cache AS
  SELECT
    bl.phone,
    bl.message,
    bl.codes,
    bl.wireless,
    bl.carrier,
    bl.checked_at,
    bl.first_checked_at,
    COALESCE(bl.last_searched_at, bl.checked_at) AS last_searched_at,
    bl.lookup_count,
    bl.last_source,
    bl.last_checked_by,
    CASE WHEN lower(COALESCE(bl.message, '')) = 'good' THEN 'good' ELSE 'blacklisted' END AS dnc_status,
    NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '') AS searched_by_name,
    u.email AS searched_by_email,
    (SELECT count(*) FROM sales s WHERE s.normalized_phone = bl.phone)::int AS sales_count
  FROM blacklist_lookups bl
  LEFT JOIN user_profiles p ON p.user_id = bl.last_checked_by
  LEFT JOIN auth.users    u ON u.id      = bl.last_checked_by;

REVOKE ALL ON v_blacklist_cache FROM anon, authenticated;
GRANT SELECT ON v_blacklist_cache TO service_role;

CREATE OR REPLACE FUNCTION app_blacklist_cache_summary()
RETURNS TABLE(dnc_status text, phones bigint, lookups bigint) LANGUAGE sql STABLE AS $$
  SELECT
    CASE WHEN lower(COALESCE(message, '')) = 'good' THEN 'good' ELSE 'blacklisted' END,
    count(*)::bigint,
    COALESCE(sum(lookup_count), 0)::bigint
  FROM blacklist_lookups
  GROUP BY 1;
$$;

NOTIFY pgrst, 'reload schema';
