-- ============================================================================
-- 179_close_authenticated_cross_tenant_leak.sql   🔴 FIXES GitHub #1
-- LIVE-CONFIRMED leak: an authenticated user with ZERO company memberships read
-- 36,317 qa_assignments rows (every company's QA data) + vicidial_config via the
-- raw REST API — because these tables carried a permissive `USING (true)` policy
-- granted to the authenticated/public role. Several were `FOR ALL` → they were
-- WRITE-open too (any logged-in user could INSERT/UPDATE/DELETE via REST).
--
-- Fix: drop the `USING(true)` policies. RLS stays ENABLED with no permissive
-- policy → deny-all for anon/authenticated. The backend is UNAFFECTED: it uses
-- the service_role key, which BYPASSES RLS. Verified the frontend never reads
-- these tables directly (no supabase.from()/realtime channel) — all access is
-- via the Express API. Realtime keep-tables (notifications, messages, callbacks)
-- and own/member-scoped tables are deliberately untouched.
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================

-- QA (the 36k-row leak) --------------------------------------------------------
DROP POLICY IF EXISTS qa_assignments_all   ON qa_assignments;
DROP POLICY IF EXISTS qa_reviews_all       ON qa_reviews;
DROP POLICY IF EXISTS qa_review_scores_all ON qa_review_scores;
DROP POLICY IF EXISTS qa_scorecards_all    ON qa_scorecards;

-- Dialer config / mapping / queue ---------------------------------------------
DROP POLICY IF EXISTS vicidial_config_all      ON vicidial_config;
DROP POLICY IF EXISTS vicidial_dispo_map_all   ON vicidial_dispo_map;
DROP POLICY IF EXISTS vcdq_all                 ON vicidial_closer_dispo_queue;

-- Customer PII / distribution / recordings ------------------------------------
DROP POLICY IF EXISTS dbitem_all  ON distribution_batch_items;   -- (grant already revoked by 176; drop policy too)
DROP POLICY IF EXISTS dbatch_all  ON distribution_batches;
DROP POLICY IF EXISTS service_role_number_lists_all ON number_lists;
DROP POLICY IF EXISTS prm_all     ON portal_recording_meta;
DROP POLICY IF EXISTS src_all     ON sale_recording_confirmations;

-- Commission / audit / ops / config -------------------------------------------
DROP POLICY IF EXISTS rt_read_spiff_entries      ON spiff_entries;      -- per-user commissions, no realtime
DROP POLICY IF EXISTS authenticated_reads_events ON events;            -- calendar, served via backend
DROP POLICY IF EXISTS field_audit_log_service_all ON field_audit_log;
DROP POLICY IF EXISTS data_cleanup_ops_service_all ON data_cleanup_operations;
DROP POLICY IF EXISTS faq_categories_all  ON faq_categories;
DROP POLICY IF EXISTS note_sc_all         ON note_shortcodes;
DROP POLICY IF EXISTS script_categories_all ON script_categories;

-- ── NOTE (lower-severity follow-up, intentionally NOT changed here) ──
-- These still allow authenticated cross-tenant reads but are low-sensitivity
-- broadcast/config (not customer/financial PII); revisit separately:
--   announcements(rt_read_announcements), marquee_items(rt_read_marquee),
--   spiff_campaigns(rt_read_spiff), permissions, form_fields.
