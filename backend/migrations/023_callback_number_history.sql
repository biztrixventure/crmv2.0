-- ============================================================================
-- 023_callback_number_history.sql
-- Field-level audit log for callback_numbers (creation, field edits,
-- status transitions caused by actions, manager reassignments).
-- NOTE: ownership changes live in callback_number_claims,
--       call attempts live in callback_number_attempts.
--       This table captures everything else.
-- ============================================================================

CREATE TABLE IF NOT EXISTS callback_number_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  callback_number_id  UUID NOT NULL REFERENCES callback_numbers(id) ON DELETE CASCADE,
  actor_id            UUID,         -- auth.users.id; NULL = system / scheduler
  action              TEXT NOT NULL CHECK (action IN (
    'created',          -- number first added to system
    'field_updated',    -- notes / customer_name / phone_number changed
    'status_changed',   -- e.g. do_not_call forces released
    'reassigned'        -- manager moved number to different owner
  )),
  field_name          TEXT,         -- which field changed (for field_updated)
  old_value           TEXT,         -- previous value
  new_value           TEXT,         -- new value
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cnh_number_time
  ON callback_number_history (callback_number_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cnh_actor
  ON callback_number_history (actor_id);
