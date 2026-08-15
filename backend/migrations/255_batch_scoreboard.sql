-- ============================================================================
-- 255_batch_scoreboard.sql
-- Per-person performance inside one batch — "10 people are working this file,
-- who is actually transferring?".
--
-- It reads the PARENT rows, not the children: mig 254's fn_mirror_item_status
-- copies each fronter's disposition up the parent_item_id chain, so the batch a
-- manager holds already carries the live outcome AND the holder on every row.
-- One GROUP BY, no recursion, no per-child fan-out.
--
-- touches = rows in the event log for that person's items (a re-disposition
-- counts as another touch), so "worked 40 numbers with 65 touches" is visible —
-- that gap is the callback-then-transfer path, not double counting.
-- Apply in Supabase SQL editor. CREATE OR REPLACE — safe to re-run.
-- ============================================================================
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
    WHERE i.batch_id = p_batch_id AND i.assigned_to IS NOT NULL
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

GRANT EXECUTE ON FUNCTION app_batch_scoreboard(uuid) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
