-- ============================================================================
-- 303_restore_assigned_tra_rows_any_transfer.sql  (APPLIED 2026-08-25)
--
-- The 50 assigned rows mig 302 missed. Same downgrade (the fronter's later
-- dispo on a recycled lead overwrote the XFER row), but the transfer under the
-- lead code is OLDER than 302's ±2-day window. An assignment is proof the row
-- was a TRA when a manager handed it out, and the transfer under its code is
-- the transfer it belongs to — restore against the nearest one by time.
-- ============================================================================

WITH tra AS (
  SELECT id FROM qa2_method WHERE label ILIKE 'tra' AND is_active AND leg IN ('fronter','both') LIMIT 1
),
hit AS (
  SELECT k.id AS call_id, t.id AS transfer_id
  FROM qa2_call k
  JOIN LATERAL (
    SELECT id FROM transfers t
    WHERE t.vicidial_vendor_code = k.vendor_code AND t.company_id = k.company_id
    ORDER BY abs(extract(epoch FROM (t.created_at - k.call_at))) LIMIT 1) t ON true
  WHERE k.method_id IS NULL AND k.qa_relevant AND k.leg = 'fronter' AND k.source = 'ingest'
    AND k.transfer_id IS NULL AND k.vendor_code IS NOT NULL
    AND k.call_at >= now() - interval '7 days'
    AND EXISTS (SELECT 1 FROM qa2_assignment a WHERE a.call_id = k.id)
)
UPDATE qa2_call k
SET transfer_id = hit.transfer_id, dispo_raw = 'XFER',
    method_id = (SELECT id FROM tra), classified_at = now()
FROM hit WHERE k.id = hit.call_id AND EXISTS (SELECT 1 FROM tra);

INSERT INTO schema_migrations (filename, note)
VALUES ('303_restore_assigned_tra_rows_any_transfer.sql',
        'assigned rows downgraded by a later dispo: restore against the transfer under their lead code regardless of age')
ON CONFLICT (filename) DO NOTHING;
