-- ============================================================================
-- 071_compliance_status_catalog.sql
-- Replaces the simple allowed_statuses string list with a structured catalog
-- so SuperAdmin can add custom statuses with their own labels + badge colors.
-- Existing records stay valid — runtime label/badge maps fall back to the
-- hardcoded shared.jsx values when a row's status isn't in the catalog.
--
-- Catalog shape:
--   [
--     {
--       "key": "closed_won",
--       "label": "Approved",
--       "badge": "success" | "error" | "warning" | "info" | "secondary",
--       "category": "won" | "lost" | "pending" | "neutral",
--       "enabled": true|false,        -- enabled keys flow into allowed_statuses
--       "editable_by_compliance": true|false   -- shown in edit dialog?
--     }, ...
--   ]
-- ============================================================================

INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'compliance.status_catalog',
    '[
      {"key":"open",                "label":"Open",              "badge":"info",      "category":"pending", "enabled":true, "editable_by_compliance":true},
      {"key":"sold",                "label":"Sold",              "badge":"success",   "category":"won",     "enabled":true, "editable_by_compliance":true},
      {"key":"cancelled",           "label":"Cancelled",         "badge":"error",     "category":"lost",    "enabled":true, "editable_by_compliance":true},
      {"key":"follow_up",           "label":"Follow Up",         "badge":"warning",   "category":"pending", "enabled":true, "editable_by_compliance":true},
      {"key":"closed_won",          "label":"Approved",          "badge":"success",   "category":"won",     "enabled":true, "editable_by_compliance":true},
      {"key":"closed_lost",         "label":"Lost",              "badge":"error",     "category":"lost",    "enabled":true, "editable_by_compliance":true},
      {"key":"pending_review",      "label":"Pending Review",    "badge":"warning",   "category":"pending", "enabled":true, "editable_by_compliance":false},
      {"key":"needs_revision",      "label":"Needs Revision",    "badge":"error",     "category":"pending", "enabled":true, "editable_by_compliance":false},
      {"key":"compliance_cancelled","label":"Comp. Cancelled",   "badge":"error",     "category":"lost",    "enabled":true, "editable_by_compliance":true},
      {"key":"chargeback",          "label":"Chargeback",        "badge":"error",     "category":"lost",    "enabled":true, "editable_by_compliance":true},
      {"key":"dispute",             "label":"Dispute",           "badge":"warning",   "category":"pending", "enabled":true, "editable_by_compliance":true},
      {"key":"resold",              "label":"Resold",            "badge":"info",      "category":"won",     "enabled":false,"editable_by_compliance":true},
      {"key":"expired",             "label":"Expired",           "badge":"secondary", "category":"lost",    "enabled":false,"editable_by_compliance":true},
      {"key":"refunded",            "label":"Refunded",          "badge":"error",     "category":"lost",    "enabled":false,"editable_by_compliance":true}
    ]'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;
