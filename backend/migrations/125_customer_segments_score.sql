-- ============================================================================
-- 125_customer_segments_score.sql
-- Adds a value SCORE to v_customer_segments so the Customer Profiles browser can
-- rank best customers first (stars rise to the top). Supersedes 124's view
-- definition — re-creates it identically plus a computed `score` column.
--
-- score mirrors the app's star logic:
--   base 3, +1 each at >=1 and >=3 active policies, -1 each at >=1 and >=3
--   cancellations, and a hard floor of 0 for "chased a lot, never bought".
-- Read-only view, idempotent. The browse endpoint orders by score by default.
-- ============================================================================
-- Drop first so re-running in any order can't hit Postgres 42P16 ("cannot drop
-- columns from view"). Safe — nothing in the DB depends on this view.
DROP VIEW IF EXISTS v_customer_segments;
CREATE OR REPLACE VIEW v_customer_segments AS
SELECT
  base.*,
  CASE
    WHEN base.sales_total = 0 AND base.transfers_total >= 2 THEN 0
    ELSE GREATEST(0, LEAST(5,
        3
      + (CASE WHEN base.active_policies >= 1 THEN 1 ELSE 0 END)
      + (CASE WHEN base.active_policies >= 3 THEN 1 ELSE 0 END)
      - (CASE WHEN base.cancellations  >= 1 THEN 1 ELSE 0 END)
      - (CASE WHEN base.cancellations  >= 3 THEN 1 ELSE 0 END)
    ))
  END AS score
FROM (
  WITH s AS (
    SELECT
      customer_uuid,
      count(*)                                                              AS sales_total,
      count(*) FILTER (WHERE status = 'closed_won' AND superseded_by IS NULL) AS active_policies,
      count(*) FILTER (WHERE status = 'closed_won')                         AS won_total,
      count(*) FILTER (
        WHERE cancellation_date IS NOT NULL
           OR status IN ('cancelled', 'compliance_cancelled', 'closed_lost', 'chargeback')
      )                                                                     AS cancellations,
      count(DISTINCT plan) FILTER (WHERE plan IS NOT NULL AND plan <> '')   AS plan_count,
      count(*) FILTER (WHERE is_resell)                                     AS resells,
      max(sale_date)                                                        AS last_sale_date,
      (array_agg(customer_name  ORDER BY sale_date DESC NULLS LAST))[1]     AS s_name,
      (array_agg(customer_phone ORDER BY sale_date DESC NULLS LAST))[1]     AS s_phone
    FROM sales
    WHERE customer_uuid IS NOT NULL
    GROUP BY customer_uuid
  ),
  t AS (
    SELECT
      customer_uuid,
      count(*)        AS transfers_total,
      max(created_at) AS last_transfer_at
    FROM transfers
    WHERE customer_uuid IS NOT NULL
    GROUP BY customer_uuid
  ),
  tn AS (
    SELECT DISTINCT ON (customer_uuid)
      customer_uuid,
      coalesce(
        form_data->>'customer_name',
        form_data->>'Name',
        nullif(trim(concat_ws(' ', form_data->>'FirstName', form_data->>'LastName')), '')
      )                  AS t_name,
      normalized_phone   AS t_phone
    FROM transfers
    WHERE customer_uuid IS NOT NULL
    ORDER BY customer_uuid, created_at DESC
  )
  SELECT
    coalesce(s.customer_uuid, t.customer_uuid)        AS customer_uuid,
    coalesce(s.s_name, tn.t_name)                     AS name,
    coalesce(s.s_phone, tn.t_phone)                   AS phone,
    coalesce(s.sales_total, 0)                        AS sales_total,
    coalesce(s.active_policies, 0)                    AS active_policies,
    coalesce(s.won_total, 0)                          AS won_total,
    coalesce(s.cancellations, 0)                      AS cancellations,
    coalesce(s.plan_count, 0)                         AS plan_count,
    coalesce(s.resells, 0)                            AS resells,
    coalesce(t.transfers_total, 0)                    AS transfers_total,
    s.last_sale_date,
    t.last_transfer_at,
    greatest(
      coalesce(s.last_sale_date::timestamptz, 'epoch'::timestamptz),
      coalesce(t.last_transfer_at,            'epoch'::timestamptz)
    )                                                 AS last_activity
  FROM s
  FULL OUTER JOIN t  ON s.customer_uuid = t.customer_uuid
  LEFT JOIN tn ON tn.customer_uuid = coalesce(s.customer_uuid, t.customer_uuid)
) base;
