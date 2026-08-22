-- ============================================================================
-- 273_quiz_system.sql
-- Quiz system: compliance_manager / qa_manager / company_admin build MCQ quizzes
-- and assign them to individual users or whole teams (mig 211). Assignees get
-- exactly one attempt, auto-graded on submit. Creators (+ the target team's
-- lead) see live progress.
--
-- Design:
--   * quiz_assignments records WHO/WHAT a quiz was pointed at (a user or a
--     team) for audit + display.
--   * quiz_attempts is the actual work unit — ONE row per targeted user,
--     snapshotted at assign time. Team assignment expands to one row per
--     current team_members row; membership changes after that don't retroactively
--     add/remove attempts (a snapshot, not a live join), matching the one-
--     attempt-only rule cleanly. Re-assigning the same quiz to someone who
--     already has a row is a no-op (ON CONFLICT DO NOTHING in the route).
--   * options/correct_index live on quiz_questions; answers are graded
--     server-side on submit — the correct answers are never sent to the
--     client before submission.
-- Apply AFTER 211 (teams) and 272.
-- ============================================================================

CREATE TABLE IF NOT EXISTS quizzes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid REFERENCES companies(id) ON DELETE SET NULL,   -- creator's home company (audit; compliance sees all regardless)
  title              text NOT NULL,
  description        text,
  time_limit_minutes int,                                                -- NULL = untimed
  is_active          boolean NOT NULL DEFAULT true,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quizzes_company    ON quizzes (company_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_created_by ON quizzes (created_by);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id        uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question_text  text NOT NULL,
  options        jsonb NOT NULL,             -- ["Option A", "Option B", ...] — 2-8 entries, enforced in the route
  correct_index  int NOT NULL,               -- index into options
  points         int NOT NULL DEFAULT 1,
  order_index    int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz ON quiz_questions (quiz_id, order_index);

CREATE TABLE IF NOT EXISTS quiz_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id         uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  assigned_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_type     text NOT NULL CHECK (target_type IN ('user', 'team')),
  target_user_id  uuid REFERENCES auth.users(id) ON DELETE CASCADE,   -- set when target_type = 'user'
  target_team_id  uuid REFERENCES teams(id) ON DELETE CASCADE,        -- set when target_type = 'team'
  due_at          timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quiz_assignments_quiz ON quiz_assignments (quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_assignments_team ON quiz_assignments (target_team_id);
CREATE INDEX IF NOT EXISTS idx_quiz_assignments_user ON quiz_assignments (target_user_id);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  uuid NOT NULL REFERENCES quiz_assignments(id) ON DELETE CASCADE,
  quiz_id        uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted')),
  answers        jsonb,                      -- [{question_id, selected_index}], written once on submit
  score          numeric,
  total_points   numeric,
  percent        numeric,
  due_at         timestamptz,                -- snapshot of the assignment's due date at grant time
  started_at     timestamptz,
  submitted_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- One attempt per (quiz, user) total — the invariant the whole feature is built on.
CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_attempts_quiz_user ON quiz_attempts (quiz_id, user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_assignment ON quiz_attempts (assignment_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user        ON quiz_attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz         ON quiz_attempts (quiz_id);

ALTER TABLE quizzes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_questions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_attempts    ENABLE ROW LEVEL SECURITY;

-- ── permissions ───────────────────────────────────────────────────────────────
INSERT INTO permissions (name, description, category) VALUES
  ('quiz.manage', 'Can create/edit/delete quizzes and assign them to users or teams', 'quiz')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM custom_roles r
 CROSS JOIN permissions p
 WHERE r.level::text IN ('compliance_manager', 'qa_manager', 'company_admin')
   AND p.name = 'quiz.manage'
ON CONFLICT DO NOTHING;

-- ── post-apply verification ─────────────────────────────────────────────────
-- SELECT tablename FROM pg_tables WHERE tablename LIKE 'quiz%';
-- SELECT r.name, r.level FROM role_permissions rp
--   JOIN custom_roles r ON r.id = rp.role_id
--   JOIN permissions  p ON p.id = rp.permission_id
--  WHERE p.name = 'quiz.manage';
