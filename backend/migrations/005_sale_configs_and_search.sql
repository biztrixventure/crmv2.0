-- ============================================================================
-- Migration 005: Sale Configs (Plans/Clients) + Sale Search Permission
-- ============================================================================

-- ============================================================================
-- 1. SALE CONFIGS TABLE
-- Stores dynamic Plans and Client values, managed by SuperAdmin per-company.
-- When a config is deleted, historical sale records retain their saved value.
-- ============================================================================
CREATE TABLE IF NOT EXISTS sale_configs (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,  -- NULL = global default
  type       VARCHAR(20) NOT NULL CHECK (type IN ('plan', 'client')),
  value      TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, type, value)
);

CREATE INDEX IF NOT EXISTS idx_sale_configs_company_type ON sale_configs(company_id, type);

ALTER TABLE sale_configs ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "service_role_sale_configs_all" ON sale_configs
  FOR ALL USING (auth.role() = 'service_role');

-- Authenticated users can view configs for their company
CREATE POLICY "users_view_sale_configs" ON sale_configs
  FOR SELECT USING (
    company_id IS NULL  -- global defaults visible to all
    OR company_id IN (
      SELECT company_id FROM user_company_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- ============================================================================
-- 2. SEED DEFAULT GLOBAL PLANS
-- ============================================================================
INSERT INTO sale_configs (company_id, type, value, sort_order) VALUES
  (NULL, 'plan', 'Signature', 1),
  (NULL, 'plan', 'Basic',     2),
  (NULL, 'plan', 'Premium',   3),
  (NULL, 'plan', 'Elite',     4),
  (NULL, 'plan', 'Gold',      5),
  (NULL, 'plan', 'Platinum',  6),
  (NULL, 'plan', 'Custom',    7)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 3. FAST SEARCH INDEXES ON SALES TABLE
-- Using pg_trgm for partial text search on key lookup fields.
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_sales_search_name
  ON sales USING gin (customer_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sales_search_phone
  ON sales USING gin (customer_phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sales_search_email
  ON sales USING gin (customer_email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sales_search_vin
  ON sales USING gin (car_vin gin_trgm_ops);

-- reference_no already has btree index — add trgm too for partial match
CREATE INDEX IF NOT EXISTS idx_sales_search_ref
  ON sales USING gin (reference_no gin_trgm_ops);

-- ============================================================================
-- 4. NEW PERMISSION: search_sales
-- ============================================================================
INSERT INTO permissions (name, description, category) VALUES
  ('search_sales', 'Can search and view all sale records in the company', 'sales')
ON CONFLICT DO NOTHING;

-- Grant search_sales to Super Admin by default
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r, permissions p
WHERE r.name = 'Super Admin' AND p.name = 'search_sales'
ON CONFLICT DO NOTHING;
