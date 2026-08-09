-- ============================================================================
-- 240_qa2_call_source_crm_day.sql
-- QA v2 — day-1 assignment: a 4th population path alongside ingest/sweep/
-- manual. Reads yesterday's transfers + sales DIRECTLY from the CRM (the same
-- records Compliance's Records > Transfers/Sales tabs already show) instead
-- of sweeping raw dialer logs — every row gets a real transfer_id/sale_id FK,
-- which is strictly better identity than a sweep's phone-only match.
--
-- 'crm_day' is qa2_call.source (HOW the row was populated, for audit/
-- reporting) — a SEPARATE concern from which qa2_method_rule.source a row
-- classifies against (qa2CrmDay.js deliberately classifies against
-- 'ingest_fronter'/'ingest_closer' so a manager's existing rules, already
-- configured for live ingest, apply unchanged — no duplicate rule set needed).
-- ============================================================================

ALTER TABLE qa2_call DROP CONSTRAINT IF EXISTS qa2_call_source_check;
ALTER TABLE qa2_call ADD CONSTRAINT qa2_call_source_check
  CHECK (source IN ('ingest', 'sweep', 'manual', 'crm_day'));

INSERT INTO schema_migrations (filename, note)
VALUES ('240_qa2_call_source_crm_day.sql', 'QA v2 — widen qa2_call.source for the day-1 CRM-record population path')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
