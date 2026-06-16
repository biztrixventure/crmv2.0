-- ============================================================================
-- 092_perf_chat_and_indexes.sql
-- Performance pass:
--   1. get_conversation_previews(uid) — collapses the chat conversation-list
--      N+1 (was 2 queries PER conversation: last message + unread count, up to
--      ~200 round-trips per /chat/conversations call, polled every 20s) into a
--      single set-returning function. The route falls back to the old per-conv
--      path if this function is missing, so applying it is safe and reversible.
--   2. Hot-path indexes the live query plans were missing: the sales list filters
--      on closer_id / company_id / sale_date / closer_disposition every load, and
--      conversation_members was only indexed by user_id (not conversation_id,
--      needed to list a conversation's members).
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ── 1. Chat conversation previews (last message + unread count) ──────────────
CREATE OR REPLACE FUNCTION get_conversation_previews(p_user_id uuid)
RETURNS TABLE (
  conversation_id  uuid,
  last_message_id  uuid,
  last_body        text,
  last_created_at  timestamptz,
  last_sender_id   uuid,
  last_deleted     boolean,
  unread_count     integer
) LANGUAGE sql STABLE AS $$
  WITH my AS (
    SELECT cm.conversation_id, cm.last_read_at
    FROM   conversation_members cm
    WHERE  cm.user_id = p_user_id
  ),
  last_msg AS (
    SELECT DISTINCT ON (m.conversation_id)
           m.conversation_id, m.id, m.body, m.created_at, m.sender_id, m.deleted_at
    FROM   messages m
    JOIN   my ON my.conversation_id = m.conversation_id
    ORDER  BY m.conversation_id, m.created_at DESC
  ),
  unread AS (
    SELECT m.conversation_id, COUNT(*)::int AS cnt
    FROM   messages m
    JOIN   my ON my.conversation_id = m.conversation_id
    WHERE  m.deleted_at IS NULL
      AND  m.sender_id <> p_user_id
      AND  (my.last_read_at IS NULL OR m.created_at > my.last_read_at)
    GROUP  BY m.conversation_id
  )
  SELECT my.conversation_id,
         lm.id, lm.body, lm.created_at, lm.sender_id, (lm.deleted_at IS NOT NULL),
         COALESCE(u.cnt, 0)
  FROM   my
  LEFT   JOIN last_msg lm ON lm.conversation_id = my.conversation_id
  LEFT   JOIN unread   u  ON u.conversation_id  = my.conversation_id;
$$;

COMMENT ON FUNCTION get_conversation_previews(uuid) IS
  'Per-conversation last message + unread count for one user in a single query. Backs GET /chat/conversations; replaces the per-conversation N+1.';

-- ── 2. Hot-path indexes ──────────────────────────────────────────────────────
-- Sales list scoping/filtering (per closer, per company, by business date + tab).
CREATE INDEX IF NOT EXISTS idx_sales_closer_id          ON sales (closer_id);
CREATE INDEX IF NOT EXISTS idx_sales_company_id         ON sales (company_id);
CREATE INDEX IF NOT EXISTS idx_sales_sale_date          ON sales (sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_closer_disposition ON sales (closer_disposition);
CREATE INDEX IF NOT EXISTS idx_sales_company_saledate   ON sales (company_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_closer_saledate    ON sales (closer_id, sale_date);

-- Chat: list a conversation's members (was only indexed by user_id).
CREATE INDEX IF NOT EXISTS idx_conversation_members_conv ON conversation_members (conversation_id);
