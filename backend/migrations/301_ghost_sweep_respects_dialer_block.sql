-- ============================================================================
-- 301_ghost_sweep_respects_dialer_block.sql  (APPLIED 2026-08-25)
--
-- The bogus-card sweep must not eat fresh XFERs.
--
-- Since 7e6b659 a card is inserted with the phone only and the dialer's
-- customer fields live under form_data.dialer until the fronter confirms. The
-- sweep (mig 280) judged "no customer" by the top-level name keys, so every
-- fresh XFER looked like a bogus re-arm: 8 of the first 28 were ghosted within
-- minutes of landing, card cleared, fronter never saw them. Two fixes:
--   * the dialer block's name counts as customer presence;
--   * nothing younger than 2 hours is swept — that is a card the fronter is
--     still working, whatever its fields say.
-- Plus a one-shot undo of the regression, and the dialer's literal
-- term_reason = NONE (a call that never connected) is nulled rather than shown
-- as an "Ended by" label.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_clear_bogus_pending_cards()
RETURNS bigint LANGUAGE plpgsql AS $fn$
DECLARE n bigint; n2 bigint;
BEGIN
  WITH allowed AS (
    SELECT c.id AS company_id,
           COALESCE(
             (SELECT array_agg(upper(x))
                FROM vicidial_config v,
                     jsonb_array_elements_text(COALESCE(v.field_map->'xfer_dispos', '[]'::jsonb)) AS x
               WHERE v.company_id = c.id),
             ARRAY['XFER']
           ) AS dispos
      FROM companies c
  )
  UPDATE transfers t
     SET vicidial_pending = false,
         dialer_ghost     = true
    FROM allowed a
   WHERE a.company_id = t.company_id
     AND t.vicidial_pending = true
     AND t.created_at < now() - interval '2 hours'
     AND upper(COALESCE(t.vicidial_dispo, '')) <> ALL (a.dispos)
     AND t.assigned_closer_id IS NULL
     AND nullif(trim(coalesce(t.form_data->>'customer_name',
                              t.form_data->>'FirstName',
                              t.form_data->>'Name',
                              t.form_data->'dialer'->>'FirstName',
                              t.form_data->'dialer'->>'LastName', '')), '') IS NULL
     AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.transfer_id = t.id)
     AND NOT EXISTS (
           SELECT 1 FROM disposition_actions d
            WHERE d.transfer_id = t.id
              AND d.user_id IS NOT NULL
              AND (d.user_id <> t.created_by
                   OR d.note IS NULL
                   OR d.note NOT LIKE 'From dialer%'));
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE transfers t
     SET dialer_ghost = false
   WHERE t.dialer_ghost = true
     AND (t.assigned_closer_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM sales s WHERE s.transfer_id = t.id));
  GET DIAGNOSTICS n2 = ROW_COUNT;

  RETURN n + n2;
END $fn$;

GRANT EXECUTE ON FUNCTION app_clear_bogus_pending_cards() TO service_role;

UPDATE transfers
   SET dialer_ghost = false,
       vicidial_pending = CASE WHEN status = 'pending' AND assigned_closer_id IS NULL
                                 AND nullif(trim(coalesce(form_data->>'FirstName','')),'') IS NULL
                               THEN true ELSE vicidial_pending END
 WHERE dialer_ghost = true
   AND vicidial_vendor_code IS NOT NULL
   AND form_data ? 'dialer'
   AND created_at >= '2026-08-25 17:45Z';

UPDATE qa2_call SET hangup_label = NULL, hangup_reason = NULL
 WHERE upper(hangup_label) = 'NONE' OR upper(hangup_reason) = 'NONE';

INSERT INTO schema_migrations (filename, note)
VALUES ('301_ghost_sweep_respects_dialer_block.sql',
        'bogus-card sweep: dialer-block name counts as customer, 2h grace for fresh cards; un-ghosted the regressions; NONE hangup nulled')
ON CONFLICT (filename) DO NOTHING;
