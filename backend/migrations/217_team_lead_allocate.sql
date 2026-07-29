-- ============================================================================
-- 217_team_lead_allocate.sql
-- Per-team switch: may this team's LEAD allocate quotas to their members?
--
-- Until now the quota tier reused teams.lead_can_edit (mig 212). That switch
-- means "this lead may edit the TEAM itself" — name, colour, type, goals — and
-- it is a strictly bigger grant than "this lead may hand their people numbers".
-- An operator who wants a lead running day-to-day targets should not have to
-- also let them rename the team, and an operator who lets a lead rename the
-- team is almost certainly fine with them allocating.
--
-- So: a separate, narrower switch, seeded from the existing one so NOTHING
-- changes behaviour on apply. Every team that could allocate yesterday still
-- can today; the two can now diverge from here on.
--
-- Superadmin overrides both switches in every company — the quota routes check
-- isSuperAdmin first and never consult these columns for that role.
--
-- Additive + idempotent. Apply AFTER 216.
-- ============================================================================

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS lead_can_allocate boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN teams.lead_can_allocate IS
  'When true, this team''s lead may create/edit/remove MEMBER quota allocations on their own team (never the team-level target, which stays a company-manager decision). Narrower than lead_can_edit, which grants editing the team record itself.';

-- Preserve today's behaviour exactly: anyone who could allocate via
-- lead_can_edit keeps that ability under the new switch.
UPDATE teams
   SET lead_can_allocate = true
 WHERE lead_can_edit = true
   AND lead_can_allocate = false;

CREATE INDEX IF NOT EXISTS idx_teams_lead_allocate
  ON teams (lead_user_id) WHERE lead_can_allocate = true;

-- ── post-apply verification ─────────────────────────────────────────────────
-- SELECT name, lead_can_edit, lead_can_allocate FROM teams ORDER BY name;
--   expect: lead_can_allocate = lead_can_edit on every existing row
