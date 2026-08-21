-- ============================================================================
-- 258_qa2_leg_pairing.sql
-- QA v2: pair a transfer's TWO recordings — the fronter's leg and the closer's
-- leg — which live on DIFFERENT dialer boxes and therefore have different
-- lead_ids. EasyTech fronts on `etc` (wavetech3new) and its closers work on
-- `wavetechpk`, so a single conversation is two rows in qa2_call with nothing
-- joining them: linked_call_id has existed since mig 234 and was never written
-- (0 of 272,739 rows).
--
-- HOW THE LEGS ARE MATCHED, in the order tried:
--   1. vendor_code — when the call is transferred the FRONTER's vendor code
--      travels to the closer's box, so the closer's lead carries e.g.
--      "ETC21249582" while its own lead_id is 2579557. Exact, no guessing.
--      Measured: 83.6% of the last 7 days' closer legs.
--   2. same phone within a -3h/+1h window, nearest in time. Rescues the legs
--      whose code did not travel (+11.5% → 95.1%). A phone match alone is NOT
--      enough without the window: the same customer is called again on later
--      days, and pairing across days would attach the wrong recording.
-- Neither step ever pairs two legs of the same kind, or a leg that is already
-- paired — a leg belongs to exactly one counterpart.
--
-- Also dedupes the double-ingested closer rows: the same call arrives once from
-- the CRM transfer path (carrying the ETC code, recording found) and once from
-- the sweep (carrying WTI+own lead, still pending), so QA saw two items and the
-- recording sat on whichever row you did not open. 816 groups in 30 days.
-- Evaluations/assignments/listen-logs are repointed BEFORE the delete — their
-- FKs are ON DELETE CASCADE, so deleting first would take the scores with it.
-- Idempotent.
-- ============================================================================

-- ── 1. dedupe: same box + same dialer lead + same leg, within the same minute ─
-- Keeper = the row that already has the recording, else the earliest.
CREATE TEMP TABLE _qa2_dupes AS
WITH ranked AS (
  SELECT id, box_id, dialer_lead_id, leg, date_trunc('minute', call_at) AS m,
         row_number() OVER (
           PARTITION BY box_id, dialer_lead_id, leg, date_trunc('minute', call_at)
           ORDER BY (recording_state = 'found') DESC, created_at
         ) rn,
         first_value(id) OVER (
           PARTITION BY box_id, dialer_lead_id, leg, date_trunc('minute', call_at)
           ORDER BY (recording_state = 'found') DESC, created_at
         ) keeper
    FROM qa2_call
   WHERE box_id IS NOT NULL AND dialer_lead_id IS NOT NULL AND call_at IS NOT NULL
)
SELECT id, keeper FROM ranked WHERE rn > 1;

UPDATE qa2_evaluation e SET call_id = d.keeper FROM _qa2_dupes d WHERE e.call_id = d.id;
UPDATE qa2_assignment a SET call_id = d.keeper FROM _qa2_dupes d WHERE a.call_id = d.id;
UPDATE qa2_listen_log l SET call_id = d.keeper FROM _qa2_dupes d WHERE l.call_id = d.id;
DELETE FROM qa2_call c USING _qa2_dupes d WHERE c.id = d.id;

-- ── 2. the pairing function ─────────────────────────────────────────────────
-- Returns the id of the leg it paired with, or NULL. Writes BOTH sides so the
-- link reads the same from either direction.
CREATE OR REPLACE FUNCTION fn_qa2_link_leg(p_call_id uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE me qa2_call%ROWTYPE; other_id uuid; want text;
BEGIN
  SELECT * INTO me FROM qa2_call WHERE id = p_call_id;
  IF me.id IS NULL OR me.leg IS NULL OR me.linked_call_id IS NOT NULL THEN RETURN NULL; END IF;
  want := CASE WHEN me.leg = 'fronter' THEN 'closer' ELSE 'fronter' END;

  -- 1. the vendor code that travelled with the transfer
  IF me.vendor_code IS NOT NULL AND me.vendor_code <> '' THEN
    SELECT o.id INTO other_id FROM qa2_call o
     WHERE o.leg = want AND o.vendor_code = me.vendor_code AND o.linked_call_id IS NULL AND o.id <> me.id
     ORDER BY o.call_at NULLS LAST LIMIT 1;
  END IF;

  -- 2. same customer, nearest call inside the transfer window
  IF other_id IS NULL AND me.normalized_phone IS NOT NULL AND me.call_at IS NOT NULL THEN
    SELECT o.id INTO other_id FROM qa2_call o
     WHERE o.leg = want AND o.normalized_phone = me.normalized_phone
       AND o.linked_call_id IS NULL AND o.id <> me.id
       AND o.call_at BETWEEN me.call_at - interval '3 hours' AND me.call_at + interval '3 hours'
     ORDER BY abs(extract(epoch FROM (o.call_at - me.call_at))) LIMIT 1;
  END IF;

  IF other_id IS NULL THEN RETURN NULL; END IF;
  UPDATE qa2_call SET linked_call_id = other_id  WHERE id = me.id;
  UPDATE qa2_call SET linked_call_id = me.id     WHERE id = other_id;
  RETURN other_id;
END $$;

-- ── 3. pair at ingest ───────────────────────────────────────────────────────
-- AFTER INSERT so the row is visible to the lookup. Depth-guarded: the function
-- UPDATEs qa2_call, which must not re-enter this trigger.
CREATE OR REPLACE FUNCTION fn_qa2_link_leg_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  PERFORM fn_qa2_link_leg(NEW.id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;   -- pairing must never block an ingest
END $$;

DROP TRIGGER IF EXISTS trg_qa2_link_leg ON qa2_call;
CREATE TRIGGER trg_qa2_link_leg AFTER INSERT ON qa2_call
  FOR EACH ROW WHEN (NEW.leg IS NOT NULL) EXECUTE FUNCTION fn_qa2_link_leg_trg();

-- ── 4. backfill — closer legs first (far fewer, and each one pulls its fronter)
CREATE OR REPLACE FUNCTION app_qa2_pair_legs(p_days int DEFAULT 30)
RETURNS TABLE(considered bigint, paired bigint) LANGUAGE plpgsql AS $$
DECLARE r record; n bigint := 0; total bigint := 0;
BEGIN
  FOR r IN
    SELECT id FROM qa2_call
     WHERE leg = 'closer' AND linked_call_id IS NULL
       AND call_at >= now() - make_interval(days => p_days)
     ORDER BY call_at DESC
  LOOP
    total := total + 1;
    IF fn_qa2_link_leg(r.id) IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  considered := total; paired := n; RETURN NEXT;
END $$;

CREATE INDEX IF NOT EXISTS idx_qa2_call_vendor_leg   ON qa2_call (vendor_code, leg) WHERE vendor_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qa2_call_phone_leg_at ON qa2_call (normalized_phone, leg, call_at);

GRANT EXECUTE ON FUNCTION app_qa2_pair_legs(int) TO service_role;

NOTIFY pgrst, 'reload schema';
