-- ============================================================================
-- 084_user_presence_activity.sql
-- Real-time presence + activity tracking.
--
-- Live online/offline state stays in Supabase Realtime Presence (ephemeral,
-- websocket-based — instant join/leave). These tables persist what the
-- websocket can't: LAST SEEN for offline users, and per-day activity
-- aggregates that power the SuperAdmin activity panel (DAU/WAU/MAU, session
-- duration, module time, login counts).
--
--   user_presence       — one row per user: last heartbeat snapshot.
--   user_activity_daily — one row per user per day: compact aggregates,
--                         upserted on every heartbeat (no raw event log, so
--                         storage stays tiny no matter the user count).
--
-- Idempotent. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_presence (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_page    text,
  device       text,
  ip           text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_presence IS
  'Last-heartbeat snapshot per user. Live online state is Supabase Realtime Presence; this answers "last seen" once they are offline.';

CREATE INDEX IF NOT EXISTS idx_user_presence_seen ON user_presence (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS user_activity_daily (
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day            date NOT NULL,
  first_seen_at  timestamptz,
  last_seen_at   timestamptz,
  active_minutes integer     NOT NULL DEFAULT 0,
  login_count    integer     NOT NULL DEFAULT 0,
  module_minutes jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, day)
);

COMMENT ON TABLE user_activity_daily IS
  'Per-user per-day activity aggregates (active minutes, logins, minutes per CRM module). Powers DAU/WAU/MAU + the SuperAdmin activity panel.';
COMMENT ON COLUMN user_activity_daily.module_minutes IS
  'JSONB { "/admin": 42, "/closer": 13, ... } — approximate minutes per top-level CRM module, accumulated from heartbeats.';

CREATE INDEX IF NOT EXISTS idx_uad_day ON user_activity_daily (day DESC);
