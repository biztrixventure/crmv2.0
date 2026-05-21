-- 041_bulk_upload.sql
-- Bulk Transfer Data Uploader (superadmin). Mirrors existing patterns:
--   * transfers stay the source of truth (no new transfer storage model)
--   * each bulk-inserted transfer is tagged with an upload_batch_id so test
--     uploads can be deleted cleanly without ever touching manual records
--   * a single global column-mapping row, like form_templates

-- Batch metadata: one row per upload, for the delete-by-batch UI.
CREATE TABLE IF NOT EXISTS upload_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name       text,
  uploaded_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  total_rows      integer NOT NULL DEFAULT 0,
  inserted_count  integer NOT NULL DEFAULT 0,
  skipped_count   integer NOT NULL DEFAULT 0,
  conflict_count  integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Tag each bulk transfer with its batch. ON DELETE CASCADE means deleting a
-- batch row removes exactly its transfers (and their sales cascade in turn).
-- NULL upload_batch_id = a normal, manually-created transfer (untouched by delete).
ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS upload_batch_id uuid REFERENCES upload_batches(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_transfers_upload_batch ON transfers(upload_batch_id);

-- Speeds up duplicate detection: normalized CLI/phone is stored at
-- form_data.cli_number on every bulk insert.
CREATE INDEX IF NOT EXISTS idx_transfers_cli ON transfers ((form_data->>'cli_number'));

-- Global, single-row column mapping (scope='global'), like a settings row.
CREATE TABLE IF NOT EXISTS upload_column_mappings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       text NOT NULL UNIQUE DEFAULT 'global',
  mapping     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
