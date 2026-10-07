-- ============================================================================
-- 340_unclosed_wrong_dispo_and_manual_verdict.sql
--
-- Two additions to the Unclosed scorecard, published as a new version because
-- v4 carries 117 submitted reviews and a scored version is immutable.
--
--   Wrong Dispo    Yes/No, role `outcome` -> gets its own counted breakdown
--                  above the sheet in the Scorecards report.
--   Final Status   Pass/Fail, role `verdict` -> the reviewer decides the
--                  result; the computed score no longer does.
--
-- WHY `choice` AND NOT `yes_no`. v1 already had a Wrong Dispo and it never
-- showed in the report, because the report's outcome breakdown aggregates
-- `role='outcome' AND input_type='choice'` (qa2Reports.js). A `yes_no` answers
-- the question on the sheet and is invisible everywhere else -- which is
-- exactly the complaint. Same question, as a choice, so it counts.
--
-- Values are 'Y' and 'N', not 'yes'/'no', and the parameter KEEPS v1's
-- lineage_id (effc8886-...): seven answers were recorded against it in v1 as
-- Y/N, and lineage plus matching values is what makes the report thread the
-- old answers to the new column instead of showing two unrelated questions.
--
-- The verdict mechanism already exists (mig 242): a `verdict` parameter's mere
-- presence hands `result` to the reviewer, and its is_pass-tagged option
-- decides pass or fail whatever the numbers say. Nothing in the scoring engine
-- changes. Pass/Fail values mirror the TRA card so the two read alike.
--
-- Built on version 6, which was already an untouched clone of v4 left unpublished
-- in the builder -- extending it avoids minting yet another version.
-- Other methods are untouched: this edits ONE form's draft and publishes it.
-- ============================================================================

DO $$
DECLARE
  v_form   uuid := 'd2f6b0a3-409a-409f-8dff-234694d7f964';  -- Unclosed Scorecard
  v_draft  uuid;
  v_wrong  uuid;
  v_final  uuid;
  v_params int;
BEGIN
  SELECT id INTO v_draft FROM qa2_form_version
   WHERE form_id = v_form AND version_no = 6 AND published_at IS NULL;
  IF v_draft IS NULL THEN
    RAISE EXCEPTION 'version 6 draft not found or already published';
  END IF;

  SELECT count(*) INTO v_params FROM qa2_parameter WHERE form_version_id = v_draft;
  IF v_params <> 7 THEN
    RAISE EXCEPTION 'expected the untouched 7-parameter clone, found %', v_params;
  END IF;

  -- Comments stay last.
  UPDATE qa2_parameter SET sort = 8
   WHERE form_version_id = v_draft AND key = 'additional_comments';

  -- Wrong Dispo — counted in the report, never scored.
  INSERT INTO qa2_parameter (
    form_version_id, section_id, lineage_id, key, label, input_type, role,
    points_yes, points_no, allow_na, included_in_base, requires_comment, sort, ui)
  VALUES (
    v_draft, NULL, 'effc8886-2800-4066-97c7-4f71ff9a4392', 'wrong_dispo',
    'Wrong Dispo', 'choice', 'outcome', 1, 0, false, false, 'never', 6, '{}')
  RETURNING id INTO v_wrong;

  INSERT INTO qa2_parameter_option (parameter_id, value, label, points, sort, is_pass) VALUES
    (v_wrong, 'Y', 'Yes', 0, 0, false),
    (v_wrong, 'N', 'No',  0, 1, false);

  -- Final Status — the reviewer's own pass/fail, overriding the computed score.
  INSERT INTO qa2_parameter (
    form_version_id, section_id, lineage_id, key, label, input_type, role,
    points_yes, points_no, allow_na, included_in_base, requires_comment, sort, ui)
  VALUES (
    v_draft, NULL, gen_random_uuid(), 'final_status',
    'Final Status', 'choice', 'verdict', 1, 0, false, false, 'never', 7, '{}')
  RETURNING id INTO v_final;

  INSERT INTO qa2_parameter_option (parameter_id, value, label, points, sort, is_pass) VALUES
    (v_final, 'Pass', 'Pass', 0, 0, true),
    (v_final, 'Fail', 'Fail', 0, 1, false);

  -- Publish: exactly one current version per form (resolveActiveFormVersion
  -- reads it with maybeSingle and errors on two).
  UPDATE qa2_form_version SET is_current = false WHERE form_id = v_form;
  UPDATE qa2_form_version
     SET is_current = true, published_at = now()
   WHERE id = v_draft;

  RAISE NOTICE 'Unclosed v6 published with Wrong Dispo + Final Status';
END $$;
