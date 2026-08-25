-- ============================================================================
-- 307_adopt_closer_dials_and_grant_closer_company.sql  (APPLIED 2026-08-26)
--
-- Every call a closer dials is QA work.
--
-- (a) Closer webhook rows that arrived with no transfer adopt the latest
--     transfer for the customer's number (30 days, any fronter company) —
--     transfer + company — unless a closer row for that transfer already
--     represents the same call (within 30 minutes). Adopted rows classify
--     Closed if the transfer has a sale, else Unclosed. (85 rows on apply.)
-- (b) Closer dials on customers never transferred have no fronter company to
--     join; they live under the closer-grouping company (1-Vertex). Grant the
--     QA manager and the team that company so those calls are reviewable too.
--     Reversible from the Team tab.
-- ============================================================================

WITH cand AS (
  SELECT k.id AS call_id, k.call_at, t.id AS transfer_id, t.company_id
  FROM qa2_call k
  JOIN LATERAL (
    SELECT id, company_id FROM transfers t
    WHERE t.normalized_phone = k.customer_phone AND NOT t.dialer_ghost
      AND t.created_at >= k.call_at - interval '30 days' AND t.created_at <= k.call_at + interval '1 hour'
    ORDER BY t.created_at DESC LIMIT 1) t ON true
  WHERE k.leg = 'closer' AND k.source = 'ingest' AND k.transfer_id IS NULL AND k.sale_id IS NULL
    AND k.qa_relevant AND k.customer_phone IS NOT NULL
    AND k.call_at >= now() - interval '14 days'
),
keep AS (
  SELECT c.* FROM cand c
  WHERE NOT EXISTS (SELECT 1 FROM qa2_call o WHERE o.transfer_id = c.transfer_id AND o.leg = 'closer' AND o.id <> c.call_id
                      AND o.call_at BETWEEN c.call_at - interval '30 minutes' AND c.call_at + interval '30 minutes')
),
tra AS (SELECT id FROM qa2_method WHERE label ILIKE 'unclosed' AND is_active LIMIT 1),
cls AS (SELECT id FROM qa2_method WHERE label ILIKE 'closed' AND is_active LIMIT 1)
UPDATE qa2_call k
SET transfer_id = keep.transfer_id, company_id = keep.company_id,
    method_id = COALESCE(k.method_id,
                  CASE WHEN EXISTS (SELECT 1 FROM sales s WHERE s.transfer_id = keep.transfer_id) THEN (SELECT id FROM cls)
                       ELSE (SELECT id FROM tra) END),
    classified_at = COALESCE(k.classified_at, now())
FROM keep WHERE k.id = keep.call_id;

WITH v AS (SELECT id FROM companies WHERE name = '1-Vertex'),
mgr AS (SELECT DISTINCT manager_id FROM qa2_team_member),
ins_m AS (
  INSERT INTO qa2_manager_company (manager_id, company_id)
  SELECT m.manager_id, v.id FROM mgr m, v
  WHERE NOT EXISTS (SELECT 1 FROM qa2_manager_company x WHERE x.manager_id = m.manager_id AND x.company_id = v.id)
  RETURNING manager_id, company_id
),
ins_a AS (
  INSERT INTO qa2_agent_company (agent_id, company_id)
  SELECT tm.agent_id, v.id FROM qa2_team_member tm, v
  WHERE NOT EXISTS (SELECT 1 FROM qa2_agent_company x WHERE x.agent_id = tm.agent_id AND x.company_id = v.id)
  RETURNING agent_id, company_id
)
INSERT INTO qa2_grant_log (entity, action, subject_id, object_id, actor_id, note)
SELECT 'manager_company', 'grant', manager_id, company_id, manager_id, 'mig 307: closer-grouping company so every closer dial is reviewable' FROM ins_m
UNION ALL
SELECT 'agent_company', 'grant', agent_id, company_id, (SELECT manager_id FROM mgr LIMIT 1), 'mig 307: closer-grouping company so every closer dial is reviewable' FROM ins_a;

INSERT INTO schema_migrations (filename, note)
VALUES ('307_adopt_closer_dials_and_grant_closer_company.sql',
        'closer webhook rows adopt their transfer (deduped) and classify; QA team granted the closer-grouping company')
ON CONFLICT (filename) DO NOTHING;
