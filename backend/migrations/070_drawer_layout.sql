-- ============================================================================
-- 070_drawer_layout.sql
-- Seeds per-role drawer layout defaults into business_config. Stored under
-- key pattern: drawer.layout.<drawer_type>.<role>
-- value = ordered array of section configs:
--   [{ id, label, visible, order, fields? }]
--
-- drawer_type ∈ {'sale', 'transfer', 'callback', 'callback_number'}
-- role        ∈ {'fronter', 'fronter_manager', 'closer', 'closer_manager',
--                'compliance_manager', 'superadmin', 'company_admin'}
-- ============================================================================

-- ── SALE drawer ───────────────────────────────────────────────────────────────
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'drawer.layout.sale.closer',
    '[{"id":"customer","label":"Customer","visible":true,"order":1},
      {"id":"vehicle","label":"Vehicle","visible":true,"order":2},
      {"id":"sale_info","label":"Sale Info","visible":true,"order":3},
      {"id":"financial","label":"Financial","visible":true,"order":4},
      {"id":"additional","label":"Additional Info","visible":true,"order":5},
      {"id":"people","label":"People","visible":true,"order":6},
      {"id":"timeline","label":"Timeline","visible":true,"order":7},
      {"id":"audit","label":"Audit Trail","visible":true,"order":8}]'::jsonb),

  ('global', 'drawer.layout.sale.fronter',
    '[{"id":"customer","label":"Customer","visible":true,"order":1},
      {"id":"vehicle","label":"Vehicle","visible":true,"order":2},
      {"id":"sale_info","label":"Sale Info","visible":true,"order":3},
      {"id":"financial","label":"Financial","visible":false,"order":4},
      {"id":"additional","label":"Additional Info","visible":false,"order":5},
      {"id":"people","label":"People","visible":true,"order":6},
      {"id":"timeline","label":"Timeline","visible":true,"order":7},
      {"id":"audit","label":"Audit Trail","visible":false,"order":8}]'::jsonb),

  ('global', 'drawer.layout.sale.fronter_manager',
    '[{"id":"customer","label":"Customer","visible":true,"order":1},
      {"id":"vehicle","label":"Vehicle","visible":true,"order":2},
      {"id":"sale_info","label":"Sale Info","visible":true,"order":3},
      {"id":"financial","label":"Financial","visible":true,"order":4},
      {"id":"additional","label":"Additional Info","visible":true,"order":5},
      {"id":"people","label":"People","visible":true,"order":6},
      {"id":"timeline","label":"Timeline","visible":true,"order":7},
      {"id":"audit","label":"Audit Trail","visible":true,"order":8}]'::jsonb),

  ('global', 'drawer.layout.sale.closer_manager',
    '[{"id":"customer","label":"Customer","visible":true,"order":1},
      {"id":"vehicle","label":"Vehicle","visible":true,"order":2},
      {"id":"sale_info","label":"Sale Info","visible":true,"order":3},
      {"id":"financial","label":"Financial","visible":true,"order":4},
      {"id":"additional","label":"Additional Info","visible":true,"order":5},
      {"id":"people","label":"People","visible":true,"order":6},
      {"id":"timeline","label":"Timeline","visible":true,"order":7},
      {"id":"audit","label":"Audit Trail","visible":true,"order":8}]'::jsonb),

  ('global', 'drawer.layout.sale.compliance_manager',
    '[{"id":"customer","label":"Customer","visible":true,"order":1},
      {"id":"vehicle","label":"Vehicle","visible":true,"order":2},
      {"id":"sale_info","label":"Sale Info","visible":true,"order":3},
      {"id":"financial","label":"Financial","visible":true,"order":4},
      {"id":"compliance_actions","label":"Compliance Actions","visible":true,"order":5},
      {"id":"additional","label":"Additional Info","visible":true,"order":6},
      {"id":"people","label":"People","visible":true,"order":7},
      {"id":"timeline","label":"Timeline","visible":true,"order":8},
      {"id":"audit","label":"Audit Trail","visible":true,"order":9}]'::jsonb),

  ('global', 'drawer.layout.sale.superadmin',
    '[{"id":"customer","label":"Customer","visible":true,"order":1},
      {"id":"vehicle","label":"Vehicle","visible":true,"order":2},
      {"id":"sale_info","label":"Sale Info","visible":true,"order":3},
      {"id":"financial","label":"Financial","visible":true,"order":4},
      {"id":"compliance_actions","label":"Compliance Actions","visible":true,"order":5},
      {"id":"additional","label":"Additional Info","visible":true,"order":6},
      {"id":"people","label":"People","visible":true,"order":7},
      {"id":"timeline","label":"Timeline","visible":true,"order":8},
      {"id":"audit","label":"Audit Trail","visible":true,"order":9}]'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

-- ── TRANSFER drawer ──────────────────────────────────────────────────────────
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'drawer.layout.transfer.closer',
    '[{"id":"customer","label":"Customer","visible":true,"order":1},
      {"id":"vehicle","label":"Vehicle","visible":true,"order":2},
      {"id":"lead_info","label":"Lead Info","visible":true,"order":3},
      {"id":"people","label":"People","visible":true,"order":4},
      {"id":"dispositions","label":"Dispositions","visible":true,"order":5},
      {"id":"timeline","label":"Timeline","visible":true,"order":6}]'::jsonb),

  ('global', 'drawer.layout.transfer.fronter',
    '[{"id":"customer","label":"Customer","visible":true,"order":1},
      {"id":"vehicle","label":"Vehicle","visible":true,"order":2},
      {"id":"lead_info","label":"Lead Info","visible":true,"order":3},
      {"id":"people","label":"People","visible":true,"order":4},
      {"id":"dispositions","label":"Dispositions","visible":false,"order":5},
      {"id":"timeline","label":"Timeline","visible":true,"order":6}]'::jsonb),

  ('global', 'drawer.layout.transfer.compliance_manager',
    '[{"id":"customer","label":"Customer","visible":true,"order":1},
      {"id":"vehicle","label":"Vehicle","visible":true,"order":2},
      {"id":"lead_info","label":"Lead Info","visible":true,"order":3},
      {"id":"people","label":"People","visible":true,"order":4},
      {"id":"dispositions","label":"Dispositions","visible":true,"order":5},
      {"id":"timeline","label":"Timeline","visible":true,"order":6},
      {"id":"audit","label":"Audit Trail","visible":true,"order":7}]'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

-- ── CALLBACK drawer ──────────────────────────────────────────────────────────
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'drawer.layout.callback.closer',
    '[{"id":"schedule","label":"Schedule","visible":true,"order":1},
      {"id":"customer","label":"Customer","visible":true,"order":2},
      {"id":"notes","label":"Notes","visible":true,"order":3},
      {"id":"history","label":"History","visible":true,"order":4}]'::jsonb),

  ('global', 'drawer.layout.callback.fronter',
    '[{"id":"schedule","label":"Schedule","visible":true,"order":1},
      {"id":"customer","label":"Customer","visible":true,"order":2},
      {"id":"notes","label":"Notes","visible":true,"order":3},
      {"id":"history","label":"History","visible":false,"order":4}]'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;
