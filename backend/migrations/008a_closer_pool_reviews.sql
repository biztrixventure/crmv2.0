-- ============================================================================
-- Migration 008a: Closer pool, call reviews, call dispositions
-- RUN FIRST. Commit before running 008b.
-- ============================================================================

-- ============================================================================
-- 1. companies: add is_closer_pool flag
-- ============================================================================
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS is_closer_pool BOOLEAN DEFAULT false;

-- ============================================================================
-- 2. call_reviews table
-- ============================================================================
CREATE TABLE IF NOT EXISTS call_reviews (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id  UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  closer_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id   UUID REFERENCES companies(id) ON DELETE SET NULL,  -- fronter's company
  rating       TEXT NOT NULL CHECK (rating IN ('excellent','good','average','below_average','bad')),
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_reviews_transfer  ON call_reviews(transfer_id);
CREATE INDEX IF NOT EXISTS idx_call_reviews_company   ON call_reviews(company_id);
CREATE INDEX IF NOT EXISTS idx_call_reviews_closer    ON call_reviews(closer_id);

-- ============================================================================
-- 3. call_dispositions table
-- ============================================================================
CREATE TABLE IF NOT EXISTS call_dispositions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id  UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  closer_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id   UUID REFERENCES companies(id) ON DELETE SET NULL,  -- fronter's company
  disposition  TEXT NOT NULL CHECK (disposition IN ('sale','no_sale','callback','not_interested','hung_up','voicemail','other')),
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_dispositions_transfer ON call_dispositions(transfer_id);
CREATE INDEX IF NOT EXISTS idx_call_dispositions_company  ON call_dispositions(company_id);

-- ============================================================================
-- 4. NEW PERMISSIONS
-- ============================================================================
INSERT INTO permissions (name, description, category) VALUES
  ('submit_call_review',    'Can submit a review/rating for a call',           'reviews'),
  ('submit_call_dispo',     'Can set disposition for a call',                  'reviews'),
  ('view_call_reviews',     'Can view call reviews for own company',           'reviews'),
  ('view_all_call_reviews', 'Can view call reviews across all companies',      'reviews'),
  ('manage_closer_pool',    'Can manage the closer pool company settings',     'companies')
ON CONFLICT (name) DO NOTHING;
