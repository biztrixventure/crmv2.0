-- 048_transfer_normalized_phone.sql
-- Fronter-scoped duplicate-transfer detection. A canonical last-10-digit phone
-- column + an index on (company_id, created_by, normalized_phone) makes the
-- per-fronter "have I already transferred this number?" lookup fast and exact.
-- Matching is ALWAYS scoped to the same fronter (created_by) + company — never
-- across fronters or companies.

ALTER TABLE transfers ADD COLUMN IF NOT EXISTS normalized_phone text;

-- Backfill from whichever phone key the form used (bulk rows already store the
-- normalized cli_number; manual rows use Phone/customer_phone/etc.).
UPDATE transfers
   SET normalized_phone = NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(
         form_data->>'cli_number', form_data->>'customer_phone', form_data->>'Phone',
         form_data->>'phone', form_data->>'Mobile', form_data->>'PhoneNumber',
         form_data->>'phone_number', form_data->>'CellPhone', ''), '\D', '', 'g'), 10), '')
 WHERE normalized_phone IS NULL;

CREATE INDEX IF NOT EXISTS idx_transfers_fronter_phone
  ON transfers (company_id, created_by, normalized_phone);
