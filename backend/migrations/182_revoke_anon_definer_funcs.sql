-- ============================================================================
-- 182_revoke_anon_definer_funcs.sql  🔒 security hardening
-- Supabase security advisor flagged 3 SECURITY DEFINER functions still callable
-- by anon (and authenticated). mig 176 revoked "FROM anon", but Postgres grants
-- EXECUTE to PUBLIC by default — so the grant must be revoked FROM PUBLIC too.
--
--   refresh_customer_segments() / rls_auto_enable() — backend/scheduler only
--     (service_role). No client role should call them.
--   is_conversation_member(uuid,uuid) — used INSIDE chat RLS for authenticated;
--     keep authenticated + service_role, drop anon/public.
-- Apply in the Supabase SQL editor. Idempotent.
-- ============================================================================

-- backend-only utilities → service_role only
REVOKE ALL ON FUNCTION public.refresh_customer_segments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_customer_segments() TO service_role;

REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;

-- chat RLS helper → authenticated (for policy evaluation) + service_role; no anon
REVOKE ALL ON FUNCTION public.is_conversation_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated, service_role;
