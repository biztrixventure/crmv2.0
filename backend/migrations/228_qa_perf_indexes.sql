-- ============================================================================
-- 228_qa_perf_indexes.sql — QA read-path indexes
--
-- WHY: every round-trip to this database costs ~445ms, so the QA department's
-- speed is decided by how many queries run and how fast each one resolves. The
-- query COUNT was cut in code (scope-cached business_config, cached
-- isSuperAdmin, batched /my-companies, batched openCounts). This file covers
-- the other half: the read paths that had no supporting index and were sorting
-- in memory.
--
-- Existing QA indexes (mig 170/174/194) only cover COMPANY-scoped reads:
--   idx_qa_assign_co_status (company_id, status, created_at DESC)
--   idx_qa_assign_agent     (assigned_to, status)          -- no created_at
--   idx_qa_reviews_co_date  (company_id, created_at DESC)
--   idx_qa_reviews_subject  (subject_user_id)              -- no created_at
--   idx_qa_reviews_reviewer (reviewer_id)                  -- no created_at
--
-- The gaps are the AGENT-scoped queue and every "all companies" listing — the
-- view compliance_manager and superadmin actually use, which today has no index
-- for its ORDER BY created_at at all.
--
-- Plain CREATE INDEX, NOT CONCURRENTLY: the Supabase SQL editor wraps every
-- paste in a transaction, and CONCURRENTLY cannot run inside one. These tables
-- are small enough that the brief write lock is fine. Idempotent — safe to
-- re-run. Apply in the SQL editor, then: node backend/verify_migrations.js
-- ============================================================================

-- ── qa_assignments ──────────────────────────────────────────────────────────

-- A QA AGENT's queue filters on assigned_to and sorts by created_at, usually
-- with no status filter. idx_qa_assign_agent stops at (assigned_to, status), so
-- the sort was unindexed for the people who open this screen most.
CREATE INDEX IF NOT EXISTS idx_qa_assign_agent_created
  ON qa_assignments (assigned_to, created_at DESC)
  WHERE assigned_to IS NOT NULL;

-- The manager pool and the dashboard both filter company_id + method + status
-- together. idx_qa_assign_co_status carries no method, so a method-filtered tab
-- had to re-check every status match in the company.
CREATE INDEX IF NOT EXISTS idx_qa_assign_co_method_status_created
  ON qa_assignments (company_id, method, status, created_at DESC);

-- ── qa_reviews ──────────────────────────────────────────────────────────────

-- The "no company filter" case — compliance_manager, superadmin, or anyone with
-- view_all_qa_reviews — reaches ORDER BY created_at DESC with nothing to serve
-- it. Used by the marking sheet, Reports, the admin team view and the activity
-- log whenever a single company is not selected.
CREATE INDEX IF NOT EXISTS idx_qa_reviews_created
  ON qa_reviews (created_at DESC);

-- "My reviews" and the reviewer-scoped dashboard: company_id + reviewer_id +
-- a created_at window, ordered by created_at.
CREATE INDEX IF NOT EXISTS idx_qa_reviews_co_reviewer_created
  ON qa_reviews (company_id, reviewer_id, created_at DESC);

-- The per-agent quality report: one subject over a date window, newest first.
CREATE INDEX IF NOT EXISTS idx_qa_reviews_subject_created
  ON qa_reviews (subject_user_id, created_at DESC);

-- The admin team view scans a roster of reviewers over a window.
CREATE INDEX IF NOT EXISTS idx_qa_reviews_reviewer_created
  ON qa_reviews (reviewer_id, created_at DESC);

-- ── NOT dropping anything here ──────────────────────────────────────────────
-- idx_qa_reviews_subject and idx_qa_reviews_reviewer become redundant once the
-- two ..._created indexes above are live (same leading column, superset of
-- columns). They are LEFT IN PLACE deliberately: confirm the new ones are being
-- used via pg_stat_user_indexes first, then drop the old pair in a later
-- migration. Dropping an index blind is how a read path silently regresses.
