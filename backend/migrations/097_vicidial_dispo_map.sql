-- ============================================================================
-- 097_vicidial_dispo_map.sql
-- Maps a raw VICIdial closer disposition code (e.g. "NI", "CB", "SALE") to a CRM
-- disposition (the name shown in the closer's dropdown / disposition_configs).
-- A row with disposition_name = NULL is an UNMAPPED code the dialer sent that the
-- superadmin hasn't resolved yet — it's auto-recorded here (with a hit count) so
-- nothing is lost and the superadmin can map or promote it.
--
-- Per-company: VICIdial codes + CRM dispositions both vary by company.
-- Idempotent. Safe to re-run.
-- ============================================================================
CREATE TABLE IF NOT EXISTS vicidial_dispo_map (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid REFERENCES companies(id) ON DELETE CASCADE,
  vici_code        text NOT NULL,                 -- raw dialer disposition, uppercased
  disposition_name text,                          -- target CRM disposition (NULL = unmapped/pending)
  category         text,                          -- optional: sale|callback|not_interested|dnc|no_answer|dropped|other
  hits             integer NOT NULL DEFAULT 0,    -- times this code has arrived
  last_seen_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, vici_code)
);
CREATE INDEX IF NOT EXISTS idx_vicidial_dispo_map_company ON vicidial_dispo_map (company_id);

ALTER TABLE vicidial_dispo_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vicidial_dispo_map_all ON vicidial_dispo_map;
CREATE POLICY vicidial_dispo_map_all ON vicidial_dispo_map FOR ALL USING (true);
