-- 332_company_agent_reports.sql
-- Company Reports: how every agent of ONE company performs, counted in the
-- database in one round-trip.
--
-- WHY A FUNCTION. The Reports panel it replaces (/stats/leaderboards) paged up
-- to 40,000 rows through PostgREST 1,000 at a time and tallied them in Node.
-- At ~445ms per round-trip that is seconds per load, and it still stopped
-- counting at 40k. Everything below is one statement.
--
-- ── THE RULES (every number on the screen obeys these) ─────────────────────
-- DAY. A transfer, callback or QA review belongs to the US-Eastern calendar
--   day it happened on — the same cut /stats uses (etDateToUtcStart) and the
--   zone the dialer boxes run in. sales.sale_date is already a DATE and is used
--   as stored. p_from / p_to are inclusive Eastern dates.
-- POST-DATES are reminders, not sales. fn_is_post_date() is the SQL twin of
--   backend/utils/postDate.js, frontend/src/utils/dispositions.js and
--   fn_stamp_post_date (mig 221) — FOUR places now; change one, change all.
--   They never enter sold / money / conversion; they are counted on their own.
-- SIDE decides SCOPE, not just labels:
--   fronter company -> transfers.company_id = company, sales.company_id = company.
--   closer company  -> every sale and transfer is filed under the FRONTER
--     company, so a closer company is scoped by its ROSTER: transfers whose
--     assigned_closer_id, and sales whose closer_id, is one of its members
--     (active OR not — a closer who left still earned last month's sales).
-- SOLD = a non-post-date sale, whatever happened to it later. ACTIVE = still
--   closed_won today. Most sales cancel around day 60, so "sold" is what the
--   agent did and "active / stick rate" is what lasted.
-- CONVERSION is transfer-cohort based: of the transfers in the window, how many
--   have a sale (any date). Sales credited to a fronter on a transfer somebody
--   else created (the Onyx placeholder era) are reported as `recredited`, never
--   folded into conversion — that is how a rate goes above 100%.
-- A MISSING fronter is "unattributed" (agent null), never zero for someone.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_is_post_date(p_dispo text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(p_dispo, '') ~* 'post[[:space:]_-]?date|postdate'
$$;
COMMENT ON FUNCTION fn_is_post_date(text) IS
  'Is this closer_disposition an un-charged post-date? Same regex as backend/utils/postDate.js, frontend/src/utils/dispositions.js and fn_stamp_post_date (mig 221). NULL -> false.';

-- Closer-side scope reads transfers by closer inside a date window.
CREATE INDEX IF NOT EXISTS idx_transfers_closer_created
  ON transfers(assigned_closer_id, created_at) WHERE assigned_closer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_callbacks_company_callback_at
  ON callbacks(company_id, callback_at);


CREATE OR REPLACE FUNCTION app_company_agent_report(
  p_company       uuid,
  p_from          date,
  p_to            date,
  p_hide_resells  boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_type   text;
  v_side   text;
  v_name   text;
  v_roster uuid[];
  v_ts0    timestamptz := (p_from::timestamp)     AT TIME ZONE 'America/New_York';
  v_ts1    timestamptz := ((p_to + 1)::timestamp) AT TIME ZONE 'America/New_York';
  v_out    jsonb;
BEGIN
  IF p_company IS NULL OR p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'app_company_agent_report: company and a valid date range are required';
  END IF;
  IF p_to - p_from > 400 THEN
    RAISE EXCEPTION 'app_company_agent_report: range is limited to 400 days';
  END IF;

  SELECT c.company_type, c.name INTO v_type, v_name FROM companies c WHERE c.id = p_company;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_side := CASE WHEN v_type = 'closer' THEN 'closer' ELSE 'fronter' END;

  -- Every membership, active or not: history belongs to whoever held the seat.
  SELECT COALESCE(array_agg(DISTINCT u.user_id), '{}') INTO v_roster
    FROM user_company_roles u WHERE u.company_id = p_company;

  WITH
  -- ── transfers in the window, with the agent they are credited to ────────
  x AS (
    SELECT t.id, t.company_id, t.created_by, t.assigned_closer_id, t.dialer_box, t.dialer_provider,
           t.latest_disposition, t.created_at,
           (t.created_at AT TIME ZONE 'America/New_York')::date AS d,
           CASE WHEN v_side = 'closer' THEN t.assigned_closer_id ELSE t.created_by END AS agent,
           CASE WHEN v_side = 'closer' THEN t.created_by ELSE t.assigned_closer_id END AS partner
      FROM transfers t
     WHERE t.created_at >= v_ts0 AND t.created_at < v_ts1
       AND t.dialer_ghost = false
       -- Same guard GET /transfers applies: an untouched dialer-pending row is
       -- not a transfer yet.
       AND (COALESCE(t.vicidial_pending, false) = false
            OR t.assigned_closer_id IS NOT NULL OR t.vicidial_dispo IS NOT NULL)
       AND CASE WHEN v_side = 'closer' THEN t.assigned_closer_id = ANY(v_roster)
                ELSE t.company_id = p_company END
  ),
  -- the sale (if any) each of those transfers produced — newest non-post-date
  xs AS (
    SELECT DISTINCT ON (s.transfer_id) s.transfer_id, s.created_at AS sale_at,
           s.down_payment, s.status
      FROM sales s
     WHERE s.transfer_id IN (SELECT id FROM x)
       AND NOT fn_is_post_date(s.closer_disposition)
       AND (NOT p_hide_resells OR s.is_resell IS NOT TRUE)
     ORDER BY s.transfer_id, s.created_at DESC
  ),
  xj AS (
    SELECT x.*, xs.sale_at, xs.down_payment AS sale_dp, (xs.transfer_id IS NOT NULL) AS has_sale
      FROM x LEFT JOIN xs ON xs.transfer_id = x.id
  ),
  -- ── sales in the window (by sale_date), post-dates split off ────────────
  s_all AS (
    SELECT s.*,
           CASE WHEN v_side = 'closer' THEN s.closer_id ELSE s.fronter_id END AS agent,
           fn_is_post_date(s.closer_disposition) AS is_pd,
           t.created_by AS xfer_creator
      FROM sales s
      LEFT JOIN transfers t ON t.id = s.transfer_id
     WHERE s.sale_date BETWEEN p_from AND p_to
       AND (NOT p_hide_resells OR s.is_resell IS NOT TRUE)
       AND CASE WHEN v_side = 'closer' THEN s.closer_id = ANY(v_roster)
                ELSE s.company_id = p_company END
  ),
  s AS (
    SELECT s_all.*,
           -- Estimated money collected: the down payment plus one monthly
           -- payment per whole month the policy stayed live (to cancellation
           -- or today). An ESTIMATE — there is no payment ledger.
           COALESCE(down_payment, 0) + COALESCE(monthly_payment, 0) * GREATEST(0,
             CASE
               WHEN status = 'closed_won' THEN
                 (EXTRACT(YEAR FROM age(current_date, sale_date)) * 12 + EXTRACT(MONTH FROM age(current_date, sale_date)))
               WHEN status = 'cancelled' AND cancellation_date IS NOT NULL THEN
                 (EXTRACT(YEAR FROM age(cancellation_date, sale_date)) * 12 + EXTRACT(MONTH FROM age(cancellation_date, sale_date)))
               ELSE 0
             END) AS est_collected
      FROM s_all WHERE NOT is_pd
  ),
  pd AS (SELECT agent, count(*) AS n FROM s_all WHERE is_pd GROUP BY agent),
  -- ── callbacks scheduled inside the window ───────────────────────────────
  cb AS (
    SELECT c.user_id AS agent,
           count(*)                                                      AS cb_total,
           count(*) FILTER (WHERE c.status = 'completed')                AS cb_completed,
           count(*) FILTER (WHERE c.status IN ('no_answer','answering_machine')) AS cb_no_contact,
           count(*) FILTER (WHERE c.status = 'pending' AND c.callback_at < now()) AS cb_missed,
           count(*) FILTER (WHERE c.status = 'pending' AND c.callback_at >= now()) AS cb_upcoming
      FROM callbacks c
     WHERE c.company_id = p_company
       AND c.callback_at >= v_ts0 AND c.callback_at < v_ts1
     GROUP BY c.user_id
  ),
  -- ── QA2: submitted, live (not superseded, not voided) evaluations ───────
  qa AS (
    SELECT e.subject_user_id AS agent, count(*) AS qa_n,
           round(avg(e.final_score)::numeric, 1) AS qa_avg,
           count(*) FILTER (WHERE e.result = 'pass') AS qa_pass
      FROM qa2_evaluation e
     WHERE e.status = 'submitted' AND e.superseded_by IS NULL AND e.voided_by IS NULL
       AND e.final_score IS NOT NULL
       -- A fronter company's evaluations also hold the CLOSERS who worked its
       -- leads; only this side's agents belong on this report.
       AND e.subject_role = v_side
       AND COALESCE(e.submitted_at, e.created_at) >= v_ts0
       AND COALESCE(e.submitted_at, e.created_at) <  v_ts1
       AND CASE WHEN v_side = 'closer' THEN e.subject_user_id = ANY(v_roster)
                ELSE e.company_id = p_company END
     GROUP BY e.subject_user_id
  ),
  xa AS (
    SELECT agent,
           count(*)                                         AS transfers,
           count(*) FILTER (WHERE has_sale)                 AS xfer_sold,
           count(*) FILTER (WHERE partner IS NULL)          AS no_partner,
           count(*) FILTER (WHERE latest_disposition IS NULL OR btrim(latest_disposition) = '') AS no_outcome,
           count(DISTINCT d)                                AS days_active,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (sale_at - created_at)) / 86400.0)
             FILTER (WHERE has_sale AND sale_at >= created_at) AS median_days_to_sale,
           min(created_at) AS first_at, max(created_at) AS last_at
      FROM xj GROUP BY agent
  ),
  sa AS (
    SELECT agent,
           count(*)                                                AS sold,
           count(*) FILTER (WHERE status = 'closed_won')           AS active,
           count(*) FILTER (WHERE status = 'cancelled')            AS cancelled,
           count(*) FILTER (WHERE status IN ('open','pending_review')) AS in_review,
           count(*) FILTER (WHERE is_resell)                       AS resells,
           count(*) FILTER (WHERE v_side = 'fronter' AND xfer_creator IS DISTINCT FROM fronter_id) AS recredited,
           COALESCE(sum(down_payment), 0)                          AS dp_sold,
           COALESCE(sum(down_payment) FILTER (WHERE status = 'closed_won'), 0)    AS dp_active,
           COALESCE(sum(monthly_payment) FILTER (WHERE status = 'closed_won'), 0) AS monthly_active,
           COALESCE(sum(est_collected), 0)                         AS est_collected,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY cancellation_date - sale_date)
             FILTER (WHERE status = 'cancelled' AND cancellation_date IS NOT NULL) AS median_days_to_cancel
      FROM s GROUP BY agent
  ),
  -- Every agent-level member (so a silent agent shows as a zero, not a gap),
  -- plus anyone the data credits.
  ids AS (
    SELECT u.user_id AS agent FROM user_company_roles u JOIN custom_roles r ON r.id = u.role_id
     WHERE u.company_id = p_company AND u.is_active
       AND r.level::text IN ('fronter','trainee','closer')
    UNION SELECT agent FROM xa UNION SELECT agent FROM sa UNION SELECT agent FROM pd
    UNION SELECT agent FROM cb UNION SELECT agent FROM qa
  ),
  mem AS (
    SELECT DISTINCT ON (u.user_id) u.user_id, u.is_active, r.level::text AS level
      FROM user_company_roles u JOIN custom_roles r ON r.id = u.role_id
     WHERE u.company_id = p_company
     ORDER BY u.user_id, u.is_active DESC
  ),
  team AS (
    SELECT DISTINCT ON (tm.user_id) tm.user_id, tm.team_id, t.name AS team_name
      FROM team_members tm JOIN teams t ON t.id = tm.team_id AND t.is_active
     WHERE t.company_id = p_company
     ORDER BY tm.user_id, tm.joined_at DESC
  ),
  agents AS (
    SELECT i.agent AS user_id,
           NULLIF(btrim(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), '') AS name,
           m.level, COALESCE(m.is_active, false) AS is_member_active, (m.user_id IS NOT NULL) AS is_member,
           tm.team_id, tm.team_name,
           COALESCE(xa.transfers,0) transfers, COALESCE(xa.xfer_sold,0) xfer_sold,
           COALESCE(xa.no_partner,0) no_partner, COALESCE(xa.no_outcome,0) no_outcome,
           COALESCE(xa.days_active,0) days_active,
           round(xa.median_days_to_sale::numeric, 1) median_days_to_sale,
           xa.first_at, xa.last_at,
           COALESCE(sa.sold,0) sold, COALESCE(sa.active,0) active, COALESCE(sa.cancelled,0) cancelled,
           COALESCE(sa.in_review,0) in_review, COALESCE(sa.resells,0) resells,
           COALESCE(sa.recredited,0) recredited,
           round(COALESCE(sa.dp_sold,0),2) dp_sold, round(COALESCE(sa.dp_active,0),2) dp_active,
           round(COALESCE(sa.monthly_active,0),2) monthly_active, round(COALESCE(sa.est_collected,0),2) est_collected,
           sa.median_days_to_cancel,
           COALESCE(pd.n,0) post_dates,
           COALESCE(cb.cb_total,0) cb_total, COALESCE(cb.cb_completed,0) cb_completed,
           COALESCE(cb.cb_no_contact,0) cb_no_contact, COALESCE(cb.cb_missed,0) cb_missed,
           COALESCE(cb.cb_upcoming,0) cb_upcoming,
           COALESCE(qa.qa_n,0) qa_n, qa.qa_avg, COALESCE(qa.qa_pass,0) qa_pass
      FROM ids i
      LEFT JOIN user_profiles p ON p.user_id = i.agent
      LEFT JOIN mem m   ON m.user_id = i.agent
      LEFT JOIN team tm ON tm.user_id = i.agent
      LEFT JOIN xa ON xa.agent IS NOT DISTINCT FROM i.agent
      LEFT JOIN sa ON sa.agent IS NOT DISTINCT FROM i.agent
      LEFT JOIN pd ON pd.agent IS NOT DISTINCT FROM i.agent
      LEFT JOIN cb ON cb.agent IS NOT DISTINCT FROM i.agent
      LEFT JOIN qa ON qa.agent IS NOT DISTINCT FROM i.agent
  ),
  -- ── who each agent's leads went to (fronter side) / came from (closer) ──
  pairs AS (
    SELECT xj.agent, xj.partner,
           CASE WHEN v_side = 'closer' THEN xj.company_id END AS partner_company_id,
           count(*) AS transfers, count(*) FILTER (WHERE has_sale) AS sold,
           round(COALESCE(sum(sale_dp) FILTER (WHERE has_sale), 0), 2) AS dp
      FROM xj
     WHERE xj.partner IS NOT NULL
     GROUP BY 1, 2, 3
  ),
  -- names for every partner, sent once instead of on each of ~1,000 pair rows
  people AS (
    SELECT DISTINCT pr.partner AS id,
           NULLIF(btrim(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), '') AS name
      FROM pairs pr LEFT JOIN user_profiles p ON p.user_id = pr.partner
  ),
  dispo AS (
    SELECT agent, COALESCE(NULLIF(btrim(latest_disposition), ''), 'No outcome yet') AS label, count(*) AS n
      FROM x GROUP BY 1, 2
  ),
  boxes AS (
    SELECT agent, dialer_provider AS provider, dialer_box AS box, count(*) AS n FROM x GROUP BY 1, 2, 3
  ),
  daily AS (
    SELECT COALESCE(a.agent, b.agent) AS agent, COALESCE(a.d, b.d) AS d,
           COALESCE(a.x, 0) AS x, COALESCE(b.s, 0) AS s, COALESCE(b.dp, 0) AS dp
      FROM (SELECT agent, d, count(*) AS x FROM x GROUP BY 1, 2) a
      FULL JOIN (SELECT agent, sale_date AS d, count(*) AS s, round(COALESCE(sum(down_payment),0),2) AS dp
                   FROM s GROUP BY 1, 2) b
        ON a.agent IS NOT DISTINCT FROM b.agent AND a.d = b.d
  )
  SELECT jsonb_build_object(
    'side',    v_side,
    'company', jsonb_build_object('id', p_company, 'name', v_name, 'type', v_type),
    'range',   jsonb_build_object('from', p_from, 'to', p_to, 'days', p_to - p_from + 1, 'tz', 'America/New_York'),
    'totals',  jsonb_build_object(
       'transfers',      (SELECT count(*) FROM x),
       'xfer_sold',      (SELECT count(*) FROM xj WHERE has_sale),
       'no_partner',     (SELECT count(*) FROM x WHERE partner IS NULL),
       'no_outcome',     (SELECT count(*) FROM x WHERE latest_disposition IS NULL OR btrim(latest_disposition) = ''),
       'sold',           (SELECT count(*) FROM s),
       'active',         (SELECT count(*) FROM s WHERE status = 'closed_won'),
       'cancelled',      (SELECT count(*) FROM s WHERE status = 'cancelled'),
       'in_review',      (SELECT count(*) FROM s WHERE status IN ('open','pending_review')),
       'resells',        (SELECT count(*) FROM s WHERE is_resell),
       'unattributed',   (SELECT count(*) FROM s WHERE agent IS NULL),
       'recredited',     (SELECT count(*) FROM s WHERE v_side = 'fronter' AND xfer_creator IS DISTINCT FROM fronter_id),
       'post_dates',     (SELECT count(*) FROM s_all WHERE is_pd),
       'dp_sold',        (SELECT round(COALESCE(sum(down_payment),0),2) FROM s),
       'dp_active',      (SELECT round(COALESCE(sum(down_payment) FILTER (WHERE status='closed_won'),0),2) FROM s),
       'monthly_active', (SELECT round(COALESCE(sum(monthly_payment) FILTER (WHERE status='closed_won'),0),2) FROM s),
       'est_collected',  (SELECT round(COALESCE(sum(est_collected),0),2) FROM s),
       'cb_total',       (SELECT COALESCE(sum(cb_total),0) FROM cb),
       'cb_completed',   (SELECT COALESCE(sum(cb_completed),0) FROM cb),
       'cb_no_contact',  (SELECT COALESCE(sum(cb_no_contact),0) FROM cb),
       'cb_missed',      (SELECT COALESCE(sum(cb_missed),0) FROM cb),
       'cb_upcoming',    (SELECT COALESCE(sum(cb_upcoming),0) FROM cb),
       'qa_n',           (SELECT COALESCE(sum(qa_n),0) FROM qa),
       'qa_pass',        (SELECT COALESCE(sum(qa_pass),0) FROM qa),
       -- mean over REVIEWS, not over agents
       'qa_avg',         (SELECT round(sum(qa_avg * qa_n) / NULLIF(sum(qa_n),0), 1) FROM qa)
    ),
    'agents',       COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.dp_sold DESC, a.sold DESC, a.transfers DESC) FROM agents a), '[]'),
    -- Compact rows (positional arrays): these lists run to ~1,000 entries on
    -- the closer company and keyed objects tripled the payload. Column order
    -- is documented here and decoded in routes/companyReports.js ONLY.
    'pairs',        COALESCE((SELECT jsonb_agg(jsonb_build_array(p.agent, p.partner, p.partner_company_id, p.transfers, p.sold, p.dp)) FROM pairs p), '[]'),   -- [agent, partner, partner_company_id, transfers, sold, dp]
    'people',       COALESCE((SELECT jsonb_object_agg(pp.id, pp.name) FROM people pp), '{}'),
    'dispositions', COALESCE((SELECT jsonb_agg(jsonb_build_array(d.agent, d.label, d.n)) FROM dispo d), '[]'),                                          -- [agent, label, n]
    'boxes',        COALESCE((SELECT jsonb_agg(jsonb_build_array(b.agent, b.provider, b.box, b.n)) FROM boxes b), '[]'),                                -- [agent, provider, box, n]
    'daily',        COALESCE((SELECT jsonb_agg(jsonb_build_array(dd.agent, dd.d, dd.x, dd.s, dd.dp) ORDER BY dd.d) FROM daily dd), '[]')                -- [agent, day, transfers, sold, dp]
  ) INTO v_out;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION app_company_agent_report(uuid, date, date, boolean) IS
  'Company Reports (mig 332): per-agent transfers / sales / money / callbacks / QA2 / dispositions / partner pairs / daily series for ONE company over an inclusive US-Eastern date range. Scope flips with company_type (closer companies are scoped by roster). Post-dates excluded via fn_is_post_date. Called only by backend/routes/companyReports.js with the service role.';


