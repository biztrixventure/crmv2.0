-- ============================================================================
-- 247_payout_kpis_by_client.sql
-- Per-client DP Status breakdown for the Compliance Sales tab — a superadmin
-- picks which clients to break out (Business Rules → DP Status Clients,
-- business_config key 'compliance.dp_status_clients', a plain array of
-- client_name strings) and each gets its own DP Status card (All/Pending/
-- Paid/Reverted $ + count), independent of the sales list's own Client
-- column filter but still scoped by company/date/search — same posture as
-- payout_kpis() (mig 243), just grouped by client_name too.
-- ============================================================================
CREATE OR REPLACE FUNCTION payout_kpis_by_client(
  p_company_id   uuid,
  p_client_names text[],
  p_date_from    date,
  p_date_to      date,
  p_search       text
) RETURNS TABLE (
  client_name   text,
  payout_status text,
  cnt           bigint,
  gross         numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    client_name,
    payout_status,
    count(*)                        AS cnt,
    COALESCE(sum(down_payment), 0)  AS gross
  FROM sales
  WHERE compliance_reviewed_at IS NOT NULL
    AND client_name = ANY(p_client_names)
    AND (p_company_id  IS NULL OR company_id  = p_company_id)
    AND (p_date_from   IS NULL OR sale_date  >= p_date_from)
    AND (p_date_to     IS NULL OR sale_date  <= p_date_to)
    AND (p_search IS NULL OR p_search = '' OR
         customer_name  ILIKE '%'||p_search||'%' OR
         customer_phone ILIKE '%'||p_search||'%' OR
         reference_no   ILIKE '%'||p_search||'%')
  GROUP BY client_name, payout_status;
$$;

GRANT EXECUTE ON FUNCTION payout_kpis_by_client(uuid, text[], date, date, text)
  TO service_role, authenticated, anon;

INSERT INTO schema_migrations (filename, note)
VALUES ('247_payout_kpis_by_client.sql', 'Per-client DP Status breakdown RPC for the Business-Rules-configured client list')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
