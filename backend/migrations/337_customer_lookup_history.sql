-- ============================================================================
-- 337_customer_lookup_history.sql
--
-- WHAT WAS SEARCHED, BY WHOM, AND WHAT CAME BACK.
--
-- The Customer Lookup tool was built to store nothing: a result was proxied to
-- the browser, drawn, and forgotten. That is wrong in two directions at once.
--
--   1. An agent who runs a second search loses the first one. The number they
--      were half way through calling is gone, and the only way back is to spend
--      another search out of their allowance on a number they already looked up.
--   2. A superadmin hands out a tool that reaches a PII service and then has no
--      way to see what anyone did with it. The server log holds one line per
--      call ("person 7724757074 by <uuid> -> 200"), which is not a report.
--
-- So every search is written here, with a compact summary for the list and the
-- payload the browser actually received, so re-opening it costs nothing and
-- spends no quota. That makes this table the ONE place in the CRM that holds
-- lookup-service output, which is why:
--
--   • it is service-role only (RLS on, no policies, revoked from anon and
--     authenticated) exactly like the mig 319 IP tables. The anon key must
--     never be able to read a page of names and addresses.
--   • the heavy `result` payload is dropped after p_result_days, while the row
--     itself (who searched what, and how many hits) survives p_history_days.
--     The audit question outlives the convenience question.
--
-- No foreign keys on user_id/company_id on purpose: a deactivated user's
-- history is the most interesting history there is, and it must not vanish
-- with the row that named them.
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_lookup_searches (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID        NOT NULL,
  company_id    UUID,
  -- people | search | addresses | vehicles | vin | enrich — the surface used,
  -- which is also the allowance it was charged to.
  kind          TEXT        NOT NULL,
  -- What the person typed, already normalised for display (a formatted phone,
  -- a name, a street + ZIP). This is the column the history list shows.
  query         TEXT        NOT NULL DEFAULT '',
  -- The parameters as sent, so a row can be re-run or explained later.
  params        JSONB       NOT NULL DEFAULT '{}'::JSONB,
  -- An async search (a scrape or a VIN run) answers with a ticket and finishes
  -- minutes later through /job/:ticket. The row is written when the search
  -- STARTS and completed when the ticket lands, so a search that never
  -- finished is visible as exactly that.
  ticket        TEXT,
  status        TEXT        NOT NULL DEFAULT 'ok',   -- ok | empty | pending | error
  found         BOOLEAN,
  result_count  INTEGER     NOT NULL DEFAULT 0,
  -- Small, listable: counts plus a handful of names/cities or vehicles. Never
  -- emails, never a full address book.
  summary       JSONB       NOT NULL DEFAULT '{}'::JSONB,
  -- The whole payload the browser got, so History re-opens the real result
  -- instead of re-running it. Dropped by the prune job after p_result_days.
  result        JSONB,
  error         TEXT,
  ms            INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

-- "My searches, newest first" — the agent's History tab.
CREATE INDEX IF NOT EXISTS idx_cls_user_created
  ON customer_lookup_searches (user_id, created_at DESC);

-- "Everyone's searches, newest first" — the superadmin Activity tab, which also
-- filters by kind and by date range.
CREATE INDEX IF NOT EXISTS idx_cls_created
  ON customer_lookup_searches (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cls_kind_created
  ON customer_lookup_searches (kind, created_at DESC);

-- A finishing job finds its own row by ticket, so this has to be cheap.
CREATE INDEX IF NOT EXISTS idx_cls_ticket
  ON customer_lookup_searches (ticket)
  WHERE ticket IS NOT NULL;

-- "Who else looked this number up" — answered from the searched phone.
CREATE INDEX IF NOT EXISTS idx_cls_phone
  ON customer_lookup_searches ((params->>'phone'))
  WHERE params->>'phone' IS NOT NULL;

ALTER TABLE customer_lookup_searches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_lookup_searches FROM anon, authenticated;
REVOKE ALL ON SEQUENCE customer_lookup_searches_id_seq FROM anon, authenticated;

COMMENT ON TABLE customer_lookup_searches IS
  'Customer Lookup history: who searched what and what came back. Service-role only — holds lookup-service PII.';

-- ── retention ───────────────────────────────────────────────────────────────
-- Two clocks, because the two reasons to keep a row expire at different times:
-- the convenience of re-opening a result is worth a month, the record of who
-- ran it is worth half a year. The floors (1 day / 7 days) stop a bad argument
-- from emptying the table.
--
-- THE TWO WINDOWS MUST NOT OVERLAP. Both statements are data-modifying CTEs in
-- ONE statement, so they share a snapshot: a row old enough to be stripped AND
-- deleted would be touched twice by the same statement, which Postgres
-- explicitly leaves unpredictable. The UPDATE is therefore bounded at BOTH
-- ends — strip what is past p_result_days but still inside p_history_days, and
-- let the DELETE own everything beyond it.
CREATE OR REPLACE FUNCTION fn_prune_customer_lookup_searches(
  p_result_days  INTEGER DEFAULT 30,
  p_history_days INTEGER DEFAULT 180
) RETURNS TABLE (stripped BIGINT, deleted BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
  WITH s AS (
    UPDATE customer_lookup_searches SET result = NULL
     WHERE result IS NOT NULL
       AND created_at <  NOW() - (GREATEST(p_result_days, 1) || ' days')::INTERVAL
       AND created_at >= NOW() - (GREATEST(p_history_days, 7) || ' days')::INTERVAL
    RETURNING 1
  ), d AS (
    DELETE FROM customer_lookup_searches
     WHERE created_at < NOW() - (GREATEST(p_history_days, 7) || ' days')::INTERVAL
    RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM s), (SELECT COUNT(*) FROM d);
$func$;

REVOKE ALL ON FUNCTION fn_prune_customer_lookup_searches(INTEGER, INTEGER) FROM anon, authenticated;
