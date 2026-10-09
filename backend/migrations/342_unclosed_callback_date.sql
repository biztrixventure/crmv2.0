-- ============================================================================
-- 342_unclosed_callback_date.sql — an OPTIONAL callback date on Unclosed,
-- picked from a calendar.
--
-- Mig 336 added "Callback Date" as one of the 41 OPTIONS inside `call_outcome`,
-- which records only THAT the closer promised to call back — never WHEN. The
-- date is the point of that outcome: a callback nobody diarised is a callback
-- nobody makes. So this adds a real date field beside it.
--
-- A NEW INPUT TYPE, AND THE CHECK HAS TO LEARN IT FIRST. `qa2_parameter`
-- constrains input_type to yes_no/scale/choice/number/text, so 'date' is a
-- 23514 until the constraint is widened. Everything downstream already copes
-- unchanged, which is why 'date' and not a bare text box:
--   * fieldPoints() and maxPoints() (utils/qa2Scoring.js) both `default: 0`,
--     so a date can never move a score;
--   * displayOf() (routes/qa2Reports.js) falls through to `a.value_text`, so
--     the Scorecards sheet prints 2026-10-15 as written;
--   * the report never flags a `role = 'info'` cell red.
-- The value is stored in qa2_answer.value_text as YYYY-MM-DD — exactly what an
-- <input type="date"> yields, so there is no parsing and no timezone to get
-- wrong. Deliberately NOT a timestamp: a callback date is a day the floor
-- agreed on, not an instant, and storing an instant would drag it across
-- midnight for anyone in another zone.
--
-- NEVER COMPULSORY, as asked. `role = 'info'` is this schema's "never scored,
-- never required" role (the one additional_comments already carries) and there
-- is no is_required column to set, so leaving it blank blocks no submit.
--
-- V6 IS LOCKED: 227 submitted reviews, and a published version is immutable.
-- This clones the current version the way the builder's "Edit as new version"
-- does (routes/qa2Forms.js), carrying lineage_id forward so every report keeps
-- ONE column per question across the bump, then publishes the clone.
--
-- Only the Unclosed form is touched. TRA and Closed keep their current
-- versions, and exactly one version per form stays current. Re-running is a
-- no-op once the field is on the current version.
-- ============================================================================

-- 1. Teach the constraint the new type.
ALTER TABLE qa2_parameter DROP CONSTRAINT IF EXISTS qa2_parameter_input_type_check;
ALTER TABLE qa2_parameter ADD CONSTRAINT qa2_parameter_input_type_check
  CHECK (input_type = ANY (ARRAY['yes_no','scale','choice','number','text','date']));

-- 2. Clone the current Unclosed version and add the field.
DO $$
DECLARE
  v_form     uuid;
  v_cur      uuid;
  v_cur_no   int;
  v_new      uuid;
  v_sec_new  uuid;
  v_params   int;
  s          record;
