-- ============================================================================
-- 137_customer_segments_matview.sql
-- Cache the customer-segments aggregation. The live view re-aggregated sales +
-- transfers and sorted by a computed score on EVERY browse. Convert it to a
-- MATERIALIZED VIEW with indexes (incl. score) so /customer-profile/browse just
-- scans pre-computed, indexed rows — top-N in ms. A scheduled job refreshes it
-- (see utils/scheduler.js) via refresh_customer_segments().
--
-- Populated WITH DATA on create, so browse works immediately. CONCURRENTLY
-- refresh needs the UNIQUE index on customer_uuid. Same column shape as the view,
-- so the browse endpoint is unchanged.
-- ============================================================================
DROP VIEW IF EXISTS v_customer_segments;
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
) base
WITH DATA;

-- UNIQUE index → enables REFRESH ... CONCURRENTLY (non-blocking refresh).
CREATE UNIQUE INDEX IF NOT EXISTS uq_vcs_customer_uuid ON v_customer_segments (customer_uuid);
-- Sort columns the browse endpoint orders by.
CREATE INDEX IF NOT EXISTS idx_vcs_score      ON v_customer_segments (score DESC);
CREATE INDEX IF NOT EXISTS idx_vcs_transfers  ON v_customer_segments (transfers_total DESC);
CREATE INDEX IF NOT EXISTS idx_vcs_active     ON v_customer_segments (active_policies DESC);
CREATE INDEX IF NOT EXISTS idx_vcs_cancels    ON v_customer_segments (cancellations DESC);
CREATE INDEX IF NOT EXISTS idx_vcs_activity   ON v_customer_segments (last_activity DESC);

-- Refresh entry point the scheduler calls via supabase.rpc('refresh_customer_segments').
-- SECURITY DEFINER so the service role can run the REFRESH. Falls back to a plain
-- (locking) refresh if CONCURRENTLY can't run (e.g. first refresh after a manual
-- non-CONCURRENT state).
CREATE OR REPLACE FUNCTION refresh_customer_segments()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY v_customer_segments;
EXCEPTION WHEN OTHERS THEN
  REFRESH MATERIALIZED VIEW v_customer_segments;
END;
$$;

-- Tell PostgREST/Supabase to pick up the new object so the REST API can read it.
NOTIFY pgrst, 'reload schema';
