-- ============================================================================
-- 073_transfer_status_catalog.sql
-- Seeds the default transfer status catalog so the new
-- TransferStatusFilterPills + Admin UI render the same five lifecycle states
-- that were previously hardcoded. SuperAdmin can rename labels, swap badge
-- colors, hide irrelevant states, and reorder them per company.
--
-- Catalog shape (mirrors compliance.status_catalog without the
-- editable_by_compliance flag — transfer transitions are system-driven, not
-- compliance-driven):
--   [
--     {
--       "key": "assigned",
--       "label": "Assigned",
--       "badge": "info" | "success" | "warning" | "error" | "secondary" | "primary",
--       "enabled": true|false
--     }, ...
--   ]
-- ============================================================================

INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'transfer.status_catalog',
    '[
      {"key":"pending",   "label":"Pending",   "badge":"warning",   "enabled":true},
      {"key":"assigned",  "label":"Assigned",  "badge":"info",      "enabled":true},
      {"key":"completed", "label":"Completed", "badge":"success",   "enabled":true},
      {"key":"rejected",  "label":"Rejected",  "badge":"error",     "enabled":true},
      {"key":"cancelled", "label":"Cancelled", "badge":"secondary", "enabled":true}
    ]'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;
