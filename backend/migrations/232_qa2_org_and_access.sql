-- ============================================================================
-- 232_qa2_org_and_access.sql
-- QA v2 — Phase 1, part 1: org chart and access tables. v1's qa_* tables
-- (mig 168-228) are frozen; this is new, parallel schema per the QA v2 build
-- brief. No FK to any qa_* table anywhere in v2 — the only shared surface is
-- companies / auth.users / custom_roles, which both generations read.
--
-- Three tiers: superadmin toggles QA access onto a compliance manager
-- (qa2_manager_access); compliance wires companies + agents to a QA manager
-- (qa2_manager_company, qa2_team_member — org-chart only); the QA manager
-- sub-assigns his own companies/methods to his agents (qa2_agent_company,
-- qa2_agent_method — operational, not compliance's job).
--
-- qa_manager stays a real role (NOT replaced by the toggle) — see
-- backend/models/helpers.js ROLE_HIERARCHY. A compliance manager with a live
-- qa2_manager_access grant gets IDENTICAL authority inside /qa2 to a real
-- qa_manager, no more — enforced by the scoping helper (Phase 3), not here.
--
-- qa2_manager_access carries grant AND revoke history (a row is never
-- deleted) — v1's qa_managers designation table (mig 227) does the same job
-- but is frozen; v2 owns this one because v1 is slated for retirement.
--
-- One company -> exactly one QA manager, one agent -> exactly one QA manager:
-- both PKs on the "one" side (company_id, agent_id) enforce this structurally,
-- not by convention. Agents do NOT auto-inherit their manager's companies —
-- qa2_agent_company is a separate, explicit grant the manager makes; fronter
-- and closer companies are separate rows here too, never auto-pulled via
-- company_links (that table stays untouched by v2 entirely).
--
-- qa2_grant_log is the append-only ledger every grant/revoke on the four live
-- tables above writes into, in the same request. When an agent's manager
-- changes, in-flight (in_review) assignments stay with the agent to finish,
-- but qa2_agent_company/qa2_agent_method grants are revoked (logged, not
-- deleted) — carrying them forward could leave the agent visible into
-- companies the NEW manager was never assigned. That's app-layer logic
-- (Phase 3's org routes), not enforced by this schema.
-- ============================================================================

CREATE TABLE IF NOT EXISTS qa2_manager_access (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_qa2_manager_access_live
  ON qa2_manager_access (user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS qa2_manager_company (
  company_id  uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  manager_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa2_manager_company_manager ON qa2_manager_company (manager_id);

CREATE TABLE IF NOT EXISTS qa2_team_member (
  agent_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  manager_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa2_team_member_manager ON qa2_team_member (manager_id);

CREATE TABLE IF NOT EXISTS qa2_agent_company (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, company_id)
);
CREATE INDEX IF NOT EXISTS idx_qa2_agent_company_agent ON qa2_agent_company (agent_id);

CREATE TABLE IF NOT EXISTS qa2_agent_method (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method_id  uuid NOT NULL,   -- FK added in 233 after qa2_method exists
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, method_id)
);
CREATE INDEX IF NOT EXISTS idx_qa2_agent_method_agent ON qa2_agent_method (agent_id);

CREATE TABLE IF NOT EXISTS qa2_grant_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity     text NOT NULL CHECK (entity IN
             ('manager_access','manager_company','team_member','agent_company','agent_method')),
  action     text NOT NULL CHECK (action IN ('grant','revoke')),
  subject_id uuid,            -- the user being granted/revoked
  object_id  uuid,            -- company or method (null for manager_access)
  actor_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa2_grant_log_subject ON qa2_grant_log (subject_id, created_at DESC);

REVOKE ALL ON public.qa2_manager_access  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qa2_manager_company FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qa2_team_member     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qa2_agent_company   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qa2_agent_method    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qa2_grant_log       FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.qa2_manager_access  TO service_role;
GRANT ALL ON public.qa2_manager_company TO service_role;
GRANT ALL ON public.qa2_team_member     TO service_role;
GRANT ALL ON public.qa2_agent_company   TO service_role;
GRANT ALL ON public.qa2_agent_method    TO service_role;
GRANT ALL ON public.qa2_grant_log       TO service_role;

INSERT INTO schema_migrations (filename, note)
VALUES ('232_qa2_org_and_access.sql', 'QA v2 phase 1 — org chart and access tables')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
