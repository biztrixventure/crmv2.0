-- ============================================================================
-- 074_shell_layouts.sql
-- Seeds shell.layout.<shell_id> defaults so SuperAdmin can hide tabs,
-- reorder them, rename labels, and set the default landing tab per shell
-- (Staff, Manager, Compliance) without touching code. The runtime hook
-- layers admin overrides ON TOP of existing permission + feature-flag
-- gates: if the user lacks the permission, the tab stays hidden regardless
-- of the layout config. Admin can only narrow what permissions/flags
-- already allowed — never widen it.
--
-- Layout shape:
--   {
--     "tabs": [
--       { "key": "overview", "enabled": true, "label": "Overview", "order": 0 },
--       ...
--     ],
--     "default_tab": "overview",
--     "stat_cards": [ { "key": "transfers", "enabled": true }, ... ],
--     "filters":    [ { "key": "date_range", "enabled": true }, ... ],
--     "actions":    [ { "key": "export", "enabled": true }, ... ]
--   }
--
-- The hook ignores unknown sub-keys for forward-compat. Only tabs are
-- seeded here; admin defaults all other sub-collections to visible at
-- runtime so a fresh deploy never silently hides surfaces.
-- ============================================================================

INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'shell.layout.staff',
    '{
      "default_tab": "sales",
      "tabs": [
        {"key":"sales",           "enabled":true, "label":"My Sales",        "order":0},
        {"key":"transfers",       "enabled":true, "label":"My Transfers",    "order":1},
        {"key":"team_transfers",  "enabled":true, "label":"Team Transfers",  "order":2},
        {"key":"team_sales",      "enabled":true, "label":"Team Sales",      "order":3},
        {"key":"callbacks",       "enabled":true, "label":"Callbacks",       "order":4},
        {"key":"team_callbacks",  "enabled":true, "label":"Team Callbacks",  "order":5},
        {"key":"tracked_numbers", "enabled":true, "label":"Tracked Numbers", "order":6},
        {"key":"numbers",         "enabled":true, "label":"My Numbers",      "order":7},
        {"key":"search",          "enabled":true, "label":"Search Sales",    "order":8},
        {"key":"faqs",            "enabled":true, "label":"FAQs",            "order":9},
        {"key":"scripts",         "enabled":true, "label":"Scripts",         "order":10}
      ]
    }'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'shell.layout.manager',
    '{
      "default_tab": "overview",
      "tabs": [
        {"key":"overview",     "enabled":true, "label":"Overview",        "order":0},
        {"key":"transfers",    "enabled":true, "label":"Team Transfers",  "order":1},
        {"key":"team_sales",   "enabled":true, "label":"Team Sales",      "order":2},
        {"key":"my_sales",     "enabled":true, "label":"My Sales",        "order":3},
        {"key":"callbacks",    "enabled":true, "label":"Team Callbacks",  "order":4},
        {"key":"numbers",      "enabled":true, "label":"Numbers",         "order":5},
        {"key":"search",       "enabled":true, "label":"Sale Search",     "order":6},
        {"key":"spiffs",       "enabled":true, "label":"SPIFFs",          "order":7},
        {"key":"activity_log", "enabled":true, "label":"Activity Log",    "order":8},
        {"key":"faqs",         "enabled":true, "label":"FAQs",            "order":9},
        {"key":"scripts",      "enabled":true, "label":"Scripts",         "order":10}
      ]
    }'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'shell.layout.compliance',
    '{
      "default_tab": "companies",
      "tabs": [
        {"key":"companies", "enabled":true, "label":"Companies",    "order":0},
        {"key":"calendar",  "enabled":true, "label":"Calendar",     "order":1},
        {"key":"queue",     "enabled":true, "label":"Review Queue", "order":2},
        {"key":"sales",       "enabled":true, "label":"All Sales",          "order":3},
        {"key":"bulk_status", "enabled":true, "label":"Bulk Status Update", "order":4},
        {"key":"transfers",   "enabled":true, "label":"Transfers",          "order":5},
        {"key":"callbacks",   "enabled":true, "label":"Callbacks",          "order":6},
        {"key":"reviews",     "enabled":true, "label":"Call Reviews",       "order":7},
        {"key":"numbers",     "enabled":true, "label":"Call Numbers",       "order":8}
      ]
    }'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;
