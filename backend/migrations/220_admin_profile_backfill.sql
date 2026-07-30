-- ============================================================================
-- 220_admin_profile_backfill.sql
-- Give env-bootstrapped superadmins (and readonly admins) a user_profiles row.
--
-- ── THE BUG ─────────────────────────────────────────────────────────────────
-- Superadmins are bootstrapped from SUPERADMIN_EMAIL. syncSuperadminMetadata
-- (backend/server.js) stamps app_metadata.role and nothing else — it never
-- creates a profile. Measured on 2026-07-30: 4 of 4 stamped superadmins had NO
-- user_profiles row at all. The one readonly_admin created through the normal
-- user-creation flow had one.
--
-- The row missing (not the NAME missing) is the whole defect, and it is why
-- the symptom is everywhere at once: ~200 read sites across ~70 backend files
-- resolve a display name by joining user_profiles and falling back to
-- 'Unknown' / 'User' / the raw email. Two of them are worse than cosmetic:
--
--   emails.js /send   — validates recipients with
--                       `select user_id from user_profiles where user_id in (…)`
--                       and 400s "Unknown recipient(s)". A superadmin could not
--                       RECEIVE internal mail at all.
--   chatService.js    — searchDirectory's default branch scans user_profiles by
--                       name, so a superadmin never appeared in the chat picker.
--                       (That function already has a comment expecting env-level
--                       superadmins to stay searchable — they never could.)
--
-- Creating the row fixes every one of those sites with no per-site edits.
--
-- ── WHY BOTH A MIGRATION AND A STARTUP HOOK ─────────────────────────────────
-- server.js now also ensures the row on boot (ensureAdminProfiles, called right
-- after the two metadata syncs), which is the durable bootstrap: it covers a
-- brand-new deploy, a fresh Supabase project, and any email ADDED to
-- SUPERADMIN_EMAIL later. This migration exists because that hook only helps
-- once the backend redeploys, and because a backfill that already ran is one
-- less thing depending on a startup path that swallows its own errors.
-- Idempotent + additive: safe to run before, after, or twice.
--
-- ── SEEDED NAME ─────────────────────────────────────────────────────────────
-- A row with NULL names still renders 'Unknown', so the backfill seeds a
-- placeholder from the email local part with digits stripped and title-cased
-- (superadmin867673@… → "Superadmin", wajid@… → "Wajid"). A superadmin can
-- rename any admin account afterwards in AdminPanel → User Control Center →
-- Admin Accounts → Account → Display name.
--
-- ── WHO IS EXCLUDED, AND WHY IT MATTERS ─────────────────────────────────────
-- ONLY accounts stamped app_metadata.role = superadmin | readonly_admin.
-- The same live check found 3 other profile-less auth users carrying
-- app_metadata.portal_client = true — external client-recording-portal logins
-- (migration 116). Those must NEVER get a user_profiles row: the chat directory
-- and the mail recipient picker are both driven by that table, so a profile row
-- would make an outside client searchable and mailable by staff. The
-- portal_client guard below is a security boundary, not tidiness.
--
-- Two further profile-less accounts are ordinary users with no role assignment
-- and no admin stamp; they are out of scope and deliberately untouched.
--
-- Apply: paste into the Supabase SQL editor. Plain DML, no CONCURRENTLY, no
-- locks worth naming — user_profiles is 231 rows.
-- ============================================================================

INSERT INTO user_profiles (user_id, first_name, last_name)
SELECT
  u.id,
  -- email local part, non-letters removed, title-cased; never blank
  COALESCE(
    NULLIF(initcap(regexp_replace(split_part(u.email, '@', 1), '[^a-zA-Z]+', '', 'g')), ''),
    'Admin'
  ),
  NULL
FROM auth.users u
WHERE u.raw_app_meta_data->>'role' IN ('superadmin', 'readonly_admin')
  AND COALESCE((u.raw_app_meta_data->>'portal_client')::boolean, false) = false
  AND NOT EXISTS (SELECT 1 FROM user_profiles p WHERE p.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;

-- ── post-apply verification ─────────────────────────────────────────────────
-- Expect zero rows: every stamped admin now has a profile.
--   SELECT u.email
--     FROM auth.users u LEFT JOIN user_profiles p ON p.user_id = u.id
--    WHERE u.raw_app_meta_data->>'role' IN ('superadmin','readonly_admin')
--      AND p.user_id IS NULL;
--
-- Expect the 3 portal_client rows to still have NO profile (the guard held):
--   SELECT u.email, (p.user_id IS NULL) AS still_no_profile
--     FROM auth.users u LEFT JOIN user_profiles p ON p.user_id = u.id
--    WHERE (u.raw_app_meta_data->>'portal_client')::boolean IS TRUE;
