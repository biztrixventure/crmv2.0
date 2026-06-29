-- ============================================================================
-- 143_bulk_update_by_id.sql
-- Make Data Cleanup "Bulk update by ID" fast. The route used to fire one UPDATE
-- per row (4000 rows = 4000 round-trips = ~10 min). This applies the whole batch
-- in ONE statement: UPDATE … FROM jsonb_to_recordset(p_rows). Thousands of rows
-- land in well under a second.
--
-- p_rows is a JSON array of:
--   sales:     [{ "id": uuid, "patch": {form_data keys}, "cols": {column: value} }]
--   transfers: [{ "id": uuid, "patch": {form_data keys} }]
-- form_data is merged (patch wins); the denormalized sale columns are set only
-- when present in cols (COALESCE keeps the existing value otherwise). Returns the
-- number of rows updated.
-- ============================================================================
CREATE OR REPLACE FUNCTION app_bulk_update_by_id(p_table text, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  IF p_table = 'sales' THEN
    UPDATE sales s SET
      form_data        = COALESCE(s.form_data, '{}'::jsonb) || COALESCE(v.patch, '{}'::jsonb),
      customer_phone   = COALESCE(v.cols->>'customer_phone',   s.customer_phone),
      customer_phone_2 = COALESCE(v.cols->>'customer_phone_2', s.customer_phone_2),
      customer_email   = COALESCE(v.cols->>'customer_email',   s.customer_email),
      car_make         = COALESCE(v.cols->>'car_make',         s.car_make),
      car_model        = COALESCE(v.cols->>'car_model',        s.car_model),
      car_vin          = COALESCE(v.cols->>'car_vin',          s.car_vin),
      plan             = COALESCE(v.cols->>'plan',             s.plan),
      client_name      = COALESCE(v.cols->>'client_name',      s.client_name),
      reference_no     = COALESCE(v.cols->>'reference_no',     s.reference_no),
      payment_due_note = COALESCE(v.cols->>'payment_due_note', s.payment_due_note),
      updated_at       = now()
    FROM jsonb_to_recordset(p_rows) AS v(id uuid, patch jsonb, cols jsonb)
    WHERE s.id = v.id;
    GET DIAGNOSTICS n = ROW_COUNT;

  ELSIF p_table = 'transfers' THEN
    UPDATE transfers t SET
      form_data  = COALESCE(t.form_data, '{}'::jsonb) || COALESCE(v.patch, '{}'::jsonb),
      updated_at = now()
    FROM jsonb_to_recordset(p_rows) AS v(id uuid, patch jsonb)
    WHERE t.id = v.id;
    GET DIAGNOSTICS n = ROW_COUNT;

  ELSE
    RAISE EXCEPTION 'app_bulk_update_by_id: unsupported table %', p_table;
  END IF;

  RETURN n;
END $$;

NOTIFY pgrst, 'reload schema';
