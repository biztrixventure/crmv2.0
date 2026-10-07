-- ============================================================================
-- 339_one_closer_row_per_transfer.sql
--
-- ONE CLOSER REVIEW ROW PER TRANSFER, PER METHOD — the closer-leg twin of 298.
--
-- Unclosed listed far more records than there were transfers, because a closer
-- who MANUALLY DIALS a customer creates its own ingest row instead of landing
-- on the transfer that is already there. Measured 2026-10-07, last 14 days:
--
--   crm_day   1,168 rows / 1,162 transfers      ~1:1, correct
--   ingest    2,477 rows / 1,450 transfers      476 extra on a transfer that
--                                               already had one, plus 551
--                                               carrying no transfer at all
--
-- Two clauses are added, mirroring the fronter pair 298 introduced:
--   (b) several methoded closer rows on ONE transfer keep exactly one —
--       found beats not-found, then oldest row, then smallest id;
--   (a) a methoded closer row with NO transfer whose same-company sibling
--       (same lead or phone) IS transfer-linked duplicates that sibling.
--
-- SCOPED BY method_id, WHICH THE FRONTER CLAUSES DO NOT NEED TO BE. The
-- fronter leg only ever holds TRA, so (transfer, leg) identifies the row. The
-- closer leg holds Closed AND Unclosed, and 17 transfers legitimately hold one
-- of each — deduping on (transfer, leg) alone would park one of those two at
-- random and quietly damage the Closed scorecard. Same method, or leave it.
--
-- Parking is `qa_relevant = false`, never a delete: the row, its audio and its
-- disposition all survive, it simply stops being offered for review. A row
-- anyone has started, scored or evaluated is excluded by the tail of this
-- function and is never touched. The parked call's recording is still
-- reachable from the surviving row through the Review screen's clip picker
-- (mig 328), so nothing a reviewer might want to hear is lost.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_qa2_duplicate_starved()
RETURNS TABLE (id uuid)
LANGUAGE sql STABLE
SET search_path = public
AS $fn$
  WITH windowed AS (
    SELECT * FROM qa2_call
    WHERE qa_relevant IS TRUE AND method_id IS NOT NULL
      AND call_at >= now() - interval '14 days'
  ),
  dupes AS (
    SELECT k.id FROM windowed k
    WHERE k.recording_state = 'missing'
      AND EXISTS (
        SELECT 1 FROM windowed s
        WHERE s.leg = k.leg AND s.id <> k.id AND s.recording_state = 'found'
          AND (
            (s.company_id = k.company_id AND (
              (k.dialer_lead_id IS NOT NULL AND s.dialer_lead_id = k.dialer_lead_id)
              OR (k.customer_phone IS NOT NULL AND s.customer_phone = k.customer_phone)))
            OR (k.transfer_id IS NULL AND k.sale_id IS NULL
                AND k.dialer_lead_id IS NOT NULL AND s.dialer_lead_id = k.dialer_lead_id)
          )
      )
    UNION
    SELECT k.id FROM windowed k
    WHERE k.leg = 'fronter' AND k.transfer_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM windowed s
        WHERE s.transfer_id = k.transfer_id AND s.leg = 'fronter' AND s.id <> k.id
          AND ROW((s.recording_state <> 'found')::int, s.created_at, s.id)
            < ROW((k.recording_state <> 'found')::int, k.created_at, k.id)
      )
    UNION
    SELECT k.id FROM windowed k
    WHERE k.leg = 'fronter' AND k.transfer_id IS NULL AND k.sale_id IS NULL
      AND EXISTS (
        SELECT 1 FROM windowed s
        WHERE s.company_id = k.company_id AND s.leg = 'fronter'
          AND s.transfer_id IS NOT NULL AND s.id <> k.id
          AND ((k.dialer_lead_id IS NOT NULL AND s.dialer_lead_id = k.dialer_lead_id)
            OR (k.customer_phone IS NOT NULL AND s.customer_phone = k.customer_phone))
      )
    UNION
    -- closer twin: unlinked webhook copy of a call whose linked closer row exists
    SELECT k.id FROM windowed k
    WHERE k.leg = 'closer' AND k.transfer_id IS NULL AND k.sale_id IS NULL
      AND k.customer_phone IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM windowed s
        WHERE s.leg = 'closer' AND s.transfer_id IS NOT NULL AND s.id <> k.id
          AND s.customer_phone = k.customer_phone
          AND s.call_at BETWEEN k.call_at - interval '30 minutes' AND k.call_at + interval '30 minutes'
      )
    UNION
    -- (b) 339: one closer row per transfer PER METHOD. The closer's manual
    -- redial of a customer already on a transfer is the same review, not a
    -- second one. Same method only — Closed and Unclosed may share a transfer.
    SELECT k.id FROM windowed k
    WHERE k.leg = 'closer' AND k.transfer_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM windowed s
        WHERE s.transfer_id = k.transfer_id AND s.leg = 'closer'
          AND s.method_id = k.method_id AND s.id <> k.id
          AND ROW((s.recording_state <> 'found')::int, s.created_at, s.id)
            < ROW((k.recording_state <> 'found')::int, k.created_at, k.id)
      )
    UNION
    -- (a) 339: an unlinked closer row shadowing a transfer-linked sibling of
    -- the same method. No time window — a manual dial hours later is still the
    -- same customer's review, which is what the 30-minute clause above misses.
    SELECT k.id FROM windowed k
    WHERE k.leg = 'closer' AND k.transfer_id IS NULL AND k.sale_id IS NULL
      AND EXISTS (
        SELECT 1 FROM windowed s
        WHERE s.company_id = k.company_id AND s.leg = 'closer'
          AND s.method_id = k.method_id
          AND s.transfer_id IS NOT NULL AND s.id <> k.id
          AND ((k.dialer_lead_id IS NOT NULL AND s.dialer_lead_id = k.dialer_lead_id)
            OR (k.customer_phone IS NOT NULL AND s.customer_phone = k.customer_phone))
      )
  )
  SELECT d.id FROM dupes d
  WHERE NOT EXISTS (SELECT 1 FROM qa2_assignment a
                    WHERE a.call_id = d.id AND a.status IN ('in_review', 'scored'))
    AND NOT EXISTS (SELECT 1 FROM qa2_evaluation e WHERE e.call_id = d.id);
$fn$;
