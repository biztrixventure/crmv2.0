-- 043_announcements_marquee_spiff.sql
-- Superadmin Announcements, Marquee, and SPIFF system.
-- App data access is enforced in the Express routes (service-role client, which
-- bypasses RLS). RLS here exists only so the frontend's anon-key Realtime client
-- can RECEIVE postgres_changes events (realtime requires a SELECT policy); the
-- authoritative, access-scoped data is always fetched via the Express API.

-- ── Announcements ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL,
  body               text NOT NULL,
  target_type        text NOT NULL DEFAULT 'global' CHECK (target_type IN ('global', 'role', 'users', 'company')),
  target_roles       text[],
  target_user_ids    uuid[],
  target_company_ids uuid[],
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active          boolean NOT NULL DEFAULT true,
  priority           text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
  expires_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcement_reads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id  uuid REFERENCES announcements(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id)
);

-- ── Marquee ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marquee_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  byline             text NOT NULL,
  content            text NOT NULL,
  speed              text NOT NULL DEFAULT 'normal' CHECK (speed IN ('slow', 'normal', 'fast')),
  is_active          boolean NOT NULL DEFAULT true,
  target_company_ids uuid[],
  target_roles       text[],
  target_user_ids    uuid[],
  bg_color           text NOT NULL DEFAULT '#1e40af',
  text_color         text NOT NULL DEFAULT '#ffffff',
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  starts_at          timestamptz NOT NULL DEFAULT now(),
  ends_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ── SPIFF ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spiff_campaigns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL,
  description        text,
  metric             text NOT NULL,
  target_value       numeric NOT NULL,
  reward_amount      numeric,
  reward_description text,
  target_company_ids uuid[],
  target_roles       text[],
  target_user_ids    uuid[],
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'ended')),
  starts_at          timestamptz NOT NULL,
  ends_at            timestamptz NOT NULL,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spiff_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid REFERENCES spiff_campaigns(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  value        numeric NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_announcements_active   ON announcements(is_active);
CREATE INDEX IF NOT EXISTS idx_marquee_active         ON marquee_items(is_active);
CREATE INDEX IF NOT EXISTS idx_spiff_campaigns_status ON spiff_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_spiff_entries_campaign ON spiff_entries(campaign_id);

-- ── RLS (read-only for the realtime client; writes go through service role) ───
ALTER TABLE announcements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE marquee_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE spiff_campaigns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE spiff_entries      ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "rt_read_announcements"  ON announcements      FOR SELECT TO authenticated USING (is_active = true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "own_announcement_reads" ON announcement_reads FOR SELECT TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "rt_read_marquee"        ON marquee_items      FOR SELECT TO authenticated USING (is_active = true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "rt_read_spiff"          ON spiff_campaigns    FOR SELECT TO authenticated USING (status = 'active');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "rt_read_spiff_entries"  ON spiff_entries      FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Enable Realtime ───────────────────────────────────────────────────────────
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE announcements;   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE marquee_items;   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE spiff_campaigns; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE spiff_entries;   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
