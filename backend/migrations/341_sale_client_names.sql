-- ============================================================================
-- 341_sale_client_names.sql — the client list behind "Clients this login can
-- see", without a row cap.
--
-- THE BUG THIS REMOVES. /portal/admin/sale-clients built that picker by
-- reading `sales.client_name` with `.limit(8000)` and de-duplicating in Node.
-- On 2026-10-09 the table held 8,122 rows, so the scan had started
-- truncating — and with no ORDER BY, which rows fell outside the window was
-- arbitrary. A client whose sales happened to sit past the cap simply vanished
-- from the picker, and nothing anywhere said so.
--
-- Reading 8,122 rows to learn NINE distinct names was the real mistake. The
-- database can answer the actual question, so it does: this view returns one
-- row per name, which is both correct and far cheaper than the scan it
-- replaces (the endpoint used to ship ~8k values over the wire per page load).
--
-- Deliberately NOT a materialized view: it is read once when a superadmin
-- opens the Client Portal tab, and a stale list is exactly the complaint that
-- started this. Deliberately NOT filtered by company: the picker is
-- superadmin-only and scopes a portal login across the estate, which is the
-- same reach the query it replaces had.
--
-- '-' is excluded because that is the placeholder the sale form writes when no
-- client was chosen, not a client anyone can be shown.
-- ============================================================================

CREATE OR REPLACE VIEW app_sale_client_names AS
SELECT DISTINCT btrim(client_name) AS client_name
FROM sales
WHERE client_name IS NOT NULL
  AND btrim(client_name) <> ''
  AND btrim(client_name) <> '-';

-- Same posture as every other app_* view in this schema: the service role
-- reads it, the anon and authenticated keys never do (mig 176 closed exactly
-- that hole for the DEFINER views, and this one carries business data).
REVOKE ALL ON public.app_sale_client_names FROM PUBLIC;
REVOKE ALL ON public.app_sale_client_names FROM anon;
REVOKE ALL ON public.app_sale_client_names FROM authenticated;
GRANT SELECT ON public.app_sale_client_names TO service_role;

COMMENT ON VIEW app_sale_client_names IS
  'Distinct non-placeholder sales.client_name values. Feeds the Client Portal '
  '"Clients this login can see" picker, which previously scanned sales with a '
  'limit of 8000 and silently dropped clients once the table outgrew it.';
