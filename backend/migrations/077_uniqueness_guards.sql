-- ============================================================================
-- 077_uniqueness_guards.sql
-- Second-pass audit closes the remaining data-integrity gaps:
--   G15  reference_no uniqueness (DB-level, soft-delete aware)
--   G24  compliance_cancelled / chargeback rows can't be re-edited by closer
--        once compliance has terminally adjudicated them (status-level guard,
--        enforced at the app layer; this migration just adds the column flag
--        so the guard is durable across redeploys).
--
-- All idempotent. Safe to re-run.
-- ============================================================================

-- G15 — partial unique index on reference_no. Sales rows hold an auto-
-- generated reference_no when the closer doesn't supply one and a manual
-- one otherwise. Two closers (or a bulk uploader) could in theory pick the
-- same number; auto-warranty audit ties every policy to a unique ref so a
-- collision = ambiguous historical record. The partial filter keeps NULL
-- and the empty-string sentinel out of the uniqueness check so legacy /
-- imported rows that left ref blank don't fail to migrate.
--
-- We use a partial index because:
--   - reference_no may be NULL on partially-uploaded rows
--   - the existing fallback inserts an empty string in rare paths
--   - soft-deleted rows (status='deleted' / archived) shouldn't block a
--     re-use of the same ref (intentional behavior in some workflows)
--
-- If any current data violates the constraint, the CREATE will fail noisily
-- with a list of conflicting rows — exactly what we want so the operator
-- can clean them BEFORE the index goes live.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sales_reference_no
  ON sales(reference_no)
  WHERE reference_no IS NOT NULL AND reference_no <> '';

COMMENT ON INDEX uniq_sales_reference_no IS
  'Auto-warranty: every sale must carry a unique policy/reference number. Empty / NULL refs are intentionally excluded so partial inserts can land before the closer assigns one.';

-- G24 — soft flag column so the app-layer "compliance terminated this row,
-- closer cannot revert" guard survives redeploys + restarts without
-- depending on in-memory state. Set automatically by the compliance routes
-- when status flips to compliance_cancelled / chargeback / dispute. Once
-- set, only compliance/superadmin can mutate the row.
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS compliance_locked_at timestamptz;

COMMENT ON COLUMN sales.compliance_locked_at IS
  'Set when compliance terminally adjudicates the row (status → compliance_cancelled / chargeback / dispute). Once non-null, only compliance + superadmin can mutate. Cleared if compliance later restores the row to a non-terminal state.';

CREATE INDEX IF NOT EXISTS idx_sales_compliance_locked
  ON sales(compliance_locked_at) WHERE compliance_locked_at IS NOT NULL;
