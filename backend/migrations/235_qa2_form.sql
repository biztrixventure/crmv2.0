-- ============================================================================
-- 235_qa2_form.sql
-- QA v2 — Phase 1, part 4: scorecards. Global catalog with per-company
-- override — one method has many forms, but exactly ONE global form
-- (company_id IS NULL) may be active per method at a time; a company gets
-- its own only when its sheet genuinely differs (mirrors mig 225's own
-- "exactly one active global card per method" dedup, which is the precedent
-- for keeping this global-by-default rather than every company inventing its
-- own copy of the same sheet). Scoring resolution order (Phase 2/7): the
-- company-specific active form if one exists, else the global active form.
--
-- IMMUTABLE VERSIONS. Publishing snapshots sections/parameters/options into a
-- new qa2_form_version. Once a version has any evaluation it is read-only —
-- enforced in the API (Phase 6); qa2_evaluation.form_version_id below is the
-- DB-level backstop. Editing a published form creates version N+1, never
-- mutates N.
--
-- LINEAGE IDS. Each parameter carries a lineage_id copied forward into every
-- new version. This is what lets reporting chart one question across
-- v1 -> v2 -> v3 after its wording changed (Phase 9's by-lineage failure-rate
-- report). Versioning without lineage gives correctness but destroys trends —
-- both are required together.
--
-- WHY NOT V1'S APPROACH: v1 keys answers by loose criterion_key text with no
-- FK, so a key can be reused, redefined, or vanish, and a bare version
-- integer doesn't prevent it. Here, answers point at a parameter_id FK
-- inside a FROZEN version, and lineage_id carries identity forward — same
-- "history stays attached" outcome, but provably, not by convention.
--
-- v1 has qa_reviews.scorecard_id REFERENCES qa_scorecards(id) ON DELETE SET
-- NULL — hard-deleting a scored scorecard silently orphans historic reviews.
-- qa2_evaluation.form_version_id (mig 237) is NOT NULL with NO ON DELETE
-- clause (implicit NO ACTION), so the database refuses that delete outright.
-- Do not weaken this when mig 237 is written.
-- ============================================================================

CREATE TABLE IF NOT EXISTS qa2_form (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  method_id   uuid NOT NULL REFERENCES qa2_method(id),
  company_id  uuid REFERENCES companies(id) ON DELETE CASCADE,   -- NULL = global
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_qa2_form_active_global ON qa2_form (method_id)
  WHERE company_id IS NULL AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_qa2_form_active_company ON qa2_form (method_id, company_id)
  WHERE company_id IS NOT NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_qa2_form_method ON qa2_form (method_id);

CREATE TABLE IF NOT EXISTS qa2_form_version (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id               uuid NOT NULL REFERENCES qa2_form(id) ON DELETE CASCADE,
  version_no            integer NOT NULL,
  is_current            boolean NOT NULL DEFAULT false,
  base_denominator_mode text NOT NULL DEFAULT 'auto'
                        CHECK (base_denominator_mode IN ('auto','manual')),
  base_denominator      numeric,
  final_score_formula   text NOT NULL DEFAULT 'base_pct_plus_penalty',
  rounding_mode         text NOT NULL DEFAULT 'round_1'
                        CHECK (rounding_mode IN ('truncate_1','round_1','round_2')),
  pass_threshold        numeric,
  pass_comparator       text NOT NULL DEFAULT 'gte' CHECK (pass_comparator IN ('gte','gt')),
  autofail_mode         text NOT NULL DEFAULT 'none'
                        CHECK (autofail_mode IN ('none','all_yes','explicit_table')),
  autofail_table        jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at          timestamptz,
  published_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, version_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_qa2_form_current ON qa2_form_version (form_id) WHERE is_current;

CREATE TABLE IF NOT EXISTS qa2_section (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_version_id uuid NOT NULL REFERENCES qa2_form_version(id) ON DELETE CASCADE,
  name            text NOT NULL,
  sort            integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qa2_parameter (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_version_id  uuid NOT NULL REFERENCES qa2_form_version(id) ON DELETE CASCADE,
  section_id       uuid REFERENCES qa2_section(id) ON DELETE CASCADE,
  lineage_id       uuid NOT NULL,
  key              text NOT NULL,
  label            text NOT NULL,
  input_type       text NOT NULL CHECK (input_type IN ('yes_no','scale','choice','number','text')),
  role             text NOT NULL CHECK (role IN ('score','autofail','penalty','outcome','info')),
  points_yes       numeric DEFAULT 1,
  points_no        numeric DEFAULT 0,
  scale_min        numeric,
  scale_max        numeric,
  scale_step       numeric DEFAULT 1,
  penalty_value    numeric,
  allow_na         boolean NOT NULL DEFAULT false,
  included_in_base boolean NOT NULL DEFAULT true,
  requires_comment text NOT NULL DEFAULT 'never'
                   CHECK (requires_comment IN ('never','on_fail','always')),
  sort             integer NOT NULL DEFAULT 0,
  ui               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_version_id, key)
);
CREATE INDEX IF NOT EXISTS idx_qa2_parameter_lineage ON qa2_parameter (lineage_id);
CREATE INDEX IF NOT EXISTS idx_qa2_parameter_version  ON qa2_parameter (form_version_id);

CREATE TABLE IF NOT EXISTS qa2_parameter_option (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter_id uuid NOT NULL REFERENCES qa2_parameter(id) ON DELETE CASCADE,
  value        text NOT NULL,
  label        text NOT NULL,
  points       numeric NOT NULL DEFAULT 0,
  sort         integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parameter_id, value)
);

REVOKE ALL ON public.qa2_form              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qa2_form_version      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qa2_section           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qa2_parameter         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qa2_parameter_option  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.qa2_form             TO service_role;
GRANT ALL ON public.qa2_form_version     TO service_role;
GRANT ALL ON public.qa2_section          TO service_role;
GRANT ALL ON public.qa2_parameter        TO service_role;
GRANT ALL ON public.qa2_parameter_option TO service_role;

INSERT INTO schema_migrations (filename, note)
VALUES ('235_qa2_form.sql', 'QA v2 phase 1 — scorecards: global catalog, immutable versions, lineage-tracked parameters')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
