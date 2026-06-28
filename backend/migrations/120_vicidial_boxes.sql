-- ============================================================================
-- 120_vicidial_boxes.sql
-- Make the dialer boxes CONFIGURABLE (was hardcoded in utils/dialerBoxes.js).
-- A superadmin can now change a box's URL / API user / API pass / vendor-code
-- prefix from Settings when the dialer changes — no code/redeploy.
--   name   = the internal box id used in code ('wavetech','etc','tmc')
--   prefix = the vendor-code prefix on transfers ('WTI','ETC','TMC')
-- dialerBoxes.js refreshes from this table every 60s; the old hardcoded values
-- remain a fallback, so nothing breaks before/without seeding.
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS vicidial_boxes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,        -- internal id (wavetech/etc/tmc)
  prefix      text NOT NULL,               -- vendor-code prefix (WTI/ETC/TMC)
  base_url    text NOT NULL,               -- https://host  (no trailing slash)
  api_user    text NOT NULL,
  api_pass    text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed the three current boxes (no-op if already present).
INSERT INTO vicidial_boxes (name, prefix, base_url, api_user, api_pass, sort_order) VALUES
  ('wavetech', 'WTI', 'https://wavetechnew.i5.tel',  'apiuser', 'apiuser123', 1),
  ('etc',      'ETC', 'https://wavetech3new.i5.tel', 'ceo',     'ceo',        2),
  ('tmc',      'TMC', 'https://tmcsolihp.i5.tel',    '1002',    '1002',       3)
ON CONFLICT (name) DO NOTHING;
