-- ============================================================================
-- 349_outgoing_links.sql — links FROM the CRM to other apps, set up on screen.
--
-- Today the only kind is 'hrms_sales': the hourly push of approved sales into
-- the HRMS (hr.vertexpakistan.com, utils/hrmsSync.js). Until now the HRMS
-- address and its keys came only from server settings (HRMS_URL +
-- HRMS_API_KEYS). With this table a superadmin adds, tests, switches off and
-- removes HR links under Admin -> System -> Connections -> Outgoing links,
-- with no server change and no restart. The server settings keep working; a
-- link that is in both places is sent once.
--
-- One row = one HR company (one HRMS API key with scope sales.write).
--
-- api_key is stored as given: the CRM has to send it, so it cannot be hashed.
-- No encryption helper exists in this codebase for stored third-party secrets,
-- so the table follows app_secrets (mig 146) / vicidial_boxes (mig 120) and
-- the Connections tables (mig 348): service-role only, RLS on, no policies,
-- revoked from anon and authenticated. The API never returns the key, only its
-- last 4 characters.
--
-- Idempotent. Safe to re-run. Until it is applied the push uses the server
-- settings only (it warns once in the log), and the Outgoing links tab shows
-- those as read-only and says "run migration 349".
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.outgoing_links (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text        NOT NULL DEFAULT 'hrms_sales' CHECK (kind IN ('hrms_sales')),
  name         text        NOT NULL,                  -- "WaveTech HR"
  url          text        NOT NULL,                  -- https://hr.vertexpakistan.com
  api_key      text        NOT NULL,                  -- never returned by the API
  enabled      boolean     NOT NULL DEFAULT true,
  last_run_at  timestamptz,
  last_result  jsonb,                                 -- counts of the last push, or { error }
  created_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outgoing_links_kind
  ON public.outgoing_links (kind) WHERE enabled;

COMMENT ON TABLE public.outgoing_links IS
  'Outgoing links from the CRM to other apps (mig 349). hrms_sales = hourly approved-sales push to one HRMS company. api_key is plaintext; service-role only.';

ALTER TABLE public.outgoing_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outgoing_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.outgoing_links TO service_role;

INSERT INTO schema_migrations (filename, note)
VALUES ('349_outgoing_links.sql', 'Outgoing links: HRMS sales push targets set up from Connections, env HRMS_URL/HRMS_API_KEYS kept as fallback')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
