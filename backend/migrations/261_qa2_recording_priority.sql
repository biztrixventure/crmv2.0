-- ============================================================================
-- 261_qa2_recording_priority.sql
-- Companion to the qa2RecordingPoller fix. Two problems were keeping transfer
-- legs silent:
--
-- 1. SAME-BOX LEGS FOUGHT OVER ONE CLIP. WaveTech's fronters and closers share
--    a dialer, so both legs hang off the same lead_id and the lookup returns
--    both clips. The poller took the first, uq_qa2_call_recording refused the
--    duplicate, and the failed UPDATE was never checked — so the second leg
--    retried the same doomed write forever without even counting the attempt.
--    621 pairs sat like that. The poller now skips clips another row owns and
--    picks by the agent login the dialer returns with each recording.
--
-- 2. THE QUEUE COULD NEVER BE DRAINED. Every dialed call becomes a qa2_call
--    row: 242,839 pending, processed oldest-first, a small batch a minute. The
--    legs a reviewer opens today sat behind months of untouched dial attempts,
--    which is why they showed 0 attempts — never reached, not failing.
--
-- This migration re-queues the legs those bugs starved and adds the index the
-- new newest-first ordering needs.
-- ============================================================================
UPDATE qa2_call
   SET recording_attempts = 0,
       recording_state = 'pending'
 WHERE linked_call_id IS NOT NULL
   AND call_at >= now() - interval '30 days'
   AND recording_state IN ('pending', 'missing', 'error');

CREATE INDEX IF NOT EXISTS idx_qa2_call_pending_hot
  ON qa2_call (call_at DESC)
  WHERE recording_state = 'pending';
