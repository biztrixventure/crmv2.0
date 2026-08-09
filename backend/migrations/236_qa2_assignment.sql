-- ============================================================================
-- 236_qa2_assignment.sql
-- QA v2 — Phase 1, part 5: assignment workflow, sampling, targets.
--
-- THREE VISIBLE STATES, not two collapsed into "pending" — derived from
-- assigned_to + status, no extra column needed: Unassigned (assigned_to IS
-- NULL), Assigned/not started (assigned_to set, status='pending'), In review
-- (status='in_review'). The UI (Phase 7) filters on both; this schema doesn't
-- need a fourth state column.
--
-- THREE ROUTING PATHS share this one table: automatic (qa2_sampling_rule
-- driven), manual push (a manager sets assigned_to directly), self-claim
-- (origin='self_claim', claimed_at stamped) — precedent for self-claim
-- already exists elsewhere in this codebase (QA Live tab), this generalizes
-- it into the main assignment flow.
--
-- UNASSIGN vs EXCLUDE are different actions with different audit trails:
-- unassign clears assigned_to and returns status to 'pending' (routing
-- event, no reason required); exclude sets status='skipped' and REQUIRES
-- skip_reason/skipped_by/skipped_at — bad recording, wrong number, test
-- call. Post-score exclusion is a void on qa2_evaluation instead (mig 237),
-- never this table.
--
-- The unique index on call_id deliberately allows MULTIPLE assignments per
-- call only when calibration_group_id is set — that's the opt-in "send for
-- calibration" path (Phase 8): two agents scored against the same call,
-- compared side by side.
--
-- AGEING: untouched AND unassigned assignments purge after 2 days, matching
-- v1's mig 177 retention behaviour exactly (reused, not reinvented — see
-- Phase 8). Assigned or opened work never ages out. No column here enforces
-- that; it's a scheduled job filtering on assigned_to/status/created_at.
-- ============================================================================

CREATE TABLE IF NOT EXISTS qa2_assignment (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id              uuid NOT NULL REFERENCES qa2_call(id) ON DELETE CASCADE,
  assigned_to          uuid REFERENCES auth.users(id) ON DELETE SET NULL,   -- NULL = unassigned pool
  assigned_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at          timestamptz,
  claimed_at           timestamptz,
  opened_at            timestamptz,
  status               text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','in_review','scored','skipped')),
  origin               text NOT NULL CHECK (origin IN ('auto','manual','self_claim')),
  calibration_group_id uuid,
  priority             integer NOT NULL DEFAULT 0,
  due_at               timestamptz,
  period               text,
  skip_reason          text,
  skipped_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  skipped_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_qa2_assignment_call ON qa2_assignment (call_id)
  WHERE calibration_group_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_qa2_assignment_assignee ON qa2_assignment (assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_qa2_assignment_unassigned ON qa2_assignment (created_at)
  WHERE assigned_to IS NULL AND status = 'pending';
CREATE INDEX IF NOT EXISTS idx_qa2_assignment_calibration ON qa2_assignment (calibration_group_id)
  WHERE calibration_group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS qa2_sampling_rule (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  method_id    uuid NOT NULL REFERENCES qa2_method(id) ON DELETE CASCADE,
  mode         text NOT NULL CHECK (mode IN ('full_coverage','per_agent_per_day','per_agent_per_week','percent')),
  quantity     numeric,
  min_talk_sec integer DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa2_sampling_rule_lookup ON qa2_sampling_rule (company_id, method_id)
  WHERE is_active;

CREATE TABLE IF NOT EXISTS qa2_agent_target (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method_id  uuid REFERENCES qa2_method(id) ON DELETE CASCADE,  -- NULL = across all
  per_day    integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, method_id)
);

REVOKE ALL ON public.qa2_assignment    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qa2_sampling_rule FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qa2_agent_target  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.qa2_assignment    TO service_role;
GRANT ALL ON public.qa2_sampling_rule TO service_role;
GRANT ALL ON public.qa2_agent_target  TO service_role;

INSERT INTO schema_migrations (filename, note)
VALUES ('236_qa2_assignment.sql', 'QA v2 phase 1 — assignment workflow, sampling rules, agent targets')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
