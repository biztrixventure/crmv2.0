-- ============================================================================
-- 186 — QA routing rules: compliance decides WHO listens to WHAT.
--
-- A rule binds one QA reviewer to a combination of:
--   • work_types  — any of:
--       'tra'          transfer calls (fronter side, full coverage)
--       'rcm'          random sampled calls
--       'closer_sales' sales calls of the closers
--       'closer_dispo' transferred calls that landed on a closer but ended with
--                      a different disposition (optionally a specific dispo set)
--   • subject_user_ids — listen to EVERYONE (empty) or only these specific
--       fronters/closers (single or multiple users)
--   • dispositions — for closer_dispo: which disposition codes count
--       (empty = any non-SALE disposition)
-- The engine (utils/qaRules.js) materializes the matching calls into
-- qa_assignments and routes them to the rule's reviewer automatically.
-- ============================================================================

-- Tag each assignment with the kind of work it represents so rules can match
-- precisely. Old rows stay NULL — the engine derives their type from
-- method/sale_id/subject_role.
ALTER TABLE qa_assignments ADD COLUMN IF NOT EXISTS work_type text;

CREATE TABLE IF NOT EXISTS qa_routing_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  reviewer_id      uuid NOT NULL,                -- the QA user who does the listening
  work_types       text[] NOT NULL DEFAULT '{}', -- subset of tra|rcm|closer_sales|closer_dispo
  subject_user_ids uuid[] NOT NULL DEFAULT '{}', -- empty = all agents of the company
  dispositions     text[] NOT NULL DEFAULT '{}', -- closer_dispo only; empty = any non-SALE
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_routing_rules_work_types_chk
    CHECK (work_types <@ ARRAY['tra','rcm','closer_sales','closer_dispo']::text[])
);

CREATE INDEX IF NOT EXISTS idx_qa_routing_rules_company
  ON qa_routing_rules (company_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_qa_routing_rules_reviewer
  ON qa_routing_rules (reviewer_id) WHERE is_active;

-- Service-role only (same posture as the other qa_* tables): RLS on, no
-- permissive policies — the anon/authenticated keys can never touch it.
ALTER TABLE qa_routing_rules ENABLE ROW LEVEL SECURITY;
