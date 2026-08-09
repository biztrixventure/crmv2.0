-- ============================================================================
-- 237_qa2_evaluation.sql
-- QA v2 — Phase 1, part 6: evaluations, answers, listen tracking.
--
-- RAW ANSWERS ARE THE SOURCE OF TRUTH. qa2_answer rows are what a reviewer
-- actually entered; every score column on qa2_evaluation (base_sum,
-- base_pct, penalty_total, final_score, autofail_result, result) is DERIVED
-- by backend/utils/qa2Scoring.js (Phase 2) from those rows plus the frozen
-- qa2_form_version they were scored against — always replayable, never a
-- number typed once and trusted forever.
--
-- MANAGER OVERRIDE NEVER MUTATES THE AGENT'S ROW. The manager marks the
-- original 'flagged', then submits their OWN evaluation with
-- overrides_evaluation_id set; the original becomes 'superseded' with
-- superseded_by pointing forward. Both rows stay queryable — that
-- side-by-side comparison is how calibration-worthy reviewers get found.
-- Same append-only philosophy this codebase already uses everywhere
-- (edit_history JSONB, disposition_actions, VIN supersession in mig 088/091)
-- — corrections create new rows linked to the original, nothing is
-- overwritten in place.
--
-- active_seconds is real reviewing time tracked from the review screen
-- (Phase 7), not a raw submitted-count — how a manager sees genuine workload.
--
-- qa2_answer.parameter_id is a hard FK into a FROZEN qa2_form_version row
-- (mig 235) — not a loose criterion_key string like v1's qa_review_scores.
-- A key can't be silently reused, redefined, or vanish out from under a past
-- answer.
--
-- qa2_listen_log exists because "did they actually listen before scoring" is
-- unanswerable from qa_reviews alone in v1 — this is a plain append log of
-- listen sessions per call (and, once one exists, per evaluation), feeding
-- Phase 9's reviewer-activity report.
-- ============================================================================

CREATE TABLE IF NOT EXISTS qa2_evaluation (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id                  uuid NOT NULL REFERENCES qa2_call(id) ON DELETE CASCADE,
  assignment_id            uuid REFERENCES qa2_assignment(id) ON DELETE SET NULL,
  form_version_id          uuid NOT NULL REFERENCES qa2_form_version(id),
  reviewer_id              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_role             text CHECK (subject_role IN ('fronter','closer')),
  company_id               uuid REFERENCES companies(id) ON DELETE SET NULL,
  status                   text NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','submitted','flagged','superseded','void')),
  overrides_evaluation_id  uuid REFERENCES qa2_evaluation(id) ON DELETE SET NULL,
  superseded_by            uuid REFERENCES qa2_evaluation(id) ON DELETE SET NULL,
  base_sum                 numeric,
  base_pct                 numeric,
  penalty_total            numeric,
  final_score              numeric,
  autofail_result          text CHECK (autofail_result IN ('pass','fail')),
  result                   text CHECK (result IN ('pass','fail','na')),
  overall_notes            text,
  started_at               timestamptz,
  submitted_at             timestamptz,
  active_seconds           integer NOT NULL DEFAULT 0,
  voided_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason              text,
  edit_history              jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa2_evaluation_call      ON qa2_evaluation (call_id);
CREATE INDEX IF NOT EXISTS idx_qa2_evaluation_reviewer  ON qa2_evaluation (reviewer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa2_evaluation_subject   ON qa2_evaluation (subject_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa2_evaluation_company   ON qa2_evaluation (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa2_evaluation_supersede ON qa2_evaluation (overrides_evaluation_id)
  WHERE overrides_evaluation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS qa2_answer (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES qa2_evaluation(id) ON DELETE CASCADE,
  parameter_id  uuid NOT NULL REFERENCES qa2_parameter(id),
  value_num     numeric,
  value_text    text,
  value_bool    boolean,
  is_na         boolean NOT NULL DEFAULT false,
  comment       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evaluation_id, parameter_id)
);

CREATE TABLE IF NOT EXISTS qa2_listen_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id        uuid NOT NULL REFERENCES qa2_call(id) ON DELETE CASCADE,
  evaluation_id  uuid REFERENCES qa2_evaluation(id) ON DELETE SET NULL,
  user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  seconds_played integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_qa2_listen_log_call ON qa2_listen_log (call_id);
CREATE INDEX IF NOT EXISTS idx_qa2_listen_log_user ON qa2_listen_log (user_id, started_at DESC);

REVOKE ALL ON public.qa2_evaluation FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qa2_answer     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qa2_listen_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.qa2_evaluation TO service_role;
GRANT ALL ON public.qa2_answer     TO service_role;
GRANT ALL ON public.qa2_listen_log TO service_role;

INSERT INTO schema_migrations (filename, note)
VALUES ('237_qa2_evaluation.sql', 'QA v2 phase 1 — evaluations with supersession, raw answers, listen log')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
