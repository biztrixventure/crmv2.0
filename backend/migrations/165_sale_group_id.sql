-- ============================================================================
-- 165_sale_group_id.sql  (sale-lifecycle audit FIX 4 — schema)
-- Multi-vehicle submits create N independent sales rows with no group
-- identity (only transfer_id ties them). Add sale_group_id so every surface
-- can recognize "these N rows are one deal".
--
--   * sale_group_id uuid NULL — NULL means "not a bundle". Single-car sales
--     stay NULL (deliberate: group_count lookups skip the common case, and
--     "IS NOT NULL" alone answers 'is this part of a multi-car deal').
--   * Backfill is CONSERVATIVE: a historical bundle is only recognizable as
--     2+ rows sharing the same transfer_id AND the exact same created_at
--     (a single multi-row INSERT stamps one transaction timestamp on every
--     row, so same-statement bundles match exactly). Rows that merely share
--     a transfer (resells, additional_car resells, later re-keys) have
--     different created_at and stay NULL — better unlinked than wrongly
--     linked. Resell rows are additionally excluded outright.
--
-- Apply BEFORE 166 (the queue RPC there reads this column).
-- Idempotent.
-- ============================================================================

ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_group_id uuid;

-- Group-member lookups only ever filter on a concrete uuid — partial index
-- skips the (vast) single-car majority.
CREATE INDEX IF NOT EXISTS idx_sales_group
  ON sales (sale_group_id) WHERE sale_group_id IS NOT NULL;

-- ── conservative backfill ─────────────────────────────────────────────────────
-- One fresh uuid per (transfer_id, created_at) cluster with 2+ non-resell rows.
WITH clusters AS (
  SELECT transfer_id, created_at, gen_random_uuid() AS gid
  FROM sales
  WHERE transfer_id IS NOT NULL
    AND is_resell IS NOT TRUE
    AND sale_group_id IS NULL
  GROUP BY transfer_id, created_at
  HAVING COUNT(*) >= 2
)
UPDATE sales s
SET sale_group_id = c.gid
FROM clusters c
WHERE s.transfer_id = c.transfer_id
  AND s.created_at  = c.created_at
  AND s.is_resell IS NOT TRUE
  AND s.sale_group_id IS NULL;

-- ── post-apply verification ───────────────────────────────────────────────────
-- SELECT COUNT(DISTINCT sale_group_id) AS bundles,
--        COUNT(*) FILTER (WHERE sale_group_id IS NOT NULL) AS grouped_rows
-- FROM sales;
-- Spot-check one bundle:
-- SELECT sale_group_id, id, reference_no, car_year, car_make, car_model, created_at
-- FROM sales WHERE sale_group_id IS NOT NULL
-- ORDER BY sale_group_id, created_at LIMIT 12;
