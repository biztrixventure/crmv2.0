-- ============================================================================
-- 193 — Broader duplicate-sold view + sale-highlight source.
--
-- The old v_double_sold_customers (mig 184) only surfaced customers sold by >= 2
-- DISTINCT closer COMPANIES. Compliance also needs the wider duplicate picture:
-- the SAME number sold multiple times (even within one company), the same number
-- tied to DIFFERENT client names, or the same reference # used by different
-- closers. This view groups every real sale (status <> 'open') by customer
-- identity (customer_uuid = UUIDv5 of normalized phone) and exposes the counts
-- compliance sorts/filters by — and the ACTIVE count that drives the sale-record
-- highlight (recomputed live, so cancelling a sale changes the tint).
--
-- View (not matview): the duplicate set is small, reads are on-demand, and it
-- must reflect the newest sale + latest statuses with no refresh lag.
-- ============================================================================
CREATE OR REPLACE VIEW public.v_duplicate_sold_customers AS
SELECT
  s.customer_uuid,
  count(*)                                                              AS sale_count,
  count(*) FILTER (WHERE s.status IN ('closed_won','pending_review'))   AS active_sale_count,
  count(*) FILTER (WHERE s.status = 'closed_won')                       AS closed_won_count,
  count(*) FILTER (WHERE s.status = 'pending_review')                   AS pending_count,
  count(*) FILTER (WHERE s.status = 'cancelled')                        AS cancelled_count,
  count(DISTINCT s.company_id)                                          AS company_count,
  count(DISTINCT s.closer_id) FILTER (WHERE s.closer_id IS NOT NULL)    AS closer_count,
  count(DISTINCT lower(btrim(s.client_name)))
    FILTER (WHERE btrim(coalesce(s.client_name,'')) <> '')             AS client_count,
  count(DISTINCT upper(btrim(s.reference_no)))
    FILTER (WHERE btrim(coalesce(s.reference_no,'')) <> '')            AS reference_count,
  array_agg(DISTINCT s.company_id)                                      AS company_ids,
  min(s.created_at)                                                     AS first_sale_at,
  max(s.created_at)                                                     AS last_sale_at,
  (array_agg(s.customer_name    ORDER BY s.created_at DESC))[1]         AS customer_name,
  (array_agg(s.normalized_phone ORDER BY s.created_at DESC))[1]         AS normalized_phone
FROM public.sales s
WHERE s.customer_uuid IS NOT NULL
  AND s.status <> 'open'                     -- ignore un-submitted drafts
GROUP BY s.customer_uuid
HAVING count(*) >= 2;

-- Backend-only, same PII posture as mig 176/182/184.
REVOKE ALL ON public.v_duplicate_sold_customers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_duplicate_sold_customers TO service_role;

-- Index that makes the per-customer highlight lookups (customer_uuid IN (...))
-- and the view's grouping cheap.
CREATE INDEX IF NOT EXISTS idx_sales_customer_uuid_status
  ON public.sales (customer_uuid, status) WHERE customer_uuid IS NOT NULL;
