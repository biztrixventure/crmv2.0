-- ============================================================================
-- 011_number_lists.sql
-- Phone number lists that managers/operations can assign to fronters.
-- Fronters see their assigned numbers and mark them as called/completed etc.
-- ============================================================================

CREATE TABLE IF NOT EXISTS number_lists (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES companies(id)   ON DELETE CASCADE,
  fronter_id    UUID        NOT NULL,
  assigned_by   UUID        NOT NULL,
  phone_number  TEXT        NOT NULL,
  customer_name TEXT,
  notes         TEXT,
  list_name     TEXT        NOT NULL DEFAULT 'Untitled List',
  status        TEXT        NOT NULL DEFAULT 'new',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT number_lists_status_check
    CHECK (status IN ('new', 'called', 'callback', 'completed', 'skip'))
);

CREATE INDEX IF NOT EXISTS idx_number_lists_company_id  ON number_lists(company_id);
CREATE INDEX IF NOT EXISTS idx_number_lists_fronter_id  ON number_lists(fronter_id);
CREATE INDEX IF NOT EXISTS idx_number_lists_status      ON number_lists(status);
CREATE INDEX IF NOT EXISTS idx_number_lists_list_name   ON number_lists(company_id, list_name);

ALTER TABLE number_lists ENABLE ROW LEVEL SECURITY;

-- Service role has full access (backend uses this)
CREATE POLICY "service_role_number_lists_all" ON number_lists
  FOR ALL USING (true);
