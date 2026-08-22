-- ============================================================================
-- 270_bogus_pending_card_sweep.sql
-- Self-healing sweep for "complete the transfer" cards armed by a non-transfer
-- disposition.
--
-- The root cause is fixed in routes/vicidial.js (the xfer_dispos gate now runs
-- BEFORE the existing-transfer branch), but that fix only takes effect when the
-- backend is redeployed, and the old order keeps arming cards until then — 34
-- came back within hours of migration 267 clearing them, stamped 21 Aug 22:26
-- through 22 Aug 00:04.
--
-- A trigger cannot judge this: the buggy path calls resetIfStale, which clears
-- vicidial_dispo and sets vicidial_pending in the SAME write, so at commit time
-- the row carries no dispo to test, and a genuine re-transfer of a recycled lead
-- looks identical. The dispo only reappears afterwards, when autoFetchDispo
-- pulls the lead's real status from the dialer — which is exactly when this
-- sweep can tell the difference.
--
-- So the rule is the one migration 267 used, run on a schedule instead of once:
-- a card whose DIALER dispo is present and is not one of that company's
-- transfer dispositions was never a transfer. Cards with no dialer dispo yet are
-- left alone — a genuine XFER awaiting confirmation looks exactly like that, and
-- clearing one would destroy real work. Companies with no vicidial_config fall
-- back to XFER, the transfer dispo on every configured company.
--
-- After the deploy this becomes a no-op, which is the point: it costs one
-- indexed pass when there is nothing to do, and it cannot mask the real fix
-- because the real fix simply stops giving it anything to find.
-- ============================================================================
CREATE OR REPLACE FUNCTION app_clear_bogus_pending_cards()
RETURNS bigint LANGUAGE plpgsql AS $$
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
     SET vicidial_pending = false
    FROM allowed a
   WHERE a.company_id = t.company_id
     AND t.vicidial_pending = true
     AND t.vicidial_dispo IS NOT NULL
     AND upper(t.vicidial_dispo) <> ALL (a.dispos)
     -- NARROWED after review. "Dialer dispo is not XFER" does NOT prove the row
     -- was never a transfer: the dispo is overwritten by the fronter's later
     -- calls on a recycled lead and by the closer's own outcome. 9,331 rows
     -- matched the loose shape and 8,492 of them had been worked by a human in
     -- the CRM — the loose rule would have called those non-transfers.
     -- A card is only bogus when nothing at all supports it: no closer took it,
     -- no sale came from it, and no human ever dispositioned it here.
     AND t.assigned_closer_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.transfer_id = t.id)
     AND NOT EXISTS (SELECT 1 FROM disposition_actions d
                      WHERE d.transfer_id = t.id AND d.user_id IS NOT NULL);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION app_clear_bogus_pending_cards() TO service_role;
