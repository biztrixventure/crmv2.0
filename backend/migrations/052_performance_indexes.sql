-- 052_performance_indexes.sql
-- Performance indexes for the hot dashboard/list/validation paths. All IF NOT
-- EXISTS so this is safe to re-run and won't clash with indexes from earlier
-- migrations. Apply in the Supabase SQL editor.

-- ── transfers ──────────────────────────────────────────────────────────────────
-- Status-only counts (superadmin dashboard) + global date sorting/ranges.
CREATE INDEX IF NOT EXISTS idx_transfers_status          ON transfers (status);
CREATE INDEX IF NOT EXISTS idx_transfers_company_status  ON transfers (company_id, status);
CREATE INDEX IF NOT EXISTS idx_transfers_created_at      ON transfers (created_at);
-- Duplicate-detection + bulk-sale matching key.
CREATE INDEX IF NOT EXISTS idx_transfers_normalized_phone ON transfers (normalized_phone);

-- ── sales ────────────────────────────────────────────────────────────────────
-- transfer_id is used everywhere (sale↔transfer join, bulk validation, compliance
-- enrichment) but was previously UNINDEXED → sequential scans.
CREATE INDEX IF NOT EXISTS idx_sales_transfer_id   ON sales (transfer_id);
CREATE INDEX IF NOT EXISTS idx_sales_status        ON sales (status);
CREATE INDEX IF NOT EXISTS idx_sales_created_at    ON sales (created_at);

-- ── dispositions ───────────────────────────────────────────────────────────────
-- Transfer list enrichment looks up the latest disposition per transfer.
CREATE INDEX IF NOT EXISTS idx_disposition_actions_transfer ON disposition_actions (transfer_id);

-- ── chat ────────────────────────────────────────────────────────────────────────
-- Conversation list (my memberships) + message history paging.
CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON conversation_members (user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created     ON messages (conversation_id, created_at);
