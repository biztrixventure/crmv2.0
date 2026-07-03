-- ============================================================================
-- 170_qa_schema.sql
-- QA Department — STEP 3. Core schema: scorecards (rubric templates), the
-- assignment worklist, review headers, and per-criterion scores.
-- Apply AFTER 168 (enum) + 169 (permissions). Idempotent.
--
-- Design notes:
--  * A REVIEW METHOD is first-class: every assignment/review carries method
--    ('tra' | 'rcm'). Compliance stays in its own tables (150/151) — not merged.
--  * qa_assignments is the single worklist for BOTH methods. TRA fills it with
--    full coverage (sampled=false); RCM fills it with a frozen random sample
--    (sampled=true, period set). Same queue/assign/report surface either way.
--  * Indexes below are cut to the exact filters/joins Sections 4 & 5 run — see
--    the inline "used by" notes, not guesses.
-- ============================================================================

-- ── qa_scorecards — rubric templates ────────────────────────────────────────
-- company_id NULL = a GLOBAL template (seeded below) usable as a starting point;
-- a company-scoped row overrides it. criteria is the weighted rubric.
CREATE TABLE IF NOT EXISTS qa_scorecards (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        REFERENCES companies(id) ON DELETE CASCADE,   -- NULL = global template
  method         text        NOT NULL CHECK (method IN ('tra','rcm')),
  name           text        NOT NULL,
  -- [{ "key":"greeting", "label":"Greeting & ID", "max_points":10, "auto_fail":false }, ...]
  criteria       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  pass_threshold numeric     NOT NULL DEFAULT 80,   -- percent of max points to pass (0-100)
  is_active      boolean     NOT NULL DEFAULT true,
  created_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- used by: GET /qa/scorecards (company+method lookup), config resolve
CREATE INDEX IF NOT EXISTS idx_qa_scorecards_co_method
  ON qa_scorecards (company_id, method) WHERE is_active;

-- ── qa_assignments — the worklist (one row per call-to-review) ───────────────
CREATE TABLE IF NOT EXISTS qa_assignments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  method        text        NOT NULL CHECK (method IN ('tra','rcm')),
  subject_role  text        NOT NULL CHECK (subject_role IN ('fronter','closer')),
  transfer_id   uuid        REFERENCES transfers(id) ON DELETE CASCADE,  -- fronter leg / TRA + RCM-fronter
  sale_id       uuid        REFERENCES sales(id)     ON DELETE CASCADE,  -- RCM-closer path (§1.5)
  assigned_to   uuid        REFERENCES auth.users(id) ON DELETE SET NULL, -- qa_agent; NULL = unassigned pool
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','in_review','scored','skipped')),
  sampled       boolean     NOT NULL DEFAULT false,   -- true = RCM random pick
  period        text,                                 -- RCM frozen-sample period id (e.g. '2026-07-03' or '2026-W27')
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- must point at SOMETHING to review
  CONSTRAINT qa_assignment_has_subject CHECK (transfer_id IS NOT NULL OR sale_id IS NOT NULL)
);
-- FROZEN / idempotent guard: at most one assignment per (transfer, method) and
-- per (sale, method). This makes both materialization jobs safe to re-run and
-- stops RCM from re-sampling the same call — the discovery's "frozen" rule.
CREATE UNIQUE INDEX IF NOT EXISTS uq_qa_assign_transfer_method
  ON qa_assignments (transfer_id, method) WHERE transfer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_qa_assign_sale_method
  ON qa_assignments (sale_id, method) WHERE sale_id IS NOT NULL;
-- used by: GET /qa/queue (company + status filter, ORDER BY created_at DESC LIMIT).
-- created_at is IN the index so the queue's sort+limit is index-served, not a
-- post-filter sort — matters once TRA full-coverage makes this table large.
CREATE INDEX IF NOT EXISTS idx_qa_assign_co_status  ON qa_assignments (company_id, status, created_at DESC);
-- used by: GET /qa/queue for a qa_agent (their assigned worklist)
CREATE INDEX IF NOT EXISTS idx_qa_assign_agent      ON qa_assignments (assigned_to, status) WHERE assigned_to IS NOT NULL;
-- used by: RCM job's per-period "already materialized?" guard
CREATE INDEX IF NOT EXISTS idx_qa_assign_co_method_period ON qa_assignments (company_id, method, period);

