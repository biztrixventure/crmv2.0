-- ============================================================================
-- 116_client_portal.sql
-- Client recording portal: a superadmin creates external "client" users who log
-- in and ONLY see assigned closers' sales + can play the actual sale-call
-- recording (streamed/proxied on demand — the recording itself is NEVER stored
-- here). portal_clients = the client login + which closers it may see.
-- portal_listens = full audit (who listened to which sale's recording, when).
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS portal_clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid NOT NULL UNIQUE,           -- the Supabase auth user (isolated, no CRM role)
  name          text NOT NULL,
  login_email   text NOT NULL,
  closer_ids    uuid[] NOT NULL DEFAULT '{}',    -- which closers this client may see
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_listens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_client_id uuid NOT NULL REFERENCES portal_clients(id) ON DELETE CASCADE,
  sale_id          uuid,
  closer_id        uuid,
  closer_name      text,
  customer_name    text,
  recording_id     text,
  listened_at      timestamptz NOT NULL DEFAULT now(),
  ip               text
);

CREATE INDEX IF NOT EXISTS idx_portal_listens_client ON portal_listens (portal_client_id, listened_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_clients_auth   ON portal_clients (auth_user_id);
