-- ============================================================================
-- 274_quiz_polish.sql
-- Quiz system polish (follows 273): categories/tags for organizing quizzes and
-- a pass/fail threshold so results and the leaderboard can show more than a
-- bare percentage. Additive — existing quizzes default to no category and a
-- 70% pass bar.
-- ============================================================================

ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS pass_threshold int NOT NULL DEFAULT 70;

CREATE INDEX IF NOT EXISTS idx_quizzes_category ON quizzes (category);

-- ── post-apply verification ─────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'quizzes' AND column_name IN ('category', 'pass_threshold');
