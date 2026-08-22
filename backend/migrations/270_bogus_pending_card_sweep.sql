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
     AND upper(t.vicidial_dispo) <> ALL (a.dispos);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION app_clear_bogus_pending_cards() TO service_role;