BEGIN
  SELECT f.id INTO v_form
    FROM qa2_form f JOIN qa2_method m ON m.id = f.method_id
   WHERE m.code = 'unclosed_closer'
   LIMIT 1;
  IF v_form IS NULL THEN RAISE EXCEPTION 'Unclosed form not found'; END IF;

  SELECT id, version_no INTO v_cur, v_cur_no
    FROM qa2_form_version
   WHERE form_id = v_form AND is_current
   ORDER BY version_no DESC LIMIT 1;
  IF v_cur IS NULL THEN RAISE EXCEPTION 'Unclosed has no current version'; END IF;

  -- Already applied? Do not stack another version on top.
  IF EXISTS (SELECT 1 FROM qa2_parameter WHERE form_version_id = v_cur AND key = 'callback_date') THEN
    RAISE NOTICE 'callback_date is already on the current Unclosed version — nothing to do';
    RETURN;
  END IF;

  SELECT count(*) INTO v_params FROM qa2_parameter WHERE form_version_id = v_cur;
  IF v_params <> 9 THEN
    RAISE EXCEPTION 'expected the 9-parameter v%, found %', v_cur_no, v_params;
  END IF;

  -- The version row, carrying every scoring setting across unchanged.
  INSERT INTO qa2_form_version (
    form_id, version_no, is_current,
    base_denominator_mode, base_denominator, final_score_formula, rounding_mode,
    pass_threshold, pass_comparator, autofail_mode, autofail_table)
  SELECT form_id,
         (SELECT max(version_no) + 1 FROM qa2_form_version WHERE form_id = v_form),
         false,
         base_denominator_mode, base_denominator, final_score_formula, rounding_mode,
         pass_threshold, pass_comparator, autofail_mode, autofail_table
    FROM qa2_form_version WHERE id = v_cur
  RETURNING id INTO v_new;

  -- Sections, remapped old -> new. v6 carries none, but a later version may,
  -- and a parameter pointing at the OLD version's section would silently tie
  -- the two versions together.
  CREATE TEMP TABLE _sec_map (old uuid PRIMARY KEY, new uuid NOT NULL) ON COMMIT DROP;
  FOR s IN SELECT * FROM qa2_section WHERE form_version_id = v_cur LOOP
    INSERT INTO qa2_section (form_version_id, name, sort)
    VALUES (v_new, s.name, s.sort)
    RETURNING id INTO v_sec_new;
    INSERT INTO _sec_map (old, new) VALUES (s.id, v_sec_new);
  END LOOP;

  -- Parameters. lineage_id carries forward UNCHANGED — that is what makes the
  -- reports chart one question across versions instead of starting a second
  -- column. final_status and additional_comments shift down one to free sort 7.
  INSERT INTO qa2_parameter (
    form_version_id, section_id, lineage_id, key, label, input_type, role,
    points_yes, points_no, scale_min, scale_max, scale_step, penalty_value,
    allow_na, included_in_base, requires_comment, sort, ui)
  SELECT v_new,
         (SELECT m.new FROM _sec_map m WHERE m.old = p.section_id),
         p.lineage_id, p.key, p.label, p.input_type, p.role,
         p.points_yes, p.points_no, p.scale_min, p.scale_max, p.scale_step, p.penalty_value,
         p.allow_na, p.included_in_base, p.requires_comment,
         CASE WHEN p.key IN ('final_status', 'additional_comments') THEN p.sort + 1 ELSE p.sort END,
         p.ui
    FROM qa2_parameter p
   WHERE p.form_version_id = v_cur;

  -- Options, matched back by `key` now that every parameter exists. Safe
  -- because `key` is what identifies a question within one version.
  INSERT INTO qa2_parameter_option (parameter_id, value, label, points, sort, is_pass)
  SELECT np.id, o.value, o.label, o.points, o.sort, o.is_pass
    FROM qa2_parameter_option o
    JOIN qa2_parameter op ON op.id = o.parameter_id AND op.form_version_id = v_cur
    JOIN qa2_parameter np ON np.form_version_id = v_new AND np.key = op.key;

  -- The new field, beside the outcome questions it belongs with.
  INSERT INTO qa2_parameter (
    form_version_id, section_id, lineage_id, key, label, input_type, role,
    points_yes, points_no, allow_na, included_in_base, requires_comment, sort, ui)
  VALUES (
    v_new, NULL, gen_random_uuid(), 'callback_date',
    'Callback Date', 'date', 'info', 0, 0, false, false, 'never', 7, '{}');

  -- Publish: exactly one current version per form (resolveActiveFormVersion
  -- reads it with maybeSingle and errors on two).
  UPDATE qa2_form_version SET is_current = false WHERE form_id = v_form;
  UPDATE qa2_form_version SET is_current = true, published_at = now() WHERE id = v_new;

  RAISE NOTICE 'Unclosed cloned from v% and published with an optional Callback Date', v_cur_no;
END $$;
