-- ============================================================================
-- 348_connections.sql — the plug-and-play "Connections" layer.
--
-- Lets ANY other app (the HRMS at hr.vertexpakistan.com, the QA platform at
-- qa.vertexpakistan.com, a BI tool, a script) talk to the CRM without a CRM
-- login, and without anything in the CRM changing for the people using it:
--
--   integration_keys        API keys for the machine API /api/ext/v1. Only the
--                           SHA-256 of a key is stored; the key itself is shown
--                           once, when it is created. Scoped (sales.read, ...)
--                           and optionally limited to some companies.
--   integration_webhooks    URLs the CRM POSTs events to (sale.approved,
--                           transfer.created, ...), signed with a per-hook
--                           HMAC secret.
--   integration_deliveries  the outbox: one row per event per webhook, retried
--                           with backoff for about a day, pruned after 14 days.
--   integration_cursors     where each event source stopped reading, so a
--                           restart neither misses nor repeats an event.
--   external_metrics        numbers other systems push IN (QA scores,
--                           attendance hours, ...) per VICIdial agent and
--                           period. Stored, not yet shown anywhere.
--
-- Two feature flags (default OFF) let a company say "HR / QA runs in the
-- other app": the CRM's own HR / QA navigation then becomes one link out. Off
-- = exactly today's screens. Nothing is removed.
--
-- Everything here is service-role only: RLS on, no policies, revoked from anon
-- and authenticated (same posture as migs 176/179/182/195/319). Routes reach
-- it through supabaseAdmin.
--
-- Idempotent. Safe to re-run. Until it is applied the code answers 503 on the
-- machine API, the Connections screen says "run migration 348", the webhook
-- job warns once and does nothing, and the two flags simply do not exist (the
-- frontend reads them strictly, so a missing flag is OFF).
-- ============================================================================

-- -- 1. API keys ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_keys (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  key_prefix    text        NOT NULL,                 -- first 8 chars, shown in the UI
  key_hash      text        NOT NULL UNIQUE,          -- sha256 hex of the full key
  scopes        text[]      NOT NULL DEFAULT '{}',
  company_ids   uuid[],                               -- NULL = every company
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

COMMENT ON TABLE public.integration_keys IS
  'Machine API keys for /api/ext/v1 (mig 348). Only the sha256 of a key is kept; the key is shown once. Service-role only.';

-- -- 2. Webhooks ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_webhooks (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL,
  url               text        NOT NULL,
  secret            text        NOT NULL,             -- HMAC key; must be readable to sign
  events            text[]      NOT NULL DEFAULT '{*}', -- '*', 'sale.*', 'transfer.created', ...
  company_ids       uuid[],                           -- NULL = every company
  active            boolean     NOT NULL DEFAULT true,
  created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_status       int,
  last_error        text,
  last_delivery_at  timestamptz,
  failing_since     timestamptz
);

COMMENT ON TABLE public.integration_webhooks IS
  'Outbound webhooks (mig 348). Payloads are signed x-crm-signature = hex HMAC-SHA256(secret, "<ts>.<body>"). Service-role only.';

-- -- 3. Outbox -----------------------------------------------------------------
-- next_attempt_at NULL + delivered_at NULL = gave up (retries exhausted).
CREATE TABLE IF NOT EXISTS public.integration_deliveries (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id       uuid        NOT NULL REFERENCES public.integration_webhooks(id) ON DELETE CASCADE,
  event            text        NOT NULL,
  payload          jsonb       NOT NULL,
  attempts         int         NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz DEFAULT now(),
  delivered_at     timestamptz,
  last_status      int,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- The dispatcher's only hot query: what is due now.
CREATE INDEX IF NOT EXISTS idx_integration_deliveries_due
  ON public.integration_deliveries (next_attempt_at)
  WHERE delivered_at IS NULL AND next_attempt_at IS NOT NULL;
-- "Recent deliveries" per webhook on the Connections screen.
CREATE INDEX IF NOT EXISTS idx_integration_deliveries_webhook
  ON public.integration_deliveries (webhook_id, created_at DESC);
-- The 14-day prune.
CREATE INDEX IF NOT EXISTS idx_integration_deliveries_created
  ON public.integration_deliveries (created_at);

-- -- 4. Source cursors ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_cursors (
  name     text PRIMARY KEY,                          -- 'policy_events', 'transfers'
  last_at  timestamptz,
  last_id  text
);

-- -- 5. Metrics pushed in by other systems -------------------------------------
CREATE TABLE IF NOT EXISTS public.external_metrics (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text        NOT NULL,                   -- 'qa', 'hrms', ...
  company_id  uuid        REFERENCES public.companies(id) ON DELETE SET NULL,
  agent       text        NOT NULL,                   -- VICIdial user, uppercase
  user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  metric      text        NOT NULL,
  period      text        NOT NULL CHECK (period ~ '^\d{4}-\d{2}(-\d{2})?$'),
  value       numeric,
  unit        text,
  details     jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_metrics_uniq UNIQUE (source, agent, metric, period)
);

CREATE INDEX IF NOT EXISTS idx_external_metrics_user
  ON public.external_metrics (user_id, period) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_external_metrics_metric
  ON public.external_metrics (metric, period);

-- -- 6. Lock down --------------------------------------------------------------
ALTER TABLE public.integration_keys       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_webhooks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_cursors    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_metrics       ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.integration_keys       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integration_webhooks   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integration_deliveries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integration_cursors    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.external_metrics       FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.integration_keys       TO service_role;
GRANT ALL ON public.integration_webhooks   TO service_role;
GRANT ALL ON public.integration_deliveries TO service_role;
GRANT ALL ON public.integration_cursors    TO service_role;
GRANT ALL ON public.external_metrics       TO service_role;

-- -- 7. External module switches (default OFF) ---------------------------------
INSERT INTO feature_flags (key, label, description, category, default_enabled, sort_order) VALUES
  ('external_hr', 'HR runs in hr.vertexpakistan.com',
   'The CRM''s own HR entries (HR module link, My HR) are replaced by one link to the HRMS (HR_APP_URL). The CRM HR pages are not removed.',
   'admin', false, 960),
  ('external_qa', 'QA runs in qa.vertexpakistan.com',
   'The CRM''s own QA entries (QA Department, QA Scores) are replaced by one link to the QA platform (QA_APP_URL). The CRM QA pages are not removed.',
   'admin', false, 961)
ON CONFLICT (key) DO NOTHING;

INSERT INTO schema_migrations (filename, note)
VALUES ('348_connections.sql', 'Connections: API keys + machine API, signed outbound webhooks, external metrics, external_hr/external_qa switches')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
