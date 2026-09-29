-- 333_user_report_access.sql
-- Company Reports: per-PERSON access, decided in User Control Center -> Reports.
--
-- Three questions, each with "nobody decided for this person" as its own state:
--   can_view      NULL = their role decides (a report permission)
--                 TRUE = on, even without the permission
--                 FALSE = off, even WITH the permission (or an estate-wide role)
--   show_amounts  NULL = view_financial_data decides
--                 TRUE / FALSE = amounts shown / hidden in the reports ONLY,
--                 so a manager can be kept out of report money without losing
--                 money everywhere else in the CRM
--   company_ids   NULL = the companies they belong to (every company for an
--                 estate-wide role); an array = exactly these companies, which
--                 is how one named person is handed other companies' reports
-- Enforced in backend/routes/companyReports.js (resolveScope / canSeeMoney) --
-- the ONLY reader. Replaces the tool_company_reports flag from 332, which had
-- no grants: two switches for one question is how they end up disagreeing.
--
-- Sidecar table, not a user_profiles column: user_profiles is self-updatable
-- through RLS, so a person could grant themselves the money (same reason as
-- user_ip_access, mig 319). RLS on, no policies, service role only.

CREATE TABLE IF NOT EXISTS user_report_access (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  can_view     boolean,
  show_amounts boolean,
  company_ids  uuid[],
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE user_report_access IS
  'Company Reports per-person access (mig 333). NULL in any column = not decided for this person, the role answers. Read/written only by routes/companyReports.js.';

ALTER TABLE user_report_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_report_access FROM anon, authenticated;

-- Who handed whom the money, and when: same audit stream as IP access (313/319).
DROP TRIGGER IF EXISTS trg_module_audit ON user_report_access;
CREATE TRIGGER trg_module_audit
  AFTER INSERT OR UPDATE OR DELETE ON user_report_access
  FOR EACH ROW EXECUTE FUNCTION fn_module_audit('access', 'user_id');

-- 332's per-person switch is superseded by the table above (0 grants existed).
DELETE FROM feature_flags WHERE key = 'tool_company_reports';

-- All-companies view: enough per agent to rank agents ACROSS companies
-- ("whose agent is on top"), not just one top agent per company.
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
      'agents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'user_id', a->'user_id', 'name', a->'name', 'team_name', a->'team_name',
                    'level', a->'level', 'is_member_active', a->'is_member_active',
                    'transfers', a->'transfers', 'xfer_sold', a->'xfer_sold',
                    'sold', a->'sold', 'active', a->'active', 'cancelled', a->'cancelled',
                    'post_dates', a->'post_dates',
                    'dp_sold', a->'dp_sold', 'dp_active', a->'dp_active',
                    'est_collected', a->'est_collected', 'monthly_active', a->'monthly_active',
                    'qa_avg', a->'qa_avg', 'qa_n', a->'qa_n'))
                  FROM jsonb_array_elements(rep->'agents') a
                 WHERE (a->>'transfers')::int > 0 OR (a->>'sold')::int > 0), '[]'::jsonb)
    ));
  END LOOP;
  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION app_company_report_overview(date, date, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_company_report_overview(date, date, uuid[]) TO service_role;
