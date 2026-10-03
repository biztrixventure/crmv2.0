-- ============================================================================
-- 338_customer_lookup_search_text.sql
--
-- SEARCHING THE HISTORY BY ANYTHING THAT IS IN IT.
--
-- 337 shipped the history with one searchable column: `query`, the thing the
-- agent typed. That answers "which number did I look up" and nothing else —
-- the name that came back, the city, the car, the VIN all live inside
-- `summary`, which is jsonb, and PostgREST cannot ILIKE a whole jsonb document.
--
-- So each row carries its own haystack: one lowercased TEXT column holding the
-- typed query, the parameters, and the summary flattened (names, places,
-- vehicle titles, VINs, addresses), plus the kind and any error. The writer
-- fills it — `buildSearchText()` in utils/customerLookupHistory.js — rather
-- than a generated column, because that flattening is the same code that builds
-- the summary and must never drift from it.
--
-- GIN + trigram, not b-tree: every search here is `%needle%`, which a b-tree
-- index cannot serve. pg_trgm is already installed on this database.
--
-- DEPLOY ORDER: the writer retries its insert WITHOUT this column when the
-- database has not got it yet, so the backend can ship before this is applied.
-- ============================================================================

ALTER TABLE customer_lookup_searches
  ADD COLUMN IF NOT EXISTS search_text TEXT;

COMMENT ON COLUMN customer_lookup_searches.search_text IS
  'Lowercased haystack for the History search box: typed query + params + flattened summary + kind + error. Written by the app, never by a trigger.';

CREATE INDEX IF NOT EXISTS idx_cls_search_text
  ON customer_lookup_searches USING GIN (search_text gin_trgm_ops);

-- ── filling in what has none ────────────────────────────────────────────────
-- A ROW WITH NO HAYSTACK CANNOT BE FOUND, and there are two ways to get one: a
-- row written while the backend was still running ahead of this migration, and
-- any future write path that forgets. So this is a FUNCTION, not a one-off
-- UPDATE — the housekeeping job runs it every 12 hours (utils/scheduler.js via
-- customerLookupHistory.prune), which repairs both cases without anybody
-- noticing. It is also the backfill for rows 337 already recorded.
--
-- The app builds a richer string for new rows (it flattens the summary arrays
-- instead of casting the whole document), so this is the floor, not the target.
--
-- It stays a statement of its OWN, never fused into the prune: two
-- data-modifying CTEs in one statement share a snapshot, and a row that both
-- touched would be modified twice in one statement — unpredictable, by the
-- Postgres manual's own words.
CREATE OR REPLACE FUNCTION fn_fill_customer_lookup_search_text()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
  WITH f AS (
    UPDATE customer_lookup_searches
       SET search_text = LOWER(
             COALESCE(query, '') || ' ' ||
             COALESCE(params::TEXT, '') || ' ' ||
             COALESCE(summary::TEXT, '') || ' ' ||
             COALESCE(kind, '')
           )
     WHERE search_text IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) FROM f;
$func$;

REVOKE ALL ON FUNCTION fn_fill_customer_lookup_search_text() FROM anon, authenticated;

-- Run it once now, for everything 337 already recorded.
SELECT fn_fill_customer_lookup_search_text();
