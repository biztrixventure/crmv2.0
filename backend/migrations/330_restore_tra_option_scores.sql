-- ============================================================================
-- 330_restore_tra_option_scores.sql
--
-- The TRA questions came back (mig 329) but their SCORES did not. Every choice
-- parameter on the current version lost all of its options between 21:47 and
-- 22:07 on 2026-09-22, so the reviewer saw the ten questions with empty
-- dropdowns and nothing to pick:
--
--   greeting_cro_energy 3, communication 5, customer_understanding 5,
--   qualifying_questions 5, misguide 3, use_of_rebuttals 4,
--   final_status 2, status 2   -- 29 options, all gone
--
-- The evidence of the damage is in the drafts: one review at 22:07 has six
-- answers holding "10", "20", "5" and still scored base_sum 0, because a value
-- with no matching option resolves to no points. The four opened after it have
-- no answers at all.
--
-- Restored IN PLACE on the current version rather than as yet another version.
-- All five evaluations against it are DRAFTS, and a draft is re-read against
-- the current definition when it is reopened -- so putting the options back is
-- what makes those six already-chosen answers score properly, which a new
-- version would not do.
--
-- NOT EXISTS makes it idempotent: a parameter that still has its options is
-- left alone, so this cannot double up a dropdown.
-- ============================================================================

INSERT INTO qa2_parameter_option (parameter_id, value, label, points, sort, is_pass)
SELECT np.id, o.value, o.label, o.points, o.sort, o.is_pass
  FROM qa2_parameter_option o
  JOIN qa2_parameter op
    ON op.id = o.parameter_id
   AND op.form_version_id = 'fecc2dbc-7d80-4fa7-9c8d-b098e13f9fa5'   -- version 4
  JOIN qa2_parameter np
    ON np.key = op.key
  JOIN qa2_form_version v
    ON v.id = np.form_version_id
   AND v.form_id = '2e74a599-f13a-4bf7-b8da-9942e522c1ed'            -- Fronters TRA
   AND v.is_current
 WHERE NOT EXISTS (
   SELECT 1 FROM qa2_parameter_option x WHERE x.parameter_id = np.id
 );
