-- ============================================================================
-- 189 — QA CRM-day fetch + closer-leg recording link + lead-id backfill.
--
-- The QA manager loads a past day and scores the three sections that already
-- live in the CRM — TRA (fronter transfer leg), Closed Sale (closer leg), and
-- Unclosed Sale (closer leg of a transfer that never became a sale). RCM stays
-- dialer-only (never in the CRM).
--
-- Two problems this migration fixes, both ADDITIVELY (no workflow changes,
-- nothing dropped, safe on a live DB):
--
--  1) `sales` has NO place to store its dialer recording link. `transfers`
--     already carries the fronter leg (vicidial_vendor_code + vicidial_agent);
--     sales gets the SAME two columns for the closer leg, filled best-effort by
--     the backfill (only when empty).
--
--  2) Some CRM rows are "incomplete" — no lead id — so a recording can only be
--     found by the slow agent+phone+date scan every play. When the manager
--     fetches the dialer day we can match phone(+agent) → lead id and write it
--     back once, making every later lookup instant. `qa_lead_backfill_log`
--     records every write for an honest audit trail.
-- ============================================================================

-- Closer-leg recording link on the sale (mirrors transfers.vicidial_vendor_code
-- / vicidial_agent for the fronter leg). Nullable + additive: existing sale
-- writes are untouched and never require these.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS vicidial_vendor_code text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS vicidial_agent       text;

-- Audit trail: one row per lead-id backfilled onto a CRM record. Immutable log.
CREATE TABLE IF NOT EXISTS qa_lead_backfill_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type  text NOT NULL,               -- 'transfer' | 'sale'
  record_id    uuid NOT NULL,
  company_id   uuid,
  leg          text,                         -- 'fronter' | 'closer'
  box_id       text,
  lead_id      text,
  vendor_code  text,                         -- prefix+lead_id written to the row
  agent        text,                         -- dialer agent id matched
  phone        text,
  matched_by   text,                         -- 'agent_phone_date' | 'phone_date' | 'lead_id'
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- deny-all RLS (service-role backend bypasses; matches the mig-179 posture).
ALTER TABLE qa_lead_backfill_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_qa_backfill_record ON qa_lead_backfill_log (record_type, record_id);

-- Lookups the CRM-day builder leans on.
CREATE INDEX IF NOT EXISTS idx_transfers_company_created ON transfers (company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_transfer            ON sales (transfer_id) WHERE transfer_id IS NOT NULL;
