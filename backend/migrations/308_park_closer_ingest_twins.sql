-- ============================================================================
-- 308_park_closer_ingest_twins.sql  (APPLIED 2026-08-26)
--
-- A closer webhook row is a TWIN of the crm_day / adopted closer leg when the
-- same phone has a transfer-linked closer row within 30 minutes — the same
-- call, represented twice now that the team can see the closer-grouping
-- company (mig 307). Park the unlinked copy; the linked one is the review.
-- Added as a fourth clause of the hourly parker; 132 rows parked on apply,
-- the 75 true cold dials left in place.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_qa2_duplicate_starved()
RETURNS TABLE (id uuid)
LANGUAGE sql STABLE
SET search_path = public
AS $$
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
    SELECT k.id FROM windowed k
    WHERE k.leg = 'closer' AND k.transfer_id IS NULL AND k.sale_id IS NULL
      AND k.customer_phone IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM windowed s
        WHERE s.leg = 'closer' AND s.transfer_id IS NOT NULL AND s.id <> k.id
          AND s.customer_phone = k.customer_phone
          AND s.call_at BETWEEN k.call_at - interval '30 minutes' AND k.call_at + interval '30 minutes'
      )
  )
  SELECT d.id FROM dupes d
  WHERE NOT EXISTS (SELECT 1 FROM qa2_assignment a
                    WHERE a.call_id = d.id AND a.status IN ('in_review', 'scored'))
    AND NOT EXISTS (SELECT 1 FROM qa2_evaluation e WHERE e.call_id = d.id);
$$;

WITH starved AS (SELECT id FROM app_qa2_duplicate_starved()),
del AS (
  DELETE FROM qa2_assignment a USING starved
  WHERE a.call_id = starved.id AND a.status = 'pending' RETURNING a.id
)
UPDATE qa2_call k SET qa_relevant = false FROM starved WHERE k.id = starved.id;

INSERT INTO schema_migrations (filename, note)
VALUES ('308_park_closer_ingest_twins.sql',
        'parker: unlinked closer webhook twin of a linked closer row (same phone, 30 min) parks; one-shot run')
ON CONFLICT (filename) DO NOTHING;
