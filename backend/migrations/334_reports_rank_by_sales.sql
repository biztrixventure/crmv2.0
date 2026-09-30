-- 334_reports_rank_by_sales.sql
-- Company Reports: agents are ranked by the NUMBER OF SALES, not by money.
--
-- 332 seeded reports.company.earner_metric = 'dp_sold' (down payments). In this
-- CRM the count of sales is what an agent is judged on; money is a secondary
-- view and is never the default ranking. utils/companyReport.js now defaults to
-- 'sold' -- this moves the stored settings that still carry the old seed.
-- A company whose superadmin deliberately picks a money metric later keeps it:
-- this runs once, against the seed value only.
UPDATE business_config
   SET value = jsonb_set(value, '{earner_metric}', '"sold"'),
       updated_at = now()
 WHERE key = 'reports.company'
   AND value->>'earner_metric' = 'dp_sold';
