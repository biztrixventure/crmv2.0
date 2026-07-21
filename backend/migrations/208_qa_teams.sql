-- ============================================================================
-- 208_qa_teams.sql
-- Two-tier QA org. Compliance's ONLY job becomes wiring the org chart:
--   * assign one or more COMPANIES to a quality MANAGER   (qa_manager_companies)
--   * assign quality AGENTS to that manager (build the team) (qa_team_members)
-- Everything about the WORK (which review methods an agent may do, task
-- assignment, per-company review-type config) moves to the MANAGER, scoped to
-- the companies + team compliance gave them.
--
-- Cardinalities (locked with the user):
--   * one company  -> exactly one manager  (PK on company_id)
--   * one agent    -> exactly one manager  (PK on agent_id)
--
-- Also scopes managers: today the global qa_manager role holds
-- view_all_qa_reviews, and allowedCompanyIds() treats that as "see EVERY
-- company". A manager must now see ONLY their assigned companies, so we revoke
-- that grant from the global qa_manager role. Compliance_manager keeps it.
--
-- Additive + idempotent. Apply AFTER 181. No data is seeded — compliance wires
-- the teams in the new UI; until a manager has companies they see nothing, and
-- until an agent has a manager they see nothing (strict by design).
-- ============================================================================

-- 1. company -> manager (one manager per company) ----------------------------
CREATE TABLE IF NOT EXISTS qa_manager_companies (
  company_id  uuid        PRIMARY KEY REFERENCES companies(id)   ON DELETE CASCADE,
  manager_id  uuid        NOT NULL    REFERENCES auth.users(id)  ON DELETE CASCADE,
  assigned_by uuid                    REFERENCES auth.users(id)  ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL    DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa_manager_companies_mgr ON qa_manager_companies (manager_id);

-- RLS on, NO permissive policy -> deny-all for anon/authenticated; the
-- service-role backend bypasses RLS (matches the mig-180 posture).
ALTER TABLE qa_manager_companies ENABLE ROW LEVEL SECURITY;

-- 2. agent -> manager (one manager per agent) --------------------------------
CREATE TABLE IF NOT EXISTS qa_team_members (
  agent_id    uuid        PRIMARY KEY REFERENCES auth.users(id)  ON DELETE CASCADE,
  manager_id  uuid        NOT NULL    REFERENCES auth.users(id)  ON DELETE CASCADE,
  assigned_by uuid                    REFERENCES auth.users(id)  ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL    DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa_team_members_mgr ON qa_team_members (manager_id);
ALTER TABLE qa_team_members ENABLE ROW LEVEL SECURITY;

-- 3. scope managers to assigned companies ------------------------------------
--    Remove the "see everything" grant from the GLOBAL qa_manager role. After
--    this, allowedCompanyIds() no longer short-circuits to null for a manager,
--    so they fall to their qa_manager_companies (their assigned set only).
--    compliance_manager still holds view_all_qa_reviews (granted in 181).
DELETE FROM role_permissions rp
USING custom_roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.company_id IS NULL
  AND r.level::text = 'qa_manager'
  AND p.name = 'view_all_qa_reviews';
