-- ============================================================================
-- 309 — payout KPIs count APPROVED sales, not just stamped ones
--
-- Symptom: Compliance → All Sales, filtered to one client and one week, showed
-- MATCHES 23 while the payout tiles read Payout Yes 20 + Payout No 2 = 22.
-- One sale was missing from the tiles and from the DP Status money totals.
--
-- Cause: these three functions gate on `compliance_reviewed_at IS NOT NULL`.
-- A sale can reach closed_won through the generic update route (PUT /sales/:id),
-- which sets status without stamping that column — six sales are in that state.
-- They are counted as APPROVED by the list and its status tiles, then silently
-- dropped by every payout aggregate, so the two never reconcile.
--
-- The row cells, the Update popup and both payout write endpoints were already
-- corrected to read eligibility as "approved" (commit c47851d). These aggregates
-- were missed, which is why a column could show a value the tiles did not count.
--
-- Fix: the same definition of approved everywhere —
--     compliance_reviewed_at IS NOT NULL OR status = 'closed_won'
--
-- Sales still in `open` or `pending_review` stay excluded, which is correct:
-- nothing is payable before it is approved. Verified on the reported window
-- (client Express Service, 2026-08-17..23): yes 21 + no 2 = 23, matching the
-- list exactly, where before it was 20 + 2 = 22.
--
-- Idempotent — CREATE OR REPLACE only, no data is touched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.payout_kpis(
  p_company_ids uuid[], p_client_names text[], p_date_from date, p_date_to date, p_search text
) RETURNS TABLE(payout_status text, cnt bigint, gross numeric)
LANGUAGE sql STABLE AS $function$
  SELECT
    payout_status,
    count(*)                        AS cnt,
    COALESCE(sum(down_payment), 0)  AS gross
  FROM sales
  WHERE (compliance_reviewed_at IS NOT NULL OR status = 'closed_won')
    AND (p_company_ids  IS NULL OR company_id  = ANY(p_company_ids))
    AND (p_client_names IS NULL OR client_name = ANY(p_client_names))
    AND (p_date_from    IS NULL OR sale_date  >= p_date_from)
    AND (p_date_to      IS NULL OR sale_date  <= p_date_to)
    AND (p_search IS NULL OR p_search = '' OR
         customer_name  ILIKE '%'||p_search||'%' OR
         customer_phone ILIKE '%'||p_search||'%' OR
         reference_no   ILIKE '%'||p_search||'%')
  GROUP BY payout_status;
$function$;

CREATE OR REPLACE FUNCTION public.payout_confirmed_kpis(
  p_company_ids uuid[], p_client_names text[], p_date_from date, p_date_to date, p_search text
) RETURNS TABLE(payout_confirmed text, cnt bigint, gross numeric)
LANGUAGE sql STABLE AS $function$
  SELECT
    payout_confirmed,
    count(*)                        AS cnt,
    COALESCE(sum(down_payment), 0)  AS gross
  FROM sales
  WHERE (compliance_reviewed_at IS NOT NULL OR status = 'closed_won')
    AND (p_company_ids  IS NULL OR company_id  = ANY(p_company_ids))
    AND (p_client_names IS NULL OR client_name = ANY(p_client_names))
    AND (p_date_from    IS NULL OR sale_date  >= p_date_from)
    AND (p_date_to      IS NULL OR sale_date  <= p_date_to)
    AND (p_search IS NULL OR p_search = '' OR
         customer_name  ILIKE '%'||p_search||'%' OR
         customer_phone ILIKE '%'||p_search||'%' OR
         reference_no   ILIKE '%'||p_search||'%')
  GROUP BY payout_confirmed;
$function$;

CREATE OR REPLACE FUNCTION public.payout_kpis_by_client(
  p_company_ids uuid[], p_client_names text[], p_date_from date, p_date_to date, p_search text
) RETURNS TABLE(client_name text, payout_status text, cnt bigint, gross numeric)
LANGUAGE sql STABLE AS $function$
  SELECT
    client_name,
    payout_status,
    count(*)                        AS cnt,
    COALESCE(sum(down_payment), 0)  AS gross
  FROM sales
  WHERE (compliance_reviewed_at IS NOT NULL OR status = 'closed_won')
    AND client_name = ANY(p_client_names)
    AND (p_company_ids IS NULL OR company_id = ANY(p_company_ids))
    AND (p_date_from   IS NULL OR sale_date  >= p_date_from)
    AND (p_date_to     IS NULL OR sale_date  <= p_date_to)
    AND (p_search IS NULL OR p_search = '' OR
         customer_name  ILIKE '%'||p_search||'%' OR
         customer_phone ILIKE '%'||p_search||'%' OR
         reference_no   ILIKE '%'||p_search||'%')
  GROUP BY client_name, payout_status;
$function$;
