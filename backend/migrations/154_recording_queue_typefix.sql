-- ============================================================================
-- 154_recording_queue_typefix.sql
-- HOTFIX for 152. The recording-review queue was switched to LANGUAGE plpgsql
-- (RETURN QUERY EXECUTE) to get a dynamic ORDER BY. Unlike LANGUAGE sql, plpgsql
-- does NOT coerce column types to the RETURNS TABLE declaration — so a
-- varchar/text or numeric(10,2)/numeric difference raises at call time:
--   "structure of query does not match function result type"
-- Fix: cast every projected column to its declared OUT type. Body is otherwise
-- identical to 152. CREATE OR REPLACE — safe to re-run; supersedes 152.
-- Apply AFTER 150 + 151 + 152.
-- ============================================================================
CREATE OR REPLACE FUNCTION app_recording_review_queue(
  p_company_ids uuid[] DEFAULT NULL,
  p_date_from   date    DEFAULT NULL,
  p_date_to     date    DEFAULT NULL,
  p_closer_id   uuid    DEFAULT NULL,
  p_status      text    DEFAULT 'pending',
  p_search      text    DEFAULT NULL,
  p_sort        text    DEFAULT 'sale_date',
  p_dir         text    DEFAULT 'desc',
  p_limit       int     DEFAULT 100,
  p_offset      int     DEFAULT 0
) RETURNS TABLE (
  sale_id         uuid,
  customer_name   text,
  customer_phone  text,
  sale_date       date,
  closer_id       uuid,
  closer_name     text,
  company_id      uuid,
  company_name    text,
  vendor_code     text,
  plan            text,
  monthly_payment numeric,
  reference_no    text,
  clip_count      int,
  confirmed       boolean,
  created_at      timestamptz,
  total_count     bigint
) LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_sort text;
  v_dir  text;
BEGIN
  v_sort := CASE lower(COALESCE(p_sort, ''))
    WHEN 'customer_name'   THEN 's.customer_name'
    WHEN 'customer_phone'  THEN 's.customer_phone'
    WHEN 'closer_name'     THEN $cn$(COALESCE(up.first_name,'')||' '||COALESCE(up.last_name,''))$cn$
    WHEN 'company_name'    THEN 'co.name'
    WHEN 'plan'            THEN 's.plan'
    WHEN 'monthly_payment' THEN 's.monthly_payment'
    WHEN 'status'          THEN 'cc.n'
    WHEN 'created_at'      THEN 's.created_at'
    ELSE 's.sale_date'
  END;
  v_dir := CASE WHEN lower(COALESCE(p_dir, '')) = 'asc' THEN 'ASC' ELSE 'DESC' END;

  RETURN QUERY EXECUTE format($q$
    SELECT s.id::uuid, s.customer_name::text, s.customer_phone::text, s.sale_date::date,
           s.closer_id::uuid,
           NULLIF(TRIM(COALESCE(up.first_name,'') || ' ' || COALESCE(up.last_name,'')), '')::text,
           s.company_id::uuid, co.name::text,
           t.vicidial_vendor_code::text, s.plan::text, s.monthly_payment::numeric, s.reference_no::text,
           COALESCE(cc.n,0)::int, (COALESCE(cc.n,0) > 0)::boolean,
           s.created_at::timestamptz, (COUNT(*) OVER())::bigint
    FROM sales s
    JOIN transfers t
      ON t.id = s.transfer_id AND t.vicidial_vendor_code ~ '^[A-Za-z]+[0-9]+$'
    JOIN user_profiles up
      ON up.user_id = s.closer_id
     AND up.vicidial_agent_ids IS NOT NULL
     AND COALESCE(array_length(up.vicidial_agent_ids,1),0) >= 1
    LEFT JOIN companies co ON co.id = s.company_id
    LEFT JOIN LATERAL (SELECT COUNT(*) AS n FROM sale_recording_confirmations c WHERE c.sale_id = s.id) cc ON TRUE
    WHERE (($5 = 'all') OR ($5 = 'pending' AND COALESCE(cc.n,0) = 0) OR ($5 = 'confirmed' AND COALESCE(cc.n,0) > 0))
      AND ($1 IS NULL OR s.company_id = ANY($1))
      AND ($2 IS NULL OR s.sale_date >= $2)
      AND ($3 IS NULL OR s.sale_date <= $3)
      AND ($4 IS NULL OR s.closer_id = $4)
      AND ($6 IS NULL OR $6 = '' OR
           s.customer_name                                         ILIKE '%%'||$6||'%%' OR
           s.customer_phone                                        ILIKE '%%'||$6||'%%' OR
           COALESCE(s.reference_no,'')                             ILIKE '%%'||$6||'%%' OR
           COALESCE(t.vicidial_vendor_code,'')                     ILIKE '%%'||$6||'%%' OR
           COALESCE(s.plan,'')                                     ILIKE '%%'||$6||'%%' OR
           COALESCE(co.name,'')                                    ILIKE '%%'||$6||'%%' OR
           (COALESCE(up.first_name,'')||' '||COALESCE(up.last_name,'')) ILIKE '%%'||$6||'%%' OR
           s.id::text                                              ILIKE '%%'||$6||'%%')
    ORDER BY %1$s %2$s NULLS LAST, s.created_at DESC
    LIMIT %3$s OFFSET %4$s
  $q$, v_sort, v_dir, GREATEST(COALESCE(p_limit,100),0), GREATEST(COALESCE(p_offset,0),0))
  USING p_company_ids, p_date_from, p_date_to, p_closer_id, p_status, p_search;
END
$fn$;

GRANT EXECUTE ON FUNCTION app_recording_review_queue(uuid[], date, date, uuid, text, text, text, text, int, int)
  TO authenticated, anon, service_role;
