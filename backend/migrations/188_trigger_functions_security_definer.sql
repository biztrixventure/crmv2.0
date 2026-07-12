-- ============================================================================
-- 188 — trigger functions run as their owner (fixes auth user deletion, pt 2).
--
-- 187 pinned search_path, which moved the error from "relation sales does not
-- exist" to "permission denied for table sales": the triggers are SECURITY
-- INVOKER, so when GoTrue's role (supabase_auth_admin) deletes an auth user and
-- the FK cascade touches public.sales, the trigger executes AS supabase_auth_admin
-- — which has no privileges on public tables.
--
-- FIX: SECURITY DEFINER on the trigger functions so they always run with the
-- owner's (postgres) privileges, regardless of which role's statement fired
-- them. Safe because 187 already pinned their search_path (the definer-function
-- hijack vector) and each body only touches fixed public tables.
-- ============================================================================

ALTER FUNCTION public.fn_reconcile_vin_active()       SECURITY DEFINER;
ALTER FUNCTION public.audit_field_changes()           SECURITY DEFINER;
ALTER FUNCTION public.fn_log_policy_event()           SECURITY DEFINER;
ALTER FUNCTION public.fn_set_customer_uuid()          SECURITY DEFINER;
ALTER FUNCTION public.fn_sync_sale_miles_num()        SECURITY DEFINER;
ALTER FUNCTION public.fn_log_transfer_assignment()    SECURITY DEFINER;
ALTER FUNCTION public.fn_set_transfer_customer_uuid() SECURITY DEFINER;
