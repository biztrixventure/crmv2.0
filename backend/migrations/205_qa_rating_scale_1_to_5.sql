-- ============================================================================
-- 205 — QA rating scale 1–5 (was 0–4). The WaveTech evaluation sheets rate each
-- criterion 1..5, but the seeded scorecards used 0..4. Patch every sheet_v2
-- rating criterion on the TRA + Closer cards (global templates AND any company
-- copies) to {min:1, scale:5}. Base divisor (30) is unchanged — the sheets
-- divide the rating sum by 30 as-found. The engine now honors `min`.
-- ============================================================================

UPDATE qa_scorecards
   SET criteria = jsonb_set(
         criteria,
         '{rating_criteria}',
         (SELECT jsonb_agg(rc || '{"min":1,"scale":5}'::jsonb)
            FROM jsonb_array_elements(criteria->'rating_criteria') rc)
       ),
       updated_at = now()
 WHERE method IN ('tra', 'closer_sales', 'closer_dispo')
   AND criteria->>'model' = 'sheet_v2'
   AND jsonb_typeof(criteria->'rating_criteria') = 'array'
   AND jsonb_array_length(criteria->'rating_criteria') > 0;
