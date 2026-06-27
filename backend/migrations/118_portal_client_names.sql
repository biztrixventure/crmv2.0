-- ============================================================================
-- 118_portal_client_names.sql
-- Scope a recording-portal login by CLIENT (sales.client_name) in addition to
-- closers. A portal user sees sales matching their assigned closers AND/OR the
-- selected clients. Empty client_names = no client restriction (closer scope only).
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================
ALTER TABLE portal_clients ADD COLUMN IF NOT EXISTS client_names text[] NOT NULL DEFAULT '{}';
