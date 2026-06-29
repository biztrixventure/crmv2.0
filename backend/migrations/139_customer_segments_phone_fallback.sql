-- ============================================================================
-- 139_customer_segments_phone_fallback.sql
-- FIX: blank phone in the Customer Profiles browse list. The matview (137) took
-- s_phone = newest sale's customer_phone column only. But many rows carry the
-- phone inside form_data (the customer_uuid trigger 079 already coalesces
-- Phone/phone/customer_phone/Mobile/CellPhone), and the newest sale's column can
-- be NULL while an older one has it. Rebuild phone to the newest NON-NULL value
-- across column + customer_phone_2 + form_data keys, on both sale and transfer
-- side. Column shape is unchanged — browse() reads it as-is.
--
-- Identical structure to 137; only the two phone expressions changed.
-- ============================================================================
DROP MATERIALIZED VIEW IF EXISTS v_customer_segments;

CREATE MATERIALIZED VIEW v_customer_segments AS
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
      (array_agg(
         COALESCE(
           NULLIF(customer_phone, ''), NULLIF(customer_phone_2, ''),
           NULLIF(form_data->>'Phone', ''), NULLIF(form_data->>'phone', ''),
           NULLIF(form_data->>'customer_phone', ''), NULLIF(form_data->>'Mobile', ''),
           NULLIF(form_data->>'CellPhone', '')
         ) ORDER BY sale_date DESC NULLS LAST
       ) FILTER (WHERE COALESCE(
           NULLIF(customer_phone, ''), NULLIF(customer_phone_2, ''),
           NULLIF(form_data->>'Phone', ''), NULLIF(form_data->>'phone', ''),
           NULLIF(form_data->>'customer_phone', ''), NULLIF(form_data->>'Mobile', ''),
           NULLIF(form_data->>'CellPhone', '')
         ) IS NOT NULL)
      )[1]                                                                  AS s_phone
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
      COALESCE(
        NULLIF(normalized_phone, ''),
        NULLIF(form_data->>'Phone', ''), NULLIF(form_data->>'phone', ''),
        NULLIF(form_data->>'customer_phone', ''), NULLIF(form_data->>'Mobile', ''),
        NULLIF(form_data->>'CellPhone', '')
      )                  AS t_phone
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
) base
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vcs_customer_uuid ON v_customer_segments (customer_uuid);
CREATE INDEX IF NOT EXISTS idx_vcs_score      ON v_customer_segments (score DESC);
CREATE INDEX IF NOT EXISTS idx_vcs_transfers  ON v_customer_segments (transfers_total DESC);
CREATE INDEX IF NOT EXISTS idx_vcs_active     ON v_customer_segments (active_policies DESC);
CREATE INDEX IF NOT EXISTS idx_vcs_cancels    ON v_customer_segments (cancellations DESC);
CREATE INDEX IF NOT EXISTS idx_vcs_activity   ON v_customer_segments (last_activity DESC);

NOTIFY pgrst, 'reload schema';
