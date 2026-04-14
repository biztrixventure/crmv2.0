-- ============================================================================
-- Migration 004: Sale Business Fields + Notifications
-- ============================================================================
-- Adds detailed sale tracking fields and a full notifications system

-- ============================================================================
-- 1. EXTEND SALES TABLE WITH BUSINESS FIELDS
-- ============================================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS customer_name      TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone     TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone_2   TEXT,
  ADD COLUMN IF NOT EXISTS customer_email     TEXT,
  ADD COLUMN IF NOT EXISTS customer_address   TEXT,
  ADD COLUMN IF NOT EXISTS car_year           INTEGER,
  ADD COLUMN IF NOT EXISTS car_make           TEXT,
  ADD COLUMN IF NOT EXISTS car_model          TEXT,
  ADD COLUMN IF NOT EXISTS car_miles          INTEGER,
  ADD COLUMN IF NOT EXISTS car_vin            TEXT,
  ADD COLUMN IF NOT EXISTS plan               TEXT,
  ADD COLUMN IF NOT EXISTS down_payment       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS monthly_payment    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS payment_due_note   TEXT,
  ADD COLUMN IF NOT EXISTS reference_no       TEXT,
  ADD COLUMN IF NOT EXISTS client_name        TEXT,
  ADD COLUMN IF NOT EXISTS fronter_id         UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS closer_id          UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS sale_date          DATE DEFAULT CURRENT_DATE;

-- Add new sale status values (safe — additive only)
ALTER TYPE sale_status ADD VALUE IF NOT EXISTS 'sold';
ALTER TYPE sale_status ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE sale_status ADD VALUE IF NOT EXISTS 'follow_up';

-- Make transfer_id optional (allow standalone sales)
ALTER TABLE sales ALTER COLUMN transfer_id DROP NOT NULL;

-- Index for faster reference lookups
CREATE INDEX IF NOT EXISTS idx_sales_reference_no   ON sales(reference_no);
CREATE INDEX IF NOT EXISTS idx_sales_fronter_id     ON sales(fronter_id);
CREATE INDEX IF NOT EXISTS idx_sales_closer_id      ON sales(closer_id);
CREATE INDEX IF NOT EXISTS idx_sales_sale_date      ON sales(sale_date);

-- ============================================================================
-- 2. NOTIFICATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
  type        VARCHAR(60) NOT NULL,   -- 'transfer_created' | 'transfer_assigned' | 'sale_created' | 'sale_updated'
  title       TEXT NOT NULL,
  message     TEXT,
  data        JSONB,                  -- { transfer_id, sale_id, reference_no, ... }
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread  ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_company ON notifications(company_id);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. NOTIFICATIONS RLS POLICIES
-- ============================================================================

-- Drop existing if re-running
DROP POLICY IF EXISTS "users_see_own_notifications"           ON notifications;
DROP POLICY IF EXISTS "users_update_own_notifications"        ON notifications;
DROP POLICY IF EXISTS "service_role_can_insert_notifications" ON notifications;
DROP POLICY IF EXISTS "service_role_can_delete_notifications" ON notifications;

CREATE POLICY "users_see_own_notifications" ON notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "users_update_own_notifications" ON notifications
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "service_role_can_insert_notifications" ON notifications
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_can_delete_notifications" ON notifications
  FOR DELETE USING (auth.role() = 'service_role');

-- ============================================================================
-- 4. NEW PERMISSIONS
-- ============================================================================

INSERT INTO permissions (name, description, category) VALUES
  ('delete_sale',          'Can delete sales',                    'sales'),
  ('view_notifications',   'Can view own notifications',          'notifications'),
  ('delete_transfer',      'Can delete transfers',                'transfers')
ON CONFLICT DO NOTHING;

-- Grant Super Admin the new permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM custom_roles r, permissions p
WHERE r.name = 'Super Admin'
  AND p.name IN ('delete_sale', 'view_notifications', 'delete_transfer')
ON CONFLICT DO NOTHING;
