-- 028_callback_history.sql
-- Enhances callback_audit_log to track reschedules and action types.
ALTER TABLE callback_audit_log
  ADD COLUMN IF NOT EXISTS action        TEXT DEFAULT 'status_change',
  ADD COLUMN IF NOT EXISTS old_callback_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS new_callback_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_callback_audit_log_callback_id ON callback_audit_log (callback_id);
CREATE INDEX IF NOT EXISTS idx_callbacks_created_at ON callbacks (created_at);
CREATE INDEX IF NOT EXISTS idx_callbacks_callback_at ON callbacks (callback_at);
