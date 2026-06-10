-- ============================================================================
-- 082_compliance_batches_chat_styles.sql
-- Two additions in one pass:
--   A) compliance_status_batches — tracks every Compliance Bulk Status Update
--      operation as its own batch (matching the existing upload_batches
--      pattern for Sale + Transfer imports) and stores enough payload that
--      DELETE /batches/:id can deterministically replay each sale's prior
--      state, restoring the cancellation_date / reason / chargeback fields.
--   B) chat_user_styles — per-user chat presentation overrides. SuperAdmin
--      assigns font colors individually, in bulk, or per company so the
--      chat UI can render each message in the assigned color.
--
-- Both idempotent. Safe to re-run.
-- ============================================================================

-- ── A) Compliance Bulk Status Update batches ───────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_status_batches (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by          uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  new_status          text        NOT NULL,
  reason              text,
  cancellation_reason_key text,
  cancellation_date   date,
  chargeback_date     date,
  chargeback_amount   numeric,
  applied_count       integer     NOT NULL DEFAULT 0,
  reverted_at         timestamptz,
  reverted_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  -- payload = array of per-sale snapshots so the revert pass can replay the
  -- exact previous state for every affected row:
  -- [{ "sale_id":"...", "previous_status":"...", "previous_cancellation_date":"...",
  --    "previous_cancellation_reason_key":"...", "previous_chargeback_date":"...",
  --    "previous_chargeback_amount":..., "previous_compliance_locked_at":"...",
  --    "previous_compliance_note":"..." }, ...]
  payload             jsonb       NOT NULL DEFAULT '[]'::jsonb
);

COMMENT ON TABLE  compliance_status_batches IS
  'Every Compliance Bulk Status Update operation is recorded as a batch row. The payload stores per-sale prior-state snapshots so DELETE /batches/:id can deterministically revert.';
COMMENT ON COLUMN compliance_status_batches.payload IS
  'JSONB array of prior-state snapshots per sale. Powers the revert flow without needing a separate audit table.';

CREATE INDEX IF NOT EXISTS idx_csb_created_at ON compliance_status_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_csb_created_by ON compliance_status_batches(created_by);

-- ── B) Chat user styles ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_user_styles (
  user_id     uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  font_color  text,        -- hex color "#RRGGBB" — null = system default
  set_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  set_at      timestamptz NOT NULL DEFAULT now(),
  -- Allows a future per-user theme without another migration.
  extra       jsonb       NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE  chat_user_styles IS
  'Per-user chat presentation overrides. SuperAdmin assigns through Chat Control. NULL font_color = system default.';
COMMENT ON COLUMN chat_user_styles.font_color IS
  'Hex "#RRGGBB". Validated client-side; backend stores verbatim. NULL = system default.';

CREATE INDEX IF NOT EXISTS idx_chat_styles_set_at ON chat_user_styles(set_at DESC);
