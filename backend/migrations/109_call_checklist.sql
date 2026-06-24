-- ============================================================================
-- 109_call_checklist.sql
-- Call-checklist questions: a list of prompts a closer ticks off DURING a call
-- in a small floating panel. Compliance (and superadmin) CRUD them. The ticking
-- is ephemeral on the client — nothing about who/what/when is ever logged.
-- Idempotent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS call_checklist_questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text        text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_call_checklist_active ON call_checklist_questions (is_active, sort_order);
