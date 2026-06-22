-- ============================================================================
-- 101_vicidial_closer_assigned_status.sql
-- Fix: confirmed VICIdial transfers that a closer already dispositioned were
-- left at status='pending' (the confirm handler hard-set 'pending'), so they
-- never showed in the closer's assigned tab / compliance / admin like a manual
-- closer-worked transfer does. Manual transfers with a closer are 'assigned'.
--
-- A status='pending' row WITH assigned_closer_id set is only ever this bug:
-- the manual create/reassign paths always set 'assigned' when a closer exists.
-- Promote those rows to 'assigned'. Idempotent.
-- ============================================================================
UPDATE transfers
SET status = 'assigned', updated_at = now()
WHERE status = 'pending'
  AND assigned_closer_id IS NOT NULL
  AND COALESCE(vicidial_pending, false) = false;
