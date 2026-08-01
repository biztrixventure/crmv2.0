-- ============================================================================
-- 224_closer_dispo_scorecard_dedupe.sql
--
-- The Unclosed Sale (closer_dispo) slot had FOUR active GLOBAL scorecards.
--
-- Why that happened: editing a global template is meant to save a COMPANY copy,
-- but with no company selected the editor posted company_id = NULL — another
-- global template. GET /qa/scorecards orders created_at DESC and the reviewer
-- form takes the first active global, so each accidental duplicate silently
-- became the card every reviewer was served.
--
-- The card in front of reviewers right now is 5bf14763 — 22 detail columns and
-- ZERO ratings, auto-fails or checklist items, because a column could not be
-- moved out of the group it was created in, so an attempt to build the client's
-- 23-column layout put every column in Details. It cannot score anything.
--
-- This retires the three duplicates and leaves 553dc454 (the seeded template,
-- the only one of the four with a review filed against it) as the single active
-- global. Nothing is deleted: is_active = false keeps every card and its
-- history readable, and any review already pointing at one still resolves.
--
-- The editor now refuses to save a template with no company selected, so the
-- duplicates cannot come back.
--
-- Verify after applying — expect exactly ONE row:
--   SELECT id, name, is_active FROM qa_scorecards
--    WHERE method = 'closer_dispo' AND company_id IS NULL AND is_active;
-- ============================================================================

UPDATE qa_scorecards
   SET is_active = false
 WHERE method     = 'closer_dispo'
   AND company_id IS NULL
   AND id IN (
     '51c2f7a4-f2eb-449e-af2d-57fca46b5e30',   -- dup, 0 reviews, created 2026-08-01 23:53
     '6c3aa1ff-a061-4554-9086-b91007ba3611',   -- dup, 0 reviews, created 2026-08-01 23:55
     '5bf14763-c609-4c00-bdc4-7069cc6c747b'    -- 22 detail columns, no scoring fields at all
   );
