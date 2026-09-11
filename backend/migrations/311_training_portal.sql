-- ============================================================================
-- 311_training_portal.sql -- the Training portal: a trainee role, and the
-- material a new hire works through before they are promoted.
--
-- WHY IT LOOKS LIKE THIS
--
-- A trainee is not a separate product. They are a fronter who has not been
-- signed off yet, so everything here is built to survive the promotion: the
-- same material stays visible after the role changes to fronter, and existing
-- fronters see it too. That is why the portal is company content keyed on
-- company_id -- never "content assigned to trainees" -- and why nothing here
-- keys on the role at all.
--
-- WHO MANAGES IT: two doors, the same two the Accounting/HR modules use.
--   1. A permission (training.manage) on the role -- seeded below for the
--      fronter_manager, who runs their own floor's new hires.
--   2. A superadmin DESIGNATION (module_designations, module='training')
--      naming companies -- so one compliance manager can own training for
--      companies they are not a member of, exactly as mig 290/293 did for the
--      accountant and the HR manager. See backend/utils/moduleAccess.js.
--
-- GLOBAL vs COMPANY: company_id NULL means "every company". Superadmin writes
-- those; a company manager only ever writes their own company_id. Trainees
-- read their company rows UNION the global ones, so a shared PDF is uploaded
-- once instead of once per tenant.
-- ============================================================================

-- -- 1. Role level --------------------------------------------------------------
-- Same pattern as qa_manager (208) and accountant/hr_manager (290). Deliberately
-- never compared as a bare enum literal in this file -- see the ::text casts in
-- section 5, which is what keeps the grants runnable in the same transaction.
ALTER TYPE role_level ADD VALUE IF NOT EXISTS 'trainee';

-- -- 2. Designation module -------------------------------------------------------
-- module_designations already exists (290) with a CHECK pinned to two modules.
-- Widen it rather than build a third designation table, so the User Control
-- Center keeps one Modules section and moduleAccess.js keeps one cache.
ALTER TABLE module_designations
  DROP CONSTRAINT IF EXISTS module_designations_module_check;
ALTER TABLE module_designations
  ADD CONSTRAINT module_designations_module_check
  CHECK (module IN ('accounting','hr','training'));

ALTER TABLE module_designation_companies
  DROP CONSTRAINT IF EXISTS module_designation_companies_module_check;
ALTER TABLE module_designation_companies
  ADD CONSTRAINT module_designation_companies_module_check
  CHECK (module IN ('accounting','hr','training'));

-- -- 3. Content ------------------------------------------------------------------

