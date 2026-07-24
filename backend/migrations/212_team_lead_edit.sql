-- 212_team_lead_edit.sql
-- Per-team switch: may the team's LEAD edit the team (name/goals/color/type)?
-- Default FALSE — only a manager (superadmin / company_admin / operations_manager)
-- can edit a team until the manager explicitly grants the lead edit rights when
-- creating/editing the team. Apply in the Supabase SQL editor.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS lead_can_edit boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN teams.lead_can_edit IS
  'When true, the team lead may edit their own team (name/desc/type/color/goals). When false, only company managers can. Set by the manager who creates/edits the team.';
