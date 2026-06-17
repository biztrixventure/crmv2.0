-- ============================================================================
-- 094_data_cleanup_history.sql
-- Extends the Data Cleanup tool (093) with two capabilities:
--   1. Blank/empty matching — fill in rows where a field has no value
--      (missing key, JSON null, or empty string), not just replace a known
--      wrong value.
--   2. Revert — every cleanup is recorded with the EXACT ids it changed, so a
--      specific operation can be undone without touching rows that already held
--      the new value before the run.
--
-- The forward function now RETURNS the affected ids (was a bare count) and takes
-- a p_match_blank flag. A companion restore function reverses an operation for a
-- given id set. Both are table-allowlisted; the field is always a quoted literal.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- The 093 version returned integer; we need SETOF uuid + an extra arg, so drop
-- the old signature before recreating (return type can't be altered in place).
DROP FUNCTION IF EXISTS app_data_cleanup_jsonb(text, text, text, text);

-- ── Forward: replace old→new, OR fill blanks, returning the changed ids ──────
CREATE OR REPLACE FUNCTION app_data_cleanup_jsonb(
  p_table text, p_field text, p_old text, p_new text, p_match_blank boolean DEFAULT false
) RETURNS SETOF uuid LANGUAGE plpgsql AS $$
BEGIN
  IF p_table NOT IN ('sales', 'transfers') THEN RAISE EXCEPTION 'table not allowed: %', p_table; END IF;
  IF p_field IS NULL OR btrim(p_field) = '' THEN RAISE EXCEPTION 'field is required'; END IF;

  IF p_match_blank THEN
    -- blank = key missing / JSON null / empty string. create_missing=true so a
    -- row that never had the key gets it.
    RETURN QUERY EXECUTE format(
      'UPDATE %I SET form_data = jsonb_set(COALESCE(form_data, ''{}''::jsonb), ARRAY[%L], to_jsonb($1::text), true) '
      || 'WHERE NULLIF(form_data->>%L, '''') IS NULL RETURNING id',
      p_table, p_field, p_field
    ) USING p_new;
  ELSE
    RETURN QUERY EXECUTE format(
      'UPDATE %I SET form_data = jsonb_set(form_data, ARRAY[%L], to_jsonb($1::text), false) '
      || 'WHERE form_data ? %L AND form_data->>%L = $2 RETURNING id',
      p_table, p_field, p_field, p_field
    ) USING p_new, p_old;
  END IF;
END $$;

COMMENT ON FUNCTION app_data_cleanup_jsonb(text, text, text, text, boolean) IS
  'Batch find/replace (or fill-blank) one form_data key across sales/transfers; RETURNS the changed row ids. Backs the superadmin Data Cleanup tool.';

-- ── Restore: re-apply a prior value (or unset) for a specific id set ─────────
CREATE OR REPLACE FUNCTION app_data_cleanup_jsonb_restore(
  p_table text, p_field text, p_ids uuid[], p_value text, p_unset boolean DEFAULT false
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  IF p_table NOT IN ('sales', 'transfers') THEN RAISE EXCEPTION 'table not allowed: %', p_table; END IF;
  IF p_field IS NULL OR btrim(p_field) = '' THEN RAISE EXCEPTION 'field is required'; END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN RETURN 0; END IF;

  IF p_unset THEN
    -- the rows were originally blank → drop the key again.
    EXECUTE format('UPDATE %I SET form_data = form_data - %L WHERE id = ANY($1)', p_table, p_field) USING p_ids;
  ELSE
    EXECUTE format(
      'UPDATE %I SET form_data = jsonb_set(COALESCE(form_data, ''{}''::jsonb), ARRAY[%L], to_jsonb($1::text), true) WHERE id = ANY($2)',
      p_table, p_field
    ) USING p_value, p_ids;
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

COMMENT ON FUNCTION app_data_cleanup_jsonb_restore(text, text, uuid[], text, boolean) IS
  'Reverse a Data Cleanup op for a recorded id set: set the field back to the prior value, or unset it when the rows were originally blank.';

-- ── Operation log (powers the revert history) ────────────────────────────────
CREATE TABLE IF NOT EXISTS data_cleanup_operations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field        text NOT NULL,
  field_type   text,
  sale_column  text,                          -- denormalized sales column also cleaned, if any
  match_blank  boolean NOT NULL DEFAULT false,
  old_value    text,                          -- null/'' when match_blank
  new_value    text NOT NULL,
  affected     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { transfers:[uuid], sales_form:[uuid], sales_col:[uuid] }
  counts       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { transfers, sales_form, sales_col, total }
  performed_by uuid,
  performed_at timestamptz NOT NULL DEFAULT now(),
  reverted_at  timestamptz,
  reverted_by  uuid
);

CREATE INDEX IF NOT EXISTS idx_data_cleanup_ops_performed ON data_cleanup_operations (performed_at DESC);

ALTER TABLE data_cleanup_operations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS data_cleanup_ops_service_all ON data_cleanup_operations;
CREATE POLICY data_cleanup_ops_service_all ON data_cleanup_operations FOR ALL USING (true);
