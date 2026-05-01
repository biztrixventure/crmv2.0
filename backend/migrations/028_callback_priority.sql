-- ============================================================
-- 028 — Callback priority
-- ============================================================
-- Adds a priority level (High / Medium / Low) to each callback.
-- Default is Medium so existing rows are unaffected.
-- ============================================================

ALTER TABLE callbacks
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'Medium'
  CHECK (priority IN ('High', 'Medium', 'Low'));
