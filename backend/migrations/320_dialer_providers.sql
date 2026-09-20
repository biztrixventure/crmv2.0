-- ============================================================================
-- 320_dialer_providers.sql
-- MULTI-DIALER: make "the dialer" a pluggable ACCOUNT instead of VICIdial only.
--
-- The CRM's dialer wiring grew around one product (VICIdial): boxes in
-- vicidial_boxes, agents in user_profiles.vicidial_agent_ids, the ingest URLs
-- guarded by one shared env token, and every correlation key shaped like a
-- vendor_lead_code. CallTools (and anything else with an HTTP webhook) cannot
-- describe itself in those terms — it posts JSON, names its agents differently,
-- and hands the recording over as a URL rather than a lead id on a box.
--
-- So the dialer becomes a row:
--
--   dialer_accounts      one connected dialer (provider + credentials + how to
--                        read its payloads). Its webhook_token IS the URL:
--                        POST /api/dialer/hook/<webhook_token>
--   dialer_agent_links   that dialer's agent identity -> CRM user (+ company).
--                        VICIdial keeps using user_profiles.vicidial_agent_ids;
--                        this is the generic fallback every provider can use.
--   dialer_webhook_events every inbound hit, raw + normalized + outcome. This is
--                        the debugging surface AND what the mapping editor reads
--                        to show "here are the fields your dialer actually
--                        sends" — you cannot map a payload you cannot see.
--
-- NOTHING here changes the VICIdial path. Existing rows read 'vicidial' by
-- default and the old ingest URLs keep working exactly as they are.
--
-- Apply in the Supabase SQL editor. Idempotent.
-- ============================================================================

-- ── 1. the connected dialers ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dialer_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider       text NOT NULL DEFAULT 'generic',
  name           text NOT NULL,
  -- NULL = the company is resolved from the agent (like VICIdial does). Set it
  -- to pin every call from this account to one company regardless of agent.
  company_id     uuid REFERENCES companies(id) ON DELETE SET NULL,
  -- Correlation-code prefix for leads that arrive from this account, so a lead
  -- id is unique across the estate exactly like a VICIdial vendor_lead_code.
  prefix         text,
  base_url       text,
  -- { type: 'bearer'|'header'|'basic'|'query'|'none', token, header_name,
  --   user, pass, query_param }  — never returned to the browser in full.
  auth           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- { xfer_dispos: [], default_leg, leg_rules: [], dedup_ms, recording: {...},
  --   ignore_dispos: [], require_signature: bool }
  settings       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- canonical field -> where to read it out of THIS dialer's payload.
  field_map      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The URL secret. Long + random; rotating it changes the webhook URL.
  webhook_token  text NOT NULL UNIQUE,
  -- Optional HMAC-SHA256 shared secret. When set, a signed header is REQUIRED.
  webhook_secret text,
  is_active      boolean NOT NULL DEFAULT true,
  last_event_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dialer_accounts_provider ON dialer_accounts (provider) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_dialer_accounts_company  ON dialer_accounts (company_id);

-- ── 2. agent identity -> CRM user ───────────────────────────────────────────
-- One external id per account. Two dialers may legitimately both call an agent
-- "1001", which is exactly why the account is part of the key.
CREATE TABLE IF NOT EXISTS dialer_agent_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES dialer_accounts(id) ON DELETE CASCADE,
  external_agent_id text NOT NULL,
  user_id           uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id        uuid REFERENCES companies(id) ON DELETE SET NULL,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dialer_agent_link
  ON dialer_agent_links (account_id, upper(external_agent_id));
CREATE INDEX IF NOT EXISTS idx_dialer_agent_link_user ON dialer_agent_links (user_id);

-- ── 3. every inbound webhook, raw ───────────────────────────────────────────
-- Kept for a short window (the prune function below) because it holds PII.
CREATE TABLE IF NOT EXISTS dialer_webhook_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid REFERENCES dialer_accounts(id) ON DELETE CASCADE,
  provider     text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  method       text,
  source_ip    text,
  headers      jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- body + query, merged
  event_type   text,                                  -- xfer | dispo | call | ignored
  leg          text,
  normalized   jsonb,                                 -- what the mapping produced
  outcome      text,                                  -- human-readable result line
  status       text NOT NULL DEFAULT 'received'
               CHECK (status IN ('received','accepted','ignored','rejected','error')),
  error        text,
  transfer_id  uuid REFERENCES transfers(id) ON DELETE SET NULL,
  qa2_call_id  uuid REFERENCES qa2_call(id) ON DELETE SET NULL,
  duration_ms  integer
);
CREATE INDEX IF NOT EXISTS idx_dialer_events_account ON dialer_webhook_events (account_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_dialer_events_status  ON dialer_webhook_events (status, received_at DESC);

-- ── 4. mark CRM rows with the dialer they came from ─────────────────────────
-- Everything that exists today came from VICIdial, so that is the default and
-- no backfill is needed.
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS dialer_provider   text NOT NULL DEFAULT 'vicidial';
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS dialer_account_id uuid REFERENCES dialer_accounts(id) ON DELETE SET NULL;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS dialer_call_id    text;
CREATE INDEX IF NOT EXISTS idx_transfers_dialer_call ON transfers (dialer_call_id) WHERE dialer_call_id IS NOT NULL;

ALTER TABLE qa2_call ADD COLUMN IF NOT EXISTS dialer_provider   text NOT NULL DEFAULT 'vicidial';
ALTER TABLE qa2_call ADD COLUMN IF NOT EXISTS dialer_account_id uuid REFERENCES dialer_accounts(id) ON DELETE SET NULL;
ALTER TABLE qa2_call ADD COLUMN IF NOT EXISTS dialer_call_id    text;
CREATE INDEX IF NOT EXISTS idx_qa2_call_dialer_call ON qa2_call (dialer_call_id) WHERE dialer_call_id IS NOT NULL;
-- The recording poller asks the PROVIDER for clips it could not get from a box.
CREATE INDEX IF NOT EXISTS idx_qa2_call_provider_pending
  ON qa2_call (dialer_provider, recording_state, recording_attempts)
  WHERE recording_state = 'pending';

-- ── 5. event retention ──────────────────────────────────────────────────────
-- Raw payloads carry customer names/numbers. 14 days is enough to debug a
-- mapping and short enough that this is not a second copy of the lead database.
CREATE OR REPLACE FUNCTION fn_prune_dialer_events(p_days integer DEFAULT 14)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM dialer_webhook_events
   WHERE received_at < now() - make_interval(days => GREATEST(p_days, 1));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ── 6. lock the tables down ─────────────────────────────────────────────────
-- Credentials and raw customer payloads: service_role only, like the rest of
-- the dialer surface. RLS on with no policy = nothing reaches anon/authenticated
-- even if a grant is added by accident later.
ALTER TABLE dialer_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE dialer_agent_links    ENABLE ROW LEVEL SECURITY;
ALTER TABLE dialer_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dialer_accounts       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.dialer_agent_links    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.dialer_webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.dialer_accounts       TO service_role;
GRANT ALL ON public.dialer_agent_links    TO service_role;
GRANT ALL ON public.dialer_webhook_events TO service_role;

INSERT INTO schema_migrations (filename, note)
VALUES ('320_dialer_providers.sql', 'Pluggable dialer accounts (CallTools + any webhook dialer) alongside VICIdial')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
