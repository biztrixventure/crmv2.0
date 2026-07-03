-- ============================================================================
-- 172_qa_materialize_fns.sql
-- QA Department — STEP 5. Set-based materialization RPCs (no per-row loops, no
-- N+1). The scheduler (utils/qaMaterializer.js) calls these once per QA-enabled
-- company per tick. Apply AFTER 170. Idempotent (CREATE OR REPLACE).
--
--  app_qa_materialize_tra(company, statuses[])              → full coverage
--  app_qa_materialize_rcm(company, covers[], mode, value,
--                         period, start, end)               → frozen random N
--
-- Both return the number of assignment rows inserted.
-- ============================================================================

-- ── TRA: one assignment per in-scope transfer that doesn't have one ──────────
-- Full coverage. `p_statuses` = ['all'] (every transfer) or an explicit status
-- list. The NOT EXISTS + the unique (transfer_id,'tra') index make it idempotent:
-- re-running only inserts transfers that appeared since the last run.
CREATE OR REPLACE FUNCTION app_qa_materialize_tra(
  p_company_id uuid,
  p_statuses   text[] DEFAULT ARRAY['all']
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO qa_assignments (company_id, method, subject_role, transfer_id, sampled, status)
  SELECT t.company_id, 'tra', 'fronter', t.id, false, 'pending'
  FROM transfers t
  WHERE t.company_id = p_company_id
    AND (p_statuses IS NULL
         OR 'all' = ANY(p_statuses)
         OR t.status::text = ANY(p_statuses))
    AND NOT EXISTS (
      SELECT 1 FROM qa_assignments a
      WHERE a.transfer_id = t.id AND a.method = 'tra'
    )
  ON CONFLICT DO NOTHING;   -- belt-and-braces vs the unique index (concurrent ticks)
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- ── RCM: frozen random sample of a period's calls ───────────────────────────
-- FROZEN: a (company, period) is sampled exactly once, never reshuffled. Three
-- layers guarantee this:
--   1. an advisory xact lock on hash(company_id|period) SERIALIZES the whole
--      check-then-insert across DB sessions/replicas (so a multi-instance deploy
--      is safe by default, not by assuming a single scheduler);
--   2. the EXISTS(period) guard short-circuits an already-materialized period;
--   3. the unique (transfer_id,'rcm') / (sale_id,'rcm') indexes are the final
--      backstop against duplicate rows.
-- Different companies/periods hash to different keys → they still run in
-- parallel; only the SAME company+period serializes.
-- Population = transfers (fronter leg) and/or sales (closer leg) created within
-- [p_start, p_end), per p_covers. N = fixed value, or ceil(value% * count).
-- Fronter rows key on transfer_id; closer rows key on sale_id (transfer_id left
-- NULL) so the two legs never collide on the unique (transfer_id,'rcm') index.
CREATE OR REPLACE FUNCTION app_qa_materialize_rcm(
  p_company_id uuid,
  p_covers     text[],
  p_mode       text,
  p_value      numeric,
  p_period     text,
  p_start      timestamptz,
  p_end        timestamptz
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_lock  bigint;
  v_total integer;
  v_n     integer;
  v_count integer;
BEGIN
  -- SERIALIZE this company+period. Transaction-scoped → auto-released at COMMIT/
  -- ROLLBACK, no manual unlock. try-variant: if another run/instance already
  -- holds it, skip cleanly (it is materializing the same period) rather than
  -- block or error — fine on an hourly, non-user-facing job.
  v_lock := hashtextextended(p_company_id::text || '|' || COALESCE(p_period, ''), 0);
  IF NOT pg_try_advisory_xact_lock(v_lock) THEN
    RAISE NOTICE 'QA RCM: lock busy for %/% — another run holds it, skipping', p_company_id, p_period;
    RETURN 0;
  END IF;

  -- frozen guard — this period already materialized?
  IF EXISTS (
    SELECT 1 FROM qa_assignments
    WHERE company_id = p_company_id AND method = 'rcm' AND period = p_period
  ) THEN
    RETURN 0;
  END IF;

  -- eligible population for this period (fronter transfers + closer sales)
  CREATE TEMP TABLE _qa_rcm_pool ON COMMIT DROP AS
  SELECT subject_role, transfer_id, sale_id FROM (
    SELECT 'fronter'::text AS subject_role, t.id AS transfer_id, NULL::uuid AS sale_id
    FROM transfers t
    WHERE 'fronter' = ANY(p_covers)
      AND t.company_id = p_company_id
      AND t.created_at >= p_start AND t.created_at < p_end
      AND NOT EXISTS (SELECT 1 FROM qa_assignments a WHERE a.transfer_id = t.id AND a.method = 'rcm')
    UNION ALL
    SELECT 'closer'::text, NULL::uuid, s.id
    FROM sales s
    WHERE 'closer' = ANY(p_covers)
      AND s.company_id = p_company_id
      AND s.created_at >= p_start AND s.created_at < p_end
      AND NOT EXISTS (SELECT 1 FROM qa_assignments a WHERE a.sale_id = s.id AND a.method = 'rcm')
  ) pool;

  SELECT COUNT(*) INTO v_total FROM _qa_rcm_pool;
  IF v_total = 0 THEN RETURN 0; END IF;

  -- sample size
  IF p_mode = 'fixed' THEN
    v_n := GREATEST(0, FLOOR(p_value)::int);
  ELSE  -- percentage
    v_n := CEIL(p_value / 100.0 * v_total)::int;
  END IF;
  v_n := LEAST(v_n, v_total);
  IF v_n <= 0 THEN RETURN 0; END IF;

  INSERT INTO qa_assignments (company_id, method, subject_role, transfer_id, sale_id, sampled, period, status)
  SELECT p_company_id, 'rcm', subject_role, transfer_id, sale_id, true, p_period, 'pending'
  FROM _qa_rcm_pool
  ORDER BY random()
  LIMIT v_n
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION app_qa_materialize_tra(uuid, text[])                                    TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION app_qa_materialize_rcm(uuid, text[], text, numeric, text, timestamptz, timestamptz) TO authenticated, anon, service_role;
