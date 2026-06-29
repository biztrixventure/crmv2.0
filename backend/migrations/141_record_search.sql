-- ============================================================================
-- 141_record_search.sql
-- "Search anything" for the compliance lists. The old search only hit
-- customer_name / phone / reference. This adds a function that matches a term
-- against the FULL record id, every form_data cell (form_data::text), the key
-- typed columns, AND the fronter / closer NAME (resolved through user_profiles —
-- the name isn't stored on the sale/transfer row, only the agent's id). So you
-- can paste a record's unique id, type any value from any field, or type an
-- agent's name and find every record they fronted/closed.
--
-- GIN trigram indexes on form_data::text make the "any cell" substring search
-- fast (pg_trgm; the term needs >= 3 chars to use the index, shorter still works
-- via scan). id matches use the primary key.
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_sales_formdata_trgm
  ON sales USING gin ((form_data::text) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_transfers_formdata_trgm
  ON transfers USING gin ((form_data::text) gin_trgm_ops);

CREATE OR REPLACE FUNCTION app_record_search(p_table text, p_q text, p_limit int DEFAULT 500)
RETURNS TABLE(id uuid)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  pat       text := '%' || replace(replace(coalesce(p_q, ''), '%', '\%'), '_', '\_') || '%';
  v_uuid    uuid;
  agent_ids uuid[];
BEGIN
  BEGIN v_uuid := p_q::uuid; EXCEPTION WHEN others THEN v_uuid := NULL; END;

  -- Fronter/closer names live in user_profiles, not on the record. Resolve the
  -- term to the agent ids whose first/last/full name matches, then match the
  -- record's fronter/closer id columns against them.
  SELECT array_agg(up.user_id) INTO agent_ids
  FROM user_profiles up
  WHERE coalesce(up.first_name, '') ILIKE pat
     OR coalesce(up.last_name, '')  ILIKE pat
     OR (coalesce(up.first_name, '') || ' ' || coalesce(up.last_name, '')) ILIKE pat;

  IF p_table = 'sales' THEN
    RETURN QUERY
      SELECT s.id FROM sales s
      WHERE (v_uuid IS NOT NULL AND s.id = v_uuid)
         OR s.form_data::text                ILIKE pat
         OR coalesce(s.customer_name, '')    ILIKE pat
         OR coalesce(s.customer_phone, '')   ILIKE pat
         OR coalesce(s.customer_phone_2, '') ILIKE pat
         OR coalesce(s.customer_email, '')   ILIKE pat
         OR coalesce(s.reference_no, '')     ILIKE pat
         OR coalesce(s.car_vin, '')          ILIKE pat
         OR coalesce(s.plan, '')             ILIKE pat
         OR coalesce(s.client_name, '')      ILIKE pat
         OR (agent_ids IS NOT NULL AND (s.fronter_id = ANY(agent_ids) OR s.closer_id = ANY(agent_ids)))
      LIMIT p_limit;

  ELSIF p_table = 'transfers' THEN
    RETURN QUERY
      SELECT t.id FROM transfers t
      WHERE (v_uuid IS NOT NULL AND t.id = v_uuid)
         OR t.form_data::text                 ILIKE pat
         OR coalesce(t.normalized_phone, '')  ILIKE pat
         OR (agent_ids IS NOT NULL AND (t.created_by = ANY(agent_ids) OR t.assigned_closer_id = ANY(agent_ids)))
      LIMIT p_limit;

  ELSE
    RAISE EXCEPTION 'app_record_search: unsupported table %', p_table;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