-- "All companies": one summary row per company, same rules, one round-trip.
CREATE OR REPLACE FUNCTION app_company_report_overview(
  p_from date, p_to date, p_companies uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  r   record;
  rep jsonb;
  v_res jsonb := '[]'::jsonb;
BEGIN
  FOR r IN SELECT c.id FROM companies c
            WHERE c.is_active AND (p_companies IS NULL OR c.id = ANY(p_companies))
            ORDER BY c.name
  LOOP
    rep := app_company_agent_report(r.id, p_from, p_to, false);
    IF rep IS NULL THEN CONTINUE; END IF;
    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'company', rep->'company',
      'side',    rep->'side',
      'totals',  rep->'totals',
      'agents_active', (SELECT count(*) FROM jsonb_array_elements(rep->'agents') a
                         WHERE (a->>'transfers')::int > 0 OR (a->>'sold')::int > 0),
      -- id list only; the route names the top earner after applying the
      -- placeholder rule, so the rule lives in one place.
      'agents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'user_id', a->'user_id', 'name', a->'name',
                    'sold', a->'sold', 'dp_sold', a->'dp_sold', 'dp_active', a->'dp_active',
                    'est_collected', a->'est_collected', 'monthly_active', a->'monthly_active',
                    'transfers', a->'transfers', 'xfer_sold', a->'xfer_sold', 'active', a->'active'))
                  FROM jsonb_array_elements(rep->'agents') a
                 WHERE (a->>'transfers')::int > 0 OR (a->>'sold')::int > 0), '[]'::jsonb)
    ));
  END LOOP;
  RETURN v_res;
