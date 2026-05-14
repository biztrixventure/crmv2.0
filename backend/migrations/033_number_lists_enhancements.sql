-- 033: Add assignment_day, mapped_data, and transfer linkage to number_lists
ALTER TABLE number_lists
  ADD COLUMN IF NOT EXISTS assignment_day DATE,
  ADD COLUMN IF NOT EXISTS mapped_data    JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS transfer_id    UUID REFERENCES transfers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_number_lists_assignment_day ON number_lists(assignment_day);
CREATE INDEX IF NOT EXISTS idx_number_lists_transfer_id    ON number_lists(transfer_id);
