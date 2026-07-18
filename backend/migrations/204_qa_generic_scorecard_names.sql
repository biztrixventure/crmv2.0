-- ============================================================================
-- 204 — Generic scorecard template names (drop the company-specific "WaveTech"
-- prefix). The shared global templates should read generically; a company that
-- customizes gets its own "(custom)" copy anyway.
-- ============================================================================

UPDATE qa_scorecards SET name = 'Fronter — TRA',            updated_at = now() WHERE company_id IS NULL AND method = 'tra'          AND is_active = true;
UPDATE qa_scorecards SET name = 'RCM — Fronter Monitoring', updated_at = now() WHERE company_id IS NULL AND method = 'rcm'          AND is_active = true;
UPDATE qa_scorecards SET name = 'Closer — Closed Sale',     updated_at = now() WHERE company_id IS NULL AND method = 'closer_sales' AND is_active = true;
UPDATE qa_scorecards SET name = 'Closer — Unclosed Sale',   updated_at = now() WHERE company_id IS NULL AND method = 'closer_dispo' AND is_active = true;

-- Strip the company prefix from any remaining template names.
UPDATE qa_scorecards SET name = btrim(replace(name, 'WaveTech ', '')), updated_at = now()
 WHERE company_id IS NULL AND name LIKE 'WaveTech %';
