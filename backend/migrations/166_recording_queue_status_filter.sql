-- ============================================================================
-- 166_recording_queue_status_filter.sql  (sale-lifecycle audit FIX 1 + FIX 4 chip)
-- The review queue had NO sale-status clause — cancelled/dead sales sat in
-- "pending review" forever. And multi-car bundles were invisible to reviewers.
--
-- Changes vs 163:
--   * NEW PARAM p_excluded_statuses text[] — dead statuses to drop from the
--     queue. The route fills it from business_config key
--     'recording_review.excluded_statuses' (seeded below), so compliance
--     policy changes without another migration — same pattern as
--     resell.enabled_statuses. NULL/empty → no exclusion (fail-open to 163
--     behavior if the route ever passes nothing).
--   * NEW OUTPUT sale_group_id + group_count — mig 165's bundle identity, so
--     the queue can show an "N-car deal" chip. group_count is 0 for
--     non-bundled sales (LATERAL is skipped via CASE; the partial index
--     idx_sales_group serves bundled rows).
--
-- Status vocabulary verified against code + live data (sales.js validators,
-- compliance route COMPLIANCE_STATUSES, resell 'expired'):
--   open, sold, follow_up, pending_review, needs_revision, closed_won,
--   closed_lost, cancelled, compliance_cancelled, chargeback, dispute, expired
-- Dead-for-review default: cancelled, compliance_cancelled, chargeback,
--   dispute, closed_lost, expired, needs_revision
--   (needs_revision = back with the closer; it re-enters the queue when
--    resubmitted and its status moves on.)
--
-- Signature changes (adds a param + output columns) → CREATE OR REPLACE would
-- either 42P13 or create an overload; DROP the 163 signature first.
-- Apply AFTER 165 (reads sales.sale_group_id). Safe to re-run.
-- ============================================================================

-- seed the configurable exclusion list (global; edit via business_config)
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'recording_review.excluded_statuses',
    '["cancelled","compliance_cancelled","chargeback","dispute","closed_lost","expired","needs_revision"]'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

DROP FUNCTION IF EXISTS app_recording_review_queue(uuid[], date, date, uuid, text, text, text, text, int, int);

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
  p_offset      int     DEFAULT 0,
  p_excluded_statuses text[] DEFAULT NULL
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
  recording_ids   text,
  sale_group_id   uuid,
  group_count     int,
  created_at      timestamptz,
  total_count     bigint
) LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_sort  text;
  v_dir   text;
  v_count text;
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
  v_count := CASE WHEN GREATEST(COALESCE(p_offset, 0), 0) = 0 THEN 'COUNT(*) OVER()' ELSE '0' END;

  RETURN QUERY EXECUTE format($q$
    SELECT s.id::uuid, s.customer_name::text, s.customer_phone::text, s.sale_date::date,
           s.closer_id::uuid,
           NULLIF(TRIM(COALESCE(up.first_name,'') || ' ' || COALESCE(up.last_name,'')), '')::text,
           s.company_id::uuid, co.name::text,
           t.vicidial_vendor_code::text, s.plan::text, s.monthly_payment::numeric, s.reference_no::text,
           COALESCE(cc.n,0)::int, (COALESCE(cc.n,0) > 0)::boolean, cc.rids::text,
           s.sale_group_id::uuid, COALESCE(gc.n,0)::int,
           s.created_at::timestamptz, (%5$s)::bigint
    FROM sales s
    LEFT JOIN transfers t ON t.id = s.transfer_id            -- code optional
    JOIN user_profiles up
      ON up.user_id = s.closer_id                            -- mapped closer still REQUIRED
     AND up.vicidial_agent_ids IS NOT NULL
     AND COALESCE(array_length(up.vicidial_agent_ids,1),0) >= 1
    LEFT JOIN companies co ON co.id = s.company_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS n,
             string_agg(c.recording_id, ', ' ORDER BY c.clip_order) AS rids
      FROM sale_recording_confirmations c WHERE c.sale_id = s.id
    ) cc ON TRUE
    LEFT JOIN LATERAL (
      SELECT CASE WHEN s.sale_group_id IS NULL THEN 0
                  ELSE (SELECT COUNT(*) FROM sales g WHERE g.sale_group_id = s.sale_group_id) END AS n
    ) gc ON TRUE
    WHERE (($5 = 'all') OR ($5 = 'pending' AND COALESCE(cc.n,0) = 0) OR ($5 = 'confirmed' AND COALESCE(cc.n,0) > 0))
      AND (s.closer_disposition IS NULL OR s.closer_disposition NOT ILIKE '%%post%%date%%')
      AND ($7 IS NULL OR NOT (s.status::text = ANY($7)))      -- FIX 1: dead statuses out (status is the sale_status ENUM → cast for text[] compare)
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
           COALESCE(cc.rids,'')                                    ILIKE '%%'||$6||'%%' OR
           s.id::text                                              ILIKE '%%'||$6||'%%')
    ORDER BY %1$s %2$s NULLS LAST, s.created_at DESC
    LIMIT %3$s OFFSET %4$s
  $q$, v_sort, v_dir, GREATEST(COALESCE(p_limit,100),0), GREATEST(COALESCE(p_offset,0),0), v_count)
  USING p_company_ids, p_date_from, p_date_to, p_closer_id, p_status, p_search, p_excluded_statuses;
END
$fn$;

GRANT EXECUTE ON FUNCTION app_recording_review_queue(uuid[], date, date, uuid, text, text, text, text, int, int, text[])
  TO authenticated, anon, service_role;
