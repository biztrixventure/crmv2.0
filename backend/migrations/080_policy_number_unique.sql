-- ============================================================================
-- 080_policy_number_unique.sql
-- Closes G25 — every auto-warranty sale's policy number must be unique
-- across the system, regardless of which form_data variant the closer
-- typed it into.
--
-- Strategy:
--   1. Add a generated column `policy_number` projected from the most
--      common JSON paths so the uniqueness constraint can hit it through
--      a plain index (UNIQUE expression indexes on JSON paths fight the
--      planner; a column with a btree wins every time).
--   2. Dedupe legacy rows: oldest sale keeps the policy_number untouched;
--      newer siblings get "-DUP-<short_id>" suffixed into form_data and
--      an edit_history entry appended (mirrors mig 078's reference_no
--      remediation).
--   3. Create the partial unique index on the generated column.
--
-- Idempotent. Replayable. Renamed rows surface in:
--   SELECT id, policy_number, customer_name, sale_date FROM sales
--    WHERE policy_number LIKE '%-DUP-%'
-- ============================================================================

-- ── 1. Generated column ────────────────────────────────────────────────────
-- Projects the value out of whichever JSON key the closer used. Order
-- preserves first-non-null priority so the catalog admin can pick which
-- field is canonical without re-running this migration.
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS policy_number text GENERATED ALWAYS AS (
    NULLIF(
      COALESCE(
        form_data->>'PolicyNumber',
        form_data->>'policy_number',
        form_data->>'policy_no',
        form_data->>'PolicyNo'
      ),
      ''
    )
  ) STORED;

COMMENT ON COLUMN sales.policy_number IS
  'Generated from form_data PolicyNumber / policy_number / policy_no / PolicyNo. Unique across all sales (idx_sales_policy_number_unique). NULL when no policy number was entered.';

CREATE INDEX IF NOT EXISTS idx_sales_policy_number
  ON sales(policy_number) WHERE policy_number IS NOT NULL;

-- ── 2. Dedupe existing duplicates ─────────────────────────────────────────
-- Rank duplicates by created_at ASC, keep the oldest, suffix the rest.
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT policy_number FROM sales
    WHERE policy_number IS NOT NULL
      AND policy_number NOT LIKE '%-DUP-%'
    GROUP BY policy_number HAVING COUNT(*) > 1
  ) sub;
  RAISE NOTICE 'sales.policy_number duplicates pending cleanup: %', dup_count;
END $$;

-- Rewrite form_data so the GENERATED column re-projects the new value.
-- We update ONLY the JSON key the row was actually using so the
-- non-canonical keys (if present) stay intact for closer-side rendering.
WITH ranked AS (
  SELECT
    id,
    form_data,
    policy_number AS pn,
    ROW_NUMBER() OVER (
      PARTITION BY policy_number
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    COUNT(*) OVER (PARTITION BY policy_number) AS dup_count
  FROM sales
  WHERE policy_number IS NOT NULL
    AND policy_number NOT LIKE '%-DUP-%'
)
UPDATE sales s
SET
  form_data = (
    SELECT jsonb_object_agg(
      k,
      CASE
        WHEN k IN ('PolicyNumber','policy_number','policy_no','PolicyNo')
             AND s.form_data->>k = r.pn
          THEN to_jsonb(r.pn || '-DUP-' || SUBSTRING(s.id::text, 1, 8))
        ELSE v
      END
    )
    FROM jsonb_each(s.form_data) e(k, v)
  ),
  edit_history = COALESCE(s.edit_history, '[]'::jsonb) || jsonb_build_object(
    'editor_id', NULL,
    'role',      'system',
    'action',    'policy_number_deduped',
    'previous_value', r.pn,
    'new_value',      r.pn || '-DUP-' || SUBSTRING(s.id::text, 1, 8),
    'reason',         'mig 080: policy_number ' || r.pn || ' was duplicated. Suffixed for audit uniqueness — review and re-key with the real policy number.',
    'edited_at',      NOW()::text
  ),
  updated_at = NOW()
FROM ranked r
WHERE s.id = r.id
  AND r.rn > 1
  AND r.dup_count > 1;

-- ── 3. Unique partial index ────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sales_policy_number
  ON sales(policy_number) WHERE policy_number IS NOT NULL;

COMMENT ON INDEX uniq_sales_policy_number IS
  'Auto-warranty: every policy number must be unique. NULL excluded so partial / closer-in-progress rows still land.';

-- ── 4. Report ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  remaining integer;
  suffixed  integer;
BEGIN
  SELECT COUNT(*) INTO suffixed FROM sales WHERE policy_number LIKE '%-DUP-%';
  SELECT COUNT(*) INTO remaining FROM (
    SELECT policy_number FROM sales
    WHERE policy_number IS NOT NULL
    GROUP BY policy_number HAVING COUNT(*) > 1
  ) sub;
  RAISE NOTICE 'Sales policy_number renamed with -DUP- suffix: %', suffixed;
  RAISE NOTICE 'Duplicate policy_numbers still present after cleanup: %', remaining;
END $$;
