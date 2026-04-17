-- Migration 010: Company types and company links

-- Add company_type to companies
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS company_type VARCHAR(20) NOT NULL DEFAULT 'fronter'
  CHECK (company_type IN ('fronter', 'closer'));

-- Create company_links junction table (fronter <-> closer)
CREATE TABLE IF NOT EXISTS company_links (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fronter_company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  closer_company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(fronter_company_id, closer_company_id),
  CHECK (fronter_company_id <> closer_company_id)
);

CREATE INDEX IF NOT EXISTS idx_company_links_fronter ON company_links(fronter_company_id);
CREATE INDEX IF NOT EXISTS idx_company_links_closer  ON company_links(closer_company_id);
