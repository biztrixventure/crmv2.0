-- ============================================================================
-- 322_batch_assignment_expiry.sql
-- Numbers can now be LENT instead of given: an assignment carries a day/time
-- limit, the person holding them can see it ticking, and when it runs out the
-- numbers leave that person automatically. The same machinery powers the manual
-- "take these back" action and the cross-chain "who has this number" report.
--
--   • distribution_batches  + expires_at / expired_at / recalled_by, and a new
--     status 'expired' — the holder's list filters to status='active', so an
--     expired batch disappears from the person it was lent to without deleting
--     a single row of history.
--   • distribution_batch_items + assign_expires_at (the deadline, mirrored onto
--     the PARENT row so the assigner sees it on the row they already have open)
--     and recalled_at / recalled_by / recall_reason (the row is hidden from the
--     holder, never destroyed).
--   • fn_recall_batch_items() — ONE way to take numbers back, used by the manual
--     action, by the report's "take back", and by the expiry job. It walks DOWN
--     parent_item_id (the fronter's copy AND their fronters' copies), hides
--     every row it finds, writes a 'recalled' event per row, and releases the
--     lock on the assigner's row so the number can be dealt again — but only
--     when nobody worked it, because a disposition is history, not a draft.
--   • fn_expire_batch_assignments() — what the scheduler calls every 5 minutes.
--   • app_batch_number_lookup() — paste/upload a list of numbers and see which
--     of them are sitting with which user, scoped exactly like app_batch_roster
--     (159): unrestricted for superadmin/compliance, tree + company-fronters for
--     a manager.
--   • fn_mirror_item_status no longer climbs the chain for status 'new'. A
--     release is not an outcome: mirroring it upward reset an ancestor row to
--     "New" while it was still legitimately held by the manager below.
--
-- Apply in the Supabase SQL editor. Idempotent.
-- ============================================================================

-- ── batches: the deadline, and the state a batch reaches when it passes ──────
ALTER TABLE distribution_batches
  ADD COLUMN IF NOT EXISTS expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS expired_at  timestamptz,
  ADD COLUMN IF NOT EXISTS recalled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE distribution_batches DROP CONSTRAINT IF EXISTS distribution_batches_status_check;
ALTER TABLE distribution_batches ADD  CONSTRAINT distribution_batches_status_check
  CHECK (status IN ('active', 'deleted', 'expired'));

