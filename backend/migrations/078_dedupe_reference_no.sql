-- ============================================================================
-- 078_dedupe_reference_no.sql
-- Remediation for mig 077's failed CREATE UNIQUE INDEX. The audit-mandated
-- uniqueness on sales.reference_no surfaced existing duplicates the closer
-- workflow + historical bulk imports produced over time.
--
-- Strategy:
--   1. For every duplicated reference_no, keep the OLDEST sale row's value
--      untouched (it owns the original reference).
--   2. Append "-DUP-<short_id>" to every newer sibling so each retains a
--      provable lineage back to the original — easy to spot in lists, easy
--      to grep in audit reports, never silently lost.
--   3. Append an edit_history entry on every renamed row so the change is
--      visible in the SaleDetailDrawer audit trail.
--   4. Re-create the unique partial index (no-op if it already exists).
--
-- Safe to re-run: the rename predicate excludes already-suffixed rows so a
-- second invocation is a no-op.
--
-- After this migration the operator can scan SELECT ... WHERE reference_no
-- LIKE '%-DUP-%' to review the renamed rows and decide whether each is a
-- genuine duplicate sale (delete or merge) or a legitimately separate sale
-- that just had a clashing ref (manually rename to a real policy number).
-- ============================================================================

-- ── 1. Diagnose — visible in the migration output so the operator can
--    eyeball how big the cleanup is.
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT reference_no
    FROM sales
    WHERE reference_no IS NOT NULL
      AND reference_no <> ''
      AND reference_no NOT LIKE '%-DUP-%'
    GROUP BY reference_no
    HAVING COUNT(*) > 1
  ) sub;
  RAISE NOTICE 'sales.reference_no duplicates pending cleanup: %', dup_count;
END $$;

-- ── 2. Rename duplicates — keep oldest, suffix the rest. Uses a CTE to
--    rank each duplicated ref by created_at ASC, then suffixes everything
--    with rank > 1.
WITH ranked AS (
  SELECT
    id,
    reference_no,
    edit_history,
    ROW_NUMBER() OVER (
      PARTITION BY reference_no
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    COUNT(*) OVER (PARTITION BY reference_no) AS dup_count
  FROM sales
  WHERE reference_no IS NOT NULL
    AND reference_no <> ''
    AND reference_no NOT LIKE '%-DUP-%'
)
UPDATE sales s
SET
  reference_no = r.reference_no || '-DUP-' || SUBSTRING(s.id::text, 1, 8),
  edit_history = COALESCE(s.edit_history, '[]'::jsonb) || jsonb_build_object(
    'editor_id',       NULL,
    'role',            'system',
    'action',          'reference_no_deduped',
    'previous_value',  r.reference_no,
    'new_value',       r.reference_no || '-DUP-' || SUBSTRING(s.id::text, 1, 8),
    'reason',          'mig 078: original ref ' || r.reference_no || ' was shared with the oldest sale on that ref. Suffixed for audit uniqueness. Review and re-key with the real policy number when known.',
    'edited_at',       NOW()::text
  ),
  updated_at = NOW()
FROM ranked r
WHERE s.id = r.id
  AND r.rn > 1
  AND r.dup_count > 1;

-- ── 3. Now create the unique index. If for some reason new dups slipped
--    in between rename and index, the CREATE will throw again — but the
--    rename step above is replayable so a second run finishes the job.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sales_reference_no
  ON sales(reference_no)
  WHERE reference_no IS NOT NULL AND reference_no <> '';

COMMENT ON INDEX uniq_sales_reference_no IS
  'Auto-warranty: every sale must carry a unique policy/reference number. Empty / NULL refs are intentionally excluded so partial inserts can land before the closer assigns one. Mig 078 cleaned legacy duplicates by suffixing newer siblings with -DUP-<id>.';

-- ── 4. Re-check + report after cleanup.
DO $$
DECLARE
  remaining integer;
  suffixed integer;
BEGIN
  SELECT COUNT(*) INTO suffixed FROM sales WHERE reference_no LIKE '%-DUP-%';
  SELECT COUNT(*) INTO remaining FROM (
    SELECT reference_no FROM sales
    WHERE reference_no IS NOT NULL AND reference_no <> ''
    GROUP BY reference_no HAVING COUNT(*) > 1
  ) sub;
  RAISE NOTICE 'Sales renamed with -DUP- suffix: %', suffixed;
  RAISE NOTICE 'Duplicate refs still present after cleanup: %', remaining;
END $$;
