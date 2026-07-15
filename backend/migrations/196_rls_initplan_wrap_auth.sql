-- ============================================================================
-- 196 — Performance: wrap auth.*() in RLS policies with a scalar subselect.
--
-- Supabase performance advisor `auth_rls_initplan`: 66 RLS policies call
-- auth.uid() / auth.role() DIRECTLY, so Postgres re-evaluates the function for
-- EVERY row scanned. Wrapping the call in a scalar subquery — (select auth.uid())
-- — makes the planner evaluate it ONCE per query (an InitPlan) and reuse the
-- constant. On large scans (sales, transfers, messages…) this is a big win.
--
-- BEHAVIOUR IS IDENTICAL: the value is the same, only evaluated once instead of
-- per-row. These ALTER POLICY statements were generated from the LIVE policy
-- definitions (pg_policies) with only the auth.*() calls rewritten — roles,
-- command, and every other predicate are byte-for-byte unchanged. Fully
-- reversible and non-breaking; safe to run on the live DB.
-- ============================================================================

ALTER POLICY own_announcement_reads ON public.announcement_reads USING (((select auth.uid()) = user_id));
ALTER POLICY service_role_can_insert_logs ON public.audit_logs WITH CHECK (((select auth.role()) = 'service_role'::text));
ALTER POLICY service_role_can_view_logs ON public.audit_logs USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY managers_see_company_callbacks ON public.callbacks USING ((company_id IN ( SELECT user_company_roles.company_id    FROM user_company_roles   WHERE ((user_company_roles.user_id = (select auth.uid())) AND (user_company_roles.is_active = true) AND (user_company_roles.role_id IN ( SELECT custom_roles.id            FROM custom_roles           WHERE (custom_roles.level = ANY (ARRAY['manager'::role_level, 'company_admin'::role_level, 'superadmin'::role_level, 'closer_manager'::role_level, 'operations_manager'::role_level]))))))));
ALTER POLICY service_role_callbacks_all ON public.callbacks USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY users_create_own_callbacks ON public.callbacks WITH CHECK ((user_id = (select auth.uid())));
ALTER POLICY users_delete_own_callbacks ON public.callbacks USING ((user_id = (select auth.uid())));
ALTER POLICY users_see_own_callbacks ON public.callbacks USING ((user_id = (select auth.uid())));
ALTER POLICY users_update_own_callbacks ON public.callbacks USING ((user_id = (select auth.uid())));
ALTER POLICY own_chat_settings ON public.chat_user_settings USING (((select auth.uid()) = user_id));
ALTER POLICY service_role_can_view_all_companies ON public.companies USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY users_can_view_their_companies ON public.companies USING ((id IN ( SELECT user_company_roles.company_id    FROM user_company_roles   WHERE ((user_company_roles.user_id = (select auth.uid())) AND (user_company_roles.is_active = true)))));
ALTER POLICY invitee_or_inviter_reads_invite ON public.conversation_invites USING (((invitee_id = (select auth.uid())) OR (inviter_id = (select auth.uid()))));
ALTER POLICY member_reads_members ON public.conversation_members USING (is_conversation_member(conversation_id, (select auth.uid())));
ALTER POLICY member_reads_conversation ON public.conversations USING (is_conversation_member(id, (select auth.uid())));
ALTER POLICY service_role_can_delete_roles ON public.custom_roles USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY service_role_can_insert_roles ON public.custom_roles WITH CHECK (((select auth.role()) = 'service_role'::text));
ALTER POLICY service_role_can_update_roles ON public.custom_roles USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY users_can_view_company_roles ON public.custom_roles USING (((company_id IS NULL) OR (company_id IN ( SELECT user_company_roles.company_id    FROM user_company_roles   WHERE ((user_company_roles.user_id = (select auth.uid())) AND (user_company_roles.is_active = true))))));
ALTER POLICY authenticated_users_can_view_forms ON public.form_fields USING (((select auth.role()) = ANY (ARRAY['authenticated'::text, 'service_role'::text])));
ALTER POLICY service_role_can_delete_forms ON public.form_fields USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY service_role_can_insert_forms ON public.form_fields WITH CHECK (((select auth.role()) = 'service_role'::text));
ALTER POLICY service_role_can_update_forms ON public.form_fields USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY member_reads_reactions ON public.message_reactions USING ((EXISTS ( SELECT 1    FROM messages m   WHERE ((m.id = message_reactions.message_id) AND is_conversation_member(m.conversation_id, (select auth.uid()))))));
ALTER POLICY member_reads_messages ON public.messages USING (is_conversation_member(conversation_id, (select auth.uid())));
ALTER POLICY member_sends_messages ON public.messages WITH CHECK (((sender_id = (select auth.uid())) AND (EXISTS ( SELECT 1    FROM conversation_members m   WHERE ((m.conversation_id = messages.conversation_id) AND (m.user_id = (select auth.uid())) AND (m.is_muted = false)))) AND (NOT (EXISTS ( SELECT 1    FROM conversations c   WHERE ((c.id = messages.conversation_id) AND (c.is_locked = true))))) AND (NOT (EXISTS ( SELECT 1    FROM chat_user_settings s   WHERE ((s.user_id = (select auth.uid())) AND (s.is_chat_banned = true)))))));
ALTER POLICY service_role_can_delete_notifications ON public.notifications USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY service_role_can_insert_notifications ON public.notifications WITH CHECK (((select auth.role()) = 'service_role'::text));
ALTER POLICY users_see_own_notifications ON public.notifications USING ((user_id = (select auth.uid())));
ALTER POLICY users_update_own_notifications ON public.notifications USING ((user_id = (select auth.uid())));
ALTER POLICY authenticated_users_can_view_permissions ON public.permissions USING (((select auth.role()) = ANY (ARRAY['authenticated'::text, 'service_role'::text])));
ALTER POLICY service_role_push_all ON public.push_subscriptions USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY users_manage_own_push_subs ON public.push_subscriptions USING ((user_id = (select auth.uid())));
ALTER POLICY service_role_can_delete_permissions ON public.role_permissions USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY service_role_can_insert_permissions ON public.role_permissions WITH CHECK (((select auth.role()) = 'service_role'::text));
ALTER POLICY service_role_can_update_permissions ON public.role_permissions USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY users_can_view_role_permissions ON public.role_permissions USING ((role_id IN ( SELECT custom_roles.id    FROM custom_roles   WHERE ((custom_roles.company_id IS NULL) OR (custom_roles.company_id IN ( SELECT user_company_roles.company_id            FROM user_company_roles           WHERE ((user_company_roles.user_id = (select auth.uid())) AND (user_company_roles.is_active = true))))))));
ALTER POLICY service_role_sale_configs_all ON public.sale_configs USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY users_view_sale_configs ON public.sale_configs USING (((company_id IS NULL) OR (company_id IN ( SELECT user_company_roles.company_id    FROM user_company_roles   WHERE ((user_company_roles.user_id = (select auth.uid())) AND (user_company_roles.is_active = true))))));
ALTER POLICY closers_can_create_sales ON public.sales WITH CHECK (((created_by = (select auth.uid())) AND (company_id IN ( SELECT user_company_roles.company_id    FROM user_company_roles   WHERE ((user_company_roles.user_id = (select auth.uid())) AND (user_company_roles.is_active = true))))));
ALTER POLICY closers_can_view_own_sales ON public.sales USING (((created_by = (select auth.uid())) AND (company_id IN ( SELECT user_company_roles.company_id    FROM user_company_roles   WHERE ((user_company_roles.user_id = (select auth.uid())) AND (user_company_roles.is_active = true))))));
ALTER POLICY managers_can_view_team_sales ON public.sales USING ((company_id IN ( SELECT user_company_roles.company_id    FROM user_company_roles   WHERE ((user_company_roles.user_id = (select auth.uid())) AND (user_company_roles.is_active = true) AND (user_company_roles.role_id IN ( SELECT custom_roles.id            FROM custom_roles           WHERE (custom_roles.level = ANY (ARRAY['manager'::role_level, 'company_admin'::role_level, 'superadmin'::role_level]))))))));
ALTER POLICY sales_creators_can_update ON public.sales USING (((created_by = (select auth.uid())) OR (company_id IN ( SELECT user_company_roles.company_id    FROM user_company_roles   WHERE ((user_company_roles.user_id = (select auth.uid())) AND (user_company_roles.is_active = true) AND (user_company_roles.role_id IN ( SELECT custom_roles.id            FROM custom_roles           WHERE (custom_roles.level = ANY (ARRAY['manager'::role_level, 'company_admin'::role_level, 'superadmin'::role_level])))))))));
ALTER POLICY service_role_can_delete_sales ON public.sales USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY service_role_can_insert_sales ON public.sales WITH CHECK (((select auth.role()) = 'service_role'::text));
ALTER POLICY service_role_can_update_sales ON public.sales USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY closers_can_view_assigned_transfers ON public.transfers USING (((assigned_to = (select auth.uid())) AND (company_id IN ( SELECT user_company_roles.company_id    FROM user_company_roles   WHERE ((user_company_roles.user_id = (select auth.uid())) AND (user_company_roles.is_active = true))))));
ALTER POLICY fronters_can_create_transfers ON public.transfers WITH CHECK (((created_by = (select auth.uid())) AND (company_id IN ( SELECT user_company_roles.company_id    FROM user_company_roles   WHERE ((user_company_roles.user_id = (select auth.uid())) AND (user_company_roles.is_active = true))))));
ALTER POLICY fronters_can_view_own_transfers ON public.transfers USING (((created_by = (select auth.uid())) AND (company_id IN ( SELECT user_company_roles.company_id    FROM user_company_roles   WHERE ((user_company_roles.user_id = (select auth.uid())) AND (user_company_roles.is_active = true))))));
ALTER POLICY managers_can_view_team_transfers ON public.transfers USING ((company_id IN ( SELECT user_company_roles.company_id    FROM user_company_roles   WHERE ((user_company_roles.user_id = (select auth.uid())) AND (user_company_roles.is_active = true) AND (user_company_roles.role_id IN ( SELECT custom_roles.id            FROM custom_roles           WHERE (custom_roles.level = ANY (ARRAY['manager'::role_level, 'company_admin'::role_level, 'superadmin'::role_level]))))))));
ALTER POLICY service_role_can_delete_transfers ON public.transfers USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY service_role_can_insert_transfers ON public.transfers WITH CHECK (((select auth.role()) = 'service_role'::text));
ALTER POLICY service_role_can_update_transfers ON public.transfers USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY transfer_creators_can_update ON public.transfers USING (((created_by = (select auth.uid())) OR (assigned_to = (select auth.uid())) OR (company_id IN ( SELECT user_company_roles.company_id    FROM user_company_roles   WHERE ((user_company_roles.user_id = (select auth.uid())) AND (user_company_roles.is_active = true) AND (user_company_roles.role_id IN ( SELECT custom_roles.id            FROM custom_roles           WHERE (custom_roles.level = ANY (ARRAY['manager'::role_level, 'company_admin'::role_level, 'superadmin'::role_level])))))))));
ALTER POLICY service_role_can_delete_user_roles ON public.user_company_roles USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY service_role_can_insert_user_roles ON public.user_company_roles WITH CHECK (((select auth.role()) = 'service_role'::text));
ALTER POLICY service_role_can_update_user_roles ON public.user_company_roles USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY users_can_view_company_members ON public.user_company_roles USING (((user_id = (select auth.uid())) OR (company_id IN ( SELECT app_user_company_ids((select auth.uid())) AS app_user_company_ids))));
ALTER POLICY user_preferences_owner_all ON public.user_preferences USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY service_role_can_delete_profiles ON public.user_profiles USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY service_role_can_insert_profiles ON public.user_profiles WITH CHECK (((select auth.role()) = 'service_role'::text));
ALTER POLICY service_role_can_update_profiles ON public.user_profiles USING (((select auth.role()) = 'service_role'::text));
ALTER POLICY users_can_update_own_profile ON public.user_profiles USING ((user_id = (select auth.uid())));
ALTER POLICY users_can_view_own_profile ON public.user_profiles USING ((user_id = (select auth.uid())));
