-- ============================================================================
-- 176_security_revoke_anon_data.sql  🔴 SECURITY — apply ASAP.
-- Closes a confirmed data leak: the PUBLIC anon key (embedded in the frontend
-- JS bundle) could read customer PII via SECURITY DEFINER views + permissive-RLS
-- tables through the REST API (verified: v_customer_segments 48k rows,
-- v_compliance_transfer_records 57k, v_sales_dnc 6k, distribution_batch_items 1k).
--
-- Safe because: the backend uses the SERVICE ROLE for all data; the frontend
-- reads data through the Express API, and only uses the Supabase client for AUTH
-- (GoTrue, no table grants) + Realtime, which subscribes as `authenticated`
-- AFTER login. `anon` needs NO data/RPC access. (Verified: the frontend already
-- gets 0 rows for business_config/user_profiles as anon and works fine.)
-- Idempotent.
-- ============================================================================

-- 1. Strip anon of ALL data + RPC access in the public schema.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE ALL ON ALL ROUTINES  IN SCHEMA public FROM anon;
-- and stop future objects from auto-granting to anon
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- 2. The SECURITY DEFINER views bypass RLS entirely — they leaked to
-- `authenticated` too (any logged-in user could read every customer). The
-- backend reads them via service_role, so no client role needs them.
REVOKE ALL ON public.v_customer_segments           FROM anon, authenticated;
REVOKE ALL ON public.v_compliance_transfer_records FROM anon, authenticated;
REVOKE ALL ON public.v_sales_dnc                   FROM anon, authenticated;

-- 3. Distribution-batch tables carry raw phones/names — backend-only.
REVOKE ALL ON public.distribution_batches     FROM anon, authenticated;
REVOKE ALL ON public.distribution_batch_items FROM anon, authenticated;

-- NOTE (follow-up, not done here to avoid breaking Realtime): many app tables
-- still have `USING (true)` RLS + `authenticated` grants, so a LOGGED-IN user
-- could read cross-tenant data via raw REST. The safe next step is to REVOKE
-- authenticated on every table EXCEPT the Realtime-subscribed ones
-- (callbacks, emails, notifications, chat_*), and fix the recursive
-- user_company_roles RLS policy. Left as a separate, tested change.
