-- ============================================================================
-- 215 — StaffShell gains an export button, shipped OFF for closer + fronter.
--
-- StaffShell had no export at all until now. Adding an egress surface for the
-- two lowest-trust roles AND switching it on in the same change would be the
-- wrong default, so this seeds the export_blocked rows that make canExport()
-- return false for both. The button does not render until a superadmin turns it
-- on in Data Egress → Export access (per role, or for one person).
--
-- dataset IS NULL is the __global scope, so this blocks every data area for
-- those two roles in one row each.
--
-- Migration 209 replaced the 3-column UNIQUE on egress_limits with a FUNCTIONAL
-- unique index over COALESCE(dataset,'*'). ON CONFLICT cannot target a
-- functional index, which is why this is a guarded INSERT rather than an upsert
-- (the same reason routes/egress.js does find-then-insert). Re-runnable, and it
-- deliberately does NOT overwrite an existing row: if an operator has already
-- decided closer or fronter may export, re-running must not silently revoke it.
-- ============================================================================

INSERT INTO egress_limits (scope_type, scope_id, action_type, dataset, export_blocked, updated_at)
SELECT v.scope_id_val, v.role_name, 'csv_export', NULL, true, now()
FROM (VALUES ('role', 'closer'), ('role', 'fronter')) AS v(scope_id_val, role_name)
WHERE NOT EXISTS (
  SELECT 1 FROM egress_limits e
  WHERE e.scope_type = 'role'
    AND e.scope_id = v.role_name
    AND e.action_type = 'csv_export'
    AND e.dataset IS NULL
);

-- Verify:
--   SELECT scope_type, scope_id, dataset, export_blocked
--   FROM egress_limits
--   WHERE action_type = 'csv_export' AND scope_type = 'role'
--   ORDER BY scope_id;
-- Expect closer + fronter with export_blocked = true and dataset NULL.
