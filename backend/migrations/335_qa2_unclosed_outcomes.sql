-- 335_qa2_unclosed_outcomes.sql
-- QA2 Unclosed scorecard: the full Call Outcome list + an Additional Comments box.
--
-- The Unclosed form's "Call Outcome" dropdown (role 'outcome') held ONE option,
-- and that option was saved with an EMPTY value ('' / "Cx was NI ") -- picking
-- it stored a blank, so every outcome answered so far reads as nothing in the
-- reports. The form builder let an option go out without a value; routes/
-- qa2Forms.js now derives one from the label, so that cannot recur.
--
-- Version 2 has submitted reviews scored against it, so it is LOCKED (the PUT
-- guard in qa2Forms.js refuses edits under a scored review). This does exactly
-- what the builder's "Edit as new version" + Publish does: clone v2 -> v3 with
-- every question carrying its lineage_id forward (so reports chart each
-- question across versions as one column), then change only:
--   * call_outcome   -> the 39 outcomes below, value = a stable slug of the label
--                       (0 points: an outcome is RECORDED, never scored)
--   * additional_comments (NEW) -> free-text box, role 'info', never scored,
--                       never required
-- and publish v3 as the current version. v2 and its reviews are untouched.
-- Idempotent: does nothing if the current version already has the comments box.

DO $$
DECLARE
  v_form  uuid;
  v_old   uuid;
  v_new   uuid;
  v_np    uuid;
  v_outc  uuid;
  v_sort  int;
  p       record;
  s       record;
  v_sec   jsonb := '{}'::jsonb;
BEGIN
  SELECT f.id INTO v_form
    FROM qa2_form f JOIN qa2_method m ON m.id = f.method_id
   WHERE m.code = 'unclosed_closer' AND f.company_id IS NULL AND f.status = 'active'
   LIMIT 1;
  IF v_form IS NULL THEN RAISE NOTICE 'no active Unclosed form -- nothing to do'; RETURN; END IF;

  SELECT id INTO v_old FROM qa2_form_version WHERE form_id = v_form AND is_current;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Unclosed form % has no current version', v_form; END IF;
  IF EXISTS (SELECT 1 FROM qa2_parameter WHERE form_version_id = v_old AND key = 'additional_comments') THEN
    RAISE NOTICE 'current version already has additional_comments -- nothing to do'; RETURN;
  END IF;

  -- clone the version's settings
  INSERT INTO qa2_form_version (form_id, version_no, is_current, base_denominator_mode, base_denominator,
                                final_score_formula, rounding_mode, pass_threshold, pass_comparator,
                                autofail_mode, autofail_table)
  SELECT form_id, (SELECT max(version_no) + 1 FROM qa2_form_version WHERE form_id = v_form), false,
         base_denominator_mode, base_denominator, final_score_formula, rounding_mode,
         pass_threshold, pass_comparator, autofail_mode, autofail_table
    FROM qa2_form_version WHERE id = v_old
  RETURNING id INTO v_new;

  -- sections (none today, carried generically)
  FOR s IN SELECT * FROM qa2_section WHERE form_version_id = v_old LOOP
    INSERT INTO qa2_section (form_version_id, name, sort) VALUES (v_new, s.name, s.sort) RETURNING id INTO v_np;
    v_sec := v_sec || jsonb_build_object(s.id::text, v_np);
  END LOOP;

  -- questions, lineage carried forward; options copied except call_outcome's
  FOR p IN SELECT * FROM qa2_parameter WHERE form_version_id = v_old ORDER BY sort LOOP
    INSERT INTO qa2_parameter (form_version_id, section_id, lineage_id, key, label, input_type, role,
                               points_yes, points_no, scale_min, scale_max, scale_step, penalty_value,
                               allow_na, included_in_base, requires_comment, sort, ui)
    VALUES (v_new, CASE WHEN p.section_id IS NULL THEN NULL ELSE (v_sec ->> p.section_id::text)::uuid END,
            p.lineage_id, p.key, p.label, p.input_type, p.role,
            p.points_yes, p.points_no, p.scale_min, p.scale_max, p.scale_step, p.penalty_value,
            p.allow_na, p.included_in_base, p.requires_comment, p.sort, p.ui)
    RETURNING id INTO v_np;
    IF p.key = 'call_outcome' THEN
      v_outc := v_np;
    ELSE
      INSERT INTO qa2_parameter_option (parameter_id, value, label, points, is_pass, sort)
      SELECT v_np, value, label, points, is_pass, sort FROM qa2_parameter_option WHERE parameter_id = p.id;
    END IF;
  END LOOP;

  IF v_outc IS NULL THEN RAISE EXCEPTION 'current Unclosed version has no call_outcome question'; END IF;

  -- the outcome list, in the order the QA team gave it
  INSERT INTO qa2_parameter_option (parameter_id, value, label, points, is_pass, sort)
  SELECT v_outc,
         trim(both '_' from lower(regexp_replace(btrim(label), '[^A-Za-z0-9]+', '_', 'g'))),
         btrim(label), 0, false, (ord - 1)::int
    FROM unnest(ARRAY[
      'Pricing Issue', 'Awaiting', 'Technical issue', 'No conversation', 'Call Back',
      'Customer no longer interested', 'CRO issue', 'Closer issue', 'NA state', 'No Data found',
      'Customer issue', 'No recording found', 'Customer asked to be on DNC', 'Mechanic Self/Family',
      'Abusive Customer', 'Already Have Warranty', 'Spanish Customer', 'Christmas budget issue',
      'Prices Pitched, CX Not Interested', 'Post Dated', 'Sarcastic CX', 'Not Affordable',
      'Need to see the docs first', 'Declined', 'Busy', 'Cx will call us', 'NEFW',
      'Cx was not interested', 'Dead Air', 'Email Required', 'Language Barrier', 'Skeptical cx',
      'Will trade the car', 'Social Security', 'Cx wants to research', 'Cx hungup during conversation',
      'Authorization', 'Cx wants to think about it', 'Litigator'
    ]) WITH ORDINALITY AS t(label, ord);

  -- the new comments box, last on the form
  SELECT COALESCE(max(sort), 0) + 1 INTO v_sort FROM qa2_parameter WHERE form_version_id = v_new;
  INSERT INTO qa2_parameter (form_version_id, section_id, lineage_id, key, label, input_type, role,
                             allow_na, included_in_base, requires_comment, sort, ui)
  VALUES (v_new, NULL, gen_random_uuid(), 'additional_comments', 'Additional Comments', 'text', 'info',
          false, false, 'never', v_sort, '{}'::jsonb);

  -- publish: same steps as POST /qa2/versions/:vid/publish
  UPDATE qa2_form_version SET is_current = false WHERE form_id = v_form AND is_current;
  UPDATE qa2_form_version SET is_current = true, published_at = now() WHERE id = v_new;
  UPDATE qa2_form SET status = 'active' WHERE id = v_form;
END $$;
