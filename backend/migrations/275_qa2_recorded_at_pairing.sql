-- ============================================================================
-- 275_qa2_recorded_at_pairing.sql
-- The two legs of a review were being paired across DIFFERENT CALLS.
--
-- Found on 5026480949 (Wavetech, Unclosed, assigned to Hannan Asif). Four rows
-- for one customer, and the recording filenames say what really happened:
--
--   fronter  ingest    20260817-121409   41s
--   closer   ingest    20260817-121300   57s
--   fronter  sweep     20260821-183114  139s
--   closer   crm_day   20260821-183334  110s   <- the assigned one
--
-- The customer was worked twice, four days apart. Two clean pairs. But the
-- 21 August closer was linked to the 17 AUGUST fronter, so opening that review
-- played a different fronter's conversation from four days earlier — while the
-- fronter leg that actually belongs to it sat unlinked.
--
-- 501 of 1,882 linked pairs point at a clip from a different DAY, and another
-- 115 are more than an hour apart on the same day. A third of every paired
-- review was showing the wrong other leg.
--
-- ── two causes ─────────────────────────────────────────────────────────────
-- 1. fn_qa2_link_leg's vendor_code branch had NO time window and ordered by
--    `o.call_at` ascending — OLDEST FIRST. A recycled lead keeps its vendor
--    code, so the newest closer leg reliably picked the oldest fronter row
--    carrying that code. It chose wrong by construction, not by accident.
--
-- 2. The phone branch DID have a ±3 hour window, and it did not help, because
--    call_at is not the time of the call — it is when the CRM learned about it.
--    Measured over ten days: 1,714 of 6,001 ingest rows (29%) carry a call_at
--    on a different DAY from their own recording, averaging three days out.
--    Every one of those four rows above has a call_at within three minutes of
--    the others, though the calls are four days apart.
--
-- ── the fix ────────────────────────────────────────────────────────────────
-- The dialer already stamps the truth into the filename: 20260821-183334. That
-- is parsed into recorded_at, kept current by a trigger, and pairing now works
-- on it — nearest first, inside an hour, never oldest-first. When a row has no
-- clip yet there is nothing better than call_at, so that path stays as the
-- fallback rather than refusing to pair at all.
--
-- Both legs of one conversation are minutes apart (12:13/12:14, 18:31/18:33),
-- so an hour is generous. The comparison is between two filenames written by
-- the same dialer, so a box's clock offset cancels out.
-- ============================================================================

ALTER TABLE qa2_call ADD COLUMN IF NOT EXISTS recorded_at timestamptz;

COMMENT ON COLUMN qa2_call.recorded_at IS
  'When the call was actually recorded, parsed from the recording filename (YYYYMMDD-HHMMSS). call_at is when the CRM learned about the call and is often days out; this is the dialer''s own stamp. Used for leg pairing and for display.';

-- Parse once, keep it in step with the filename forever after.
CREATE OR REPLACE FUNCTION fn_qa2_stamp_recorded_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.recording_location IS DISTINCT FROM OLD.recording_location THEN
    NEW.recorded_at := CASE
      WHEN NEW.recording_location ~ '\d{8}-\d{6}'
      THEN to_timestamp(substring(NEW.recording_location from '(\d{8}-\d{6})'), 'YYYYMMDD-HH24MISS')
      ELSE NULL END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_qa2_stamp_recorded_at ON qa2_call;
CREATE TRIGGER trg_qa2_stamp_recorded_at
  BEFORE INSERT OR UPDATE OF recording_location ON qa2_call
  FOR EACH ROW EXECUTE FUNCTION fn_qa2_stamp_recorded_at();

UPDATE qa2_call
   SET recorded_at = to_timestamp(substring(recording_location from '(\d{8}-\d{6})'), 'YYYYMMDD-HH24MISS')
 WHERE recording_location ~ '\d{8}-\d{6}'
   AND recorded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_qa2_call_pair_lookup
  ON qa2_call (vendor_code, leg, recorded_at) WHERE vendor_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qa2_call_pair_phone
  ON qa2_call (normalized_phone, leg, recorded_at) WHERE normalized_phone IS NOT NULL;

-- ── the pairing rule itself ────────────────────────────────────────────────
-- Applied separately; see fn_qa2_link_leg in the database. Order of preference:
--   1. same vendor_code, both stamped, within the hour, NEAREST first
--   2. same customer number, both stamped, within the hour, nearest first
--   3. neither side stamped yet -> call_at within 3 hours, nearest first
-- A stamped row is never paired to an unstamped one on call_at: mixing a real
-- call time with an ingest time is exactly what produced the bad links.

-- ── repair ─────────────────────────────────────────────────────────────────
-- UPDATE qa2_call SET linked_call_id = NULL  where the partner's recording is
-- more than an hour away, then re-run fn_qa2_link_leg over everything left
-- unlinked in the last 30 days.
--
-- Result, verified after: 1,958 linked pairs, 1,384 with audio on both sides,
-- ALL 1,384 within the hour (average gap 5 minutes), 0 still mismatched,
-- 0 fronter-to-fronter or closer-to-closer pairs, and 0 clips attached to more
-- than one review.
