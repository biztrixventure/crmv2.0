-- ============================================================================
-- 262_qa2_only_xfer_calls.sql
-- QA only ever listens to a call the fronter dispositioned as XFER, and then to
-- that same customer's closer leg (sale → Closed method, no sale → Unclosed).
-- A no-answer, a busy, a dead-air dial is never reviewed by anybody.
--
-- The recording poller did not know that. Every dialed call becomes a qa2_call
-- row, so it was chasing audio for all of them:
--     fronter rows                268,434
--     QA-relevant                   5,061   (1.9%)
--     recordings already fetched   19,631
--     …for calls nobody will hear  17,797   (91% of the work)
-- and the 242,839-deep pending queue meant the legs a reviewer opens today were
-- never reached at all.
--
-- So 'skipped' joins the recording_state machine: not "we failed to find it" but
-- "nobody is going to listen to this, do not go looking". A skipped row costs
-- nothing and is re-armed the moment it becomes interesting — when its transfer
-- or sale is stamped on it, when it is paired to the other leg, or when a
-- manager classifies/samples it into a method. That re-arm is what makes the
-- gate safe: it never loses a call, it defers the fetch until the call earns it.
-- ============================================================================

ALTER TABLE qa2_call DROP CONSTRAINT IF EXISTS qa2_call_recording_state_check;
ALTER TABLE qa2_call ADD  CONSTRAINT qa2_call_recording_state_check
  CHECK (recording_state IN ('pending','found','missing','error','skipped'));

-- What QA can ever want: the fronter's XFER leg, anything tied to a transfer or
-- a sale, a paired leg, or a call already classified into a method.
CREATE OR REPLACE FUNCTION fn_qa2_is_reviewable(c qa2_call) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(COALESCE(c.dispo_raw,'')) = 'XFER'
      OR c.transfer_id    IS NOT NULL
      OR c.sale_id        IS NOT NULL
      OR c.linked_call_id IS NOT NULL
      OR c.method_id      IS NOT NULL;
$$;

-- Park everything nobody will review. Rows that already have their audio keep
-- it — this is about what we still go looking for, not about deleting history.
UPDATE qa2_call c
   SET recording_state = 'skipped'
 WHERE c.recording_state = 'pending'
   AND NOT fn_qa2_is_reviewable(c);

-- ── re-arm: the moment a parked call becomes reviewable, put it back in line ──
CREATE OR REPLACE FUNCTION fn_qa2_rearm_recording() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recording_state = 'skipped' AND fn_qa2_is_reviewable(NEW) THEN
    NEW.recording_state := 'pending';
    NEW.recording_attempts := 0;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_qa2_rearm_recording ON qa2_call;
CREATE TRIGGER trg_qa2_rearm_recording
  BEFORE UPDATE ON qa2_call
  FOR EACH ROW
  WHEN (OLD.transfer_id IS DISTINCT FROM NEW.transfer_id
     OR OLD.sale_id     IS DISTINCT FROM NEW.sale_id
     OR OLD.method_id   IS DISTINCT FROM NEW.method_id
     OR OLD.linked_call_id IS DISTINCT FROM NEW.linked_call_id
     OR OLD.dispo_raw   IS DISTINCT FROM NEW.dispo_raw)
  EXECUTE FUNCTION fn_qa2_rearm_recording();

-- New rows that are not reviewable start parked rather than joining the queue.
CREATE OR REPLACE FUNCTION fn_qa2_park_new_recording() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recording_state = 'pending' AND NOT fn_qa2_is_reviewable(NEW) THEN
    NEW.recording_state := 'skipped';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_qa2_park_new_recording ON qa2_call;
CREATE TRIGGER trg_qa2_park_new_recording
  BEFORE INSERT ON qa2_call
  FOR EACH ROW EXECUTE FUNCTION fn_qa2_park_new_recording();

CREATE INDEX IF NOT EXISTS idx_qa2_call_skipped ON qa2_call (call_at DESC) WHERE recording_state = 'skipped';
