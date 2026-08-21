-- ============================================================================
-- 263_qa2_closed_method_clone.sql
-- The Closed-sale method, cloned from Unclosed so it scores identically on day
-- one. Same leg (closer), same scorecard: form, version settings, every
-- parameter and every option are copied by INSERT…SELECT rather than retyped,
-- so nothing drifts between the two sheets.
--
-- The one thing NOT copied verbatim is the classification rule. Unclosed's rule
-- is `source=ingest_closer, match_type=any, priority=100` — it claims EVERY
-- closer call. Cloning that would leave two methods fighting for the same call,
-- and the classifier is first-match-wins by ascending priority, so the winner
-- would be whichever row happened to sort first. Closed instead gets an EXACT
-- match on the SALE dispo at priority 50, i.e. ahead of Unclosed:
--     closer dispo = SALE  → Closed
--     anything else        → Unclosed  (its catch-all, untouched)
--
-- Exact, not a wildcard, on purpose: the closers' dispo list also contains
-- "DECLINED SALE", which a %SALE% pattern would score as a sale. "POST DATE" is
-- likewise excluded — a post-date is a reminder, not a charged sale (mig 221).
--
-- Parameters get FRESH lineage_ids. lineage_id tracks one question across
-- versions of its own form; sharing Unclosed's would make the two scorecards
-- look like one question's history and corrupt per-parameter reporting.
-- Idempotent: re-running finds the method already there and does nothing.
-- ============================================================================
DO $$
DECLARE
  src_method uuid;
  src_form   uuid;
  src_ver    uuid;
  new_method uuid;
  new_form   uuid;
  new_ver    uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM qa2_method WHERE code = 'closed_closed') THEN
    RAISE NOTICE 'closed_closed already exists — nothing to do';
    RETURN;
  END IF;

  SELECT id INTO src_method FROM qa2_method WHERE code = 'unclosed_closer';
  IF src_method IS NULL THEN RAISE EXCEPTION 'source method unclosed_closer not found'; END IF;

  SELECT f.id INTO src_form FROM qa2_form f WHERE f.method_id = src_method ORDER BY f.created_at LIMIT 1;
  SELECT v.id INTO src_ver  FROM qa2_form_version v
   WHERE v.form_id = src_form ORDER BY v.is_current DESC, v.version_no DESC LIMIT 1;

  -- 1. the method
  INSERT INTO qa2_method (code, label, leg, requires_transfer, is_active, sort, created_by)
  SELECT 'closed_closed', 'Closed', m.leg, m.requires_transfer, true, m.sort, m.created_by
    FROM qa2_method m WHERE m.id = src_method
  RETURNING id INTO new_method;

  -- 2. the form
  INSERT INTO qa2_form (name, method_id, company_id, status, created_by)
  SELECT 'Closed Scorecard', new_method, f.company_id, f.status, f.created_by
    FROM qa2_form f WHERE f.id = src_form
  RETURNING id INTO new_form;

  -- 3. the version — scoring settings copied wholesale
  INSERT INTO qa2_form_version (form_id, version_no, is_current, base_denominator_mode, base_denominator,
                                final_score_formula, rounding_mode, pass_threshold, pass_comparator,
                                autofail_mode, autofail_table, published_at, published_by)
  SELECT new_form, 1, true, v.base_denominator_mode, v.base_denominator,
         v.final_score_formula, v.rounding_mode, v.pass_threshold, v.pass_comparator,
         v.autofail_mode, v.autofail_table, v.published_at, v.published_by
    FROM qa2_form_version v WHERE v.id = src_ver
  RETURNING id INTO new_ver;

  -- 4. sections (Unclosed has none today, but a clone must not assume that)
  CREATE TEMP TABLE _sec_map ON COMMIT DROP AS
  SELECT s.id AS old_id, gen_random_uuid() AS new_id FROM qa2_section s WHERE s.form_version_id = src_ver;

  INSERT INTO qa2_section (id, form_version_id, name, sort)
  SELECT m.new_id, new_ver, s.name, s.sort
    FROM qa2_section s JOIN _sec_map m ON m.old_id = s.id;

  -- 5. parameters — fresh ids AND fresh lineage
  CREATE TEMP TABLE _par_map ON COMMIT DROP AS
  SELECT p.id AS old_id, gen_random_uuid() AS new_id FROM qa2_parameter p WHERE p.form_version_id = src_ver;

  INSERT INTO qa2_parameter (id, form_version_id, section_id, lineage_id, key, label, input_type, role,
                             points_yes, points_no, scale_min, scale_max, scale_step, penalty_value,
                             allow_na, included_in_base, requires_comment, sort, ui)
  SELECT m.new_id, new_ver,
         (SELECT sm.new_id FROM _sec_map sm WHERE sm.old_id = p.section_id),
         gen_random_uuid(), p.key, p.label, p.input_type, p.role,
         p.points_yes, p.points_no, p.scale_min, p.scale_max, p.scale_step, p.penalty_value,
         p.allow_na, p.included_in_base, p.requires_comment, p.sort, p.ui
    FROM qa2_parameter p JOIN _par_map m ON m.old_id = p.id;

  -- 6. the options under each parameter
  INSERT INTO qa2_parameter_option (parameter_id, value, label, points, sort, is_pass)
  SELECT m.new_id, o.value, o.label, o.points, o.sort, o.is_pass
    FROM qa2_parameter_option o JOIN _par_map m ON m.old_id = o.parameter_id;

  -- 7. classification — SALE goes to Closed, ahead of Unclosed's catch-all
  INSERT INTO qa2_method_rule (method_id, source, match_type, dispo_match, priority, is_active)
  VALUES (new_method, 'ingest_closer', 'exact', 'SALE', 50, true);

  -- 8. sampling — mirror whatever Unclosed samples
  INSERT INTO qa2_sampling_rule (company_id, method_id, mode, quantity, min_talk_sec, is_active)
  SELECT r.company_id, new_method, r.mode, r.quantity, r.min_talk_sec, r.is_active
    FROM qa2_sampling_rule r WHERE r.method_id = src_method;

  RAISE NOTICE 'closed_closed created: method % form % version %', new_method, new_form, new_ver;
END $$;
