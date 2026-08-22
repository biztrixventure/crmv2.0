-- ============================================================================
-- 272_ghost_cards_only_xfer_prompts.sql
-- The rule, stated plainly: ONLY an XFER disposition may raise the "complete the
-- transfer" popup. Every other disposition the fronter gives is not a transfer,
-- and what the CLOSER dispositions afterwards is what shows on the record.
--
-- 271 marked the ghosts the dialer's own dispo could prove and left 686 cards
-- alone, reasoning that a genuine XFER awaiting confirmation carries no dispo yet
-- and would look identical. It does not:
--
--   cards showing              721
--   with a customer name        35   <- plausible, genuinely awaiting confirmation
--   with NO customer name      686   <- 664 older than a week, oldest 12 Feb 2026
--
-- A card from February that nobody confirmed in six months is not pending work.
--
-- ── the discriminator, corrected twice ─────────────────────────────────────
-- First attempt marked every nameless row. That caught 456 rows carrying a
-- CLOSER disposition, and "a closer worked it" looks like proof of a real
-- transfer. It is not proof of anything: EVERY one of those disposition_actions
-- rows has note = 'From dialer (CODE)' and setter_role hardcoded to 'closer' —
-- the webhook writes them, not a person.
--
-- What actually separates Mubeen Jabbar's four real rows from his four ghosts on
-- 21 August is WHO the dialer dispo was attributed to:
--
--   real    Lakisha  CXHNGP  closer assigned  attributed to Aqib Amir
--   real    Bobby    NI      closer assigned  attributed to M. Abdullah Aftab
--   real    Barbara  CAW     closer assigned  attributed to Fahad Butt
--   real    Carlos   CI      closer assigned  attributed to M. Ahad
--   ghost   (none)   GH      no closer        attributed to Mubeen Jabbar
--   ghost   (none)   DAIR    no closer        attributed to Mubeen Jabbar
--   ghost   (none)   CHU     no closer        attributed to Mubeen Jabbar
--   ghost   (none)   WI      no closer        attributed to Mubeen Jabbar
--
-- Attributed to the fronter who created it = the call never left the fronter =
-- it was never a transfer.
--
-- Ghost = no closer, no sale, dispo not XFER, no customer details, and every
-- dialer dispo on it attributed to its own creator. Anything a different user
-- touched, or anything dispositioned by hand in the CRM, is real and stays —
-- 373 nameless rows qualify on that alone and are left visible.
--
-- 2,618 rows. Verified after applying: none with a closer, none sold, none with
-- an XFER dispo, none touched by anyone else. Mubeen 21 Aug: 8 -> 4, and 17 -> 13
-- across the week. Nothing is deleted; ghosts keep their history and stay
-- auditable, they are only excluded from counts and lists.
-- ============================================================================

-- Re-derive from scratch so this is idempotent and supersedes 271's narrower pass.
UPDATE transfers t SET dialer_ghost = false WHERE t.dialer_ghost;

UPDATE transfers t
   SET dialer_ghost = true,
       vicidial_pending = false
 WHERE t.assigned_closer_id IS NULL
   AND upper(coalesce(t.vicidial_dispo, '')) <> 'XFER'
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

-- ── keep the 10-minute sweep on the same rule ──────────────────────────────
-- 270's sweep only fired once the dialer reported a dispo and used the
-- "any human dispositioned it" guard that turned out to mean nothing. Same
-- corrected test here, so a card armed before the deploy lands is retired within
-- ten minutes instead of sitting on a dashboard for six months.
CREATE OR REPLACE FUNCTION app_clear_bogus_pending_cards()
RETURNS bigint LANGUAGE plpgsql AS $fn$
DECLARE n bigint;
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
  RETURN n;
END $fn$;

GRANT EXECUTE ON FUNCTION app_clear_bogus_pending_cards() TO service_role;
