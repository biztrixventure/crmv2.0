-- ============================================================================
-- 207 — TRA pass line = 35 (match the WaveTech Fronter sheet).
--
-- The sheet's "QA Overall Status" formula is IF(Final_Score > 35, "Pass",
-- "FAIL"). mig 203 seeded the CRM card at 40 (a hand-picked break in the dummy
-- data), so a call scoring 36–40 passed on the sheet but failed in the CRM.
-- Correct the default to 35, in BOTH the settable pass_threshold column AND
-- criteria.pass_threshold (the value the scoring engine actually reads). Only
-- touches cards still on the seeded 40 — a company that already tuned its own
-- threshold is left alone. Managers can still change it in Scorecards & Config.
-- ============================================================================

UPDATE qa_scorecards
   SET pass_threshold = 35,
       criteria = jsonb_set(criteria, '{pass_threshold}', '35'::jsonb),
       updated_at = now()
 WHERE method = 'tra'
   AND criteria->>'model' = 'sheet_v2'
   AND (pass_threshold = 40 OR criteria->>'pass_threshold' = '40');