END;
$$;

COMMENT ON FUNCTION app_company_report_overview(date, date, uuid[]) IS
  'Company Reports (mig 332): per-company totals + agent money list for the superadmin "All companies" view. Wraps app_company_agent_report.';

-- Service role only: these read every tenant's rows.
REVOKE ALL ON FUNCTION app_company_agent_report(uuid, date, date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_company_report_overview(date, date, uuid[])     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_company_agent_report(uuid, date, date, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION app_company_report_overview(date, date, uuid[])     TO service_role;


-- Per-person switch: shows up in User Control Center -> Tools automatically
-- (toolCatalog lists every tool_* flag). Off by default — a manager gets the
-- section from their role's report permissions, this is for one named person.
INSERT INTO feature_flags (key, label, description, category, default_enabled, sort_order)
VALUES ('tool_company_reports', 'Company Reports',
        'Per-agent performance, comparison and money for the person''s own company, without changing their role.',
        'admin_tools', false, 900)
ON CONFLICT (key) DO NOTHING;


-- Report settings (superadmin-editable in the Reports screen). Placeholder
-- accounts are shown, labelled, kept in totals, and never ranked. Seeded with
-- the Onyx placeholder that 289 sales were punched to before agents had logins.
INSERT INTO business_config (scope, key, value)
SELECT 'global', 'reports.company', jsonb_build_object(
  'placeholder_users', COALESCE((
     SELECT jsonb_agg(p.user_id) FROM user_profiles p
       JOIN user_company_roles u ON u.user_id = p.user_id
       JOIN companies c ON c.id = u.company_id AND c.name = 'Onyx'
      WHERE btrim(COALESCE(p.first_name,'')) = 'Onyx' AND btrim(COALESCE(p.last_name,'')) = ''), '[]'::jsonb),
  'earner_metric',      'dp_sold',
  'best_partner_min',   5,
  'hidden_metrics',     '[]'::jsonb,
  'show_inactive',      false
)
ON CONFLICT (scope, key) DO NOTHING;
