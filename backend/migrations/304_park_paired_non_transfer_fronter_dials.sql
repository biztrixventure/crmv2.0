-- ============================================================================
-- 304_park_paired_non_transfer_fronter_dials.sql  (APPLIED 2026-08-26)
--
-- The fronter's non-transfer redials are not QA work.
--
-- The recording-pairer links every dial on a recycled lead to that lead's
-- closer call. That made the fronter's A / N / CALLBK redials look reviewable
-- (they were "paired") and flood the Unclassified tab — 207 in a week — as if
-- they were transfers waiting for a method. They have no transfer, no sale and
-- no XFER dispo; the closer leg is the review for that lead. Park them, and
-- GET /qa2/unclassified no longer treats pairing alone as reviewable.
-- ============================================================================

UPDATE qa2_call k
SET qa_relevant = false
WHERE k.qa_relevant IS TRUE AND k.method_id IS NULL
  AND k.leg = 'fronter' AND k.source = 'ingest'
  AND k.transfer_id IS NULL AND k.sale_id IS NULL
  AND k.linked_call_id IS NOT NULL
  AND NOT (k.dispo_raw ILIKE 'xfer')
  AND k.call_at >= now() - interval '30 days'
  AND NOT EXISTS (SELECT 1 FROM qa2_assignment a WHERE a.call_id = k.id)
  AND NOT EXISTS (SELECT 1 FROM qa2_evaluation e WHERE e.call_id = k.id);

INSERT INTO schema_migrations (filename, note)
VALUES ('304_park_paired_non_transfer_fronter_dials.sql',
        'park paired-but-unanchored non-XFER fronter dials so they stop surfacing as unclassified QA work')
ON CONFLICT (filename) DO NOTHING;
