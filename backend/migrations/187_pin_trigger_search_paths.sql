-- ============================================================================
-- 187 — pin search_path on all trigger functions (fixes auth user deletion).
--
-- ROOT CAUSE: deleting a user from Supabase Auth cascades into public tables
-- (sales.submitted_by / compliance_reviewed_by are ON DELETE SET NULL). That
-- RI statement fires sales' STATEMENT-level trigger fn_reconcile_vin_active
-- (statement triggers fire even when 0 rows are affected). GoTrue runs as
-- supabase_auth_admin with search_path = auth, and the function references
-- "sales" unqualified → ERROR: relation "sales" does not exist → EVERY
-- auth-user deletion on this project 500s ("Database error deleting user").
--
-- FIX: pin search_path on every public trigger function so they resolve their
-- tables regardless of the caller's role/search_path. No behavior change for
-- normal app traffic (PostgREST already runs with public in scope).
-- ============================================================================

ALTER FUNCTION public.fn_reconcile_vin_active()       SET search_path = public, extensions;
ALTER FUNCTION public.audit_field_changes()           SET search_path = public, extensions;
ALTER FUNCTION public.fn_log_policy_event()           SET search_path = public, extensions;
ALTER FUNCTION public.fn_set_customer_uuid()          SET search_path = public, extensions;
ALTER FUNCTION public.fn_sync_sale_miles_num()        SET search_path = public, extensions;
ALTER FUNCTION public.fn_log_transfer_assignment()    SET search_path = public, extensions;
ALTER FUNCTION public.fn_set_transfer_customer_uuid() SET search_path = public, extensions;
