-- ============================================================================
-- 219_column_filter_indexes.sql
-- Indexes for click-a-column-header filtering and sorting (AdminPanel +
-- ComplianceShell). Nothing here changes a schema — it only makes the paths
-- the new column headers open up cheap enough to expose.
--
-- MEASURED FIRST, THEN INDEXED. Every index below exists because an
-- EXPLAIN (ANALYZE, BUFFERS) on the live database showed a sequential scan on
-- a table big enough for it to matter. The three tables that back these screens
-- are NOT the same size, and the decision differs per table:
--
--   transfers   80,139 rows   → indexed. Full/parallel seq scans, 7.5k buffers.
--   callbacks    4,504 rows   → indexed on the (filter, sort) pair only.
--   sales        7,044 rows   → DELIBERATELY NOT INDEXED for sorting. Measured:
--                               ORDER BY customer_name + created_at over the
--                               whole table is a 7.1ms top-N heapsort touching
--                               1,490 buffers. Adding btrees to the hottest
--                               write table in the system to save 7ms is a net
--                               loss — every sale insert and every compliance
--                               status change would pay for them. sales already
--                               carries 47 indexes; it does not need more.
--
-- Additive and idempotent.
--
-- ── HOW TO APPLY (read this, the obvious way does not work) ─────────────────
--
-- The Supabase SQL editor wraps whatever you paste in a transaction, and
-- CREATE INDEX CONCURRENTLY cannot run inside one:
--     ERROR: 25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
-- Running the statements one at a time does NOT help — each one still gets its
-- own BEGIN. The wrapper is the blocker, not the batching.
--
-- So this file is split by ACTUAL RISK rather than by table:
--
--   PART A (callbacks + sales) — paste into the SQL editor as-is, any time.
--     These are plain CREATE INDEX. callbacks is 1.3 MB of heap and sales is
--     12 MB, so each build is milliseconds. CONCURRENTLY would be ceremony.
--
--   PART B (transfers) — 59 MB of heap, 80,720 rows, taking live VICIDIAL
--     writes. Two options, in order of preference:
--
--       1. psql, keeping CONCURRENTLY. psql runs in autocommit, so there is no
--          transaction to be inside. Connection string:
--          Supabase → Project Settings → Database → Connection string → URI.
--              psql "postgresql://postgres.<ref>:<pw>@<host>:5432/postgres" \
--                   -f backend/migrations/219_column_filter_indexes.sql
--          (Use the DIRECT connection on port 5432, not the 6543 transaction
--          pooler — the pooler cannot hold a session-level CONCURRENTLY build.)
--
--       2. If psql is not available: drop the word CONCURRENTLY from the three
--          PART B statements and run them in the SQL editor during a quiet
--          minute. What that actually costs: CREATE INDEX takes a SHARE lock,
--          which blocks INSERT/UPDATE/DELETE but NOT SELECT — so reads are
--          unaffected and the app stays responsive. Writes WAIT rather than
--          fail, because the backend writes as service_role, which has no
--          statement_timeout (only anon=3s and authenticated=8s do). Expect a
--          few seconds per index, the trigram GIN being the slowest.
--
-- Everything is IF NOT EXISTS, so re-running after a partial apply is safe.
--
-- ⚠ One caveat specific to CONCURRENTLY: if it fails part-way it leaves an
-- INVALID index behind, and IF NOT EXISTS will then skip it forever. Check
-- after applying:
--     SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--      WHERE NOT i.indisvalid;
-- Anything listed must be DROPped and rebuilt.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — safe in the Supabase SQL editor, paste the whole block.
-- ═══════════════════════════════════════════════════════════════════════════

-- callbacks: the (filter, sort) pairs.
-- compliance.js already filters callbacks by status and priority and orders by
-- callback_at — and callbacks had NO index on either status or priority. The
-- composite key order matches the pair the route actually issues (scope by
-- company, filter by status, order by callback_at), which a sort-only index
-- would not serve.
CREATE INDEX IF NOT EXISTS idx_callbacks_company_status_at
  ON callbacks (company_id, status, callback_at DESC);

-- The compliance global view has no company_id at all, so it needs the
-- status-leading form as well.
CREATE INDEX IF NOT EXISTS idx_callbacks_status_at
  ON callbacks (status, callback_at DESC);

CREATE INDEX IF NOT EXISTS idx_callbacks_priority
  ON callbacks (priority);

-- sales: the one column that IS worth it.
-- updated_at backs the "Status Updated" header, which is already live in
-- SALE_SORT (compliance.js) and has never had an index. Unlike customer_name
-- this one is also a natural default ordering for the review queue, so it earns
-- its write cost where the name columns do not.
CREATE INDEX IF NOT EXISTS idx_sales_updated_at
  ON sales (updated_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — transfers (80,720 rows, live writes). psql, or drop CONCURRENTLY.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. transfers: customer name sort ────────────────────────────────────────
-- transfers has NO customer columns. Every customer-facing value lives in
-- form_data JSONB (FirstName / LastName / Phone / Email / …), so the Customer
-- column header has no denormalized twin to steer to — an expression index is
-- the only option, and this is the "performance decision, not a mapping detail"
-- the whole design turns on.
--
-- Measured before (global compliance view, no company filter):
--   Parallel Seq Scan on transfers, rows=40081 x 2 workers,
--   Sort Method: top-N heapsort, Buffers: shared hit=7538, 46.7ms
-- 46ms of two-worker CPU per header click, per compliance user, is what this
-- removes.
--
-- created_at DESC is the SECOND key on purpose: sortHelper.applySort always
-- appends a created_at DESC tiebreaker, so an index of (expr, created_at DESC)
-- matches the full ORDER BY and the sort node disappears entirely. An index on
-- the expression alone would still need a sort for the tiebreaker.
--
-- Only these two keys are indexed. Every other form_data key stays FILTER-ONLY
-- through the existing idx_transfers_formdata_trgm GIN + app_record_search
-- (mig 141) — an index per JSONB key on an 80k insert-heavy table is exactly
-- the write amplification this file is trying to avoid.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_fd_lastname
  ON transfers ((form_data->>'LastName'), created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_fd_firstname
  ON transfers ((form_data->>'FirstName'), created_at DESC);

-- ── 2. transfers: phone contains-filter ─────────────────────────────────────
-- The single most expensive path measured anywhere in this work.
--   Seq Scan on transfers, Filter: normalized_phone ~~* '%555%',
--   Rows Removed by Filter: 79,726, Buffers: shared hit=7492, 116.0ms
-- idx_transfers_normalized_phone is a btree and a btree cannot serve a LEADING
-- wildcard, which is what a "phone contains" column filter always is. trigram
-- GIN can.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_phone_trgm
  ON transfers USING gin (normalized_phone gin_trgm_ops);

-- ── post-apply verification ─────────────────────────────────────────────────
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname='public' AND indexname IN (
--    'idx_transfers_fd_lastname','idx_transfers_fd_firstname',
--    'idx_transfers_phone_trgm','idx_callbacks_company_status_at',
--    'idx_callbacks_status_at','idx_callbacks_priority','idx_sales_updated_at');
--   expect: 7 rows
--
-- Re-run the two heaviest plans and compare to the "before" numbers above:
--   EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
--     SELECT id FROM transfers WHERE normalized_phone ILIKE '%555%'
--      ORDER BY created_at DESC LIMIT 50;                 -- was 116.0ms / 7492 buf
--   EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
--     SELECT id FROM transfers
--      ORDER BY form_data->>'LastName' ASC NULLS LAST, created_at DESC LIMIT 50;
--                                                          -- was  46.7ms / 7538 buf
