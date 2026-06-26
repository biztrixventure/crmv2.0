-- ============================================================================
-- 114_backfill_apply_rpc.sql
-- Speed up the list-CSV backfill: apply ALL transfer code/dispo updates for a
-- batch in ONE statement instead of one UPDATE per transfer. Takes a JSON array
-- of {id, code, dispo}; stamps the code always and the dispo only when provided
-- (NULL dispo = leave the existing one — the no-overwrite is decided in the API).
-- The route falls back to per-row updates if this function is absent.
-- Apply in Supabase SQL editor. Idempotent (CREATE OR REPLACE).
-- ============================================================================
CREATE OR REPLACE FUNCTION backfill_apply_transfers(items jsonb)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  UPDATE transfers t SET
    vicidial_vendor_code = e.code,
    vicidial_dispo       = COALESCE(e.dispo, t.vicidial_dispo),
    vicidial_dispo_at    = CASE WHEN e.dispo IS NOT NULL THEN now() ELSE t.vicidial_dispo_at END
  FROM (
    SELECT (x->>'id')::uuid AS id, x->>'code' AS code, NULLIF(x->>'dispo','') AS dispo
    FROM jsonb_array_elements(items) x
  ) e
  WHERE t.id = e.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;