-- the expiry job's only scan: active batches carrying a deadline.
CREATE INDEX IF NOT EXISTS idx_dbatch_expires
  ON distribution_batches (expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;

-- ── items: the deadline on the row, and the take-back stamp ──────────────────
ALTER TABLE distribution_batch_items
  ADD COLUMN IF NOT EXISTS assign_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS recalled_at       timestamptz,
  ADD COLUMN IF NOT EXISTS recalled_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recall_reason     text;

-- every list of a batch's numbers filters out recalled rows, so that is the
-- index. The phone one serves the number lookup report.
CREATE INDEX IF NOT EXISTS idx_dbitem_live       ON distribution_batch_items (batch_id) WHERE recalled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dbitem_phone_live ON distribution_batch_items (phone_number) WHERE recalled_at IS NULL;

-- ── a release must not climb the chain ───────────────────────────────────────
-- Unchanged from 254 except the 'new' guard. Taking a number back sets the
-- assigner's row to 'new'; mirroring that upward told every level above that
-- the number was untouched and unheld, which is false — the levels above still
-- hold it. Notes still mirror, because a note IS information.
CREATE OR REPLACE FUNCTION fn_mirror_item_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_parent uuid; v_guard int := 0; v_notes_changed boolean;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.notes IS NOT DISTINCT FROM OLD.notes THEN
    RETURN NEW;
  END IF;
  v_notes_changed := NEW.notes IS DISTINCT FROM OLD.notes;
  -- a lock release ('new') carries no outcome — only follow it up when the note
  -- changed in the same write, and then carry only the note.
  IF NEW.status = 'new' AND NOT v_notes_changed THEN RETURN NEW; END IF;

  v_parent := NEW.parent_item_id;
  WHILE v_parent IS NOT NULL AND v_guard < 20 LOOP
    IF NEW.status = 'new' THEN
      UPDATE distribution_batch_items
         SET notes = COALESCE(NEW.notes, notes), updated_at = now()
       WHERE id = v_parent
      RETURNING parent_item_id INTO v_parent;
    ELSE
      UPDATE distribution_batch_items
         SET status     = NEW.status,
             notes      = COALESCE(NEW.notes, notes),
             worked_at  = now(),
             updated_at = now()
       WHERE id = v_parent
      RETURNING parent_item_id INTO v_parent;
    END IF;
    v_guard := v_guard + 1;
  END LOOP;
  RETURN NEW;
END $$;

-- ── the ONE take-back ────────────────────────────────────────────────────────
-- p_item_ids are the rows AS THE HOLDER HAS THEM (the child rows). Everything
-- below them goes too — a fronter manager who already passed them on cannot
-- leave a copy behind. Returns what actually moved so the caller can report it.
CREATE OR REPLACE FUNCTION fn_recall_batch_items(
  p_item_ids uuid[],
  p_actor    uuid    DEFAULT NULL,
  p_reason   text    DEFAULT NULL
) RETURNS TABLE (recalled integer, released integer)
LANGUAGE plpgsql AS $$
DECLARE
  v_recalled integer := 0;
  v_released integer := 0;
  v_batches  uuid[];
BEGIN
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    recalled := 0; released := 0; RETURN NEXT; RETURN;
  END IF;

  WITH RECURSIVE tree AS (
    SELECT i.id FROM distribution_batch_items i WHERE i.id = ANY(p_item_ids)
    UNION ALL
    SELECT c.id FROM distribution_batch_items c JOIN tree t ON c.parent_item_id = t.id
  ),
  hit AS (
    UPDATE distribution_batch_items i
       SET recalled_at       = now(),
           recalled_by       = p_actor,
           recall_reason     = p_reason,
           assign_expires_at = NULL,
           updated_at        = now()
     WHERE i.id IN (SELECT id FROM tree) AND i.recalled_at IS NULL
    RETURNING i.id, i.batch_id
  ),
  ev AS (
    INSERT INTO distribution_batch_item_events (item_id, batch_id, actor_id, action, note)
    SELECT h.id, h.batch_id, p_actor, 'recalled', p_reason FROM hit h
  ),
  -- the lock on the assigner's own row. Only the DIRECT parents of the named
  -- rows, and only ones nobody worked: a real disposition stays where it is.
  parents AS (
    UPDATE distribution_batch_items p
       SET assigned_to       = NULL,
           assigned_at       = NULL,
           assigned_by       = NULL,
           assign_expires_at = NULL,
           status            = 'new',
           updated_at        = now()
     WHERE p.id IN (SELECT x.parent_item_id FROM distribution_batch_items x
                     WHERE x.id = ANY(p_item_ids) AND x.parent_item_id IS NOT NULL)
       AND p.status = 'assigned'
    RETURNING p.id
  )
  SELECT (SELECT count(*) FROM hit), (SELECT count(*) FROM parents),
         (SELECT array_agg(DISTINCT h.batch_id) FROM hit h)
    INTO v_recalled, v_released, v_batches;

  -- item_count is what every list shows; a second statement so it counts what
  -- the UPDATE above actually left behind (a CTE would read the old snapshot).
  IF v_batches IS NOT NULL THEN
    UPDATE distribution_batches b
       SET item_count = (SELECT count(*) FROM distribution_batch_items x
                          WHERE x.batch_id = b.id AND x.recalled_at IS NULL)
     WHERE b.id = ANY(v_batches);
    -- a handed-down batch with nothing left in it is finished — drop it out of
    -- the holder's inbox instead of leaving an empty row they cannot act on.
    UPDATE distribution_batches b
       SET status = 'expired', expired_at = now()
     WHERE b.id = ANY(v_batches) AND b.parent_batch_id IS NOT NULL
       AND b.status = 'active' AND b.item_count = 0;
  END IF;

  recalled := v_recalled; released := v_released; RETURN NEXT;
END $$;

-- ── the deadline passing ─────────────────────────────────────────────────────
-- Called by the scheduler. Each expired batch has every live row taken back
-- (which cascades to anyone it was passed on to) and is itself marked expired,
-- along with its descendant batches. Returns one row per batch so the job can
-- tell the holder what left.
CREATE OR REPLACE FUNCTION fn_expire_batch_assignments(p_limit integer DEFAULT 200)
RETURNS TABLE (batch_id uuid, batch_name text, holder_id uuid, company_id uuid, recalled integer)
LANGUAGE plpgsql AS $$
DECLARE r record; v record;
BEGIN
  FOR r IN
    SELECT b.id, b.name, b.sent_to_user_id, b.company_id
      FROM distribution_batches b
     WHERE b.status = 'active' AND b.expires_at IS NOT NULL AND b.expires_at <= now()
     ORDER BY b.expires_at
     LIMIT GREATEST(COALESCE(p_limit, 200), 1)
  LOOP
    SELECT * INTO v FROM fn_recall_batch_items(
      ARRAY(SELECT i.id FROM distribution_batch_items i
             WHERE i.batch_id = r.id AND i.recalled_at IS NULL),
      NULL, 'time limit reached');

    UPDATE distribution_batches SET status = 'expired', expired_at = now() WHERE id = r.id;
    UPDATE distribution_batches d
       SET status = 'expired', expired_at = now()
     WHERE d.status = 'active' AND d.id <> r.id
       AND d.id IN (SELECT a.id FROM app_batch_descendants(r.id) a);

    batch_id := r.id; batch_name := r.name; holder_id := r.sent_to_user_id;
    company_id := r.company_id; recalled := COALESCE(v.recalled, 0);
    RETURN NEXT;
  END LOOP;
END $$;

-- ── one batch's items: recalled rows are gone, the deadline travels with the row
DROP FUNCTION IF EXISTS app_batch_items(uuid, text, text, text, int, int);
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
  assign_expires_at timestamptz,
  worked_at timestamptz, created_at timestamptz, total_count bigint
) LANGUAGE sql STABLE AS $$
  SELECT i.id, i.phone_number, i.lead_id, i.customer_name, i.status,
         i.notes, i.exclusion_reason, i.position, i.data,
         i.parent_item_id, i.assigned_to, i.assigned_at, i.assigned_by,
         i.assign_expires_at,
         i.worked_at, i.created_at,
         COUNT(*) OVER()::bigint
  FROM distribution_batch_items i
  WHERE i.batch_id = p_batch_id
    AND i.recalled_at IS NULL
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

