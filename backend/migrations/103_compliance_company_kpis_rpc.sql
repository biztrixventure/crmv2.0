-- ============================================================================
-- 103_compliance_company_kpis_rpc.sql
-- Disk-IO fix for the compliance Overview. The route previously PAGED every
-- sale and every transfer for all companies (tens of thousands of rows) on each
-- load and counted them in JS — a repeated full-table read. This RPC does the
-- counting in ONE grouped query per table, so the route reads ~one row per
-- company instead.
--
-- Date semantics mirror the route exactly:
--   sales      → sale_date (plain date) BETWEEN p_sale_from AND p_sale_to
--   transfers  → created_at (timestamptz) BETWEEN p_xfer_from AND p_xfer_to
-- Any bound may be NULL (= unbounded). Idempotent.
-- ============================================================================
CREATE OR REPLACE FUNCTION compliance_company_kpis(
  p_ids       uuid[],
  p_sale_from date,
  p_sale_to   date,
  p_xfer_from timestamptz,
  p_xfer_to   timestamptz
) RETURNS TABLE (
  company_id            uuid,
  user_count            bigint,
  sale_count            bigint,
  pending_review_count  bigint,
  completed_count       bigint,
  cancelled_count       bigint,
  gross_value           numeric,
  transfer_count        bigint
) LANGUAGE sql STABLE AS $$
  WITH u AS (
    SELECT company_id, count(*) AS c
    FROM user_company_roles
    WHERE is_active AND company_id = ANY(p_ids)
    GROUP BY company_id
  ), s AS (
    SELECT company_id,
           count(*)                                                              AS c,
           count(*) FILTER (WHERE status = 'pending_review')                     AS pend,
           count(*) FILTER (WHERE status IN ('closed_won', 'sold'))              AS comp,
           count(*) FILTER (WHERE status IN ('cancelled', 'compliance_cancelled')) AS canc,
           COALESCE(sum(down_payment), 0)                                        AS gross
    FROM sales
    WHERE company_id = ANY(p_ids)
      AND (p_sale_from IS NULL OR sale_date >= p_sale_from)
      AND (p_sale_to   IS NULL OR sale_date <= p_sale_to)
    GROUP BY company_id
  ), t AS (
    SELECT company_id, count(*) AS c
    FROM transfers
    WHERE company_id = ANY(p_ids)
      AND (p_xfer_from IS NULL OR created_at >= p_xfer_from)
      AND (p_xfer_to   IS NULL OR created_at <= p_xfer_to)
    GROUP BY company_id
  ), keys AS (
    SELECT company_id FROM u
    UNION SELECT company_id FROM s
    UNION SELECT company_id FROM t
  )
  SELECT k.company_id,
         COALESCE(u.c, 0), COALESCE(s.c, 0), COALESCE(s.pend, 0),
         COALESCE(s.comp, 0), COALESCE(s.canc, 0), COALESCE(s.gross, 0),
         COALESCE(t.c, 0)
  FROM keys k
  LEFT JOIN u ON u.company_id = k.company_id
  LEFT JOIN s ON s.company_id = k.company_id
  LEFT JOIN t ON t.company_id = k.company_id;
$$;

GRANT EXECUTE ON FUNCTION compliance_company_kpis(uuid[], date, date, timestamptz, timestamptz)
  TO service_role, authenticated, anon;

NOTIFY pgrst, 'reload schema';
