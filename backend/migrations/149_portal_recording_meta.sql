-- ============================================================================
-- 149_portal_recording_meta.sql
-- Cache of resolved recording metadata (length) per sale, so the client portal
-- shows the EXACT call length at first sight WITHOUT playing, and without
-- re-hitting the dialer on every view. A recording's length never changes once
-- it exists → positive results are cached permanently; a "not found" is cached
-- briefly (see META_NEG_TTL in routes/portal.js) so a later-arriving recording
-- is still picked up.
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS portal_recording_meta (
  sale_id      uuid PRIMARY KEY REFERENCES sales(id) ON DELETE CASCADE,
  found        boolean NOT NULL DEFAULT false,   -- did a recording resolve?
  duration     integer,                          -- seconds; NULL when not found
  recording_id text,                             -- dialer recording_id (audit/debug)
  resolved_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE portal_recording_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prm_all ON portal_recording_meta;
CREATE POLICY prm_all ON portal_recording_meta FOR ALL USING (true);
