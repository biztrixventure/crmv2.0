-- ============================================================================
-- 155_note_shortcodes.sql
-- Predefined "/shortcode → full note text" entries for the fronter PIP notes
-- field (Phase 2). Mirrors the chat message-shortcut UX, but — unlike chat's
-- templates which live in per-device localStorage — these are SERVER-SIDE.
-- Three scope tiers (personal wins → company → global):
--   PERSONAL: owner_user_id = me            (only I see/use; any user can make)
--   COMPANY : company_id = mine, owner NULL  (manager-curated, whole company)
--   GLOBAL  : company_id NULL, owner NULL    (all companies)
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS note_shortcodes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        REFERENCES companies(id) ON DELETE CASCADE,   -- NULL = global (unless personal)
  owner_user_id uuid        REFERENCES auth.users(id) ON DELETE CASCADE,  -- set = personal (private to this user)
  code          text        NOT NULL,     -- typed after "/" (no slash stored), e.g. 'nc'
  text          text        NOT NULL,     -- the full note inserted
  sort_order    int         NOT NULL DEFAULT 0,
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Idempotent add for envs where an earlier 155 already created the table.
ALTER TABLE note_shortcodes ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- One code per scope (partial uniques; NULLs aren't deduped by a plain UNIQUE).
DROP INDEX IF EXISTS uq_note_sc_company;
DROP INDEX IF EXISTS uq_note_sc_global;
CREATE UNIQUE INDEX IF NOT EXISTS uq_note_sc_personal ON note_shortcodes(owner_user_id, code) WHERE owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_note_sc_company  ON note_shortcodes(company_id, code)    WHERE company_id IS NOT NULL AND owner_user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_note_sc_global   ON note_shortcodes(code)                WHERE company_id IS NULL     AND owner_user_id IS NULL;
CREATE INDEX        IF NOT EXISTS idx_note_sc_owner   ON note_shortcodes(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_note_sc_company ON note_shortcodes(company_id);

ALTER TABLE note_shortcodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS note_sc_all ON note_shortcodes;
CREATE POLICY note_sc_all ON note_shortcodes FOR ALL USING (true);

-- Sensible global defaults so fronters have shortcodes out of the box.
INSERT INTO note_shortcodes (company_id, code, text, sort_order) VALUES
  (NULL, 'nc',   'No answer — no contact',                10),
  (NULL, 'vmf',  'No answer, voicemail full',             20),
  (NULL, 'lm',   'Left voicemail',                        30),
  (NULL, 'cb',   'Requested a callback later today',      40),
  (NULL, 'cbt',  'Callback scheduled (add time)',         50),
  (NULL, 'ni',   'Not interested',                        60),
  (NULL, 'dnc',  'Do not call — requested removal',       70),
  (NULL, 'wn',   'Wrong number',                          80),
  (NULL, 'busy', 'Line busy',                             90),
  (NULL, 'dc',   'Disconnected / out of service',        100)
ON CONFLICT (code) WHERE company_id IS NULL AND owner_user_id IS NULL DO NOTHING;
