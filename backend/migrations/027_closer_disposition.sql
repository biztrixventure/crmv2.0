-- 027_closer_disposition.sql
-- Adds a dedicated column for the disposition a closer selects when creating a sale.
-- This is separate from call_dispositions (which tracks transfer review outcomes).
ALTER TABLE sales ADD COLUMN IF NOT EXISTS closer_disposition TEXT;
