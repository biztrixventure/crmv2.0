-- ============================================================================
-- 233_qa2_method.sql
-- QA v2 — Phase 1, part 2: methods, fully manager-defined, no defaults.
--
-- No seeded rows here on purpose — a fresh install has an empty method
-- catalog. This is the direct fix for v1's mess, where editing a seeded
-- method spawned a duplicate method and a duplicate sheet instead of editing
-- in place.
--
-- Methods are a GLOBAL catalog (one method, used by many companies) and are
-- fully open — any QA manager can create and publish one without compliance
-- approval (decided explicitly over a compliance-gate alternative; revisit if
-- the manager count grows past a handful and the catalog gets noisy). A
-- method edits in place: renaming it or changing its rules does not create a
-- new method and does not detach any history — only qa2_form_version
-- (mig 235) carries a version number. Deleting a method with scored calls is
-- blocked at the application layer (Phase 4); this migration only provides
-- is_active/archived_at for the archive path.
--
-- qa2_method_rule drives classification: the ingest routes (Phase 5) no
-- longer hardcode TRA/SALE labels — every incoming call is matched against
-- active rules for its source, ordered by priority ascending, first match
-- wins. Zero matches -> qa2_call.method_id stays NULL (Unclassified pool,
-- mig 234) rather than the call being silently dropped.
-- ============================================================================

CREATE TABLE IF NOT EXISTS qa2_method (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE,
  label             text NOT NULL,
  leg               text NOT NULL CHECK (leg IN ('fronter','closer','both')),
  requires_transfer boolean,        -- NULL = don't care
  is_active         boolean NOT NULL DEFAULT true,
  archived_at       timestamptz,
  sort              integer NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qa2_method_rule (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  method_id   uuid NOT NULL REFERENCES qa2_method(id) ON DELETE CASCADE,
  source      text NOT NULL CHECK (source IN ('ingest_fronter','ingest_closer','sweep')),
  match_type  text NOT NULL CHECK (match_type IN ('any','exact','prefix','regex')),
  dispo_match text,                 -- null when match_type = 'any'
  priority    integer NOT NULL DEFAULT 100,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa2_method_rule_lookup
  ON qa2_method_rule (source, priority) WHERE is_active;

-- Complete the deferred FK from 232 now that qa2_method exists.
ALTER TABLE qa2_agent_method
  ADD CONSTRAINT fk_qa2_agent_method_method
  FOREIGN KEY (method_id) REFERENCES qa2_method(id) ON DELETE CASCADE;

REVOKE ALL ON public.qa2_method      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qa2_method_rule FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.qa2_method      TO service_role;
GRANT ALL ON public.qa2_method_rule TO service_role;

INSERT INTO schema_migrations (filename, note)
VALUES ('233_qa2_method.sql', 'QA v2 phase 1 — methods and classification rules, no seeded rows')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
