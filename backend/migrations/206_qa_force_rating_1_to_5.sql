-- ============================================================================
-- 206 — Force EVERY sheet_v2 rating card to the 1–5 scale (idempotent).
--
-- The dropdown renders whatever the card stores. Cards seeded before the scale
-- was corrected still carry {scale:4} (0–4). mig 205 fixed the TRA + Closer
-- cards, but this one is unconditional and covers ALL sheet_v2 cards with
-- ratings — global templates AND company copies, every method — so the range is
-- guaranteed 1..5 no matter what was applied before. The engine honors `min`.
-- Safe to re-run.
-- ============================================================================

UPDATE qa_scorecards
   SET criteria = jsonb_set(
         criteria,
         '{rating_criteria}',
         (SELECT jsonb_agg(rc || '{"min":1,"scale":5}'::jsonb)
            FROM jsonb_array_elements(criteria->'rating_criteria') rc)
       ),
       updated_at = now()
 WHERE criteria->>'model' = 'sheet_v2'
   AND jsonb_typeof(criteria->'rating_criteria') = 'array'
   AND jsonb_array_length(criteria->'rating_criteria') > 0;
