-- ============================================================================
-- 323_batch_lookup_passed_on_active.sql
-- `passed_on` must mean "somebody BELOW is holding this right now", and a child
-- row in a DELETED or EXPIRED batch is nobody holding anything.
--
-- 322's version asked only whether a live child row existed. A deleted batch
-- keeps its item rows (the soft delete is what makes the audit trail work), so
-- an ancestor stayed flagged `passed_on` forever — and every caller skips a
-- passed-on row when deciding who holds a number. The number then read as held
-- by NOBODY while its parent row was still stamped with an agent, which is
-- exactly the duplicate the uniqueness check exists to catch. Found on a live
-- row: "Bisam - Manual Dial" holds a worked number whose child batch was
-- deleted, and the check could not see it.
--
-- Only the EXISTS subquery changes; the signature, the scoping and every other
-- column are 322's. Apply in the Supabase SQL editor. CREATE OR REPLACE — safe
-- to re-run.
-- ============================================================================
CREATE OR REPLACE FUNCTION app_batch_number_lookup(
  p_phones           text[],
  p_user             uuid,
  p_unrestricted     boolean DEFAULT false,
  p_company_ids      uuid[]  DEFAULT NULL,
  p_include_recalled boolean DEFAULT false,
  p_limit            int     DEFAULT 3000
) RETURNS TABLE (
  phone_number      text,
  item_id           uuid,
  batch_id          uuid,
  batch_name        text,
  batch_status      text,
  holder_id         uuid,
  sender_id         uuid,
  company_id        uuid,
  assigned_to       uuid,
  assigned_at       timestamptz,
  assign_expires_at timestamptz,
  batch_expires_at  timestamptz,
  status            text,
  customer_name     text,
  notes             text,
  worked_at         timestamptz,
  recalled_at       timestamptz,
  sent_at           timestamptz,
  hop               int,
  passed_on         boolean
) LANGUAGE sql STABLE AS $$
  WITH RECURSIVE
  batch_tree AS (
    SELECT id, id AS root_id, 1 AS depth
      FROM distribution_batches WHERE parent_batch_id IS NULL
    UNION ALL
    SELECT b.id, bt.root_id, bt.depth + 1
      FROM distribution_batches b JOIN batch_tree bt ON b.parent_batch_id = bt.id
  ),
  roots AS (
    SELECT id FROM distribution_batches
     WHERE p_unrestricted = false AND status <> 'deleted'
       AND (created_by = p_user OR sent_to_user_id = p_user)
  ),
  descendants AS (
    SELECT id FROM roots
    UNION
    SELECT b.id FROM distribution_batches b JOIN descendants d ON b.parent_batch_id = d.id
  ),
  cfront AS (
    SELECT ucr.user_id
      FROM user_company_roles ucr
      JOIN custom_roles cr ON cr.id = ucr.role_id
     WHERE p_unrestricted = false AND p_company_ids IS NOT NULL
       AND ucr.company_id = ANY(p_company_ids) AND ucr.is_active = true
       AND cr.level IN ('fronter', 'trainee', 'closer')
  ),
  cbatches AS (
    SELECT b.id FROM distribution_batches b
     WHERE b.status <> 'deleted' AND b.sent_to_user_id IN (SELECT user_id FROM cfront)
  ),
  domain AS (SELECT id FROM descendants UNION SELECT id FROM cbatches)
  SELECT
    i.phone_number, i.id, b.id, b.name, b.status,
    b.sent_to_user_id, b.created_by, b.company_id,
    i.assigned_to, i.assigned_at, i.assign_expires_at, b.expires_at,
    i.status, i.customer_name, i.notes, i.worked_at, i.recalled_at, b.sent_at,
    bt.depth,
    -- the fix: the child's batch has to still be ACTIVE for the row above it to
    -- count as handed on.
    EXISTS (SELECT 1
              FROM distribution_batch_items c
              JOIN distribution_batches cb ON cb.id = c.batch_id
             WHERE c.parent_item_id = i.id
               AND c.recalled_at IS NULL
               AND cb.status = 'active')
  FROM distribution_batch_items i
  JOIN distribution_batches b ON b.id = i.batch_id
  JOIN batch_tree bt          ON bt.id = i.batch_id
  WHERE b.status <> 'deleted'
    AND i.phone_number = ANY(p_phones)
    AND (p_include_recalled OR i.recalled_at IS NULL)
    AND (p_unrestricted OR i.batch_id IN (SELECT id FROM domain))
  ORDER BY i.phone_number, bt.depth, b.sent_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 3000), 1);
$$;

GRANT EXECUTE ON FUNCTION app_batch_number_lookup(text[], uuid, boolean, uuid[], boolean, int)
  TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
