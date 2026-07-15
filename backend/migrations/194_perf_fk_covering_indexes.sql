-- ============================================================================
-- 194 — Performance: covering indexes for unindexed foreign keys (hot tables).
--
-- Supabase's performance advisor flagged 61 foreign keys with no covering index.
-- An unindexed FK forces a sequential scan whenever the PARENT row is deleted or
-- updated (the FK check) and whenever a query filters/joins on that column. This
-- migration adds covering indexes for the 26 FKs on the busiest tables.
--
-- Notably this fixes slow AUTH USER DELETION: removing a user makes Postgres
-- check every table that references it (created_by / assigned_by / sender_id /
-- submitted_by / …); without these indexes each check was a full-table scan.
--
-- 100% additive and non-breaking: CREATE INDEX IF NOT EXISTS only. No data, no
-- behavior change. Index maintenance cost on these FK columns is negligible.
-- ============================================================================

-- permissions / roles (hottest — every auth check joins these)
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission        ON public.role_permissions (permission_id);
CREATE INDEX IF NOT EXISTS idx_ucr_role                           ON public.user_company_roles (role_id);
CREATE INDEX IF NOT EXISTS idx_ucr_assigned_by                    ON public.user_company_roles (assigned_by);
CREATE INDEX IF NOT EXISTS idx_upo_permission                     ON public.user_permission_overrides (permission_id);
CREATE INDEX IF NOT EXISTS idx_upo_company                        ON public.user_permission_overrides (company_id);
CREATE INDEX IF NOT EXISTS idx_custom_roles_created_by            ON public.custom_roles (created_by);
CREATE INDEX IF NOT EXISTS idx_custom_roles_parent_role_id        ON public.custom_roles (parent_role_id);

-- sales / transfers lifecycle
CREATE INDEX IF NOT EXISTS idx_sales_submitted_by                 ON public.sales (submitted_by);
CREATE INDEX IF NOT EXISTS idx_sales_compliance_reviewed_by       ON public.sales (compliance_reviewed_by);
CREATE INDEX IF NOT EXISTS idx_transfers_rejected_by              ON public.transfers (rejected_by);
CREATE INDEX IF NOT EXISTS idx_transfer_assignments_assigned_by   ON public.transfer_assignments (assigned_by);
CREATE INDEX IF NOT EXISTS idx_transfer_assignments_from_closer   ON public.transfer_assignments (from_closer_id);
CREATE INDEX IF NOT EXISTS idx_policy_events_actor                ON public.policy_events (actor_id);
CREATE INDEX IF NOT EXISTS idx_disposition_actions_config         ON public.disposition_actions (disposition_config_id);

-- QA
CREATE INDEX IF NOT EXISTS idx_qa_assignments_assigned_by         ON public.qa_assignments (assigned_by);
CREATE INDEX IF NOT EXISTS idx_qa_reviews_scorecard               ON public.qa_reviews (scorecard_id);
CREATE INDEX IF NOT EXISTS idx_qa_reviews_finalized_by            ON public.qa_reviews (finalized_by);

-- chat / email
CREATE INDEX IF NOT EXISTS idx_messages_sender                    ON public.messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_deleted_by               ON public.messages (deleted_by);
CREATE INDEX IF NOT EXISTS idx_emails_company                     ON public.emails (company_id);
CREATE INDEX IF NOT EXISTS idx_emails_reply_to                   ON public.emails (reply_to_email_id);

-- distribution / spiff / flags
CREATE INDEX IF NOT EXISTS idx_distribution_batches_company       ON public.distribution_batches (company_id);
CREATE INDEX IF NOT EXISTS idx_distribution_batches_deleted_by    ON public.distribution_batches (deleted_by);
CREATE INDEX IF NOT EXISTS idx_spiff_entries_user                 ON public.spiff_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_cff_enabled_by                     ON public.company_feature_flags (enabled_by);
CREATE INDEX IF NOT EXISTS idx_cff_disabled_by                    ON public.company_feature_flags (disabled_by);
