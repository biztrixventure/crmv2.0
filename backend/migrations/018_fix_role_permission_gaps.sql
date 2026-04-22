-- ============================================================================
-- Migration 018: Fix role permission gaps discovered during UI audit
-- ============================================================================
-- Changes:
--   Fronter Manager → add view_all_call_reviews (Reviews tab was invisible)
--   Fronter Manager → add search_sales (Search Sales tab was invisible)
--   Closer          → add view_financial_data (monthly payment hidden on own sales)
-- ============================================================================

DO $$
DECLARE
  v_role_id   UUID;
  v_perm_id   UUID;
  v_perm_name TEXT;
  v_role_name TEXT;
  v_perms     TEXT[];
BEGIN
  FOR v_role_name, v_perms IN
    SELECT * FROM (VALUES
      ('Fronter Manager', ARRAY['view_all_call_reviews', 'search_sales']),
      ('Closer',          ARRAY['view_financial_data'])
    ) AS t(rname, perms)
  LOOP
    FOR v_role_id IN
      SELECT id FROM custom_roles WHERE name = v_role_name
    LOOP
      FOREACH v_perm_name IN ARRAY v_perms LOOP
        SELECT id INTO v_perm_id FROM permissions WHERE name = v_perm_name;
        IF v_perm_id IS NOT NULL THEN
          INSERT INTO role_permissions (role_id, permission_id)
          VALUES (v_role_id, v_perm_id)
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Migration 018: Fronter Manager + Closer permission gaps fixed.';
END $$;
