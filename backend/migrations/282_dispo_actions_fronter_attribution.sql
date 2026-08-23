-- ============================================================================
-- 282_dispo_actions_fronter_attribution.sql
-- applyCloserDispo() (routes/vicidial.js) already guarded transfers.
-- assigned_closer_id against ever holding a fronter — closerOk requires the
-- resolved dialer agent to (a) not be the transfer's own creator and (b)
-- actually hold a closer-side role. But the disposition_actions insert right
-- below it used the raw, UNGUARDED closerUserId instead of that same closerOk
-- value — so a fronter re-dialling her own recycled lead (a normal, harmless
-- fronter action) got logged as if a closer had worked the call: user_id =
-- the fronter's own id, note = 'From dialer (CODE)', setter_role = 'closer'.
-- assigned_closer_id stayed correctly null; this one field didn't.
--
-- Fixed going forward in the same commit. This is the retroactive correction:
-- 3,161 rows across 2,911 transfers since 28 Jun carry exactly that signature
-- (user_id = the transfer's own creator, dialer-authored, tagged closer) —
-- which can never be legitimate, by the same logic the code guard already
-- uses. Backfilled to the transfer's real assigned_closer_id where one
-- exists (mirrors the code's own fallback chain), else left NULL. Nothing
-- else on the row changes — the disposition itself, its name, note, and
-- timestamp are the real history and stay exactly as recorded.
-- ============================================================================

UPDATE disposition_actions d
   SET user_id = t.assigned_closer_id
  FROM transfers t
 WHERE d.transfer_id = t.id
   AND d.user_id = t.created_by
   AND d.note LIKE 'From dialer%'
   AND d.setter_role = 'closer';

-- ── post-apply verification ─────────────────────────────────────────────────
-- SELECT count(*) FROM disposition_actions d JOIN transfers t ON t.id = d.transfer_id
--  WHERE d.user_id = t.created_by AND d.note LIKE 'From dialer%' AND d.setter_role = 'closer';
--  -- expect 0
