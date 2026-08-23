-- ============================================================================
-- 280_dialer_ghost_unghost.sql
-- dialer_ghost (271/272) is one-directional: the sweep SETS it the moment a
-- pending card with no closer and a non-transfer dispo matches the ghost
-- rule, but nothing ever CLEARS it if the row later stops matching — e.g. the
-- dialer's recycled-lead re-arm path reuses the same transfers.id, and a
-- LATER dial on that same row becomes a genuine transfer: a closer gets
-- assigned, the closer dispositions it for real (attributed to the closer,
-- not the creator — migration 272's own test for "real"). The flag never
-- gets re-evaluated, so a transfer that is now completely legitimate stays
-- excluded from every compliance count forever.
--
-- Found via a same-day audit (22 Aug): 56 dialer_ghost rows created THAT DAY
-- already carry an assigned_closer_id, all 56 dispositioned by that closer
-- (not the fronter who created the row) — migration 272's own definition of
-- real. Two of the 56 have a sale, one closed_won. Zero such rows exist on
-- any earlier day back through 29 Jun (the whole life of the column), so
-- this is not old accumulated damage — it is a live gap that would keep
-- growing every day it goes unpatched.
--
-- Fix, symmetric with the SET side: un-ghost anything that now has a closer
-- assigned or a sale. The SET criteria already required assigned_closer_id
-- IS NULL and no sale to flag a row, so a currently-ghost row with either is
-- proof by construction that it changed after being flagged — never a false
-- un-ghost.
-- ============================================================================

-- One-time correction of today's 56 (+2 with a sale) mislabeled rows.
UPDATE transfers
   SET dialer_ghost = false
 WHERE dialer_ghost = true
   AND (assigned_closer_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM sales s WHERE s.transfer_id = transfers.id));

-- Keep the 10-minute sweep symmetric going forward: SET ghosts as before,
-- then CLEAR any that no longer qualify.
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
     AND upper(COALESCE(t.vicidial_dispo, '')) <> ALL (a.dispos)
     AND t.assigned_closer_id IS NULL
     AND nullif(trim(coalesce(t.form_data->>'customer_name',
                              t.form_data->>'FirstName',
                              t.form_data->>'Name', '')), '') IS NULL
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

-- ── post-apply verification ─────────────────────────────────────────────────
-- SELECT count(*) FROM transfers WHERE dialer_ghost = true AND (assigned_closer_id IS NOT NULL
--   OR EXISTS (SELECT 1 FROM sales s WHERE s.transfer_id = transfers.id));  -- expect 0
