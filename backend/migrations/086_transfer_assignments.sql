-- ============================================================================
-- 086_transfer_assignments.sql
-- Append-only assignment log for the lead transfer chain.
--
-- Why: transfers.assigned_closer_id is MUTABLE — it only ever shows the
-- CURRENT owner. When a lead moves Fronter → Closer A → Closer B → Closer C,
-- the intermediate hops are lost. This table records every hop as an
-- immutable row so the full chain is queryable in one join, and managers can
-- report "leads received vs transferred out vs closed" per closer company.
--
-- How it stays in sync WITHOUT touching route code:
--   A trigger on transfers fires whenever assigned_closer_id changes (or is
--   set on insert) and appends one row here. No backend change needed, so no
--   existing workflow can break. The trigger body is wrapped in an exception
--   handler — if logging ever fails it is swallowed and the transfer write
--   proceeds normally. Audit logging must never block a business write.
--
-- Backfill caveat (per migration impact assessment):
--   Historical A→B→C chains are NOT recoverable — only the CURRENT assignment
--   was ever stored. Backfill therefore seeds one row per already-assigned
--   transfer (from = NULL, to = current assigned_closer_id). Going forward the
--   trigger captures the complete chain.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfer_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id    uuid NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  from_closer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  to_closer_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at    timestamptz NOT NULL DEFAULT now(),
  source         text NOT NULL DEFAULT 'trigger'   -- 'trigger' | 'backfill'
);

COMMENT ON TABLE transfer_assignments IS
  'Append-only log of lead reassignments. One row per hop in the transfer chain. Populated by trg_log_transfer_assignment on transfers — never written by route code. source=backfill rows are the one-time seed of the current owner.';
COMMENT ON COLUMN transfer_assignments.from_closer_id IS
  'Previous assigned_closer_id (NULL on first assignment / backfill seed).';
COMMENT ON COLUMN transfer_assignments.to_closer_id IS
  'New assigned_closer_id after this hop.';

CREATE INDEX IF NOT EXISTS idx_transfer_assignments_transfer ON transfer_assignments(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_assignments_to       ON transfer_assignments(to_closer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_assignments_at       ON transfer_assignments(assigned_at DESC);

-- ── Trigger function ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_log_transfer_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- INSERT: log only if the row is born already assigned.
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_closer_id IS NOT NULL THEN
      INSERT INTO transfer_assignments (transfer_id, from_closer_id, to_closer_id, assigned_by, assigned_at)
      VALUES (NEW.id, NULL, NEW.assigned_closer_id,
              COALESCE(NEW.last_modified_by, NEW.created_by),
              COALESCE(NEW.updated_at, now()));
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: log only on a real change of owner.
  IF NEW.assigned_closer_id IS DISTINCT FROM OLD.assigned_closer_id THEN
    INSERT INTO transfer_assignments (transfer_id, from_closer_id, to_closer_id, assigned_by, assigned_at)
    VALUES (NEW.id, OLD.assigned_closer_id, NEW.assigned_closer_id,
            COALESCE(NEW.last_modified_by, NEW.created_by),
            now());
  END IF;
  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Logging must never break the transfer write.
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_transfer_assignment ON transfers;
CREATE TRIGGER trg_log_transfer_assignment
  AFTER INSERT OR UPDATE OF assigned_closer_id ON transfers
  FOR EACH ROW EXECUTE FUNCTION fn_log_transfer_assignment();

-- ── Backfill (idempotent) ────────────────────────────────────────────────────
-- Seed the current owner for every already-assigned transfer. Re-running the
-- migration rebuilds the seed cleanly without duplicating trigger rows.
DELETE FROM transfer_assignments WHERE source = 'backfill';

INSERT INTO transfer_assignments (transfer_id, from_closer_id, to_closer_id, assigned_by, assigned_at, source)
SELECT id, NULL, assigned_closer_id, COALESCE(last_modified_by, created_by), COALESCE(updated_at, created_at, now()), 'backfill'
FROM   transfers
WHERE  assigned_closer_id IS NOT NULL;
