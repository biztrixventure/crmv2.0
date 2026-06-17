-- ============================================================================
-- 093_data_cleanup_fn.sql
-- Superadmin data-quality tool: batch find/replace a form field's value across
-- the database. app_data_cleanup_jsonb() rewrites a single JSONB form_data key
-- (e.g. "CarMake": "Hodna" → "Honda") on every matching row in ONE statement
-- per table — far cheaper + safer than fetch-modify-write loops from the app.
--
-- Guards: only the two tables that hold form_data are allowed; the field name is
-- always passed as a quoted literal (never concatenated as SQL), so it can't be
-- used for injection. Called only by the superadmin-gated /data-cleanup route.
--
-- Idempotent. Safe to re-run.
-- ============================================================================
CREATE OR REPLACE FUNCTION app_data_cleanup_jsonb(p_table text, p_field text, p_old text, p_new text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  IF p_table NOT IN ('sales', 'transfers') THEN
    RAISE EXCEPTION 'table not allowed: %', p_table;
  END IF;
  IF p_field IS NULL OR btrim(p_field) = '' THEN
    RAISE EXCEPTION 'field is required';
  END IF;

  EXECUTE format(
    'UPDATE %I SET form_data = jsonb_set(form_data, ARRAY[%L], to_jsonb($1::text), false) '
    || 'WHERE form_data ? %L AND form_data->>%L = $2',
    p_table, p_field, p_field, p_field
  ) USING p_new, p_old;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

COMMENT ON FUNCTION app_data_cleanup_jsonb(text, text, text, text) IS
  'Batch-replace one form_data JSONB key value (old→new) across all matching rows of sales/transfers. Returns the affected row count. Backs the superadmin Data Cleanup tool.';
