-- ============================================================================
-- 298_one_tra_row_per_transfer.sql  (APPLIED 2026-08-25)
--
-- ONE FRONTER REVIEW ROW PER TRANSFER. Load Day's TRA pill counted ROWS, and
-- rows had duplicated (sweep+ingest twins; plus the 2026-08-24 backlog pass
-- that classified paired-but-unlinked fronter rows): Wavetech 24 Aug showed
-- 160 TRA over 125 distinct transfers.
--
-- The parker predicate gains two clauses, fronter-leg only:
--   (b) several methoded fronter rows on ONE transfer keep exactly one —
--       found beats not-found, then oldest row, then smallest id;
--   (a) a methoded fronter row with NO transfer whose same-company sibling
--       (same lead or phone) IS transfer-linked duplicates that sibling.
-- Started/scored/evaluated rows are never touched. See the applied function
-- body in the DB (app_qa2_duplicate_starved) — this file is the repo record.
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
  )
  SELECT d.id FROM dupes d
  WHERE NOT EXISTS (SELECT 1 FROM qa2_assignment a
                    WHERE a.call_id = d.id AND a.status IN ('in_review', 'scored'))
    AND NOT EXISTS (SELECT 1 FROM qa2_evaluation e WHERE e.call_id = d.id);
$fn$;

INSERT INTO schema_migrations (filename, note)
VALUES ('298_one_tra_row_per_transfer.sql',
        'parker enforces one fronter review row per transfer; unlinked shadows of a linked sibling park')
ON CONFLICT (filename) DO NOTHING;
