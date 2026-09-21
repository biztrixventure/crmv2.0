-- ============================================================================
-- 324_qa_org_v1_to_v2_backfill.sql
-- The QA org chart exists TWICE — v1 (`qa_manager_companies`, `qa_team_members`,
-- `qa_managers`, wired from Compliance → QA Department) and v2
-- (`qa2_manager_company`, `qa2_team_member`, `qa2_manager_access`, wired from
-- the /qa2 Org tab). QA2 reads ONLY the v2 tables: qa2ScopeResolver gives a
-- qa_manager their companies from `qa2_manager_company` and nothing else.
--
-- So an admin who wires a manager on the v1 screen creates a manager who opens
-- /qa2 and sees an empty shell. That is exactly what happened on 2026-09-21:
-- a QA manager was given a company and two agents in v1 and had zero rows in
-- v2, so QA2 showed him no company and no team.
--
-- This copies every v1 row v2 has no opinion about. ON CONFLICT DO NOTHING is
-- deliberate: where v2 already names a manager for a company or an agent, V2
-- WINS — it is the surface that is staying, and overwriting a deliberate v2
-- assignment with a stale v1 one would be the worse mistake.
--
-- Idempotent: re-running copies only what is still missing. Going forward the
-- v1 endpoints mirror into v2 (backend/utils/qaOrgMirror.js), so this is a
-- one-time catch-up and not a sync job.
-- Apply in the Supabase SQL editor.
-- ============================================================================

-- ── companies: one manager per company (company_id is the PK in both) ────────
INSERT INTO qa2_manager_company (company_id, manager_id, assigned_by, assigned_at)
SELECT mc.company_id, mc.manager_id, mc.assigned_by, COALESCE(mc.assigned_at, now())
  FROM qa_manager_companies mc
ON CONFLICT (company_id) DO NOTHING;

-- ── agents: one manager per agent (agent_id is the PK in both) ───────────────
INSERT INTO qa2_team_member (agent_id, manager_id, assigned_by, assigned_at)
SELECT tm.agent_id, tm.manager_id, tm.assigned_by, COALESCE(tm.assigned_at, now())
  FROM qa_team_members tm
ON CONFLICT (agent_id) DO NOTHING;

-- ── the designation ──────────────────────────────────────────────────────────
-- v1 marks "this person acts as a quality manager" in `qa_managers` whatever
-- their role. v2 only needs that for a compliance_manager — a qa_manager holds
-- the authority natively (qa2ScopeResolver) and POST /qa2/org/manager-access
-- refuses anyone else. So only the compliance managers carry across.
INSERT INTO qa2_manager_access (user_id, granted_by, granted_at)
SELECT q.user_id, q.designated_by, COALESCE(q.designated_at, now())
  FROM qa_managers q
 WHERE EXISTS (SELECT 1 FROM user_company_roles u
                 JOIN custom_roles cr ON cr.id = u.role_id
                WHERE u.user_id = q.user_id AND u.is_active AND cr.level = 'compliance_manager')
   AND NOT EXISTS (SELECT 1 FROM qa2_manager_access a
                    WHERE a.user_id = q.user_id AND a.revoked_at IS NULL);

NOTIFY pgrst, 'reload schema';
