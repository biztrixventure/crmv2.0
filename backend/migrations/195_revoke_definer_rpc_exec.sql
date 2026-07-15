-- ============================================================================
-- 195 — Security: revoke public RPC access to SECURITY DEFINER functions.
--
-- Supabase's security advisor flagged 9 SECURITY DEFINER functions that anon /
-- authenticated can call via PostgREST RPC (/rest/v1/rpc/<fn>). A DEFINER
-- function runs with the OWNER's privileges, so exposing it to public roles is a
-- privilege / info-disclosure surface (same class mig 176/182 closed). Their
-- search_path is already pinned (migs 187/188) — only the EXECUTE grant is open.
--
-- Safe + non-breaking, verified:
--   • 7 are TRIGGER functions (fn_* / audit_field_changes). Triggers fire via the
--     engine regardless of EXECUTE grants, and the backend never calls them via
--     RPC — revoke from everyone.
--   • app_user_company_ids / is_conversation_member are RLS helpers evaluated for
--     the `authenticated` role (realtime + any direct RLS read) — KEEP
--     authenticated, drop only anon/PUBLIC.
--   • The frontend never calls supabase .rpc() (it uses the Express API on the
--     service role); the service role bypasses RLS and fires triggers directly.
-- ============================================================================

-- ── trigger functions — no role needs RPC EXECUTE ───────────────────────────
REVOKE EXECUTE ON FUNCTION public.audit_field_changes()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_log_policy_event()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_log_transfer_assignment()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_reconcile_vin_active()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_set_customer_uuid()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_set_transfer_customer_uuid()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_sync_sale_miles_num()         FROM PUBLIC, anon, authenticated;

-- ── RLS helpers — drop anon/PUBLIC, keep authenticated (policies call these) ──
REVOKE EXECUTE ON FUNCTION public.app_user_company_ids(uuid)       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.app_user_company_ids(uuid)       TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated;
