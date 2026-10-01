-- 336_qa2_unclosed_outcomes_more.sql
-- Two more Unclosed "Call Outcome" options: Callback Date, Wrong Dispo.
--
-- v3 (mig 335) already has submitted reviews, so it is LOCKED -- same move as
-- 335: clone the current version (every question with its lineage_id, every
-- option of every question), append the new outcomes at the end of
-- call_outcome, publish the clone. Idempotent: skips when the current version
-- already offers 'wrong_dispo'.

DO $$
DECLARE
  v_form  uuid;
  v_old   uuid;
  v_new   uuid;
  v_np    uuid;
  v_outc  uuid;
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
  IF EXISTS (SELECT 1 FROM qa2_parameter qp JOIN qa2_parameter_option o ON o.parameter_id = qp.id
              WHERE qp.form_version_id = v_old AND qp.key = 'call_outcome' AND o.value = 'wrong_dispo') THEN
    RAISE NOTICE 'current version already has the new outcomes -- nothing to do'; RETURN;
  END IF;

  INSERT INTO qa2_form_version (form_id, version_no, is_current, base_denominator_mode, base_denominator,
                                final_score_formula, rounding_mode, pass_threshold, pass_comparator,
                                autofail_mode, autofail_table)
  SELECT form_id, (SELECT max(version_no) + 1 FROM qa2_form_version WHERE form_id = v_form), false,
         base_denominator_mode, base_denominator, final_score_formula, rounding_mode,
         pass_threshold, pass_comparator, autofail_mode, autofail_table
    FROM qa2_form_version WHERE id = v_old
  RETURNING id INTO v_new;

  FOR s IN SELECT * FROM qa2_section WHERE form_version_id = v_old LOOP
    INSERT INTO qa2_section (form_version_id, name, sort) VALUES (v_new, s.name, s.sort) RETURNING id INTO v_np;
    v_sec := v_sec || jsonb_build_object(s.id::text, v_np);
  END LOOP;

  FOR p IN SELECT * FROM qa2_parameter WHERE form_version_id = v_old ORDER BY sort LOOP
    INSERT INTO qa2_parameter (form_version_id, section_id, lineage_id, key, label, input_type, role,
                               points_yes, points_no, scale_min, scale_max, scale_step, penalty_value,
                               allow_na, included_in_base, requires_comment, sort, ui)
    VALUES (v_new, CASE WHEN p.section_id IS NULL THEN NULL ELSE (v_sec ->> p.section_id::text)::uuid END,
            p.lineage_id, p.key, p.label, p.input_type, p.role,
            p.points_yes, p.points_no, p.scale_min, p.scale_max, p.scale_step, p.penalty_value,
            p.allow_na, p.included_in_base, p.requires_comment, p.sort, p.ui)
    RETURNING id INTO v_np;
    INSERT INTO qa2_parameter_option (parameter_id, value, label, points, is_pass, sort)
    SELECT v_np, value, label, points, is_pass, sort FROM qa2_parameter_option WHERE parameter_id = p.id;
    IF p.key = 'call_outcome' THEN v_outc := v_np; END IF;
  END LOOP;

  IF v_outc IS NULL THEN RAISE EXCEPTION 'current Unclosed version has no call_outcome question'; END IF;

  INSERT INTO qa2_parameter_option (parameter_id, value, label, points, is_pass, sort)
  SELECT v_outc, v.value, v.label, 0, false,
         (SELECT COALESCE(max(sort), -1) FROM qa2_parameter_option WHERE parameter_id = v_outc) + v.ord
    FROM (VALUES ('callback_date', 'Callback Date', 1), ('wrong_dispo', 'Wrong Dispo', 2)) AS v(value, label, ord)
   WHERE NOT EXISTS (SELECT 1 FROM qa2_parameter_option o WHERE o.parameter_id = v_outc AND o.value = v.value);

  UPDATE qa2_form_version SET is_current = false WHERE form_id = v_form AND is_current;
  UPDATE qa2_form_version SET is_current = true, published_at = now() WHERE id = v_new;
  UPDATE qa2_form SET status = 'active' WHERE id = v_form;
END $$;
