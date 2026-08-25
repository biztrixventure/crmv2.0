-- ============================================================================
-- 300_qa2_call_hangup_columns.sql  (APPLIED 2026-08-25)
--
-- Who ended the call, persisted on the row. The dialer's phone_number_log says
-- whether the AGENT or the CALLER hung up (annotateHangups in dialerBoxes.js),
-- but reading it is a dialer round-trip per phone — fine for one review screen,
-- impossible for a 200-row queue. So the answer is stored the first time anyone
-- learns it: the recording poller once a clip is found (pollHangups), and
-- GET /qa2/calls/:id whenever a review opens. Lists then read it for free.
--
-- hangup_status = the dialer's call_status for that log row, or the sentinel
-- 'unavailable' when the log no longer holds the call (so it is not retried).
-- ============================================================================

ALTER TABLE qa2_call
  ADD COLUMN IF NOT EXISTS hangup_label  text,
  ADD COLUMN IF NOT EXISTS hangup_reason text,
  ADD COLUMN IF NOT EXISTS hangup_status text;

INSERT INTO schema_migrations (filename, note)
VALUES ('300_qa2_call_hangup_columns.sql',
        'qa2_call.hangup_label/reason/status - who ended the call, persisted from the dialer phone log')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
