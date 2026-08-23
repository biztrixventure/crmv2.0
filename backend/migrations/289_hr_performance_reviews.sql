-- ============================================================================
-- 289_hr_performance_reviews.sql
--
-- HR module, part 4 of 4: review cycles, reviews, goals, competency ratings.
--
-- The review is a four-stop conveyor:
--
--   pending_self -> pending_manager -> pending_signoff -> completed
--
-- Each stop belongs to a different person, so each stop stamps its own
-- timestamp column rather than sharing one "updated" field -- a completed review
-- has to be able to say when the employee wrote their self-assessment, when the
-- manager wrote theirs, and when it was signed off. Transitions are enforced in
-- backend/routes/hr/reviews.js; the CHECK here fences the vocabulary only, so a
-- future cycle type can add a stop without a migration to widen an enum.
--
-- Goals and competency ratings each carry BOTH a self_rating and a
-- manager_rating on the same row. That is deliberate: the disagreement between
-- the two is the interesting number in a review, and splitting them across rows
-- would make it a join to find.
--
-- Verify after applying:
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_name IN ('hr_review_cycles','hr_reviews','hr_review_goals','hr_review_ratings');  -- 4
-- ============================================================================

CREATE TABLE IF NOT EXISTS hr_review_cycles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  period_start date NOT NULL,
  period_end   date NOT NULL,
  due_date     date,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','closed')),
  description  text,
  -- Scale is per-cycle so a company can run 1-5 one year and 1-10 the next
  -- without rewriting old reviews.
  rating_scale_max numeric(4,2) NOT NULL DEFAULT 5 CHECK (rating_scale_max > 0),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name),
  CONSTRAINT hrrc_date_order CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_hrrc_company ON hr_review_cycles (company_id, status);

CREATE TABLE IF NOT EXISTS hr_reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cycle_id    uuid NOT NULL REFERENCES hr_review_cycles(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  -- Who runs the review. Defaults to the employee manager at creation time, but
  -- stored so a later reorg does not rewrite history.
  reviewer_employee_id uuid REFERENCES hr_employees(id) ON DELETE SET NULL,

  status      text NOT NULL DEFAULT 'pending_self'
              CHECK (status IN ('pending_self','pending_manager','pending_signoff','completed','cancelled')),

  self_comments     text,
  manager_comments  text,
  signoff_comments  text,
  overall_rating    numeric(4,2) CHECK (overall_rating >= 0),

  self_submitted_at    timestamptz,
  manager_submitted_at timestamptz,
  signed_off_at        timestamptz,
  signed_off_by        uuid,
  completed_at         timestamptz,

  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_hrrev_company_status ON hr_reviews (company_id, status);
CREATE INDEX IF NOT EXISTS idx_hrrev_employee       ON hr_reviews (employee_id);
CREATE INDEX IF NOT EXISTS idx_hrrev_reviewer       ON hr_reviews (reviewer_employee_id, status);
CREATE INDEX IF NOT EXISTS idx_hrrev_cycle          ON hr_reviews (cycle_id);

CREATE TABLE IF NOT EXISTS hr_review_goals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  review_id      uuid NOT NULL REFERENCES hr_reviews(id) ON DELETE CASCADE,
  title          text NOT NULL,
  description    text,
  target         text,
  weight         numeric(5,2) NOT NULL DEFAULT 0 CHECK (weight >= 0),
  status         text NOT NULL DEFAULT 'not_started'
                 CHECK (status IN ('not_started','in_progress','achieved','partially_met','missed')),
  self_rating    numeric(4,2) CHECK (self_rating    >= 0),
  manager_rating numeric(4,2) CHECK (manager_rating >= 0),
  self_comments    text,
  manager_comments text,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hrgoal_review  ON hr_review_goals (review_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_hrgoal_company ON hr_review_goals (company_id);

CREATE TABLE IF NOT EXISTS hr_review_ratings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  review_id      uuid NOT NULL REFERENCES hr_reviews(id) ON DELETE CASCADE,
  competency     text NOT NULL,
  self_rating    numeric(4,2) CHECK (self_rating    >= 0),
  manager_rating numeric(4,2) CHECK (manager_rating >= 0),
  comments       text,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, competency)
);

CREATE INDEX IF NOT EXISTS idx_hrrate_review  ON hr_review_ratings (review_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_hrrate_company ON hr_review_ratings (company_id);

COMMENT ON TABLE hr_reviews IS
  'Performance reviews (mig 289). Status ladder pending_self -> pending_manager -> pending_signoff -> completed is enforced in backend/routes/hr/reviews.js.';

ALTER TABLE hr_review_cycles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_reviews        ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_review_goals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_review_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hr_review_cycles  FROM anon;
REVOKE ALL ON hr_reviews        FROM anon;
REVOKE ALL ON hr_review_goals   FROM anon;
REVOKE ALL ON hr_review_ratings FROM anon;
