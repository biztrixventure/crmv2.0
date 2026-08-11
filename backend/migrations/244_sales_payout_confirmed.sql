-- ============================================================================
-- 244_sales_payout_confirmed.sql
-- Second, independent payout field for the merged Compliance Sales / Payout
-- section (mig 243 added the first one, `payout_status` pending/paid/reverted,
-- labeled "DP Status" in the UI). `payout_confirmed` is "Payout Status" in the
-- UI — a manual, three-state field a superadmin sets by hand (pending is the
-- default until someone decides yes/no), with no derived meaning or
-- automation behind it. Not applied yet as of this rewrite, so this replaces
-- the file in place rather than adding a follow-up migration for the
-- boolean → tri-state change.
-- ============================================================================
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payout_confirmed text NOT NULL DEFAULT 'pending'
  CHECK (payout_confirmed IN ('pending', 'yes', 'no'));

-- Per-payout_confirmed count + down_payment sum, scoped the same way
-- payout_kpis() (mig 243) scopes DP Status — company/client/date/search, not
-- payout_status/payout_confirmed themselves, so every bucket's tile stays
-- comparable while the table narrows to one.
CREATE OR REPLACE FUNCTION payout_confirmed_kpis(
  p_company_id  uuid,
  p_client_name text,
  p_date_from   date,
  p_date_to     date,
  p_search      text
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
    AND (p_company_id  IS NULL OR company_id  = p_company_id)
    AND (p_client_name IS NULL OR client_name = p_client_name)
    AND (p_date_from   IS NULL OR sale_date  >= p_date_from)
    AND (p_date_to     IS NULL OR sale_date  <= p_date_to)
    AND (p_search IS NULL OR p_search = '' OR
         customer_name  ILIKE '%'||p_search||'%' OR
         customer_phone ILIKE '%'||p_search||'%' OR
         reference_no   ILIKE '%'||p_search||'%')
  GROUP BY payout_confirmed;
$$;

GRANT EXECUTE ON FUNCTION payout_confirmed_kpis(uuid, text, date, date, text)
  TO service_role, authenticated, anon;

INSERT INTO schema_migrations (filename, note)
VALUES ('244_sales_payout_confirmed.sql', 'Payout Status — manual tri-state (pending/yes/no) flag + payout_confirmed_kpis() RPC')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
