-- ============================================================================
-- 242_qa2_verdict_role.sql
-- Closes the gap flagged in qa2Scoring.js's own header: v1's manual_status
-- (a human-entered verdict that overrides any computed pass/fail, e.g. the
-- mig-226 weighted TRA sheet's "Final Status") has no v2 equivalent yet.
--
-- Adds 'verdict' as a valid qa2_parameter.role, and qa2_parameter_option.is_pass
-- so a verdict-role parameter's options can say which one means Pass. Scoring
-- side (qa2Scoring.js computeEvaluation): when a verdict parameter is answered,
-- its is_pass value overrides `result`, matching v1's manual_status semantics
-- exactly (reviewer judgment is authoritative, same as the sheet it replaces).
-- ============================================================================

ALTER TABLE qa2_parameter DROP CONSTRAINT qa2_parameter_role_check;
ALTER TABLE qa2_parameter ADD CONSTRAINT qa2_parameter_role_check
  CHECK (role IN ('score','autofail','penalty','outcome','info','verdict'));

ALTER TABLE qa2_parameter_option ADD COLUMN IF NOT EXISTS is_pass boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (filename, note)
VALUES ('242_qa2_verdict_role.sql', 'QA v2 — verdict role + parameter_option.is_pass, closes the manual_status gap')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
