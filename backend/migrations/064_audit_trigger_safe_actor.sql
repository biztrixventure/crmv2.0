-- ============================================================================
-- 064_audit_trigger_safe_actor.sql
--
-- Fix runtime error from migration 063: the audit trigger function read
-- NEW.user_id and NEW.created_by directly, but those columns don't exist on
-- every tracked table — transfers has created_by but no user_id; callback_numbers
-- has neither (it uses owner_id). PL/pgSQL field access on a missing column
-- throws `record "new" has no field "user_id"` at INSERT time and the whole
-- write rolls back.
--
-- Rewrite the actor resolver to go through to_jsonb(NEW), which returns NULL
-- for absent keys instead of erroring. Same trigger, same audit table, no
-- schema change — just replaces the function body.
-- ============================================================================

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
    -- Pull actor through the jsonb so missing columns are NULL, not an error.
    -- Order of preference: last_modified_by (explicit) → created_by (most
    -- tables) → user_id (callbacks) → owner_id (callback_numbers).
    actor := NULLIF(new_json ->> 'last_modified_by', '')::uuid;
    IF actor IS NULL THEN actor := NULLIF(new_json ->> 'created_by', '')::uuid; END IF;
    IF actor IS NULL THEN actor := NULLIF(new_json ->> 'user_id',    '')::uuid; END IF;
    IF actor IS NULL THEN actor := NULLIF(new_json ->> 'owner_id',   '')::uuid; END IF;

    INSERT INTO field_audit_log (table_name, record_id, operation, changes, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', jsonb_build_object('snapshot', new_json), actor);
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    old_json := to_jsonb(OLD);
    new_json := to_jsonb(NEW);

    actor := NULLIF(new_json ->> 'last_modified_by', '')::uuid;
    IF actor IS NULL THEN actor := NULLIF(new_json ->> 'created_by', '')::uuid; END IF;
    IF actor IS NULL THEN actor := NULLIF(new_json ->> 'user_id',    '')::uuid; END IF;
    IF actor IS NULL THEN actor := NULLIF(new_json ->> 'owner_id',   '')::uuid; END IF;

    FOR field_key IN SELECT jsonb_object_keys(new_json) LOOP
      IF field_key = ANY(skip_keys) THEN CONTINUE; END IF;
      IF (old_json -> field_key) IS DISTINCT FROM (new_json -> field_key) THEN
        diff := diff || jsonb_build_object(
          field_key,
          jsonb_build_object('old', old_json -> field_key, 'new', new_json -> field_key)
        );
      END IF;
    END LOOP;

    IF diff <> '{}'::jsonb THEN
      INSERT INTO field_audit_log (table_name, record_id, operation, changes, changed_by)
      VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', diff, actor);
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    old_json := to_jsonb(OLD);
    INSERT INTO field_audit_log (table_name, record_id, operation, changes, changed_by)
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', jsonb_build_object('snapshot', old_json), NULL);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;
