-- 072_transfer_dedup_events.sql
-- Log every duplicate-attempt event when a fronter resubmits an existing phone.
-- Manager visibility: counts of refresh / reengage / sale_overlap that did NOT
-- increment the fronter's daily transfer count but represent real activity.

CREATE TABLE IF NOT EXISTS transfer_dedup_events (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fronter_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transfer_id        uuid        REFERENCES transfers(id) ON DELETE SET NULL,
  prior_transfer_id  uuid        REFERENCES transfers(id) ON DELETE SET NULL,
  event_type         text        NOT NULL CHECK (event_type IN ('refresh','reengage','sale_overlap')),
  normalized_phone   text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tde_company_created ON transfer_dedup_events (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tde_fronter         ON transfer_dedup_events (fronter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tde_transfer        ON transfer_dedup_events (transfer_id);

COMMENT ON TABLE  transfer_dedup_events IS 'Append-only log of fronter duplicate-attempt events. Used by ManagerShell stats.';
COMMENT ON COLUMN transfer_dedup_events.event_type IS 'refresh = within window update | reengage = past window new row | sale_overlap = completed sale on prior';
