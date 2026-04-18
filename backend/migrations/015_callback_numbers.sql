-- ============================================================================
-- 015_callback_numbers.sql
-- Phone number tracking: ownership, call attempt logs, 7-day/30-day expiry
-- ============================================================================

-- Main table: one row per tracked phone number, tracks current owner + expiry
CREATE TABLE IF NOT EXISTS callback_numbers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  phone_number    TEXT NOT NULL,
  customer_name   TEXT,
  notes           TEXT,
  source          TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual', 'transfer')),
  source_id       UUID,   -- optional link to transfers.id when source='transfer'

  -- Current ownership
  owner_id        UUID,   -- auth.users.id of current owner (NULL = released/unclaimed)

  -- Status lifecycle: active → claimable → released
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'claimable', 'released')),

  -- Expiry mechanics
  last_attempt_at TIMESTAMPTZ,      -- updated each time a call attempt is logged
  locked_until    TIMESTAMPTZ,      -- last_attempt_at + 7 days; expire → claimable
  assigned_at     TIMESTAMPTZ DEFAULT NOW(), -- when current owner claimed/created it
  release_at      TIMESTAMPTZ,      -- assigned_at + 30 days; expire → released

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cn_company_owner  ON callback_numbers (company_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_cn_company_status ON callback_numbers (company_id, status);
CREATE INDEX IF NOT EXISTS idx_cn_locked_until   ON callback_numbers (locked_until)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_cn_release_at     ON callback_numbers (release_at)
  WHERE status IN ('active', 'claimable');

-- ─────────────────────────────────────────────────────────────────────────────
-- Each individual call attempt logged against a number
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS callback_number_attempts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  callback_number_id    UUID NOT NULL REFERENCES callback_numbers(id) ON DELETE CASCADE,
  caller_id             UUID NOT NULL,   -- auth.users.id
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  attempted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  outcome               TEXT NOT NULL CHECK (outcome IN (
    'answered_sold',
    'answered_no_sale',
    'answered_callback',
    'no_answer',
    'voicemail',
    'wrong_number',
    'do_not_call'
  )),
  remarks               TEXT,
  scheduled_callback_at TIMESTAMPTZ,  -- set when outcome = 'answered_callback'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cna_number_id ON callback_number_attempts (callback_number_id);
CREATE INDEX IF NOT EXISTS idx_cna_caller    ON callback_number_attempts (caller_id);
CREATE INDEX IF NOT EXISTS idx_cna_company   ON callback_number_attempts (company_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Ownership history: one row per owner, closed when owner changes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS callback_number_claims (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  callback_number_id  UUID NOT NULL REFERENCES callback_numbers(id) ON DELETE CASCADE,
  owner_id            UUID NOT NULL,     -- auth.users.id
  owned_from          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  owned_until         TIMESTAMPTZ,       -- NULL = still current owner
  release_reason      TEXT CHECK (release_reason IN (
    'inactivity_7d',
    'inactivity_30d',
    'manager_reassign',
    'do_not_call',
    'self_release'
  )),
  attempt_count       INT NOT NULL DEFAULT 0,
  last_outcome        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cnc_number_id ON callback_number_claims (callback_number_id);
CREATE INDEX IF NOT EXISTS idx_cnc_owner     ON callback_number_claims (owner_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Permissions
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (name, description, category)
VALUES
  ('manage_callback_numbers',      'Create and manage own tracked numbers',       'callbacks'),
  ('view_team_callback_numbers',   'View all team tracked numbers and full logs',  'callbacks'),
  ('reassign_callback_numbers',    'Reassign tracked numbers between team members','callbacks')
ON CONFLICT (name) DO NOTHING;
