-- ============================================================================
-- 210_egress_export_access.sql
-- SuperAdmin per-user / per-role EXPORT-BUTTON control, layered on the existing
-- egress_limits table (167 + 209). Adds a clean boolean kill-switch so a
-- superadmin can turn the export button ON/OFF for any role or any individual
-- user, globally or per data AREA — without abusing max_exports_per_day=0.
--
-- Resolution (unchanged, in egressGuard): user > company > role, and a
-- dataset-specific row beats the catch-all (dataset NULL = "all areas").
--
-- Posture: OPT-OUT. Default false = NOT blocked = everyone keeps exporting; the
-- superadmin inserts an export_blocked=true row to disable a role/user/area.
--
-- Additive + idempotent. Apply AFTER 209.
-- ============================================================================

ALTER TABLE egress_limits
  ADD COLUMN IF NOT EXISTS export_blocked boolean NOT NULL DEFAULT false;

-- The resolver reads by (scope_type, scope_id, action_type, dataset) — already
-- indexed by uq_egress_limits_scope_area (209) + idx_egress_limits_area (209).
-- No new index needed; export_blocked rides on the row the resolver already picks.

-- ── post-apply verification ─────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='egress_limits' AND column_name='export_blocked';
