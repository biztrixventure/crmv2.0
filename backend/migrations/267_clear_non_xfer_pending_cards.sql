-- ============================================================================
-- 267_clear_non_xfer_pending_cards.sql
-- Clear the "complete the transfer" cards the fronter dashboard was showing for
-- calls that were never transfers.
--
-- The dialer's Dispo Call URL fires on EVERY disposition. In routes/vicidial.js
-- the xfer_dispos allowlist sat BELOW the "existing transfer" branch, so a
-- non-transfer dispo on a lead that already had a transfer row never reached the
-- check: the branch called resetIfStale({ rearmPending: true }) and returned. A
-- fronter re-dialling a recycled lead and marking it Manual Answering, Callback
-- or Cx Hang up got the confirm card pushed back onto their dashboard for a
-- transfer they never made. The gate now runs first; this clears the backlog.
--
-- 3,077 cards across four companies, and not one of them carries an XFER dispo:
--   N 1008 · A 294 · NI 285 · WN 177 · DEADA 142 · CALLBK 130 · DNC 106 · ...
--
-- Only rows whose DIALER dispo is present and is not a transfer dispo are
-- cleared — that is the dialer's own account of what the fronter did, so it is
-- the safe signal. Rows with no dialer dispo yet (743) are left alone: a genuine
-- XFER awaiting confirmation looks exactly like that, and wrongly clearing one
-- would lose a real transfer the fronter still has to complete.
--
-- Cards are cleared, not deleted: the transfer row, its form data and its
-- history stay exactly as they are. Only the dashboard prompt goes away.
-- ============================================================================
UPDATE transfers t
   SET vicidial_pending = false
  FROM vicidial_config v
 WHERE v.company_id = t.company_id
   AND t.vicidial_pending = true
   AND t.vicidial_dispo IS NOT NULL
   AND upper(t.vicidial_dispo) <> ALL (
         SELECT upper(x) FROM jsonb_array_elements_text(
           COALESCE(v.field_map->'xfer_dispos', '[]'::jsonb)) AS x
       );

-- ── second pass: companies with no vicidial_config row ─────────────────────
-- The join above needs a config row to know that company's transfer dispos, so
-- 1-Vertex (2,010 cards) was skipped entirely — it has no config. Its stuck
-- cards carry the same non-transfer dispos as everyone else's: N 915, WN 175,
-- A 174, DEADA 142, NI 87... XFER is the transfer dispo on every configured
-- company, so it is the honest fallback for one that has not been configured.
UPDATE transfers t
   SET vicidial_pending = false
 WHERE t.vicidial_pending = true
   AND t.vicidial_dispo IS NOT NULL
   AND upper(t.vicidial_dispo) <> 'XFER'
   AND NOT EXISTS (SELECT 1 FROM vicidial_config v WHERE v.company_id = t.company_id);
