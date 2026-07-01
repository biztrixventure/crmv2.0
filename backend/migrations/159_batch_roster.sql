-- ============================================================================
-- 159_batch_roster.sql   (Batch UI/UX upgrade — Phase B)
-- Cross-chain "all assigned numbers" roster. One row per distribution_batch_item
-- (per-assignment), with the item's current holder + its hop depth in the tree.
--
-- Scoping (done set-based inside the RPC, no N+1):
--   * unrestricted (superadmin / compliance / readonly): all active items.
--   * manager: DOMAIN = tree(roots = batches they sent OR received, + all
--     descendants via recursive parent_batch_id walk)  UNION  company-fronter
--     batches (any active batch whose recipient is a fronter in the manager's
--     companies — deliberately includes bypass batches sent straight to a fronter).
--
-- hop / chain_len come from a batch-scale depth walk (batch_tree): hop = this
-- batch's depth from its tree root (1 = the original data_analyzer batch),
-- chain_len = the deepest hop in that tree, so the UI can show "hop K of M".
-- Lineage itself stays on-demand (the row expands via /:id/lineage) — NOT here.
--
-- total_count: COUNT(*) OVER() only on page 1 (p_offset = 0); later pages emit 0
-- so the window count isn't recomputed every page (same pattern as 157/Y3). The
-- window function is injected dynamically so it's ABSENT from the plan past page 1.
-- Apply in Supabase SQL editor. CREATE OR REPLACE — safe to re-run.
-- ============================================================================
CREATE OR REPLACE FUNCTION app_batch_roster(
  p_user         uuid,
  p_unrestricted boolean DEFAULT false,
  p_company_ids  uuid[]  DEFAULT NULL,
  p_search       text    DEFAULT NULL,
  p_status       text    DEFAULT NULL,
  p_company_id   uuid    DEFAULT NULL,
  p_date_from    date    DEFAULT NULL,
  p_date_to      date    DEFAULT NULL,
  p_limit        int     DEFAULT 100,
  p_offset       int     DEFAULT 0
) RETURNS TABLE (
  item_id          uuid,
  phone_number     text,
  customer_name    text,
  status           text,
  exclusion_reason text,
  "position"       int,
  batch_id         uuid,
  batch_name       text,
  holder_id        uuid,
  sender_id        uuid,
  company_id       uuid,
  sent_at          timestamptz,
  hop              int,
  chain_len        int,
  total_count      bigint
) LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_count text := CASE WHEN GREATEST(COALESCE(p_offset, 0), 0) = 0 THEN 'COUNT(*) OVER()' ELSE '0' END;
BEGIN
  RETURN QUERY EXECUTE format($q$
    WITH RECURSIVE
    -- absolute depth + tree root for every batch (batch-scale, cheap)
    batch_tree AS (
      SELECT id, id AS root_id, 1 AS depth
      FROM distribution_batches WHERE parent_batch_id IS NULL
      UNION ALL
      SELECT b.id, bt.root_id, bt.depth + 1
      FROM distribution_batches b JOIN batch_tree bt ON b.parent_batch_id = bt.id
    ),
    tree_max AS (SELECT root_id, max(depth) AS chain_len FROM batch_tree GROUP BY root_id),
    -- manager domain (skipped when unrestricted: roots gated by $2=false)
    roots AS (
      SELECT id FROM distribution_batches
      WHERE status = 'active' AND $2 = false AND (created_by = $1 OR sent_to_user_id = $1)
    ),
    descendants AS (
      SELECT id FROM roots
      UNION
      SELECT b.id FROM distribution_batches b
      JOIN descendants d ON b.parent_batch_id = d.id
      WHERE b.status = 'active'
    ),
    cfront AS (
      SELECT ucr.user_id
      FROM user_company_roles ucr
      JOIN custom_roles cr ON cr.id = ucr.role_id
      WHERE $3 IS NOT NULL AND ucr.company_id = ANY($3)
        AND ucr.is_active = true AND cr.level = 'fronter'
    ),
    cbatches AS (
      SELECT b.id FROM distribution_batches b
      WHERE b.status = 'active' AND b.sent_to_user_id IN (SELECT user_id FROM cfront)
    ),
    domain AS (SELECT id FROM descendants UNION SELECT id FROM cbatches)
    SELECT
      i.id::uuid, i.phone_number::text, i.customer_name::text, i.status::text,
      i.exclusion_reason::text, i.position::int,
      b.id::uuid, b.name::text, b.sent_to_user_id::uuid, b.created_by::uuid,
      b.company_id::uuid, b.sent_at::timestamptz,
      bt.depth::int, tm.chain_len::int,
      (%1$s)::bigint
    FROM distribution_batch_items i
    JOIN distribution_batches b  ON b.id = i.batch_id
    JOIN batch_tree bt           ON bt.id = i.batch_id
    JOIN tree_max tm             ON tm.root_id = bt.root_id
    WHERE b.status = 'active'
      AND ($2 OR i.batch_id IN (SELECT id FROM domain))
      AND ($6::uuid IS NULL OR b.company_id = $6)
      AND ($5::text IS NULL OR $5 = '' OR i.status = $5)
      AND ($7::date IS NULL OR b.sent_at >= $7)
      AND ($8::date IS NULL OR b.sent_at < ($8 + 1))
      AND ($4::text IS NULL OR $4 = '' OR
           i.phone_number              ILIKE '%%'||$4||'%%' OR
           COALESCE(i.customer_name,'') ILIKE '%%'||$4||'%%' OR
           b.name                      ILIKE '%%'||$4||'%%')
    ORDER BY b.sent_at DESC, i.position ASC NULLS LAST
    LIMIT %2$s OFFSET %3$s
  $q$, v_count, GREATEST(COALESCE(p_limit,100),0), GREATEST(COALESCE(p_offset,0),0))
  USING p_user, p_unrestricted, p_company_ids, p_search, p_status, p_company_id, p_date_from, p_date_to;
END
$fn$;

GRANT EXECUTE ON FUNCTION app_batch_roster(uuid, boolean, uuid[], text, text, uuid, date, date, int, int)
  TO authenticated, anon, service_role;
