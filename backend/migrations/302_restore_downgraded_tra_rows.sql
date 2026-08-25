-- ============================================================================
-- 302_restore_downgraded_tra_rows.sql  (APPLIED 2026-08-25)
--
-- Restore the XFER rows a later dispo downgraded.
--
-- The ingest hook treated the fronter's LATER dispo on the same lead (a redial
-- marked A / N / CALLBK …) as a duplicate webhook and refreshed the original
-- XFER row with it: dispo_raw XFER → A, method_id TRA → NULL, transfer_id →
-- NULL. Calls a QA agent had already been assigned surfaced in the
-- Unclassified tab out of nowhere (64 assigned rows, 179 in all).
--
-- Fixed at source in qa2VicidialIngestHook.js (a classified row is never
-- downgraded). This puts the facts back where a same-company transfer with the
-- same lead code exists within ±2 days of the call — the transfer IS the proof
-- that the call was an XFER. Assignments are untouched.
-- ============================================================================

WITH tra AS (
  SELECT id FROM qa2_method WHERE label ILIKE 'tra' AND is_active AND leg IN ('fronter','both') LIMIT 1
),
hit AS (
  SELECT k.id AS call_id, t.id AS transfer_id
  FROM qa2_call k
  JOIN LATERAL (
    SELECT id, created_at FROM transfers t
    WHERE t.vicidial_vendor_code = k.vendor_code AND t.company_id = k.company_id
      AND t.created_at BETWEEN k.call_at - interval '2 days' AND k.call_at + interval '2 days'
    ORDER BY abs(extract(epoch FROM (t.created_at - k.call_at))) LIMIT 1) t ON true
  WHERE k.method_id IS NULL AND k.qa_relevant AND k.leg = 'fronter' AND k.source = 'ingest'
    AND k.transfer_id IS NULL AND k.vendor_code IS NOT NULL
    AND k.call_at >= now() - interval '7 days'
)
UPDATE qa2_call k
SET transfer_id = hit.transfer_id,
    dispo_raw = 'XFER',
    method_id = (SELECT id FROM tra),
    classified_at = now()
FROM hit
WHERE k.id = hit.call_id AND EXISTS (SELECT 1 FROM tra);

INSERT INTO schema_migrations (filename, note)
VALUES ('302_restore_downgraded_tra_rows.sql',
        'restore transfer link, XFER dispo and TRA method on ingest rows a later dispo had downgraded')
ON CONFLICT (filename) DO NOTHING;
