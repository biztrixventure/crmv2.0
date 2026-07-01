-- ============================================================================
-- 153_distribution_batches.sql
-- First-class "batch distribution" entity with parent→child lineage and a
-- recursive cascading soft-delete. A batch is pulled from the Data Analyzer
-- (source='data_analyzer', parent_batch_id NULL) and re-sent downstream as
-- sub-batches (source='sub_batch', parent_batch_id = the batch it came from),
-- forming a tree: Data Analyzer → compliance_manager → fronter_manager → fronter.
--
-- Deleting a batch soft-deletes it AND its whole descendant subtree (recursive
-- CTE) so it disappears from every downstream view. Rows are kept (audit trail),
-- just flipped to status='deleted' — not revertable, just hidden.
--
-- Unit of distribution = normalized phone_number (per the audit: one phone can
-- map to many lead_ids; phone is the CRM's assignment unit). lead_id is
-- informational only.
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS distribution_batches (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  parent_batch_id uuid        REFERENCES distribution_batches(id) ON DELETE CASCADE,  -- NULL = original (from Data Analyzer)
  source          text        NOT NULL DEFAULT 'sub_batch' CHECK (source IN ('data_analyzer','sub_batch')),
  sent_to_user_id uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  company_id      uuid        REFERENCES companies(id) ON DELETE SET NULL,
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
  deleted_at      timestamptz,
  deleted_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  item_count      integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dbatch_parent     ON distribution_batches(parent_batch_id);
CREATE INDEX IF NOT EXISTS idx_dbatch_sent_to    ON distribution_batches(sent_to_user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_dbatch_created_by ON distribution_batches(created_by);

-- The unit rows. Items are hidden when their batch is deleted (queries filter to
-- active batches) — item work-status is preserved for audit, not overwritten.
CREATE TABLE IF NOT EXISTS distribution_batch_items (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      uuid        NOT NULL REFERENCES distribution_batches(id) ON DELETE CASCADE,
  phone_number  text        NOT NULL,     -- normalized digits
  lead_id       text,                     -- informational only (when known)
  customer_name text,
  status        text        NOT NULL DEFAULT 'new'
                CHECK (status IN ('new','called','callback','completed','skip','transferred')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dbitem_batch ON distribution_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_dbitem_phone ON distribution_batch_items(phone_number);

ALTER TABLE distribution_batches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE distribution_batch_items  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dbatch_all ON distribution_batches;
CREATE POLICY dbatch_all ON distribution_batches FOR ALL USING (true);
DROP POLICY IF EXISTS dbitem_all ON distribution_batch_items;
CREATE POLICY dbitem_all ON distribution_batch_items FOR ALL USING (true);

-- ── Cascading soft-delete: this batch + its whole descendant subtree ──────────
-- Single recursive CTE (efficient at any depth — no N+1), one UPDATE.
CREATE OR REPLACE FUNCTION app_delete_batch_cascade(p_batch_id uuid, p_deleted_by uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_count integer;
BEGIN
  WITH RECURSIVE tree AS (
    SELECT id FROM distribution_batches WHERE id = p_batch_id
    UNION ALL
    SELECT b.id FROM distribution_batches b JOIN tree t ON b.parent_batch_id = t.id
  )
  UPDATE distribution_batches d
     SET status = 'deleted', deleted_at = now(), deleted_by = p_deleted_by
    FROM tree
   WHERE d.id = tree.id AND d.status <> 'deleted';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- ── Lineage: ancestor chain (who pulled it + every hop) and descendant tree ───
CREATE OR REPLACE FUNCTION app_batch_ancestors(p_batch_id uuid)
RETURNS TABLE (id uuid, name text, created_by uuid, sent_to_user_id uuid, source text,
               parent_batch_id uuid, sent_at timestamptz, status text, depth int)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up AS (
    SELECT b.*, 0 AS depth FROM distribution_batches b WHERE b.id = p_batch_id
    UNION ALL
    SELECT p.*, up.depth + 1 FROM distribution_batches p JOIN up ON p.id = up.parent_batch_id
  )
  SELECT id, name, created_by, sent_to_user_id, source, parent_batch_id, sent_at, status, depth
  FROM up ORDER BY depth;
$$;

CREATE OR REPLACE FUNCTION app_batch_descendants(p_batch_id uuid)
RETURNS TABLE (id uuid, name text, created_by uuid, sent_to_user_id uuid, source text,
               parent_batch_id uuid, sent_at timestamptz, status text, depth int)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE down AS (
    SELECT b.*, 0 AS depth FROM distribution_batches b WHERE b.id = p_batch_id
    UNION ALL
    SELECT c.*, down.depth + 1 FROM distribution_batches c JOIN down ON c.parent_batch_id = down.id
  )
  SELECT id, name, created_by, sent_to_user_id, source, parent_batch_id, sent_at, status, depth
  FROM down ORDER BY depth, sent_at;
$$;

GRANT EXECUTE ON FUNCTION app_delete_batch_cascade(uuid, uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION app_batch_ancestors(uuid)            TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION app_batch_descendants(uuid)          TO authenticated, anon, service_role;
