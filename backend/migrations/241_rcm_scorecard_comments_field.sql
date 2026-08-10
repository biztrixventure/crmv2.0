-- ============================================================================
-- 241_rcm_scorecard_comments_field.sql
-- RCM — Fronter Monitoring is generated from the client's own "RCM - Master
-- Evaluation Sheet - WaveTech" file, which ends in a free-text "Comments"
-- column (unlike the Closer sheet, it has no "Additional Comments" column —
-- that one stays Closer-only). Migration 198 seeded meta_fields without it,
-- so reviewers scoring on this sheet have had nowhere to write what they
-- actually observed on the call. closer_sales/closer_dispo already carry
-- this field the same way — this brings RCM in line with them.
-- ============================================================================

UPDATE qa_scorecards
SET criteria = jsonb_set(
  criteria, '{meta_fields}',
  COALESCE(criteria->'meta_fields', '[]'::jsonb) || '[{"key":"comments","label":"Comments"}]'::jsonb
)
WHERE method = 'rcm' AND is_active = true AND company_id IS NULL
  AND NOT jsonb_path_exists(criteria, '$.meta_fields[*] ? (@.key == "comments")');

INSERT INTO schema_migrations (filename, note)
VALUES ('241_rcm_scorecard_comments_field.sql', 'RCM — Fronter Monitoring gains the Comments meta field it was missing')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
