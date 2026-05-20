-- 036_multi_car_sales.sql
-- Multi-car sales: one customer/transfer can produce multiple sale records,
-- one per vehicle. Two schema changes:
--   1. form_fields.repeats_per_car — superadmin marks vehicle/deal fields that
--      duplicate per car. Personal fields (name/address/zip) stay single.
--   2. Drop the UNIQUE constraint on sales.transfer_id so several sales can share
--      the same transfer. The foreign key to transfers is preserved.

-- 1. Per-field "repeats per car" flag --------------------------------------------
ALTER TABLE form_fields
  ADD COLUMN IF NOT EXISTS repeats_per_car BOOLEAN NOT NULL DEFAULT false;

-- 2. Allow multiple sales per transfer -------------------------------------------
-- The original schema declared transfer_id as `UUID UNIQUE`, which Postgres backs
-- with an auto-named constraint (typically sales_transfer_id_key). The exact name
-- can differ between environments, so discover and drop any single-column UNIQUE
-- constraint on transfer_id while leaving the FK intact.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel      ON rel.oid = con.conrelid
    JOIN pg_attribute att  ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'sales'
      AND con.contype  = 'u'
      AND att.attname  = 'transfer_id'
      AND array_length(con.conkey, 1) = 1
  LOOP
    EXECUTE format('ALTER TABLE sales DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- Belt-and-suspenders: drop a standalone unique index if one exists.
DROP INDEX IF EXISTS sales_transfer_id_key;

-- Helpful for the "list sales by transfer" enrichment queries now that the
-- relationship is one-to-many.
CREATE INDEX IF NOT EXISTS idx_sales_transfer_id ON sales(transfer_id);
