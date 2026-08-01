-- ============================================================================
-- 225_tra_scorecard_dedupe.sql
--
-- Same accident as 224, other method. TRA had TWO active GLOBAL scorecards:
--
--   7ac05eba  WaveTech Fronter — TRA            /30, pass > 35, 4 reviews
--   66691a83  WaveTech Fronter — TRA (custom)   /42, pass > 62, 0 reviews
--                                               created 2026-08-02 00:03
--
-- 66691a83 was created four minutes after the last closer_dispo duplicate, by
-- the same bug: saving a global template with no company selected posted
-- company_id = NULL, i.e. another global. /qa/scorecards is created_at DESC and
-- the reviewer form takes the first active global, so it — not the verified
-- card — is what TRA reviewers are being graded on right now.
--
-- It cannot grade anyone. Its five ratings are 1–5, so the highest reachable
-- base sum is 25; over a divisor of 42 that is 59.5%, against a pass threshold
-- of 62. EVERY TRA review on that card fails, however well the agent performed.
-- That is a broken card, not a re-calibration.
--
-- 7ac05eba is the card the formula harness verifies (base 0.4667 → 41.6 pass,
-- 0.3667 → 31.6 fail against the > 35 rule) and the only one of the two with
-- reviews filed against it. Nothing is deleted; is_active = false keeps the
-- card and its history readable.
--
-- The editor now refuses to save a template with no company selected, so this
-- cannot recur.
--
-- Verify after applying — expect exactly ONE row, 7ac05eba:
--   SELECT id, name, pass_threshold, criteria->>'base_score_divisor' AS divisor
--     FROM qa_scorecards
--    WHERE method = 'tra' AND company_id IS NULL AND is_active;
--
-- And to confirm no other method is serving two globals at once:
--   SELECT method, count(*) FROM qa_scorecards
--    WHERE company_id IS NULL AND is_active GROUP BY method HAVING count(*) > 1;
-- ============================================================================

UPDATE qa_scorecards
   SET is_active = false
 WHERE method     = 'tra'
   AND company_id IS NULL
   AND id = '66691a83-7959-4191-bd07-5c77d0ec3a06';   -- /42 with a 62 threshold: unreachable
