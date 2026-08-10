-- ============================================================================
-- 243_sales_payout_status.sql
-- Payout tracking for the SuperAdmin Payout tab. A sale enters the payout
-- worklist the moment compliance approves it (compliance_reviewed_at is
-- stamped by POST /sales/:id/compliance-approve) and stays there even if it
-- is later cancelled — payout_status tracks whether the closer/company has
-- actually been PAID for that approval, independent of the sale's own
-- compliance status lifecycle (status / cancellation_date).
-- ============================================================================
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payout_status text NOT NULL DEFAULT 'pending'
  CHECK (payout_status IN ('pending', 'paid', 'reverted'));
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payout_updated_at timestamptz;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payout_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- The Payout tab lists only ever-approved sales, newest sale_date first.
CREATE INDEX IF NOT EXISTS idx_sales_compliance_reviewed_at
  ON sales (sale_date DESC) WHERE compliance_reviewed_at IS NOT NULL;

-- Per-payout-status count + down_payment sum, scoped by the same filters the
-- Payout tab's table uses (minus payout_status itself, so all three KPI tiles
-- stay comparable while the table narrows to one status). Aggregated in the
-- DB rather than summed in JS so a large approved-sales set never hits
-- PostgREST's max-rows cap the way fetching raw rows would (see
-- compliance.js's statusCountsExact for the same lesson applied to counts).
CREATE OR REPLACE FUNCTION payout_kpis(
  p_company_id  uuid,
  p_client_name text,
  p_date_from   date,
  p_date_to     date,
  p_search      text
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
    AND (p_company_id  IS NULL OR company_id  = p_company_id)
    AND (p_client_name IS NULL OR client_name = p_client_name)
    AND (p_date_from   IS NULL OR sale_date  >= p_date_from)
    AND (p_date_to     IS NULL OR sale_date  <= p_date_to)
    AND (p_search IS NULL OR p_search = '' OR
         customer_name  ILIKE '%'||p_search||'%' OR
         customer_phone ILIKE '%'||p_search||'%' OR
         reference_no   ILIKE '%'||p_search||'%')
  GROUP BY payout_status;
$$;

GRANT EXECUTE ON FUNCTION payout_kpis(uuid, text, date, date, text)
  TO service_role, authenticated, anon;

INSERT INTO schema_migrations (filename, note)
VALUES ('243_sales_payout_status.sql', 'Payout tab — sales.payout_status/payout_updated_at/payout_updated_by + payout_kpis() RPC')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
