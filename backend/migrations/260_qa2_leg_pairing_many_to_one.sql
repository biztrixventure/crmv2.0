-- ============================================================================
-- 260_qa2_leg_pairing_many_to_one.sql
-- Correction to 258's pairing rule. It required the counterpart to be unclaimed,
-- which assumed one fronter leg ↔ one closer leg. The data says otherwise: over
-- 7 days, 630 fronter calls have TWO closer legs in window, 5 have three, one
-- has five — the closer's dialer logs the transferred call and then the closer's
-- own follow-ups against the same customer. With the "must be free" rule the
-- first closer claimed the fronter and every later one was left unpaired: 757 of
-- the 1,078 unpaired closer legs had their fronter sitting right there, taken.
--
-- New rule — the link is many-to-one, closers → fronter:
--   • from a CLOSER: always link to its fronter, claimed or not. Opening any
--     closer leg therefore always reaches the fronter recording, which is what
--     the Unclosed and Closed-sale methods need (they score the closer and play
--     the fronter leg for context).
--   • from a FRONTER: only claim a closer that is still free, preferring one
--     whose recording is already found — so the fronter's own "other leg"
--     pointer lands on a playable call rather than an empty one.
-- The asymmetry is deliberate: linked_call_id holds one uuid, and the direction
-- that must never be ambiguous is closer → fronter.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_qa2_link_leg(p_call_id uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE me qa2_call%ROWTYPE; other_id uuid;
BEGIN
  SELECT * INTO me FROM qa2_call WHERE id = p_call_id;
  IF me.id IS NULL OR me.leg IS NULL OR me.linked_call_id IS NOT NULL THEN RETURN NULL; END IF;

  IF me.leg = 'closer' THEN
    -- 1. the vendor code that travelled with the transfer (exact)
    IF me.vendor_code IS NOT NULL AND me.vendor_code <> '' THEN
      SELECT o.id INTO other_id FROM qa2_call o
       WHERE o.leg = 'fronter' AND o.vendor_code = me.vendor_code AND o.id <> me.id
       ORDER BY (o.recording_state = 'found') DESC, o.call_at NULLS LAST LIMIT 1;
    END IF;
    -- 2. same customer, nearest fronter call inside the transfer window
    IF other_id IS NULL AND me.normalized_phone IS NOT NULL AND me.call_at IS NOT NULL THEN
      SELECT o.id INTO other_id FROM qa2_call o
       WHERE o.leg = 'fronter' AND o.normalized_phone = me.normalized_phone AND o.id <> me.id
         AND o.call_at BETWEEN me.call_at - interval '3 hours' AND me.call_at + interval '3 hours'
       ORDER BY (o.recording_state = 'found') DESC,
                abs(extract(epoch FROM (o.call_at - me.call_at))) LIMIT 1;
    END IF;
    IF other_id IS NULL THEN RETURN NULL; END IF;
    UPDATE qa2_call SET linked_call_id = other_id WHERE id = me.id;
    -- give the fronter a pointer back only if it has none yet
    UPDATE qa2_call SET linked_call_id = me.id WHERE id = other_id AND linked_call_id IS NULL;
    RETURN other_id;
  END IF;

  -- from a FRONTER: claim a still-free closer
  IF me.vendor_code IS NOT NULL AND me.vendor_code <> '' THEN
    SELECT o.id INTO other_id FROM qa2_call o
     WHERE o.leg = 'closer' AND o.vendor_code = me.vendor_code AND o.linked_call_id IS NULL AND o.id <> me.id
     ORDER BY (o.recording_state = 'found') DESC, o.call_at NULLS LAST LIMIT 1;
  END IF;
  IF other_id IS NULL AND me.normalized_phone IS NOT NULL AND me.call_at IS NOT NULL THEN
    SELECT o.id INTO other_id FROM qa2_call o
     WHERE o.leg = 'closer' AND o.normalized_phone = me.normalized_phone
       AND o.linked_call_id IS NULL AND o.id <> me.id
       AND o.call_at BETWEEN me.call_at - interval '3 hours' AND me.call_at + interval '3 hours'
     ORDER BY (o.recording_state = 'found') DESC,
              abs(extract(epoch FROM (o.call_at - me.call_at))) LIMIT 1;
  END IF;
  IF other_id IS NULL THEN RETURN NULL; END IF;
  UPDATE qa2_call SET linked_call_id = other_id WHERE id = me.id;
  UPDATE qa2_call SET linked_call_id = me.id WHERE id = other_id AND linked_call_id IS NULL;
  RETURN other_id;
END $$;
