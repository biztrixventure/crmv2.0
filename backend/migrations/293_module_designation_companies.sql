-- ============================================================================
-- 293_module_designation_companies.sql
--
-- Gives an Accounting / HR designation a COMPANY SCOPE.
--
-- mig 290 made a designation a plain (user_id, module) toggle, which could only
-- ever mean "acts as the accountant wherever they already are". That is not the
-- job: a compliance manager who belongs to 1-Vertex may be the person who runs
-- HR and the books for Wavetech Infomatics -- a company they are not a member
-- of. Without a company scope the module was unreachable for them, because
-- resolveScopedCompanyId falls back to the caller's OWN company for anyone who
-- is not a member of the one they asked for.
--
-- So the designation gains an explicit company list.
--
-- SEMANTICS, and the reason they are shaped this way:
--
--   rows present  -> the designation applies to EXACTLY those companies.
--                    The operator picked them; nothing is added silently.
--   rows absent   -> the designation applies to the companies the user is
--                    already a member of. This is precisely what mig 290 did,
--                    so the 2 designations that exist today keep working
--                    unchanged. Nothing is widened by applying this file.
--
-- Membership is still honoured on top: being designated for Wavetech does not
-- remove your access to your own company, it adds Wavetech.
--
-- The FK to companies is ON DELETE CASCADE, so deleting a company cannot leave
-- a designation pointing at a tenant that no longer exists.
--
-- Verify after applying:
--   SELECT count(*) FROM module_designation_companies;   -- 0 until scoped
--   SELECT * FROM module_designations;                   -- unchanged, still 2
-- ============================================================================

CREATE TABLE IF NOT EXISTS module_designation_companies (
  user_id       uuid NOT NULL,
  module        text NOT NULL CHECK (module IN ('accounting','hr')),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  designated_by uuid,
  designated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, module, company_id)
);

-- The hot lookup is "which companies does this user hold this module in".
CREATE INDEX IF NOT EXISTS idx_moddesig_co_user_module
  ON module_designation_companies (user_id, module);
-- And the reverse, for "who runs accounting for this company".
CREATE INDEX IF NOT EXISTS idx_moddesig_co_company
  ON module_designation_companies (company_id, module);

COMMENT ON TABLE module_designation_companies IS
  'Which companies an Accounting/HR designation covers (mig 293). No rows for a (user, module) means the designation falls back to that user''s own member companies -- the mig 290 behaviour. Read by backend/utils/moduleAccess.js.';

ALTER TABLE module_designation_companies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON module_designation_companies FROM anon;

INSERT INTO schema_migrations (filename, note)
VALUES ('293_module_designation_companies.sql',
        'company scope for accounting/HR designations; empty list keeps the mig 290 member-companies behaviour so existing designations are unchanged')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
