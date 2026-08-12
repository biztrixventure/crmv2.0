-- ============================================================================
-- 249_sales_paid_to_partner.sql
-- Adds a superadmin-only checkbox ("Paid to Partner") alongside the existing
-- paid_to_closer flag (mig 246). paid_to_closer surfaces to the CLOSER on
-- their own Sale card; this one is a separate, independent fact surfaced to
-- the COMPANY_ADMIN of the sale's own company (sales.company_id) in
-- ManagerShell's Team Sales tab — has the company itself (the "partner")
-- been paid out for this sale, distinct from whether the individual closer
-- has been paid.
-- ============================================================================
ALTER TABLE sales ADD COLUMN IF NOT EXISTS paid_to_partner boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (filename, note)
VALUES ('249_sales_paid_to_partner.sql', 'Adds sales.paid_to_partner — superadmin-set flag surfaced to company_admin in ManagerShell Team Sales')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
