-- ============================================================================
-- 112_vicidial_backfill_batches.sql
-- Make the "Backfill dispos from a list CSV" import undoable. Each upload is a
-- BATCH; every disposition it fills is a FILL row that remembers the transfer,
-- the previous value, the value set, and the disposition_actions row inserted —
-- so the batch can be reverted exactly (and only where nothing changed since).
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS vicidial_backfill_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text,                       -- the uploaded file name
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  total_rows    integer NOT NULL DEFAULT 0, -- rows received from the CSV
  applied_count integer NOT NULL DEFAULT 0, -- transfers actually filled
  undone_at     timestamptz,
  undone_count  integer
);

CREATE TABLE IF NOT EXISTS vicidial_backfill_fills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        uuid NOT NULL REFERENCES vicidial_backfill_batches(id) ON DELETE CASCADE,
  transfer_id     uuid NOT NULL,
  prev_dispo      text,        -- value before the fill (NULL — we only fill empties)
  new_dispo       text,        -- value written
  dispo_action_id uuid,        -- the disposition_actions row inserted (deleted on undo)
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backfill_fills_batch    ON vicidial_backfill_fills (batch_id);
CREATE INDEX IF NOT EXISTS idx_backfill_fills_transfer ON vicidial_backfill_fills (transfer_id);
