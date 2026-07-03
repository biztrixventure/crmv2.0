-- ============================================================================
-- verify_qa.sql — Section 7 verification for the QA Department build.
-- Run in the Supabase SQL editor AFTER applying migrations 168–172.
-- Read-only except CHECK 2 (which writes to qa_assignments in a TX it ROLLS BACK)
-- and CHECK 4b (a manual toggle you undo). Nothing here is destructive.
-- ============================================================================

-- ── CHECK 0: migrations landed ──────────────────────────────────────────────
-- Expect: qa_manager + qa_agent present in the enum; 4 qa_* tables; 6 qa perms.
SELECT unnest(enum_range(NULL::role_level))::text AS role_level_values;   -- look for qa_manager, qa_agent
SELECT table_name FROM information_schema.tables
 WHERE table_name IN ('qa_scorecards','qa_assignments','qa_reviews','qa_review_scores') ORDER BY 1;
SELECT name FROM permissions WHERE category = 'qa' ORDER BY 1;            -- 6 rows

-- ── CHECK 1: EXPLAIN the queue query (the hot read) ─────────────────────────
-- The route runs: WHERE company_id = ANY(...) [AND status=] ORDER BY created_at DESC LIMIT n OFFSET 0.
-- EXPECT: an Index Scan (Backward) on idx_qa_assign_co_status (company_id,status,created_at DESC)
-- — NO "Sort" node and NO "Seq Scan". created_at is in the index so the ORDER
-- BY + LIMIT is served directly. (Replace the UUID with a real company_id.)
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM qa_assignments
WHERE company_id = '00000000-0000-0000-0000-000000000000'
  AND status = 'pending'
ORDER BY created_at DESC
LIMIT 50 OFFSET 0;

-- EXPLAIN the TRA bulk insert's SELECT half (the set-based, no-N+1 path).
-- EXPECT: the NOT EXISTS becomes an Anti Join using uq_qa_assign_transfer_method;
-- no per-row subplan. (Replace the company_id.)
EXPLAIN
INSERT INTO qa_assignments (company_id, method, subject_role, transfer_id, sampled, status)
SELECT t.company_id, 'tra', 'fronter', t.id, false, 'pending'
FROM transfers t
WHERE t.company_id = '00000000-0000-0000-0000-000000000000'
  AND NOT EXISTS (SELECT 1 FROM qa_assignments a WHERE a.transfer_id = t.id AND a.method='tra')
ON CONFLICT DO NOTHING;

-- ── CHECK 2: RCM frozen sample never re-samples a period ─────────────────────
-- Run the SAME period twice; the second call must return 0 and add no rows.
-- Wrapped in a TX we ROLLBACK so prod data is untouched.
-- NOTE on the advisory lock: both calls below share ONE session/transaction, so
-- the transaction-scoped advisory lock is re-entrant (the same session re-takes
-- it) — meaning this test exercises the EXISTS(period) freeze guard, and the 2nd
-- call still returns 0. The advisory lock's job is the CROSS-session/replica case
-- (two schedulers racing the same period from different connections); to observe
-- it, run the two SELECTs from two separate psql sessions without COMMITting the
-- first — the second returns 0 with a "lock busy … skipping" NOTICE.
BEGIN;
  -- pick a real company + a window that actually has transfers/sales:
  SELECT app_qa_materialize_rcm(
    '00000000-0000-0000-0000-000000000000'::uuid,
    ARRAY['fronter'], 'percentage', 20, 'TEST-PERIOD',
    now() - interval '30 days', now()
  ) AS first_run_inserted;          -- EXPECT: > 0 (some sample)

  SELECT app_qa_materialize_rcm(
    '00000000-0000-0000-0000-000000000000'::uuid,
    ARRAY['fronter'], 'percentage', 20, 'TEST-PERIOD',
    now() - interval '30 days', now()
  ) AS second_run_inserted;         -- EXPECT: 0 (frozen — period already materialized)

  SELECT count(*) AS rows_for_test_period
  FROM qa_assignments WHERE method='rcm' AND period='TEST-PERIOD';   -- EXPECT: == first_run_inserted
ROLLBACK;

-- ── CHECK 3: recording candidate lookup surfaces the FRONTER leg ────────────
-- The candidate route uses listCandidatesByLeadId(lead_id) which returns EVERY
-- leg on the lead (fronter + closer + redials) — verify a real non-converted
-- transfer has a resolvable lead code. This SQL just confirms the input exists;
-- the actual leg listing is proven by calling
--   GET /api/qa/assignments/:id/candidates   (as a qa_agent)
-- and checking the returned candidates include the fronter's agent_user.
SELECT id, vicidial_vendor_code
FROM transfers
WHERE vicidial_vendor_code ~ '^[A-Za-z]+[0-9]+$'
  AND id NOT IN (SELECT transfer_id FROM sales WHERE transfer_id IS NOT NULL)  -- never converted
LIMIT 5;   -- pick one, create/find its TRA qa_assignment, hit the candidates endpoint

-- ── CHECK 4: nothing is QA-enabled by default ───────────────────────────────
-- 4a. The ONLY qa.methods row after migration is the GLOBAL default = [].
SELECT scope, value FROM business_config WHERE key = 'qa.methods';
-- EXPECT: exactly one row → scope='global', value='[]'. NO company:* rows yet.

-- 4b. The materializer only ever targets companies with a NON-EMPTY company-scoped
-- override. This query mimics enabledCompanies() — it must return ZERO rows until
-- a qa_manager turns a company on:
SELECT scope, value FROM business_config
WHERE key = 'qa.methods' AND scope LIKE 'company:%'
  AND jsonb_array_length(value) > 0;
-- EXPECT: 0 rows on a fresh install → the hourly job is a complete no-op.