CREATE OR REPLACE FUNCTION app_batch_status_counts(p_batch_id uuid)
RETURNS TABLE (status text, n bigint, assigned bigint) LANGUAGE sql STABLE AS $$
  SELECT status, count(*)::bigint, count(*) FILTER (WHERE assigned_to IS NOT NULL)::bigint
  FROM distribution_batch_items
  WHERE batch_id = p_batch_id AND recalled_at IS NULL
  GROUP BY status;
$$;

-- scoreboard: a number taken back is no longer that person's to answer for.
CREATE OR REPLACE FUNCTION app_batch_scoreboard(p_batch_id uuid)
RETURNS TABLE (
  assigned_to       uuid,
  assigned          bigint,
  worked            bigint,
  transferred       bigint,
  callback          bigint,
  not_interested    bigint,
  answering_machine bigint,
  no_answer         bigint,
  called            bigint,
  untouched         bigint,
  touches           bigint,
  last_activity     timestamptz
) LANGUAGE sql STABLE AS $$
  WITH mine AS (
    SELECT i.id, i.assigned_to, i.status, i.worked_at
    FROM distribution_batch_items i
    WHERE i.batch_id = p_batch_id AND i.assigned_to IS NOT NULL AND i.recalled_at IS NULL
  ),
  ev AS (
    SELECT m.assigned_to, count(*)::bigint AS touches
    FROM distribution_batch_item_events e
    JOIN mine m ON m.id = e.item_id
    WHERE e.action = 'status'
    GROUP BY m.assigned_to
  )
  SELECT
    m.assigned_to,
    count(*)::bigint,
    count(*) FILTER (WHERE m.status NOT IN ('new','assigned','excluded'))::bigint,
    count(*) FILTER (WHERE m.status = 'transferred')::bigint,
    count(*) FILTER (WHERE m.status = 'callback')::bigint,
    count(*) FILTER (WHERE m.status = 'not_interested')::bigint,
    count(*) FILTER (WHERE m.status = 'answering_machine')::bigint,
    count(*) FILTER (WHERE m.status = 'no_answer')::bigint,
    count(*) FILTER (WHERE m.status = 'called')::bigint,
    count(*) FILTER (WHERE m.status IN ('new','assigned'))::bigint,
    COALESCE(max(ev.touches), 0)::bigint,
    max(m.worked_at)
  FROM mine m
  LEFT JOIN ev ON ev.assigned_to = m.assigned_to
  GROUP BY m.assigned_to
  ORDER BY count(*) FILTER (WHERE m.status = 'transferred') DESC, count(*) DESC;
$$;

-- ── "who has this number?" ───────────────────────────────────────────────────
-- Paste or upload a list; get back every place each number is sitting right now
-- (and, with p_include_recalled, where it used to sit). Scoping is 159's, word
-- for word: unrestricted sees everything, a manager sees the batches in their
-- own tree plus the batches held by agents in their companies.
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
    EXISTS (SELECT 1 FROM distribution_batch_items c
             WHERE c.parent_item_id = i.id AND c.recalled_at IS NULL)
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

-- roster (159) is the same question asked the other way round — it must not
-- keep listing numbers their holder no longer has.
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
    batch_tree AS (
      SELECT id, id AS root_id, 1 AS depth
      FROM distribution_batches WHERE parent_batch_id IS NULL
      UNION ALL
      SELECT b.id, bt.root_id, bt.depth + 1
      FROM distribution_batches b JOIN batch_tree bt ON b.parent_batch_id = bt.id
    ),
    tree_max AS (SELECT root_id, max(depth) AS chain_len FROM batch_tree GROUP BY root_id),
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
      AND i.recalled_at IS NULL
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

GRANT EXECUTE ON FUNCTION fn_recall_batch_items(uuid[], uuid, text)         TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION fn_expire_batch_assignments(integer)              TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION app_batch_items(uuid, text, text, text, int, int) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION app_batch_status_counts(uuid)                     TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION app_batch_scoreboard(uuid)                        TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION app_batch_number_lookup(text[], uuid, boolean, uuid[], boolean, int)
  TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION app_batch_roster(uuid, boolean, uuid[], text, text, uuid, date, date, int, int)
  TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
