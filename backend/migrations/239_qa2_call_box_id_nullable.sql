-- ============================================================================
-- 239_qa2_call_box_id_nullable.sql
-- QA v2 — Phase 5 correction. mig 234 specified box_id NOT NULL, written
-- before the actual ingest hook existed. Building it (backend/middleware/
-- qa2VicidialIngestHook.js) surfaced a real case that spec didn't anticipate:
-- a closer-dispo hit that matches a transfer by CUSTOMER PHONE (not by
-- vendor code — see vicidial.js's phone-fallback branch) never learns which
-- physical dialer box the call actually happened on. A bare numeric lead_id
-- with no box prefix is genuinely ambiguous across boxes (two production
-- boxes share the WTI prefix — see dialerBoxes.js) until the Phase 5
-- recording poller resolves it later by fanning out and finding the actual
-- clip. Forcing a guess into a NOT NULL column would be worse than admitting
-- "not yet known."
--
-- Safe to relax: qa2_call has zero rows (confirmed before this migration was
-- written — Phase 5 hadn't started writing to it yet).
--
-- The poller ALWAYS sets box_id together with recording_id in the same
-- update once a match is found (never one without the other), so
-- uq_qa2_call_recording's (box_id, recording_id) uniqueness stays meaningful
-- once a row reaches recording_state = 'found' — the null-box_id window only
-- exists for rows still 'pending'.
-- ============================================================================

ALTER TABLE qa2_call ALTER COLUMN box_id DROP NOT NULL;

INSERT INTO schema_migrations (filename, note)
VALUES ('239_qa2_call_box_id_nullable.sql', 'QA v2 phase 5 — box_id genuinely unknown at ingest time for phone-matched calls')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
