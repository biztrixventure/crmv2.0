-- ============================================================================
-- 229_compliance_kpis_exclude_postdate.sql
-- compliance_company_kpis (mig 103) counted every sales row for sale_count
-- ("Total Sales" on the Compliance Overview company card) with no disposition
-- filter, so un-charged post-dated sales (status='open', disposition matches
-- post-date) were counted as sales even though nothing was charged yet — the
-- card's Total Sales could read higher than Approved for no visible reason.
-- See backend/utils/postDate.js — this RPC is exactly the counter its header
-- comment predicted would be missed ("the stat counters knew nothing about it").
--
-- NULL-safe (same trap as postDate.js's POST_DATE_OR): a plain
-- `disposition NOT ILIKE '%post%date%'` filter is NULL — not TRUE — for a NULL
-- disposition, which would silently drop every sale with no disposition set.
-- Keep rows where disposition IS NULL OR does not match the post-date pattern.
-- Charged post-dates have already had their disposition flipped to 'sale', so
-- they stay counted — which is the point.
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
           count(*) FILTER (WHERE closer_disposition IS NULL
                               OR closer_disposition NOT ILIKE '%post%date%')  AS c,
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
