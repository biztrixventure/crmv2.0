-- ============================================================================
-- 174_qa_assignment_recordings.sql
-- QA Department — let a qa_manager assign RAW day-recordings (from the Day
-- Recordings browser) to a qa_agent as TRA/RCM tasks, not just the materialized
-- transfer/sale rows. Apply AFTER 170-173. Idempotent.
--
-- A "day_recording" assignment isn't backed by a CRM transfers/sales row (an RCM
-- call may never have converted), so it stores the dialer recording reference
-- inline (recording_ref) instead of an FK. The review flow reads either shape.
-- ============================================================================

ALTER TABLE qa_assignments
  ADD COLUMN IF NOT EXISTS source        text NOT NULL DEFAULT 'materialized',  -- 'materialized' | 'day_recording'
  ADD COLUMN IF NOT EXISTS recording_ref jsonb,     -- {box_id,recording_id,lead_id,location,agent_user,start_time,duration,phone}
  ADD COLUMN IF NOT EXISTS recording_date date,
  ADD COLUMN IF NOT EXISTS subject_agent text,      -- the dialer agent (fronter/closer) whose call this is
  ADD COLUMN IF NOT EXISTS assigned_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at   timestamptz;

-- An assignment must point at SOMETHING: a transfer, a sale, OR a raw recording.
ALTER TABLE qa_assignments DROP CONSTRAINT IF EXISTS qa_assignment_has_subject;
ALTER TABLE qa_assignments ADD CONSTRAINT qa_assignment_has_subject
  CHECK (transfer_id IS NOT NULL OR sale_id IS NOT NULL OR recording_ref IS NOT NULL);

-- Dedup: the same recording can't be assigned twice for the same method
-- (expression unique index on the jsonb ref).
CREATE UNIQUE INDEX IF NOT EXISTS uq_qa_assign_recording
  ON qa_assignments (method, (recording_ref->>'box_id'), (recording_ref->>'recording_id'))
  WHERE recording_ref IS NOT NULL;

-- Queue reads by assignee + status a lot; already indexed (170). Add a source
-- filter helper for the "manager view: day-recording tasks" listing.
CREATE INDEX IF NOT EXISTS idx_qa_assign_source ON qa_assignments (company_id, source, status);
