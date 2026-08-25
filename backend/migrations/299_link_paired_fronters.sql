-- ============================================================================
-- 299_link_paired_fronters.sql  (APPLIED 2026-08-25)
--
-- A fronter row classified through its PAIRED closer call carried the transfer
-- relation only implicitly (linked_call_id -> closer -> transfer): 27 such
-- rows on Wavetech 24 Aug alone, and 26 of them were the ONLY fronter row for
-- their transfer - legitimate TRA members, not duplicates. Stamp the transfer
-- explicitly so counts, dedupe ranking and Load Day share one anchor; then the
-- parker run settles any row the linking turned into a same-transfer duplicate.
-- After this: rows == distinct transfers per method per day (verified).
-- ============================================================================

UPDATE qa2_call k
SET transfer_id = o.transfer_id
FROM qa2_call o
WHERE o.id = k.linked_call_id
  AND o.transfer_id IS NOT NULL
  AND k.transfer_id IS NULL
  AND k.leg = 'fronter'
  AND k.method_id IS NOT NULL
  AND k.qa_relevant IS TRUE
  AND k.call_at >= now() - interval '14 days';

WITH starved AS (SELECT id FROM app_qa2_duplicate_starved()),
del AS (
  DELETE FROM qa2_assignment a USING starved
  WHERE a.call_id = starved.id AND a.status = 'pending' RETURNING a.id
)
UPDATE qa2_call k SET qa_relevant = false FROM starved WHERE k.id = starved.id;

INSERT INTO schema_migrations (filename, note)
VALUES ('299_link_paired_fronters.sql',
        'stamp transfer_id onto paired-classified fronter rows, then one parker pass')
ON CONFLICT (filename) DO NOTHING;
