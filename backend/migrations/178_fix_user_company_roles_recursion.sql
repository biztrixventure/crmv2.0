-- ============================================================================
-- 178_fix_user_company_roles_recursion.sql   🔴 FIXES GitHub #2 (42P17)
-- The SELECT policy on user_company_roles queried user_company_roles inside its
-- own USING clause → infinite recursion. LIVE-CONFIRMED: an authenticated REST
-- read of sales/transfers/user_company_roles returned
--   HTTP 500  42P17 infinite recursion detected in policy for relation
--             "user_company_roles"
--
-- Standard fix: move the membership lookup into a SECURITY DEFINER function that
-- reads the table with RLS bypassed (owner context), so the policy no longer
-- self-references. This also unblocks every dependent policy (sales, transfers,
-- callbacks, companies, custom_roles, role_permissions, sale_configs) that
-- sub-queries user_company_roles — their semantics are unchanged; they simply
-- stop inheriting the recursion.
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================

-- 1. Membership helper. SECURITY DEFINER → runs as owner (bypasses RLS) → the
--    policy that calls it can read user_company_roles without re-entering RLS.
CREATE OR REPLACE FUNCTION app_user_company_ids(p_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id
  FROM user_company_roles
  WHERE user_id = p_uid AND is_active = true;
$$;

REVOKE ALL ON FUNCTION app_user_company_ids(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION app_user_company_ids(uuid) TO authenticated, service_role;

-- 2. Replace the self-recursive SELECT policy with a non-recursive one.
DROP POLICY IF EXISTS users_can_view_company_members ON user_company_roles;
CREATE POLICY users_can_view_company_members ON user_company_roles
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR company_id IN (SELECT app_user_company_ids(auth.uid()))
  );
