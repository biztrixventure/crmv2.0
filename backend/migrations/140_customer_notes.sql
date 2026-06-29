-- ============================================================================
-- 140_customer_notes.sql
-- Superadmin (and anyone granted tool_customer_profiles) can attach freeform
-- notes to a customer — keyed by customer_uuid (the canonical identity; there is
-- no customers table). Pinned notes float to the top. Read in the Customer
-- Profile "Notes" section. No trigger / app-write only.
-- ============================================================================
CREATE TABLE IF NOT EXISTS customer_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_uuid uuid NOT NULL,
  author_id     uuid,
  body          text NOT NULL,
  pinned        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_notes_uuid ON customer_notes (customer_uuid, pinned DESC, created_at DESC);

NOTIFY pgrst, 'reload schema';
