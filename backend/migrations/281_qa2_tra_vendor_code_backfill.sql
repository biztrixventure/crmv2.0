-- ============================================================================
-- 281_qa2_tra_vendor_code_backfill.sql
-- fn_qa2_materialize_transfer (mig 265) stamps a TRA qa2_call row's
-- vendor_code from transfers.vicidial_vendor_code at the instant the transfer
-- is INSERTed — but the trigger only ever runs once per transfer, and the
-- dialer very often reports the vendor code onto the transfer LATER (the
-- ingest webhook updates the transfer after the fronter already created it).
-- When that happens the qa2_call row is permanently stuck with
-- vendor_code/dialer_lead_id = NULL even though the transfer now has one —
-- the recording poller only gets the weak agent+day+phone fallback
-- (qa2RecordingPoller.js's pollByAgentDay, 3-attempt leash) instead of the
-- strong lead-id lookup, and several of today's TRA rows burned all 3
-- attempts on that fallback and were marked 'missing' despite a findable
-- vendor code sitting right there on the transfer.
--
-- Fix: periodically copy the vendor code across whenever it's newly present,
-- and reset the row to 'pending' with attempts cleared so the NEXT poll tick
-- retries with the exact lead-id search instead of leaving it written off.
-- ============================================================================

-- qa2_call runs ~288k rows; this keeps the periodic backfill's WHERE clause
-- (leg/vendor_code/recording_state) index-only instead of a table scan every
-- tick — the index itself stays tiny since almost every row fails the filter.
CREATE INDEX IF NOT EXISTS idx_qa2_call_tra_no_vendor ON qa2_call (transfer_id)
  WHERE leg = 'fronter' AND vendor_code IS NULL AND recording_state <> 'found';

CREATE OR REPLACE FUNCTION app_qa2_attach_tra_vendor_codes()
RETURNS bigint LANGUAGE plpgsql AS $fn$
DECLARE n bigint;
BEGIN
  UPDATE qa2_call c
     SET vendor_code       = t.vicidial_vendor_code,
         dialer_lead_id    = NULLIF(regexp_replace(t.vicidial_vendor_code, '\D', '', 'g'), ''),
         recording_state   = 'pending',
         recording_attempts = 0
    FROM transfers t
   WHERE c.transfer_id = t.id
     AND c.leg = 'fronter'
     AND c.vendor_code IS NULL
     AND c.recording_state <> 'found'
     AND t.vicidial_vendor_code IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;

GRANT EXECUTE ON FUNCTION app_qa2_attach_tra_vendor_codes() TO service_role;

-- One-time catch-up for the rows already stuck missing.
SELECT app_qa2_attach_tra_vendor_codes();

-- ── post-apply verification ─────────────────────────────────────────────────
-- SELECT count(*) FROM qa2_call c JOIN transfers t ON t.id = c.transfer_id
--  WHERE c.leg = 'fronter' AND c.vendor_code IS NULL AND c.recording_state <> 'found'
--    AND t.vicidial_vendor_code IS NOT NULL;  -- expect 0
