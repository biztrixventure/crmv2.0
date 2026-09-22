-- ============================================================================
-- 328_dialer_box_timezone.sql
--
-- VICIdial's recording_lookup returns a NAIVE wall-clock start time
-- ("2026-09-18 17:39:50") in the BOX's own timezone, while qa2_call.call_at is
-- a real UTC instant. The recording picker subtracted one from the other, so
-- every comparison carried the box's UTC offset as error -- four hours for a
-- US-Eastern dialer. With no maximum distance on the match, the picker then
-- handed out whatever clip was least-badly wrong, and the clips on a lead ended
-- up rotated among its calls.
--
-- Measured on lead 2982052 (phone ...6340) the day this was written: all three
-- fronter legs held another leg's audio, and the correct clip for each was
-- sitting there within SECONDS once the offset was applied.
--
-- The offset cannot be a constant: America/New_York is -4 in September and -5
-- in December, so a hardcoded number would silently break every clip match on
-- the first Sunday of November. The zone name is stored instead and resolved
-- per call through Intl, which knows the DST rules.
-- ============================================================================

ALTER TABLE vicidial_boxes
  ADD COLUMN IF NOT EXISTS tz text NOT NULL DEFAULT 'America/New_York';

COMMENT ON COLUMN vicidial_boxes.tz IS
  'IANA zone the box reports wall-clock times in (recording_lookup start_time, '
  'recording file names, call logs). Used to turn those into real instants.';

-- wti_flexo ran for a single day (2026-09-15, 10 calls) and is no longer up.
-- Leaving it active costs more than the 10 rows it holds: it shares the WTI
-- prefix with wavetechpk, so EVERY WTI lead lookup had to disambiguate between
-- two boxes, and each one paid a round trip to a host that no longer answers.
UPDATE vicidial_boxes SET is_active = false, updated_at = now()
WHERE name = 'wti_flexo';
