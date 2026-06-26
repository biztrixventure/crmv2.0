-- ============================================================================
-- 115_scheduler_perf_index.sql
-- The callback scheduler runs every 60s and queries:
--   callbacks WHERE status='pending' AND notified=false AND callback_at <= now+60s
-- Without a matching index that's a scan of the whole callbacks table every
-- minute, forever. A tiny PARTIAL index (only the not-yet-fired rows) turns it
-- into an instant index scan and stays small. Apply in Supabase. Idempotent.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_callbacks_due
  ON callbacks (callback_at)
  WHERE status = 'pending' AND notified = false;
