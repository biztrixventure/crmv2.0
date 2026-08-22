-- ============================================================================
-- 278_qa2_closer_disposition.sql
-- What the CLOSER did with a transfer, for any set of qa2_call rows.
--
-- A TRA row is the FRONTER's leg. Its own dispo is 'XFER' (or whatever the
-- dialer later overwrote it with), which tells a reviewer nothing about how the
-- transfer actually went — and how it went is the point. Scoring a fronter
-- without knowing whether the closer found a live, qualified customer or a
-- wrong number is scoring half the call.
--
-- Order matters, most authoritative first:
--   1. the sale's closer_disposition — a sale exists, that is the final word
--   2. the newest disposition made by the transfer's OWN assigned closer.
--      setter_role is NOT trustworthy on its own: the dialer webhook stamps
--      'closer' on every row it writes, including ones attributed to the
--      fronter — that is exactly how the ghost cards were traced. The identity
--      of the person is the reliable test, not the label on the row.
--   3. the paired closer LEG's dialer dispo, when the two legs are linked
--   4. transfers.latest_disposition — last resort: whoever touched it most
--      recently, usually the closer but not guaranteed
--
-- Coverage on a week of TRA (1,719 rows): 1,121 from the assigned closer,
-- 111 from a sale, 54 from the paired leg, 294 from latest_disposition,
-- 134 with nothing recorded yet. The source is returned alongside the value so
-- the UI never has to guess how solid it is.
-- ============================================================================
CREATE OR REPLACE FUNCTION app_qa2_closer_dispo(p_call_ids uuid[])
RETURNS TABLE(call_id uuid, closer_dispo text, closer_dispo_source text)
LANGUAGE sql STABLE AS $fn$
  SELECT c.id,
         COALESCE(s.closer_disposition, own.disposition_name, leg.dispo_raw, t.latest_disposition),
         CASE
           WHEN s.closer_disposition IS NOT NULL THEN 'sale'
           WHEN own.disposition_name IS NOT NULL THEN 'closer'
           WHEN leg.dispo_raw        IS NOT NULL THEN 'closer_leg'
           WHEN t.latest_disposition IS NOT NULL THEN 'latest'
           ELSE NULL
         END
    FROM qa2_call c
    LEFT JOIN transfers t ON t.id = c.transfer_id
    LEFT JOIN LATERAL (
      SELECT sa.closer_disposition FROM sales sa
       WHERE sa.transfer_id = c.transfer_id AND sa.closer_disposition IS NOT NULL
       ORDER BY sa.created_at DESC LIMIT 1) s ON true
    LEFT JOIN LATERAL (
      SELECT d.disposition_name FROM disposition_actions d
       WHERE d.transfer_id = c.transfer_id
         AND t.assigned_closer_id IS NOT NULL
         AND d.user_id = t.assigned_closer_id
       ORDER BY d.created_at DESC LIMIT 1) own ON true
    LEFT JOIN qa2_call leg ON leg.id = c.linked_call_id AND leg.leg = 'closer'
   WHERE c.id = ANY (p_call_ids);
$fn$;

GRANT EXECUTE ON FUNCTION app_qa2_closer_dispo(uuid[]) TO service_role;