-- ── qa_reviews — result header (one per assignment) ─────────────────────────
CREATE TABLE IF NOT EXISTS qa_reviews (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   uuid        NOT NULL REFERENCES qa_assignments(id) ON DELETE CASCADE,
  company_id      uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,  -- denormalized for report filters
  method          text        NOT NULL CHECK (method IN ('tra','rcm')),
  subject_role    text        NOT NULL CHECK (subject_role IN ('fronter','closer')),
  subject_user_id uuid        REFERENCES auth.users(id) ON DELETE SET NULL,  -- the fronter/closer reviewed
  reviewer_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,  -- the qa_agent
  scorecard_id    uuid        REFERENCES qa_scorecards(id) ON DELETE SET NULL,
  total_score     numeric     NOT NULL DEFAULT 0,
  max_score       numeric     NOT NULL DEFAULT 0,     -- sum of criteria max_points at score time (percentage context)
  passed          boolean     NOT NULL DEFAULT false,
  overall_notes   text,
  status          text        NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','disputed','void')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id)   -- one review per assignment (re-score = update)
);
-- used by: GET /qa/reports (by company + date), per-agent rollups
CREATE INDEX IF NOT EXISTS idx_qa_reviews_co_date  ON qa_reviews (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_reviews_subject  ON qa_reviews (subject_user_id);
CREATE INDEX IF NOT EXISTS idx_qa_reviews_reviewer ON qa_reviews (reviewer_id);

-- ── qa_review_scores — per-criterion breakdown ──────────────────────────────
CREATE TABLE IF NOT EXISTS qa_review_scores (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id    uuid        NOT NULL REFERENCES qa_reviews(id) ON DELETE CASCADE,
  criterion_key text       NOT NULL,
  points       numeric     NOT NULL DEFAULT 0,
  note         text,
  UNIQUE (review_id, criterion_key)
);
CREATE INDEX IF NOT EXISTS idx_qa_review_scores_review ON qa_review_scores (review_id);

-- ── RLS (service-role backend; permissive like the other app tables) ────────
ALTER TABLE qa_scorecards    ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_assignments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_reviews       ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_review_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qa_scorecards_all    ON qa_scorecards;
DROP POLICY IF EXISTS qa_assignments_all   ON qa_assignments;
DROP POLICY IF EXISTS qa_reviews_all       ON qa_reviews;
DROP POLICY IF EXISTS qa_review_scores_all ON qa_review_scores;
CREATE POLICY qa_scorecards_all    ON qa_scorecards    FOR ALL USING (true);
CREATE POLICY qa_assignments_all   ON qa_assignments   FOR ALL USING (true);
CREATE POLICY qa_reviews_all       ON qa_reviews       FOR ALL USING (true);
CREATE POLICY qa_review_scores_all ON qa_review_scores FOR ALL USING (true);

-- ── Seed: global 1-criterion "Overall" scorecards so a company can launch light.
-- A single 100-point "Overall" criterion IS pass/fail with a threshold; add more
-- criteria later with zero migration of past reviews (per the discovery §4).
INSERT INTO qa_scorecards (company_id, method, name, criteria, pass_threshold, is_active)
SELECT NULL, m.method, 'Overall (starter)',
       '[{"key":"overall","label":"Overall Call Quality","max_points":100,"auto_fail":false}]'::jsonb,
       80, true
FROM (VALUES ('tra'), ('rcm')) AS m(method)
WHERE NOT EXISTS (
  SELECT 1 FROM qa_scorecards s WHERE s.company_id IS NULL AND s.method = m.method AND s.name = 'Overall (starter)'
);
