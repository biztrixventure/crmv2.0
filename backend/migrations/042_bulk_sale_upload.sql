-- 042_bulk_sale_upload.sql
-- Bulk Sale Data Uploader (superadmin). Reuses the existing upload_batches and
-- upload_column_mappings infrastructure from the transfer uploader (041).
--   * upload_batches.kind distinguishes 'transfer' vs 'sale' batches
--   * sales.upload_batch_id tags ONLY bulk-INSERTED sales (updates to existing
--     sales are never tagged), so deleting a sale batch removes exactly the
--     rows that were inserted — never manual or updated ones
--   * column mapping for sales is a separate global row (scope='sales')

ALTER TABLE upload_batches
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'transfer';

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS upload_batch_id uuid REFERENCES upload_batches(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sales_upload_batch ON sales(upload_batch_id);

-- Speeds up the transfer→sale phone match during validation.
CREATE INDEX IF NOT EXISTS idx_sales_customer_phone ON sales ((regexp_replace(customer_phone, '\D', '', 'g')));
