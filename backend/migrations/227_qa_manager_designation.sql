-- ============================================================================
-- 227_qa_manager_designation.sql
--
-- Lets a SUPERADMIN name someone a quality manager without changing their role.
--
-- The problem: the QA org chart (mig 208) builds its manager list from
-- user_company_roles where custom_roles.level = 'qa_manager'. Measured today:
--
--   qa_agent           6 users
--   compliance_manager 4 users
--   qa_manager         0 users      ← nobody
--
-- So the "QA manager" column of Compliance → QA Department is empty, there is
-- nothing to assign companies or team members to, and the compliance managers
-- who actually do the job cannot be picked — even though they already reach /qa.
--
-- Giving them the qa_manager ROLE instead would be the wrong fix: role level
-- drives shell routing and permission resolution, so a second role row risks
-- moving a compliance manager out of /compliance.
--
-- This is a DESIGNATION, not a role: one row = "this user also acts as a
-- quality manager". Their compliance role, shell and permissions are untouched.
-- Deleting the row removes the designation; the qa_manager_companies /
-- qa_team_members rows they own are left alone deliberately, so a designation
-- toggled off and on again does not silently unwire their team.
--
-- Mirrors its sibling tables (208): no FK on user_id, RLS on, anon revoked —
-- everything reaches this through the service role in backend/routes/qa.js.
--
-- Verify after applying:
--   SELECT * FROM qa_managers;                       -- empty until you designate
--   SELECT count(*) FROM information_schema.tables WHERE table_name = 'qa_managers';
-- ============================================================================

CREATE TABLE IF NOT EXISTS qa_managers (
  user_id       uuid PRIMARY KEY,
  designated_by uuid,
  designated_at timestamptz NOT NULL DEFAULT now(),
  note          text
);

COMMENT ON TABLE qa_managers IS
  'Users who act as QA managers without holding the qa_manager role (mig 227). Superadmin-managed; read by GET /qa/admin/managers.';

ALTER TABLE qa_managers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qa_managers FROM anon;
