-- ============================================================================
-- 184_double_sold_customers_view.sql   🕵️ compliance fraud signal (issue #6)
-- Cross-closer double-selling: a customer (customer_uuid = UUIDv5 of normalized
-- phone) whose lead was closed_won by >= 2 DISTINCT closer companies. This is a
-- resold-lead / double-dip fraud signal the fronter + compliance need to see.
--
-- View, not matview: the double-sold set is small (dozens), reads are on-demand
-- (compliance report + fronter badge), and it must reflect the newest sale with
-- no refresh lag. Backend reads it via service_role.
-- ============================================================================
CREATE OR REPLACE VIEW public.v_double_sold_customers AS
SELECT
  s.customer_uuid,
  count(DISTINCT s.company_id)                                   AS closer_company_count,
  array_agg(DISTINCT s.company_id)                              AS closer_company_ids,
  count(*)                                                       AS sale_count,
  min(s.created_at)                                             AS first_sale_at,
  max(s.created_at)                                             AS last_sale_at,
  (array_agg(s.customer_name    ORDER BY s.created_at DESC))[1] AS customer_name,
  (array_agg(s.normalized_phone ORDER BY s.created_at DESC))[1] AS normalized_phone
FROM public.sales s
WHERE s.status = 'closed_won'
  AND s.customer_uuid IS NOT NULL
GROUP BY s.customer_uuid
HAVING count(DISTINCT s.company_id) >= 2;

-- Lock down like the rest of the PII surface (mig 176/182 posture): backend-only.
REVOKE ALL ON public.v_double_sold_customers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_double_sold_customers TO service_role;
