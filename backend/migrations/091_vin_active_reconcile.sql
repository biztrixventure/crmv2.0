-- ============================================================================
-- 091_vin_active_reconcile.sql
-- Re-introduces "one active policy per VIN" in a BULK-SAFE way (replaces the
-- 088 design that broke multi-row bulk uploads — see 090).
--
-- Why 088 broke: it used a BEFORE-INSERT row trigger that UPDATEs sibling rows
-- of the same table, plus a partial UNIQUE index. A multi-row INSERT (bulk
-- upload, 100 rows at a time) containing the same car_vin twice made the
-- trigger touch a row from the same command → "tuple to be updated was already
-- modified..." (or a unique violation) → the whole batch failed.
--
-- The bulk-safe design here:
--   1. NO blocking unique index — instead a NON-unique partial index purely for
--      fast lookups, which never rejects an insert.
--   2. A STATEMENT-level AFTER trigger (INSERT + UPDATE) using a transition
--      table. It runs ONCE after the whole statement completes, so it never
--      mutates a row mid-statement → multi-row bulk inserts of any size, with
--      any number of duplicate VINs, always succeed. It then reconciles: for
--      every VIN touched by the statement, keep the NEWEST closed_won row
--      active and stamp superseded_by on the rest.
--   3. pg_trigger_depth() guard so the reconcile's own UPDATE doesn't recurse.
--
-- Net effect for uploads: a batch can contain the same VIN many times and the
-- insert succeeds; immediately after, only the newest closed_won row per VIN
-- stays active and the older ones are marked superseded — correct and durable
-- across many files over time.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ── 0. Remove the unsafe 088 objects (idempotent; harmless if 090 already ran) ─
DROP TRIGGER  IF EXISTS trg_supersede_vin_active ON sales;
DROP FUNCTION IF EXISTS fn_supersede_vin_active();
DROP INDEX    IF EXISTS uq_sales_active_vin;

-- ── 1. Fast (NON-unique) lookup index for the reconcile ────────────────────────
-- Non-unique → it can never reject an insert. Just makes "active rows for these
-- VINs" lookups fast as the sales table grows over many uploads.
CREATE INDEX IF NOT EXISTS idx_sales_active_vin
  ON sales (car_vin)
  WHERE status = 'closed_won' AND superseded_by IS NULL AND car_vin IS NOT NULL;

-- ── 2. Reconcile function (statement-level, transition table) ──────────────────
CREATE OR REPLACE FUNCTION fn_reconcile_vin_active()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Our own UPDATE below re-fires this statement trigger; stop the recursion.
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;

  WITH touched AS (
    -- VINs that this statement just inserted/updated into an active state.
    SELECT DISTINCT car_vin
    FROM new_rows
    WHERE car_vin IS NOT NULL AND btrim(car_vin) <> '' AND status = 'closed_won'
  ),
  ranked AS (
    -- All currently-active policies (existing + just-written) for those VINs,
    -- newest first. Newest = latest sale_date, then created_at, then id.
    SELECT s.id,
           row_number() OVER (
             PARTITION BY s.car_vin
             ORDER BY COALESCE(s.sale_date::timestamptz, s.created_at) DESC,
                      s.created_at DESC, s.id DESC
           ) AS rn,
           first_value(s.id) OVER (
             PARTITION BY s.car_vin
             ORDER BY COALESCE(s.sale_date::timestamptz, s.created_at) DESC,
                      s.created_at DESC, s.id DESC
           ) AS keeper_id
    FROM sales s
    WHERE s.car_vin IN (SELECT car_vin FROM touched)
      AND s.status = 'closed_won'
      AND s.superseded_by IS NULL
  )
  UPDATE sales s
     SET superseded_by    = r.keeper_id,
         superseded_at     = now(),
         superseded_reason = 'auto_one_active_per_vin'
    FROM ranked r
   WHERE s.id = r.id
     AND r.rn > 1;          -- keep rn = 1 (newest) active; supersede the rest

  RETURN NULL;
END $$;

-- ── 3. Statement-level triggers (INSERT + UPDATE) ──────────────────────────────
DROP TRIGGER IF EXISTS trg_reconcile_vin_active_ins ON sales;
CREATE TRIGGER trg_reconcile_vin_active_ins
  AFTER INSERT ON sales
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION fn_reconcile_vin_active();

DROP TRIGGER IF EXISTS trg_reconcile_vin_active_upd ON sales;
CREATE TRIGGER trg_reconcile_vin_active_upd
  AFTER UPDATE ON sales
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION fn_reconcile_vin_active();

-- ── 4. One-time reconcile of any dups created while enforcement was off ─────────
-- (Between applying 090 and this, bulk uploads could have inserted same-VIN
-- active dups.) Bring the whole table to "one active per VIN" now; the triggers
-- keep it that way afterward.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY car_vin
           ORDER BY COALESCE(sale_date::timestamptz, created_at) DESC, created_at DESC, id DESC
         ) AS rn,
         first_value(id) OVER (
           PARTITION BY car_vin
           ORDER BY COALESCE(sale_date::timestamptz, created_at) DESC, created_at DESC, id DESC
         ) AS keeper_id
  FROM sales
  WHERE status = 'closed_won' AND superseded_by IS NULL
    AND car_vin IS NOT NULL AND btrim(car_vin) <> ''
)
UPDATE sales s
   SET superseded_by    = r.keeper_id,
       superseded_at     = now(),
       superseded_reason = 'backfill_091_one_active_per_vin'
  FROM ranked r
 WHERE s.id = r.id
   AND r.rn > 1;