-- PDFs, shown as product-style cards. The file lives in Supabase Storage
-- (bucket 'training-media'); storage_path is kept so a delete can remove the
-- object too, instead of orphaning it behind a public URL.
CREATE TABLE IF NOT EXISTS training_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid REFERENCES companies(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  category     text,
  file_url     text NOT NULL,
  storage_path text,
  file_name    text,
  file_size    bigint,
  mime_type    text NOT NULL DEFAULT 'application/pdf',
  accent       text,
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_training_docs_co ON training_documents (company_id, is_active, sort_order);

-- Call recordings a trainee listens to. Same storage shape as documents.
CREATE TABLE IF NOT EXISTS training_recordings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid REFERENCES companies(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  category     text,
  file_url     text NOT NULL,
  storage_path text,
  file_name    text,
  file_size    bigint,
  mime_type    text NOT NULL DEFAULT 'audio/mpeg',
  duration_sec integer,
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_training_recs_co ON training_recordings (company_id, is_active, sort_order);

-- A written situation the trainee reads, with the dispositions they may pick
-- from. Options are a child table, not a jsonb array, because the manager edits
-- them one at a time and because correctness is reported per option.
CREATE TABLE IF NOT EXISTS training_scenarios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES companies(id) ON DELETE CASCADE,
  title       text NOT NULL,
  situation   text NOT NULL,
  guidance    text,
  category    text,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_training_scen_co ON training_scenarios (company_id, is_active, sort_order);

CREATE TABLE IF NOT EXISTS training_scenario_options (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL REFERENCES training_scenarios(id) ON DELETE CASCADE,
  label       text NOT NULL,
  disposition text,
  is_correct  boolean NOT NULL DEFAULT false,
  feedback    text,
  sort_order  integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_training_scen_opt ON training_scenario_options (scenario_id, sort_order);

-- Tool Kit pronunciation entries.
--
-- kind='vehicle' rows are the EXTRAS ONLY. The makes and models a trainee
-- practises come live from vehicle_makes / vehicle_models (the form builder
-- catalog) -- copying them here would fork the list the moment someone edits
-- the catalog. This table exists so a manager can add the ones the catalog
-- does not carry, and so a customer-name list can be uploaded at all.
CREATE TABLE IF NOT EXISTS training_terms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('vehicle','name')),
  term       text NOT NULL,
  phonetic   text,
  note       text,
  source     text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import')),
  is_active  boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One spelling per company per kind, case-insensitively: a pasted list is
-- re-pasted often and must not multiply.
CREATE UNIQUE INDEX IF NOT EXISTS uq_training_terms
  ON training_terms (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, lower(term));
CREATE INDEX IF NOT EXISTS idx_training_terms_read ON training_terms (kind, company_id, is_active);

-- What a trainee has worked through. One row per (person, item) -- upserted, so
-- re-opening a PDF does not grow the table. This is what a manager reads before
-- deciding someone is ready to be promoted.
CREATE TABLE IF NOT EXISTS training_progress (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  company_id   uuid REFERENCES companies(id) ON DELETE CASCADE,
  item_type    text NOT NULL CHECK (item_type IN ('document','recording','scenario','toolkit')),
  item_id      uuid,
  item_key     text,
  status       text NOT NULL DEFAULT 'opened' CHECK (status IN ('opened','completed')),
  score        integer,
  attempts     integer NOT NULL DEFAULT 1,
  opened_at    timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_training_progress
  ON training_progress (user_id, item_type, COALESCE(item_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(item_key, ''));
CREATE INDEX IF NOT EXISTS idx_training_progress_co ON training_progress (company_id, user_id, item_type);

-- -- 4. Lock-down -----------------------------------------------------------------
-- Every read and write goes through the service role in backend/routes/training.js.
-- anon must never see any of it (the mig 176 lesson).
ALTER TABLE training_documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_recordings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_scenarios        ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_scenario_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_terms            ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_progress         ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON training_documents        FROM anon;
REVOKE ALL ON training_recordings       FROM anon;
REVOKE ALL ON training_scenarios        FROM anon;
REVOKE ALL ON training_scenario_options FROM anon;
REVOKE ALL ON training_terms            FROM anon;
REVOKE ALL ON training_progress         FROM anon;

-- -- 5. Permissions ----------------------------------------------------------------
INSERT INTO permissions (name, description, category) VALUES
  ('training.view',     'Open the Training portal and work through its material', 'training'),
  ('training.manage',   'Upload and edit training documents, recordings, scenarios and word lists', 'training'),
  ('training.progress', 'See how far the team has got through the training material', 'training')
ON CONFLICT (name) DO UPDATE
  SET description = EXCLUDED.description,
      category    = EXCLUDED.category;

-- Grants, per role LEVEL, against every custom_roles row at that level.
-- r.level::text, never r.level = 'trainee' -- comparing against an enum value
-- added earlier in this same transaction raises "unsafe use of new value".
-- role_permissions has UNIQUE(role_id, permission_id), so this is idempotent.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r
CROSS JOIN permissions p
WHERE p.name = 'training.view'
  AND r.level::text IN ('trainee','fronter','closer','fronter_manager','closer_manager',
                        'manager','operations_manager','company_admin','compliance_manager')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r
CROSS JOIN permissions p
WHERE p.name IN ('training.manage','training.progress')
  AND r.level::text IN ('fronter_manager','manager','operations_manager','company_admin','compliance_manager')
ON CONFLICT DO NOTHING;

-- -- 6. Comments --------------------------------------------------------------------
COMMENT ON TABLE training_documents  IS 'Training PDFs shown as cards in the Training portal (mig 311). company_id NULL = every company.';
COMMENT ON TABLE training_recordings IS 'Training call recordings (mig 311). Stored in the training-media bucket.';
COMMENT ON TABLE training_scenarios  IS 'Written practice situations with pickable dispositions (mig 311).';
COMMENT ON TABLE training_terms      IS 'Tool Kit pronunciation extras (mig 311). Vehicle makes/models come LIVE from vehicle_makes/vehicle_models; only additions and uploaded name lists live here.';
COMMENT ON TABLE training_progress   IS 'Per-person training progress (mig 311). Upserted on (user, item); read by managers deciding on promotion.';
