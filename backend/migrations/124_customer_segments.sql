-- ============================================================================
-- 124_customer_segments.sql
-- Per-customer rollup so the Customer Profiles browser can FILTER customers by
-- behaviour/value: who was chased a lot but never bought, who holds many active
-- policies (good/star customers), who cancels (at-risk), resellers, etc.
--
-- One row per customer_uuid, aggregating sales + transfers. Read-only view, no
-- new tables — safe to (re)create. The browse endpoint falls back to the simple
-- search if this view is missing, so applying it is non-breaking either way.
--
-- Status semantics mirror the app:
--   active policy = status='closed_won' AND superseded_by IS NULL
--   cancellation  = cancellation_date set OR status in the terminal set
-- ============================================================================
CREATE OR REPLACE VIEW v_customer_segments AS
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
LEFT JOIN tn ON tn.customer_uuid = coalesce(s.customer_uuid, t.customer_uuid);
