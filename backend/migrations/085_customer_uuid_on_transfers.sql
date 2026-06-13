-- ============================================================================
-- 085_customer_uuid_on_transfers.sql
-- Extends the customer lifetime identity (customer_uuid, born in 079) onto
-- the transfers table. Same UUIDv5 determinism: same normalized phone →
-- same uuid across transfers AND sales.
--
-- Why: migration 079 put customer_uuid on sales only. A transfer is the
-- lead record created BEFORE the sale. Without customer_uuid here, there is
-- no way to join a lead's history to the policy it became.
--
-- Design notes:
--   • normalized_phone on transfers is already a clean 10-digit string
--     (migration 048). The trigger uses it directly — no need to call
--     app_norm_phone() again.
--   • app_uuid_v5() and the fixed namespace uuid were created in 079.
--     This migration does not redefine them.
--   • Backfill computes customer_uuid directly from normalized_phone rather
--     than touching the column to fire the trigger — avoids a no-op UPDATE
--     on rows that may not change the column value.
--
-- Prerequisite: migrations 048 and 079 must be applied first.
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ── Schema ───────────────────────────────────────────────────────────────────
ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS customer_uuid uuid;

COMMENT ON COLUMN transfers.customer_uuid IS
  'Deterministic UUIDv5 of the lead normalized phone. Same phone → same uuid as sales.customer_uuid. Joins transfers to the sales they became for full lead→policy lifecycle reporting.';

CREATE INDEX IF NOT EXISTS idx_transfers_customer_uuid
  ON transfers(customer_uuid) WHERE customer_uuid IS NOT NULL;

-- ── Trigger ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_set_transfer_customer_uuid()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ns constant uuid := '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
BEGIN
  IF NEW.normalized_phone IS NOT NULL AND length(NEW.normalized_phone) >= 7 THEN
    NEW.customer_uuid := app_uuid_v5(ns, NEW.normalized_phone);
  ELSE
    NEW.customer_uuid := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_transfer_customer_uuid ON transfers;
CREATE TRIGGER trg_set_transfer_customer_uuid
  BEFORE INSERT OR UPDATE OF normalized_phone
  ON transfers
  FOR EACH ROW EXECUTE FUNCTION fn_set_transfer_customer_uuid();

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- normalized_phone already populated (migration 048). Compute uuid directly.
-- Filter on NULL makes this replay-safe and cheap on re-run.
UPDATE transfers
SET    customer_uuid = app_uuid_v5(
         '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
         normalized_phone
       )
WHERE  normalized_phone IS NOT NULL
  AND  length(normalized_phone) >= 7
  AND  customer_uuid IS NULL;
