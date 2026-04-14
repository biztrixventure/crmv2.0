-- ============================================================================
-- Migration 006: Callbacks + Push Subscriptions
-- ============================================================================

-- ============================================================================
-- 1. CALLBACKS TABLE
-- Both fronters and closers can schedule callbacks with customers.
-- Server checks every minute and sends push + in-app notification when due.
-- ============================================================================
CREATE TABLE IF NOT EXISTS callbacks (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_name  TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,
  notes       TEXT,
  callback_at TIMESTAMPTZ NOT NULL,
  status      VARCHAR(20) DEFAULT 'pending'
              CHECK (status IN ('pending', 'completed', 'cancelled', 'no_answer')),
  source      VARCHAR(20) DEFAULT 'manual'
              CHECK (source IN ('manual', 'transfer', 'sale')),
  source_id   UUID,         -- optional link to transfer_id or sale_id
  notified    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_callbacks_user_id     ON callbacks(user_id);
CREATE INDEX IF NOT EXISTS idx_callbacks_company_id  ON callbacks(company_id);
CREATE INDEX IF NOT EXISTS idx_callbacks_callback_at ON callbacks(callback_at);
-- Scheduler uses this index to find pending due callbacks efficiently
CREATE INDEX IF NOT EXISTS idx_callbacks_due
  ON callbacks(callback_at, notified)
  WHERE notified = false AND status = 'pending';

ALTER TABLE callbacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_callbacks_all" ON callbacks
  FOR ALL USING (auth.role() = 'service_role');

-- Users see their own callbacks
CREATE POLICY "users_see_own_callbacks" ON callbacks
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "users_create_own_callbacks" ON callbacks
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "users_update_own_callbacks" ON callbacks
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "users_delete_own_callbacks" ON callbacks
  FOR DELETE USING (user_id = auth.uid());

-- Managers see all company callbacks
CREATE POLICY "managers_see_company_callbacks" ON callbacks
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM user_company_roles
      WHERE user_id = auth.uid() AND is_active = true
      AND role_id IN (
        SELECT id FROM custom_roles
        WHERE level IN ('manager', 'company_admin', 'superadmin', 'closer_manager', 'operations_manager')
      )
    )
  );

-- ============================================================================
-- 2. PUSH SUBSCRIPTIONS TABLE
-- Stores Web Push API subscription objects per user per browser.
-- ============================================================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth_key   TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user_id ON push_subscriptions(user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_push_all" ON push_subscriptions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "users_manage_own_push_subs" ON push_subscriptions
  FOR ALL USING (user_id = auth.uid());

-- ============================================================================
-- 3. NEW PERMISSIONS
-- ============================================================================
INSERT INTO permissions (name, description, category) VALUES
  ('view_callbacks',   'Can view own callback schedule',          'callbacks'),
  ('manage_callbacks', 'Can create and manage callbacks',         'callbacks'),
  ('view_team_callbacks', 'Can view team callbacks (managers)',   'callbacks')
ON CONFLICT DO NOTHING;
