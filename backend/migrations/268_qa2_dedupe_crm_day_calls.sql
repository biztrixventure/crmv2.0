-- ============================================================================
-- 268_qa2_dedupe_crm_day_calls.sql
-- Load Day was inserting the same call again on every run.
--
-- populateCrmDay skips a transfer that already has a qa2_call row, using a Set
-- built by existingKeys(). That function selected EVERY qa2_call row for the
-- company with no filter and no limit — and PostgREST caps how many rows it
-- returns. On a company with 135,744 rows the Set held a small fraction of what
-- exists, so almost every transfer looked new and each run inserted duplicates.
-- The unbounded select did not just risk the 500 it was fixed for; it silently
-- under-reported, which is the more damaging failure.
--
-- What it looked like from the floor: Abdullah Ghulam Sarwar's 20 August showed
-- 47 calls, 46 of them with no recording — but he only made 4 transfers that
-- day. The 47 rows pointed at those same 4 transfers, and the copies carried no
-- vendor code, so they could never resolve a recording. One real call, and
-- forty-six ghosts beside it reading "Cx Hang up · recording missing".
--
-- Keep the best row per (transfer_id, leg): one with audio wins, then one that
-- still has a dialer code to find audio with, then the earliest.
--
-- ONLY duplicates carrying no QA work are deleted — 1,504 of the 1,520. The
-- other 16 hold an assignment, and qa2_assignment has a one-assignment-per-call
-- unique index (mig 236), so blindly repointing them onto a keeper that already
-- has one fails outright (this migration's first attempt did exactly that).
-- They are moved only where the keeper is free, and any that still cannot move
-- are LEFT IN PLACE: a stray duplicate row is a much smaller problem than a
-- deleted assignment. None of the 1,520 carried an evaluation, so no score was
-- ever at risk.
-- ============================================================================
CREATE TEMP TABLE _qa2_dupes AS
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY transfer_id, leg
           ORDER BY (recording_state = 'found') DESC,
                    (dialer_lead_id IS NOT NULL) DESC,
                    (vendor_code IS NOT NULL) DESC,
                    created_at
         ) rn,
         first_value(id) OVER (
           PARTITION BY transfer_id, leg
           ORDER BY (recording_state = 'found') DESC,
                    (dialer_lead_id IS NOT NULL) DESC,
                    (vendor_code IS NOT NULL) DESC,
                    created_at
         ) keeper
    FROM qa2_call
   WHERE transfer_id IS NOT NULL
)
SELECT id, keeper FROM ranked WHERE rn > 1;

-- Move what can be moved: evaluations and listen logs are unconstrained, and an
-- assignment only where the survivor does not already have one.
UPDATE qa2_evaluation e SET call_id = d.keeper FROM _qa2_dupes d WHERE e.call_id = d.id;
UPDATE qa2_listen_log  l SET call_id = d.keeper FROM _qa2_dupes d WHERE l.call_id = d.id;
UPDATE qa2_assignment  a SET call_id = d.keeper
  FROM _qa2_dupes d
 WHERE a.call_id = d.id
   AND NOT EXISTS (SELECT 1 FROM qa2_assignment k WHERE k.call_id = d.keeper);

-- Release any leg link held by a row about to disappear.
UPDATE qa2_call o SET linked_call_id = NULL
 WHERE o.linked_call_id IN (
   SELECT d.id FROM _qa2_dupes d
    WHERE NOT EXISTS (SELECT 1 FROM qa2_assignment a WHERE a.call_id = d.id)
      AND NOT EXISTS (SELECT 1 FROM qa2_evaluation e WHERE e.call_id = d.id));

DELETE FROM qa2_call c
 USING _qa2_dupes d
 WHERE c.id = d.id
   AND NOT EXISTS (SELECT 1 FROM qa2_assignment a WHERE a.call_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM qa2_evaluation e WHERE e.call_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM qa2_listen_log  l WHERE l.call_id = c.id);

DROP TABLE IF EXISTS _qa2_dupes;

-- No unique index on (transfer_id, leg) yet: a handful of duplicates that still
-- hold an assignment are deliberately left behind, and a unique index would
-- refuse to build over them. The application-side guard is the real fix —
-- existingKeys now asks only about the day's own ids, so it can no longer be
-- truncated into thinking a transfer is new.
