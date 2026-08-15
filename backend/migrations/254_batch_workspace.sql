-- ============================================================================
-- 254_batch_workspace.sql
-- Batches become the ONE surface for lead distribution: upload a file at any
-- level, keep every column the file carried, assign down to any user, and watch
-- the work come back up. Builds on 153/158/159 — nothing here is a rewrite.
--
--   • batches gain source='upload' + the file name + the file's column order.
--   • items gain `data` (every non-phone column, verbatim), `parent_item_id`
--     (per-NUMBER lineage — 153 only had per-BATCH lineage), and the assignment
--     stamp (assigned_to / at / by).
--   • statuses gain the fronter dispositions: not_interested, answering_machine,
--     no_answer, plus 'assigned' (locked to a person, not yet worked).
--   • ASSIGNMENT IS A LOCK: handing a number down stamps assigned_to on the
--     parent row, so the same number can never be dealt to a second fronter.
--     The parent keeps the row (upper command still sees all 1000).
--   • fn_mirror_item_status: a fronter's disposition/note walks UP the
--     parent_item_id chain, so every level above sees the live outcome without
--     opening the child batch.
--   • distribution_batch_item_events: append-only who-did-what-when per number.
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================

-- ── batches: uploads are a first-class origin ────────────────────────────────
ALTER TABLE distribution_batches
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS columns   jsonb NOT NULL DEFAULT '[]'::jsonb;   -- the file's header order

ALTER TABLE distribution_batches DROP CONSTRAINT IF EXISTS distribution_batches_source_check;
ALTER TABLE distribution_batches ADD  CONSTRAINT distribution_batches_source_check
  CHECK (source IN ('data_analyzer', 'sub_batch', 'upload'));

-- ── items: the file's other columns, per-number lineage, assignment lock ─────
ALTER TABLE distribution_batch_items
  ADD COLUMN IF NOT EXISTS data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS parent_item_id uuid REFERENCES distribution_batch_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_to    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at    timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS worked_at      timestamptz;

ALTER TABLE distribution_batch_items DROP CONSTRAINT IF EXISTS distribution_batch_items_status_check;
ALTER TABLE distribution_batch_items ADD  CONSTRAINT distribution_batch_items_status_check
  CHECK (status IN ('new','assigned','called','callback','completed','skip','transferred',
                    'not_interested','answering_machine','no_answer','excluded'));

CREATE INDEX IF NOT EXISTS idx_dbitem_parent_item ON distribution_batch_items(parent_item_id);
CREATE INDEX IF NOT EXISTS idx_dbitem_assigned_to ON distribution_batch_items(assigned_to);
CREATE INDEX IF NOT EXISTS idx_dbitem_status      ON distribution_batch_items(batch_id, status);

-- ── who did what, when — one row per action, never updated ───────────────────
CREATE TABLE IF NOT EXISTS distribution_batch_item_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid NOT NULL REFERENCES distribution_batch_items(id) ON DELETE CASCADE,
  batch_id    uuid NOT NULL REFERENCES distribution_batches(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action      text NOT NULL,            -- assigned | status | note | uploaded
  from_status text,
  to_status   text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dbie_item  ON distribution_batch_item_events(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dbie_batch ON distribution_batch_item_events(batch_id, created_at DESC);
ALTER TABLE distribution_batch_item_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dbie_all ON distribution_batch_item_events;
CREATE POLICY dbie_all ON distribution_batch_item_events FOR ALL USING (true);

-- ── a fronter's outcome climbs the chain ─────────────────────────────────────
-- The fronter works the CHILD row; every ancestor row mirrors status/notes so a
-- manager (or superadmin, N hops up) reads the live outcome on the row they
-- already have open. Depth guard: the mirroring UPDATE re-fires this trigger,
-- so anything past the first hop is walked by the loop, not by recursion.
CREATE OR REPLACE FUNCTION fn_mirror_item_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_parent uuid; v_guard int := 0;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.notes IS NOT DISTINCT FROM OLD.notes THEN
    RETURN NEW;
  END IF;
  v_parent := NEW.parent_item_id;
  WHILE v_parent IS NOT NULL AND v_guard < 20 LOOP
    UPDATE distribution_batch_items
       SET status     = NEW.status,
           notes      = COALESCE(NEW.notes, notes),
           worked_at  = now(),
           updated_at = now()
     WHERE id = v_parent
    RETURNING parent_item_id INTO v_parent;
    v_guard := v_guard + 1;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mirror_item_status ON distribution_batch_items;
CREATE TRIGGER trg_mirror_item_status
  AFTER UPDATE ON distribution_batch_items
  FOR EACH ROW EXECUTE FUNCTION fn_mirror_item_status();

-- ── one batch's items, paged + filtered (a batch is 1000+ rows) ──────────────
-- Assignment/holder names are resolved by the route (user_profiles lives outside
-- this table); this returns the raw row + a stable total so the UI can page.
CREATE OR REPLACE FUNCTION app_batch_items(
  p_batch_id uuid,
  p_status   text DEFAULT NULL,
  p_search   text DEFAULT NULL,
  p_assigned text DEFAULT NULL,     -- 'yes' | 'no' | NULL
  p_limit    int  DEFAULT 100,
  p_offset   int  DEFAULT 0
) RETURNS TABLE (
  id uuid, phone_number text, lead_id text, customer_name text, status text,
  notes text, exclusion_reason text, "position" int, data jsonb,
  parent_item_id uuid, assigned_to uuid, assigned_at timestamptz, assigned_by uuid,
  worked_at timestamptz, created_at timestamptz, total_count bigint
) LANGUAGE sql STABLE AS $$
  SELECT i.id, i.phone_number, i.lead_id, i.customer_name, i.status,
         i.notes, i.exclusion_reason, i.position, i.data,
         i.parent_item_id, i.assigned_to, i.assigned_at, i.assigned_by,
         i.worked_at, i.created_at,
         COUNT(*) OVER()::bigint
  FROM distribution_batch_items i
  WHERE i.batch_id = p_batch_id
    AND (p_status IS NULL OR p_status = '' OR i.status = p_status)
    AND (p_assigned IS NULL OR (p_assigned = 'yes' AND i.assigned_to IS NOT NULL)
                            OR (p_assigned = 'no'  AND i.assigned_to IS NULL))
    AND (p_search IS NULL OR p_search = ''
         OR i.phone_number ILIKE '%'||p_search||'%'
         OR COALESCE(i.customer_name,'') ILIKE '%'||p_search||'%'
         OR COALESCE(i.notes,'') ILIKE '%'||p_search||'%'
         OR i.data::text ILIKE '%'||p_search||'%')
  ORDER BY i.position ASC NULLS LAST, i.created_at ASC
  LIMIT GREATEST(COALESCE(p_limit,100),0) OFFSET GREATEST(COALESCE(p_offset,0),0);
$$;

-- ── per-batch disposition counts — drives the status tabs ────────────────────
CREATE OR REPLACE FUNCTION app_batch_status_counts(p_batch_id uuid)
RETURNS TABLE (status text, n bigint, assigned bigint) LANGUAGE sql STABLE AS $$
  SELECT status, count(*)::bigint, count(*) FILTER (WHERE assigned_to IS NOT NULL)::bigint
  FROM distribution_batch_items WHERE batch_id = p_batch_id GROUP BY status;
$$;

GRANT EXECUTE ON FUNCTION app_batch_items(uuid, text, text, text, int, int) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION app_batch_status_counts(uuid)                     TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
