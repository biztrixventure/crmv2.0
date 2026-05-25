-- 049_events.sql
-- Company event calendar. SuperAdmin creates/edits/deletes events; everyone else
-- (all authenticated users across every company) sees them read-only.
--
-- Writes always run through the Express routes (service-role client, bypasses
-- RLS, gated by isSuperAdmin). The SELECT policy below exists only so the
-- frontend's anon-key Realtime client can RECEIVE postgres_changes events
-- (Realtime requires a SELECT policy) and as defence-in-depth.

CREATE TABLE IF NOT EXISTS events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text,
  location    text,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz,                       -- null = open-ended / single point
  all_day     boolean NOT NULL DEFAULT false,
  color       text NOT NULL DEFAULT '#a8885c',   -- hex; drives the event chip colour
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events (starts_at);

-- ── RLS ────────────────────────────────────────────────────────────────────────
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- All authenticated users may read every event (calendar is global).
DO $$ BEGIN
  CREATE POLICY "authenticated_reads_events" ON events
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- No client-side INSERT/UPDATE/DELETE policies: writes go through the service
-- role in the Express routes, gated by isSuperAdmin.

-- ── Realtime ────────────────────────────────────────────────────────────────────
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE events; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
