-- ============================================================================
-- 251_profile_verification_request.sql
--
-- Superadmin-driven "verify your profile" prompt.
--
-- WHY: dialer agent ids are the single most breakage-prone field in the CRM — a
-- wrong or missing id means resolveAgent() cannot match the dialer, so that
-- person's transfers and dispositions are dropped silently (agents were found
-- working full shifts whose leads never reached the CRM). Admins cannot know
-- every agent's dialer login; the agent does. This lets a superadmin ask staff
-- to confirm their own details, with the dialer id as the one editable field.
--
-- STATE MODEL (no extra table — nullable columns on user_profiles).
-- A submission is a PROPOSAL, never a direct write: the user's answer lands in
-- the submitted_* columns and the live vicidial_agent_ids are left untouched
-- until a superadmin approves. That is the whole point — the field exists to
-- FIX wrong dialer ids, so letting anyone self-apply one unreviewed would just
-- move the problem rather than solve it.
--
--   requested_at IS NULL                      -> nothing being asked
--   requested_at > COALESCE(verified_at, 0)   -> OPEN: user is prompted
--     └─ submitted_at > COALESCE(verified_at, 0) -> user answered, AWAITING REVIEW
--   verified_at  >= requested_at              -> approved, prompt disappears
--
-- Storing the request as a TIMESTAMP rather than a boolean means a later
-- request automatically re-opens the prompt for someone who verified months ago
-- (e.g. after a dialer migration renumbers logins) without any reset step.
--
-- The superadmin can withdraw a request at any time by setting requested_at
-- back to NULL — that is the "toggle off" path, and it works whether or not the
-- user ever completed it.
-- ============================================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS profile_verify_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS profile_verify_requested_by uuid,
  ADD COLUMN IF NOT EXISTS profile_verified_at         timestamptz,
  -- what the USER proposed, held until a superadmin approves it
  ADD COLUMN IF NOT EXISTS profile_verify_submitted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS profile_verify_submitted_ids text[],
  -- the live ids as they were when the user submitted, so the reviewer sees the
  -- exact before/after they were shown rather than a value that drifted since
  ADD COLUMN IF NOT EXISTS profile_verify_previous_ids  text[],
  ADD COLUMN IF NOT EXISTS profile_verify_reviewed_by   uuid;

COMMENT ON COLUMN user_profiles.profile_verify_requested_at IS
  'When a superadmin last asked this user to verify their profile. NULL = not being asked. Prompt is open while this is later than profile_verified_at.';
COMMENT ON COLUMN user_profiles.profile_verify_requested_by IS
  'Superadmin who raised the request (audit).';
COMMENT ON COLUMN user_profiles.profile_verified_at IS
  'When a superadmin APPROVED the user submission. Superseded implicitly by a newer request.';
COMMENT ON COLUMN user_profiles.profile_verify_submitted_at IS
  'When the user answered the prompt. Their answer is held, not applied, until approved.';
COMMENT ON COLUMN user_profiles.profile_verify_submitted_ids IS
  'Dialer ids the USER proposed. Copied onto vicidial_agent_ids only on approval.';
COMMENT ON COLUMN user_profiles.profile_verify_previous_ids IS
  'Live dialer ids at submission time, so the reviewer sees the true before/after.';

-- The prompt check runs on every page load for every signed-in user, so keep it
-- index-backed. Partial: only rows with an outstanding request are of interest.
CREATE INDEX IF NOT EXISTS idx_user_profiles_verify_open
  ON public.user_profiles (user_id)
  WHERE profile_verify_requested_at IS NOT NULL;

-- The superadmin review queue reads "everything awaiting approval" across all
-- users, so index that set directly rather than scanning every profile.
CREATE INDEX IF NOT EXISTS idx_user_profiles_verify_submitted
  ON public.user_profiles (profile_verify_submitted_at)
  WHERE profile_verify_submitted_at IS NOT NULL;

INSERT INTO schema_migrations (filename, note)
VALUES ('251_profile_verification_request.sql',
        'Superadmin-requested profile verification: staff confirm their details and correct their own dialer id')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
