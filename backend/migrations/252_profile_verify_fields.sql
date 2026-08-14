-- ============================================================================
-- 252_profile_verify_fields.sql
--
-- Extends the profile-verification prompt (251) so the superadmin chooses WHICH
-- details each person is asked to confirm, instead of the dialer id being the
-- only editable field.
--
--   profile_verify_fields = ['vicidial_agent_id']          -> dialer id only
--   profile_verify_fields = ['vicidial_agent_id','name']   -> also their name
--
-- The field set is stored PER REQUEST rather than as one global setting, so a
-- fronter team can be asked for their dialer id while another group is asked to
-- fix their name too, without one choice overwriting the other. NULL keeps the
-- original behaviour (dialer id only), so requests raised before this migration
-- keep working untouched.
--
-- Name is a PROPOSAL like everything else here — it lands in the submitted_*
-- columns and only reaches first_name/last_name when a superadmin approves.
-- Email is deliberately NOT offerable: it is the login identity, changing it
-- would break sign-in, and it belongs to auth rather than the profile row.
-- ============================================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS profile_verify_fields               text[],
  ADD COLUMN IF NOT EXISTS profile_verify_submitted_first_name text,
  ADD COLUMN IF NOT EXISTS profile_verify_submitted_last_name  text;

COMMENT ON COLUMN user_profiles.profile_verify_fields IS
  'Which fields this user was asked to confirm: vicidial_agent_id and/or name. NULL = dialer id only (pre-252 behaviour).';
COMMENT ON COLUMN user_profiles.profile_verify_submitted_first_name IS
  'First name the USER proposed. Copied onto first_name only on approval.';
COMMENT ON COLUMN user_profiles.profile_verify_submitted_last_name IS
  'Last name the USER proposed. Copied onto last_name only on approval.';

INSERT INTO schema_migrations (filename, note)
VALUES ('252_profile_verify_fields.sql',
        'Superadmin picks which fields the profile-verification prompt asks for (dialer id and/or name)')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
