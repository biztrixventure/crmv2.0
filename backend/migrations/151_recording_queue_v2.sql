-- ============================================================================
-- 151_recording_queue_v2.sql
-- Extend the recording-review queue RPC for the compliance admin UI:
--   + company name, product (plan), amount (monthly_payment), reference_no
--   + confirmation status per row (clip_count / confirmed) so the queue can show
--     pending / confirmed / all
--   + p_status filter ('pending' | 'confirmed' | 'all')
--   + p_search free-text (ILIKE on customer name / phone / reference / lead code)
-- Replaces the 150 signature (dropped below). Apply AFTER 150. Idempotent.
-- ============================================================================
DROP FUNCTION IF EXISTS app_recording_review_queue(uuid[], date, date, uuid, int, int);
DROP FUNCTION IF EXISTS app_recording_review_queue(uuid[], date, date, uuid, text, text, int, int);

CREATE OR REPLACE FUNCTION app_recording_review_queue(
  p_company_ids uuid[] DEFAULT NULL,
  p_date_from   date    DEFAULT NULL,
  p_date_to     date    DEFAULT NULL,
  p_closer_id   uuid    DEFAULT NULL,
  p_status      text    DEFAULT 'pending',   -- 'pending' | 'confirmed' | 'all'
  p_search      text    DEFAULT NULL,
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
) LANGUAGE sql STABLE AS $$
  SELECT s.id, s.customer_name, s.customer_phone, s.sale_date,
         s.closer_id,
         NULLIF(TRIM(COALESCE(up.first_name,'') || ' ' || COALESCE(up.last_name,'')), ''),
         s.company_id, co.name,
         t.vicidial_vendor_code, s.plan, s.monthly_payment, s.reference_no,
         COALESCE(cc.n, 0)::int, COALESCE(cc.n, 0) > 0,
         s.created_at,
         COUNT(*) OVER()
  FROM sales s
  JOIN transfers t
    ON t.id = s.transfer_id
   AND t.vicidial_vendor_code ~ '^[A-Za-z]+[0-9]+$'
  JOIN user_profiles up
    ON up.user_id = s.closer_id
   AND up.vicidial_agent_ids IS NOT NULL
   AND COALESCE(array_length(up.vicidial_agent_ids, 1), 0) >= 1
  LEFT JOIN companies co ON co.id = s.company_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS n FROM sale_recording_confirmations c WHERE c.sale_id = s.id
  ) cc ON TRUE
  WHERE (p_status = 'all'
         OR (p_status = 'pending'   AND COALESCE(cc.n, 0) = 0)
         OR (p_status = 'confirmed' AND COALESCE(cc.n, 0) > 0))
    AND (p_company_ids IS NULL OR s.company_id = ANY(p_company_ids))
    AND (p_date_from   IS NULL OR s.sale_date >= p_date_from)
    AND (p_date_to     IS NULL OR s.sale_date <= p_date_to)
    AND (p_closer_id   IS NULL OR s.closer_id = p_closer_id)
    AND (p_search IS NULL OR p_search = '' OR
         s.customer_name              ILIKE '%' || p_search || '%' OR
         s.customer_phone             ILIKE '%' || p_search || '%' OR
         COALESCE(s.reference_no, '') ILIKE '%' || p_search || '%' OR
         COALESCE(t.vicidial_vendor_code, '') ILIKE '%' || p_search || '%')
  ORDER BY s.sale_date DESC NULLS LAST, s.created_at DESC
  LIMIT  GREATEST(COALESCE(p_limit, 100), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

GRANT EXECUTE ON FUNCTION app_recording_review_queue(uuid[], date, date, uuid, text, text, int, int)
  TO authenticated, anon, service_role;
