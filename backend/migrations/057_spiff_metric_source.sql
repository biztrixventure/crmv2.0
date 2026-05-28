-- ============================================================================
-- 057_spiff_metric_source.sql — auto-computed SPIFF progress
--
-- Adds a structured `metric_source` to spiff_campaigns so participant values
-- can be derived live from real business activity (transfers, sales, revenue)
-- instead of typed in by a superadmin. Existing campaigns default to 'manual'
-- so the old "POST /spiff/:id/entry { value }" workflow keeps working.
--
-- The pre-existing free-text `metric` column stays as a human-friendly label
-- (shown on widgets); `metric_source` drives the calculation.
-- ============================================================================

ALTER TABLE spiff_campaigns
  ADD COLUMN IF NOT EXISTS metric_source text NOT NULL DEFAULT 'manual';

ALTER TABLE spiff_campaigns
  DROP CONSTRAINT IF EXISTS spiff_campaigns_metric_source_check;

ALTER TABLE spiff_campaigns
  ADD CONSTRAINT spiff_campaigns_metric_source_check
  CHECK (metric_source IN ('manual', 'transfers', 'sales', 'revenue'));
