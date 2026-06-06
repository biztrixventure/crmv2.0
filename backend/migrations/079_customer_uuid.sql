-- ============================================================================
-- 079_customer_uuid.sql
-- Closes G17 / G21 / G26 / G27 in one stroke: gives every sale a stable
-- lifetime-customer identifier derived from the normalized phone number,
-- so parent-company / compliance reports can roll up a single customer's
-- activity across every fronter company, closer company, and re-front the
-- system has ever recorded.
--
-- Identity model:
--   customer_uuid = uuidv5(NAMESPACE_BIZTRIX_CUSTOMER, normalized_phone)
--
-- The namespace is a fixed UUID baked into this migration so the same
-- normalized phone always produces the same customer_uuid across every
-- deployment + every replay of the migration. UUIDv5 is deterministic (a
-- SHA-1 hash of namespace + name) and Postgres can compute it with the
-- pgcrypto extension's digest() primitive.
--
-- Cross-company aggregation:
--   SELECT customer_uuid, COUNT(*) FROM sales GROUP BY customer_uuid
--   → every row that shares a customer_uuid is the same human, regardless
--     of which fronter co fronted them or which closer co closed.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Schema ─────────────────────────────────────────────────────────────────
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS customer_uuid uuid;

COMMENT ON COLUMN sales.customer_uuid IS
  'Deterministic UUID-v5 of the customer''s normalized phone number. Same phone → same uuid across every company. Drives lifetime-customer reporting and cross-co dedup. Populated by trigger fn_set_customer_uuid().';

CREATE INDEX IF NOT EXISTS idx_sales_customer_uuid
  ON sales(customer_uuid) WHERE customer_uuid IS NOT NULL;

-- ── Helpers ────────────────────────────────────────────────────────────────
-- Normalize a US phone number to 10 digits. Strips non-digits, drops a
-- leading 1 if 11 digits. Matches the JS normPhone in backend/utils.
CREATE OR REPLACE FUNCTION app_norm_phone(input text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN input IS NULL THEN NULL
    WHEN length(regexp_replace(input, '\D', '', 'g')) = 11
         AND substring(regexp_replace(input, '\D', '', 'g'), 1, 1) = '1'
      THEN substring(regexp_replace(input, '\D', '', 'g'), 2)
    ELSE regexp_replace(input, '\D', '', 'g')
  END;
$$;

-- UUIDv5 in pure SQL using pgcrypto.digest. The namespace is a fixed
-- uuid (chosen once for BizTrix customers). The name part is the
-- normalized phone. Output format follows RFC 4122 §4.3.
CREATE OR REPLACE FUNCTION app_uuid_v5(namespace uuid, name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  ns_bytes bytea;
  hash     bytea;
  hex      text;
BEGIN
  IF name IS NULL OR name = '' THEN RETURN NULL; END IF;
  -- Convert namespace UUID to 16 bytes
  ns_bytes := decode(replace(namespace::text, '-', ''), 'hex');
  hash := digest(ns_bytes || convert_to(name, 'UTF8'), 'sha1');
  -- Take first 16 bytes, set version + variant bits per RFC 4122 §4.3
  hash := set_byte(hash, 6, (get_byte(hash, 6) & 15) | 80);  -- version 5
  hash := set_byte(hash, 8, (get_byte(hash, 8) & 63) | 128); -- variant 10
  hex  := encode(substring(hash, 1, 16), 'hex');
  RETURN (
    substring(hex, 1, 8)  || '-' ||
    substring(hex, 9, 4)  || '-' ||
    substring(hex, 13, 4) || '-' ||
    substring(hex, 17, 4) || '-' ||
    substring(hex, 21, 12)
  )::uuid;
END $$;

-- ── Trigger ────────────────────────────────────────────────────────────────
-- Compute customer_uuid on insert + on any update that touches the phone.
-- We pull the phone from customer_phone first (closer-side normalized
-- column) and fall back to the JSON variants the form ships.
CREATE OR REPLACE FUNCTION fn_set_customer_uuid()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  raw_phone   text;
  norm_phone  text;
  ns_customer constant uuid := '6ba7b811-9dad-11d1-80b4-00c04fd430c8';  -- fixed namespace
BEGIN
  raw_phone := COALESCE(
    NEW.customer_phone,
    NEW.form_data->>'Phone',
    NEW.form_data->>'phone',
    NEW.form_data->>'customer_phone',
    NEW.form_data->>'Mobile',
    NEW.form_data->>'CellPhone'
  );
  norm_phone := app_norm_phone(raw_phone);
  IF norm_phone IS NULL OR length(norm_phone) < 7 THEN
    NEW.customer_uuid := NULL;
  ELSE
    NEW.customer_uuid := app_uuid_v5(ns_customer, norm_phone);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_customer_uuid ON sales;
CREATE TRIGGER trg_set_customer_uuid
  BEFORE INSERT OR UPDATE OF customer_phone, form_data
  ON sales
  FOR EACH ROW EXECUTE FUNCTION fn_set_customer_uuid();

-- ── Backfill ───────────────────────────────────────────────────────────────
-- Touch every existing row through the trigger so historical sales pick
-- up a customer_uuid without app code changes. Filter on NULL so the
-- migration is replay-safe and cheap on re-run.
UPDATE sales
SET    customer_phone = customer_phone
WHERE  customer_uuid IS NULL;
