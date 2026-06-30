-- ============================================================================
-- 144_bulk_apply_disposition.sql
-- Bulk-set a transfer's disposition + closer by id (Data Cleanup "Set
-- Disposition"). Mirrors exactly how a disposition is recorded everywhere else:
-- insert a disposition_actions row (the AFTER trigger from migration 100 then
-- syncs transfers.latest_disposition) and, when a closer is given, stamp the
-- transfer's assigned_closer_id + promote a still-pending transfer to assigned.
--
-- p_rows: [{ transfer_id uuid, closer_id uuid|null, status text|null,
--            disposition_config_id uuid|null, disposition_name text, color text,
--            note text }]
-- The note carries a per-run batch token so the operation can be reverted by
-- deleting exactly the actions it inserted. Whole batch = 2 statements.
-- ============================================================================
CREATE OR REPLACE FUNCTION app_bulk_apply_disposition(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  -- 1) Closer + status onto the transfer (closer optional — COALESCE keeps the
  --    existing value when null).
  UPDATE transfers t SET
    assigned_closer_id = COALESCE(v.closer_id, t.assigned_closer_id),
    assigned_to        = COALESCE(v.closer_id, t.assigned_to),
    status             = COALESCE(v.status, t.status),
    updated_at         = now()
  FROM jsonb_to_recordset(p_rows)
       AS v(transfer_id uuid, closer_id uuid, status text,
             disposition_config_id uuid, disposition_name text, color text, note text)
  WHERE t.id = v.transfer_id;

  -- 2) The visible disposition row (trigger 100 syncs latest_disposition).
  INSERT INTO disposition_actions
    (transfer_id, company_id, user_id, disposition_config_id, disposition_name, color, note, setter_role)
  SELECT v.transfer_id, t.company_id, v.closer_id, v.disposition_config_id,
         v.disposition_name, COALESCE(v.color, '#6b7280'), v.note, 'closer'
  FROM jsonb_to_recordset(p_rows)
       AS v(transfer_id uuid, closer_id uuid, status text,
             disposition_config_id uuid, disposition_name text, color text, note text)
  JOIN transfers t ON t.id = v.transfer_id;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

NOTIFY pgrst, 'reload schema';
