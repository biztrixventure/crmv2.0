-- ============================================================================
-- 211_teams.sql
-- General team structure per company (greenfield — no team org existed outside
-- QA). ADDITIVE org + reporting layer: it groups users into teams for the org
-- chart and team dashboards, but does NOT change any existing access — a manager
-- still sees their whole company. Teams add structure + reporting on top.
--
-- Decisions (locked with the user):
--   * additive layer (no access restriction)          → pure structure/reporting
--   * ONE team per user per company                    → unique (user_id, company_id)
--   * admins + team leads manage                       → enforced in routes/teams.js
--   * nested hierarchy                                 → teams.parent_team_id
--
-- Metrics are computed live from member attribution (sales.closer_id/fronter_id,
-- transfers.created_by/assigned_closer_id, callbacks.user_id) — nothing is
-- denormalized here. Additive + idempotent. Apply AFTER 210.
-- ============================================================================

CREATE TABLE IF NOT EXISTS teams (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  description            text,
  team_type              text NOT NULL DEFAULT 'general'
                           CHECK (team_type IN ('fronter', 'closer', 'mixed', 'general')),
  lead_user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,   -- the manager / team lead
  parent_team_id         uuid REFERENCES teams(id) ON DELETE SET NULL,        -- nesting (operations over sub-teams)
  goal_monthly_sales     int,                                                 -- target (NULL = none)
  goal_monthly_transfers int,
  color                  text,                                                -- UI accent
  is_active              boolean NOT NULL DEFAULT true,
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_teams_company ON teams (company_id);
CREATE INDEX IF NOT EXISTS idx_teams_parent  ON teams (parent_team_id);
CREATE INDEX IF NOT EXISTS idx_teams_lead    ON teams (lead_user_id);

CREATE TABLE IF NOT EXISTS team_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,  -- denorm: enforces one-team-per-user-per-company
  role_in_team text NOT NULL DEFAULT 'member' CHECK (role_in_team IN ('lead', 'member')),
  added_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at    timestamptz NOT NULL DEFAULT now()
);
-- one team per user within a company (the org-chart invariant)
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_member_user_company ON team_members (user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members (team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members (user_id);

-- RLS on, deny-all for anon/authenticated; the service-role backend bypasses it
-- (matches the mig-167/180/208 posture — all access goes through routes/teams.js).
ALTER TABLE teams        ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- ── post-apply verification ─────────────────────────────────────────────────
-- SELECT tablename FROM pg_tables WHERE tablename IN ('teams','team_members');
-- SELECT indexname FROM pg_indexes WHERE tablename IN ('teams','team_members');
