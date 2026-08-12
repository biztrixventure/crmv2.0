-- ============================================================================
-- 248_payout_kpis_multi_value.sql
-- Compliance Sales tab filters (Company, Client, Status, Closer, DP Status,
-- Payout Status) became multi-select. The main sales list already handles a
-- comma-separated list of any of these via .in() — this migration is only
-- for the three payout KPI aggregate RPCs (243/244/247), which took a single
-- p_company_id/p_client_name and now need arrays so the KPI cards agree with
-- whatever the operator multi-selected in the filter bar.
--
-- Postgres identifies a function by name + ARGUMENT TYPES, so changing
-- uuid -> uuid[] / text -> text[] is a new overload, not a replacement —
-- the old single-value signatures are explicitly dropped first so nothing
-- is left calling the pre-array version.
-- ============================================================================
DROP FUNCTION IF EXISTS payout_kpis(uuid, text, date, date, text);
DROP FUNCTION IF EXISTS payout_confirmed_kpis(uuid, text, date, date, text);
DROP FUNCTION IF EXISTS payout_kpis_by_client(uuid, text[], date, date, text);

CREATE OR REPLACE FUNCTION payout_kpis(
  p_company_ids  uuid[],
  p_client_names text[],
  p_date_from    date,
  p_date_to      date,
  p_search       text
) RETURNS TABLE (
  payout_status text,
  cnt           bigint,
  gross         numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    payout_status,
    count(*)                        AS cnt,
    COALESCE(sum(down_payment), 0)  AS gross
  FROM sales
  WHERE compliance_reviewed_at IS NOT NULL
    AND (p_company_ids  IS NULL OR company_id  = ANY(p_company_ids))
    AND (p_client_names IS NULL OR client_name = ANY(p_client_names))
    AND (p_date_from    IS NULL OR sale_date  >= p_date_from)
    AND (p_date_to      IS NULL OR sale_date  <= p_date_to)
    AND (p_search IS NULL OR p_search = '' OR
         customer_name  ILIKE '%'||p_search||'%' OR
         customer_phone ILIKE '%'||p_search||'%' OR
         reference_no   ILIKE '%'||p_search||'%')
  GROUP BY payout_status;
$$;

CREATE OR REPLACE FUNCTION payout_confirmed_kpis(
  p_company_ids  uuid[],
  p_client_names text[],
  p_date_from    date,
  p_date_to      date,
  p_search       text
) RETURNS TABLE (
  payout_confirmed text,
  cnt               bigint,
  gross             numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    payout_confirmed,
    count(*)                        AS cnt,
    COALESCE(sum(down_payment), 0)  AS gross
  FROM sales
  WHERE compliance_reviewed_at IS NOT NULL
    AND (p_company_ids  IS NULL OR company_id  = ANY(p_company_ids))
    AND (p_client_names IS NULL OR client_name = ANY(p_client_names))
    AND (p_date_from    IS NULL OR sale_date  >= p_date_from)
    AND (p_date_to      IS NULL OR sale_date  <= p_date_to)
    AND (p_search IS NULL OR p_search = '' OR
         customer_name  ILIKE '%'||p_search||'%' OR
         customer_phone ILIKE '%'||p_search||'%' OR
         reference_no   ILIKE '%'||p_search||'%')
  GROUP BY payout_confirmed;
$$;

-- p_client_names here keeps its original meaning: the Business-Rules
-- configured "always show these clients" list, NOT the operator's Client
-- filter — so this one stays a required (non-null) filter, unlike the two
-- above where NULL means "no filter".
CREATE OR REPLACE FUNCTION payout_kpis_by_client(
  p_company_ids  uuid[],
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
    AND (p_company_ids IS NULL OR company_id = ANY(p_company_ids))
    AND (p_date_from   IS NULL OR sale_date  >= p_date_from)
    AND (p_date_to     IS NULL OR sale_date  <= p_date_to)
    AND (p_search IS NULL OR p_search = '' OR
         customer_name  ILIKE '%'||p_search||'%' OR
         customer_phone ILIKE '%'||p_search||'%' OR
         reference_no   ILIKE '%'||p_search||'%')
  GROUP BY client_name, payout_status;
$$;

GRANT EXECUTE ON FUNCTION payout_kpis(uuid[], text[], date, date, text)
  TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION payout_confirmed_kpis(uuid[], text[], date, date, text)
  TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION payout_kpis_by_client(uuid[], text[], date, date, text)
  TO service_role, authenticated, anon;

INSERT INTO schema_migrations (filename, note)
VALUES ('248_payout_kpis_multi_value.sql', 'payout_kpis/payout_confirmed_kpis/payout_kpis_by_client take uuid[]/text[] for multi-select Company + Client filters')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
