-- ============================================================================
-- 279_quiz_dropdown_and_long_options.sql
-- Two things a quiz builder needs that 273 did not have.
--
-- 1. A DROPDOWN question. The data is identical to a multiple choice — a list
--    of options and one correct index — so this is a presentation choice, not
--    a second kind of question, and it gets a display column rather than a
--    parallel schema. Which matters because of (2): forty radio buttons is an
--    unusable question and a forty-entry dropdown is an ordinary one.
--
-- 2. Long option lists. `options` is jsonb and was never bounded by the
--    database; the 2-8 limit lived in the route. The cap moves to 100, which
--    is past anything a real question needs while still refusing a runaway
--    paste. Existing questions are untouched.
--
-- display_type defaults to 'radio', so every question that already exists keeps
-- rendering exactly as it does now.
-- ============================================================================

ALTER TABLE quiz_questions
  ADD COLUMN IF NOT EXISTS display_type text NOT NULL DEFAULT 'radio';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quiz_questions_display_type_chk'
  ) THEN
    ALTER TABLE quiz_questions
      ADD CONSTRAINT quiz_questions_display_type_chk
      CHECK (display_type IN ('radio', 'dropdown'));
  END IF;
END $$;

COMMENT ON COLUMN quiz_questions.display_type IS
  'How the options are presented to the person taking the quiz: radio buttons (default) or a dropdown. Same data either way — a list of options and one correct index. Dropdown exists so a question can carry dozens of options without becoming a wall of radio buttons.';
