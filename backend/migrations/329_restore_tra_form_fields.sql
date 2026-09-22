-- ============================================================================
-- 329_restore_tra_form_fields.sql
--
-- The TRA scorecard lost eight of its ten fields. Version 5 of "Fronters TRA"
-- was created at 2026-09-22 21:23:43 -- ONE SECOND after version 4 -- and
-- carries only the first two parameters:
--
--   kept    greeting_cro_energy, communication
--   lost    customer_understanding, qualifying_questions, misguide,
--           use_of_rebuttals, comments, final_status, status,
--           reason_of_rejection
--
-- v5 is the current version, so every TRA review since has been scored on a
-- two-field sheet. Four evaluations were recorded against it.
--
-- RESTORED AS A NEW VERSION, NOT BY EDITING v5. Form versions are immutable by
-- design: the four evaluations scored on v5 must keep pointing at the sheet
-- they were actually scored on, or their answers stop matching their form and
-- those scores become unreadable. v6 is an exact copy of v4 -- the last good
-- sheet -- including every option and, importantly, every lineage_id, which is
-- what lets reporting follow one parameter across versions.
--
-- NOT FIXED HERE, deliberately: qualifying_questions has a top option worth 20
-- points but labelled "25". That came in with v3, which holds 81 evaluations.
-- Correcting the points would silently move every score already given on it,
-- so it is restored exactly as it was and raised separately.
-- ============================================================================

DO $$
DECLARE
  v_form_id  uuid := '2e74a599-f13a-4bf7-b8da-9942e522c1ed';  -- Fronters TRA
  v_good     uuid := 'fecc2dbc-7d80-4fa7-9c8d-b098e13f9fa5';  -- version 4, 10 params
  v_new      uuid;
  v_next     int;
  v_params   int;
BEGIN
  SELECT count(*) INTO v_params FROM qa2_parameter WHERE form_version_id = v_good;
  IF v_params <> 10 THEN
    RAISE EXCEPTION 'expected 10 parameters on the source version, found %', v_params;
  END IF;

  SELECT COALESCE(max(version_no), 0) + 1 INTO v_next
    FROM qa2_form_version WHERE form_id = v_form_id;

  INSERT INTO qa2_form_version (
    form_id, version_no, is_current, base_denominator_mode, base_denominator,
    final_score_formula, rounding_mode, pass_threshold, pass_comparator,
    autofail_mode, autofail_table, published_at
  )
  SELECT form_id, v_next, false, base_denominator_mode, base_denominator,
         final_score_formula, rounding_mode, pass_threshold, pass_comparator,
         autofail_mode, autofail_table, now()
    FROM qa2_form_version WHERE id = v_good
  RETURNING id INTO v_new;

  -- Parameters. lineage_id is COPIED, not regenerated: it is the thread tying a
  -- parameter to its own history, and a fresh one would orphan every score
  -- already given on that field.
  INSERT INTO qa2_parameter (
    form_version_id, section_id, lineage_id, key, label, input_type, role,
    points_yes, points_no, scale_min, scale_max, scale_step, penalty_value,
    allow_na, included_in_base, requires_comment, sort, ui
  )
  SELECT v_new, section_id, lineage_id, key, label, input_type, role,
         points_yes, points_no, scale_min, scale_max, scale_step, penalty_value,
         allow_na, included_in_base, requires_comment, sort, ui
    FROM qa2_parameter WHERE form_version_id = v_good;

  -- Their options, matched by key because the new parameter ids are fresh.
  INSERT INTO qa2_parameter_option (parameter_id, value, label, points, sort, is_pass)
  SELECT np.id, o.value, o.label, o.points, o.sort, o.is_pass
    FROM qa2_parameter_option o
    JOIN qa2_parameter op ON op.id = o.parameter_id AND op.form_version_id = v_good
    JOIN qa2_parameter np ON np.form_version_id = v_new AND np.key = op.key;

  -- One current version per form: clear, then set.
  UPDATE qa2_form_version SET is_current = false WHERE form_id = v_form_id;
  UPDATE qa2_form_version SET is_current = true  WHERE id = v_new;

  RAISE NOTICE 'TRA restored as version % (%): % parameters',
    v_next, v_new, (SELECT count(*) FROM qa2_parameter WHERE form_version_id = v_new);
END $$;
