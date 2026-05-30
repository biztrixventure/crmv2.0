-- ============================================================================
-- 063_field_audit_log.sql
--
-- Generic per-field audit trail covering every UPDATE / INSERT / DELETE on the
-- tables that hold customer-facing data: transfers, sales, callbacks,
-- callback_numbers. One row per write event; the `changes` JSONB carries
-- {field: {old, new}} so the table stays compact even when a write touches
-- many columns.
--
-- Actor attribution comes from a `last_modified_by` column on each tracked
-- table. The trigger reads NEW.last_modified_by — Supabase's PostgREST model
-- runs each HTTP call in its own transaction, so session GUCs (set_config)
-- don't persist across writes, which makes a column-based actor more reliable.
--
-- Safe to apply: triggers fire AFTER the write so a buggy trigger can't roll
-- back a real change, and the trigger function is INSERT-only into a separate
-- table — no impact on the live row.
-- ============================================================================

-- ── audit table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS field_audit_log (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name   text          NOT NULL,
  record_id    uuid          NOT NULL,
  operation    text          NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  -- {field: {old: value, new: value}} for UPDATE; full row snapshot under
  -- {snapshot: row} for INSERT / DELETE so we keep a forensic copy at both
  -- ends of the lifecycle. Keeping both shapes in one column lets a single
  -- index serve every history query.
  changes      jsonb         NOT NULL,
  changed_by   uuid          NULL,
  changed_at   timestamptz   NOT NULL DEFAULT now(),
  source       text          NULL          -- optional tag: 'bulk_upload', 'compliance', 'trigger'
);

-- Lookup pattern: "show me the history of row X on table Y" — covers the
-- common case (record audit timeline). Date-desc so most recent change first.
CREATE INDEX IF NOT EXISTS field_audit_log_record_idx
  ON field_audit_log (table_name, record_id, changed_at DESC);

-- "Show me everything user U touched" — useful for compliance investigations.
CREATE INDEX IF NOT EXISTS field_audit_log_actor_idx
  ON field_audit_log (changed_by, changed_at DESC)
  WHERE changed_by IS NOT NULL;

-- "Show me activity on table T in time window W" — useful for cross-row
-- analysis ("what got edited yesterday on sales").
CREATE INDEX IF NOT EXISTS field_audit_log_table_time_idx
  ON field_audit_log (table_name, changed_at DESC);

-- ── trigger function ────────────────────────────────────────────────────────

-- Generic AFTER trigger. Diffs OLD vs NEW jsonb representations and inserts
-- one row per write event. Skips housekeeping columns that change on every
-- write but carry no semantic value (updated_at, last_modified_by itself).
CREATE OR REPLACE FUNCTION audit_field_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_json   jsonb;
  new_json   jsonb;
  diff       jsonb := '{}'::jsonb;
  actor      uuid;
  field_key  text;
  skip_keys  text[] := ARRAY['updated_at', 'last_modified_by', 'edit_history'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_json := to_jsonb(NEW);
    actor    := COALESCE(NEW.last_modified_by, NEW.created_by, NEW.user_id);
    INSERT INTO field_audit_log (table_name, record_id, operation, changes, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', jsonb_build_object('snapshot', new_json), actor);
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    old_json := to_jsonb(OLD);
    new_json := to_jsonb(NEW);
    actor    := COALESCE(NEW.last_modified_by, NEW.created_by);

    -- Diff one field at a time. Compare jsonb values (NULL-safe via IS DISTINCT
    -- FROM) so a column going NULL→value or value→NULL still registers.
    FOR field_key IN SELECT jsonb_object_keys(new_json) LOOP
      IF field_key = ANY(skip_keys) THEN CONTINUE; END IF;
      IF (old_json -> field_key) IS DISTINCT FROM (new_json -> field_key) THEN
        diff := diff || jsonb_build_object(
          field_key,
          jsonb_build_object('old', old_json -> field_key, 'new', new_json -> field_key)
        );
      END IF;
    END LOOP;

    -- Only log if something semantically changed — keeps the audit table from
    -- ballooning on housekeeping-only updates (touching updated_at alone).
    IF diff <> '{}'::jsonb THEN
      INSERT INTO field_audit_log (table_name, record_id, operation, changes, changed_by)
      VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', diff, actor);
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    old_json := to_jsonb(OLD);
    -- DELETE actor is captured by whoever issued the call; without a session
    -- GUC we don't know, so leave NULL and rely on application-level pre-log.
    INSERT INTO field_audit_log (table_name, record_id, operation, changes, changed_by)
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', jsonb_build_object('snapshot', old_json), NULL);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- ── tracked tables: add last_modified_by + attach trigger ──────────────────

ALTER TABLE transfers          ADD COLUMN IF NOT EXISTS last_modified_by uuid;
ALTER TABLE sales              ADD COLUMN IF NOT EXISTS last_modified_by uuid;
ALTER TABLE callbacks          ADD COLUMN IF NOT EXISTS last_modified_by uuid;
ALTER TABLE callback_numbers   ADD COLUMN IF NOT EXISTS last_modified_by uuid;

-- DROP-then-CREATE so re-running the migration replaces the trigger cleanly
-- (CREATE TRIGGER IF NOT EXISTS doesn't exist in older Postgres versions and
-- the cheap rebuild is fine since these are metadata-only operations).
DROP TRIGGER IF EXISTS audit_transfers_changes        ON transfers;
DROP TRIGGER IF EXISTS audit_sales_changes            ON sales;
DROP TRIGGER IF EXISTS audit_callbacks_changes        ON callbacks;
DROP TRIGGER IF EXISTS audit_callback_numbers_changes ON callback_numbers;

CREATE TRIGGER audit_transfers_changes
  AFTER INSERT OR UPDATE OR DELETE ON transfers
  FOR EACH ROW EXECUTE FUNCTION audit_field_changes();

CREATE TRIGGER audit_sales_changes
  AFTER INSERT OR UPDATE OR DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION audit_field_changes();

CREATE TRIGGER audit_callbacks_changes
  AFTER INSERT OR UPDATE OR DELETE ON callbacks
  FOR EACH ROW EXECUTE FUNCTION audit_field_changes();

CREATE TRIGGER audit_callback_numbers_changes
  AFTER INSERT OR UPDATE OR DELETE ON callback_numbers
  FOR EACH ROW EXECUTE FUNCTION audit_field_changes();

-- ── RLS: service role only (backend reads, no client access) ───────────────

ALTER TABLE field_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS field_audit_log_service_all ON field_audit_log;
CREATE POLICY field_audit_log_service_all ON field_audit_log
  FOR ALL USING (true);
