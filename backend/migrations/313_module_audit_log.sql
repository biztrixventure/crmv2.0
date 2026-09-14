-- ============================================================================
-- 313_module_audit_log.sql
--
-- A complete, append-only change record for every HR and Accounting table, plus
-- the CRM membership table (user_company_roles) so role changes -- the trainee
-- -> fronter promotion included -- are on record from today.
--
-- WHY A NEW TABLE and not field_audit_log (mig 063):
--   field_audit_log is 375 MB / 448k rows and sits on the hottest write path in
--   the app (every transfer, sale and callback write inserts into it). Adding a
--   company index to it would take a SHARE lock that queues every CRM write for
--   the duration of the build, and the Supabase SQL path cannot build
--   CONCURRENTLY. It also cannot say who DELETED a row. This table has the same
--   {field: {old, new}} / {snapshot: row} shape so one timeline reads both, and
--   adds what the HR/finance record needs: company, module, reason, source.
--
-- WHO made the change:
--   The backend runs every request inside an AsyncLocalStorage context
--   (utils/requestContext.js) and supabaseAdmin's fetch stamps three headers on
--   every PostgREST call:
--       x-actor-id          -- the signed-in user (from the verified JWT)
--       x-change-reason-b64 -- optional "why", base64 so any language survives
--       x-change-source     -- 'api' or 'job:<name>'
--   PostgREST exposes request headers to SQL as the `request.headers` GUC, so
--   the trigger knows the actor for INSERT, UPDATE *and* DELETE -- no
--   last_modified_by column needed. A write with no headers (SQL editor, a
--   migration) is recorded with source 'sql' rather than guessed at.
--
-- SAFETY:
--   * AFTER ROW trigger, whole body wrapped in EXCEPTION -> RAISE WARNING. An
--     audit failure can never roll back or block the real write. Same promise
--     mig 063 and 087 made.
--   * Never touches the audited row or its siblings (mig 088/091 lesson).
--   * Append-only: UPDATE, DELETE and TRUNCATE on the log raise.
--   * No FK to companies: deleting a company must not cascade-delete its
--     history, and a cascade would collide with the append-only guard.
--
-- Verify after applying:
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_module_audit';   -- 26
--   SELECT source, count(*) FROM module_audit_log GROUP BY 1;            -- baseline rows
-- ============================================================================

-- -- The log -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS module_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  module      text NOT NULL CHECK (module IN ('hr','accounting','people','access')),
  company_id  uuid,                  -- NULL only for designations (user-level)
  table_name  text NOT NULL,
  record_id   uuid NOT NULL,
  -- The record this row belongs to (invoice for a line item, run for a payroll
  -- entry, employee for an attendance day). Lets "history of invoice X" include
  -- its lines and payments without searching JSON.
  parent_id   uuid,
  operation   text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  -- UPDATE: {field: {old, new}}.  INSERT / DELETE / baseline: {snapshot: row}.
  changes     jsonb NOT NULL,
  changed_by  uuid,
  reason      text,
  source      text NOT NULL DEFAULT 'sql',   -- api | sql | baseline | job:<name>
  changed_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_mal_record  ON module_audit_log (table_name, record_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_mal_parent  ON module_audit_log (parent_id, id DESC) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mal_company ON module_audit_log (company_id, module, id DESC);
CREATE INDEX IF NOT EXISTS idx_mal_actor   ON module_audit_log (changed_by, id DESC) WHERE changed_by IS NOT NULL;

COMMENT ON TABLE module_audit_log IS
  'Append-only change record for HR, Accounting, memberships and designations (mig 313). Written only by fn_module_audit(); read by /api/{hr,accounting}/history.';

ALTER TABLE module_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON module_audit_log FROM anon, authenticated;

-- -- Append-only guard ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_module_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'module_audit_log is append-only: history cannot be edited or removed';
END;
$fn$;

DROP TRIGGER IF EXISTS trg_mal_append_only ON module_audit_log;
CREATE TRIGGER trg_mal_append_only
  BEFORE UPDATE OR DELETE ON module_audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_module_audit_append_only();

DROP TRIGGER IF EXISTS trg_mal_no_truncate ON module_audit_log;
CREATE TRIGGER trg_mal_no_truncate
  BEFORE TRUNCATE ON module_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION fn_module_audit_append_only();

-- -- Request context ----------------------------------------------------------------
-- What the backend told us about this write. {via:'sql'} when there are no
-- request headers at all (SQL editor, migration, pg_cron).
CREATE OR REPLACE FUNCTION fn_request_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE h jsonb;
BEGIN
  BEGIN
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    h := NULL;
  END;
  IF h IS NULL THEN
    RETURN jsonb_build_object('via', 'sql');
  END IF;
  RETURN jsonb_build_object(
    'via',        'api',
    'actor',      h ->> 'x-actor-id',
    'reason_b64', h ->> 'x-change-reason-b64',
    'source',     h ->> 'x-change-source'
  );
END;
$fn$;

-- Exposed to the service role only -- it is how the backend self-tests that the
-- headers actually arrive (see utils/requestContext.js). Nobody else needs it.
REVOKE ALL ON FUNCTION fn_request_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_request_context() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_request_context() TO service_role;

-- -- The trigger ------------------------------------------------------------------------
-- TG_ARGV[0] = module, TG_ARGV[1] = parent column name ('' for none).
CREATE OR REPLACE FUNCTION fn_module_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_module   text := TG_ARGV[0];
  v_parent_c text := nullif(TG_ARGV[1], '');
  v_old      jsonb;
  v_new      jsonb;
  v_row      jsonb;
  v_diff     jsonb := '{}'::jsonb;
  v_changes  jsonb;
  v_key      text;
  v_ctx      jsonb;
  v_actor    uuid;
  v_reason   text;
  v_source   text;
  v_record   uuid;
  v_parent   uuid;
  v_company  uuid;
  v_col      text;
BEGIN
  BEGIN
    IF TG_OP IN ('UPDATE','DELETE') THEN v_old := to_jsonb(OLD); END IF;
    IF TG_OP IN ('INSERT','UPDATE') THEN v_new := to_jsonb(NEW); END IF;
    v_row := COALESCE(v_new, v_old);

    IF TG_OP = 'UPDATE' THEN
      FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
        CONTINUE WHEN v_key = 'updated_at';
        IF (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
          v_diff := v_diff || jsonb_build_object(
            v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
        END IF;
      END LOOP;
      -- Housekeeping-only write (updated_at alone): nothing happened.
      IF v_diff = '{}'::jsonb THEN RETURN NULL; END IF;
      v_changes := v_diff;
    ELSE
      v_changes := jsonb_build_object('snapshot', v_row);
    END IF;

    v_ctx    := fn_request_context();
    v_source := left(COALESCE(nullif(v_ctx ->> 'source', ''), v_ctx ->> 'via', 'sql'), 60);

    BEGIN
      v_actor := nullif(v_ctx ->> 'actor', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_actor := NULL;
    END;

    -- No actor header (SQL editor, scheduler without a user): for a NEW row the
    -- row's own attribution column is the best evidence of who created it. An
    -- update or delete with no header is left unattributed rather than pinned
    -- on whoever happened to create the row originally.
    IF v_actor IS NULL AND TG_OP = 'INSERT' THEN
      FOREACH v_col IN ARRAY ARRAY['created_by','recorded_by','submitted_by','requested_by',
                                   'assigned_by','designated_by','posted_by'] LOOP
        BEGIN
          v_actor := nullif(v_row ->> v_col, '')::uuid;
        EXCEPTION WHEN OTHERS THEN v_actor := NULL;
        END;
        EXIT WHEN v_actor IS NOT NULL;
      END LOOP;
    END IF;

    IF nullif(v_ctx ->> 'reason_b64', '') IS NOT NULL THEN
      BEGIN
        v_reason := left(convert_from(decode(v_ctx ->> 'reason_b64', 'base64'), 'UTF8'), 1000);
      EXCEPTION WHEN OTHERS THEN v_reason := NULL;
      END;
    END IF;

    BEGIN
      v_record := COALESCE(nullif(v_row ->> 'id', ''), nullif(v_row ->> 'user_id', ''))::uuid;
    EXCEPTION WHEN OTHERS THEN v_record := NULL;
    END;
    IF v_record IS NULL THEN RETURN NULL; END IF;

    BEGIN
      v_company := nullif(v_row ->> 'company_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_company := NULL;
    END;

    IF v_parent_c IS NOT NULL THEN
      BEGIN
        v_parent := nullif(v_row ->> v_parent_c, '')::uuid;
      EXCEPTION WHEN OTHERS THEN v_parent := NULL;
      END;
    END IF;

    INSERT INTO module_audit_log
      (module, company_id, table_name, record_id, parent_id, operation, changes, changed_by, reason, source)
    VALUES
      (v_module, v_company, TG_TABLE_NAME, v_record, v_parent, TG_OP, v_changes, v_actor, v_reason, v_source);
  EXCEPTION WHEN OTHERS THEN
    -- The record of a change must never cost the change itself.
    RAISE WARNING 'fn_module_audit(%): % -- change kept, history row skipped', TG_TABLE_NAME, SQLERRM;
  END;
  RETURN NULL;
END;
$fn$;

-- -- Attach -------------------------------------------------------------------------------
-- {table, module, parent column}
DO $$
DECLARE
  spec text[];
  specs text[][] := ARRAY[
    ARRAY['hr_departments',              'hr',         ''],
    ARRAY['hr_positions',                'hr',         ''],
    ARRAY['hr_employees',                'hr',         ''],
    ARRAY['hr_attendance',               'hr',         'employee_id'],
    ARRAY['hr_leave_types',              'hr',         ''],
    ARRAY['hr_leave_balances',           'hr',         'employee_id'],
    ARRAY['hr_leave_requests',           'hr',         'employee_id'],
    ARRAY['hr_pay_periods',              'hr',         ''],
    ARRAY['hr_payroll_runs',             'hr',         ''],
    ARRAY['hr_payroll_entries',          'hr',         'run_id'],
    ARRAY['hr_payroll_deductions',       'hr',         'entry_id'],
    ARRAY['hr_review_cycles',            'hr',         ''],
    ARRAY['hr_reviews',                  'hr',         'employee_id'],
    ARRAY['hr_review_goals',             'hr',         'review_id'],
    ARRAY['hr_review_ratings',           'hr',         'review_id'],
    ARRAY['chart_of_accounts',           'accounting', ''],
    ARRAY['journal_entries',             'accounting', ''],
    ARRAY['journal_entry_lines',         'accounting', 'entry_id'],
    ARRAY['invoices',                    'accounting', ''],
    ARRAY['invoice_line_items',          'accounting', 'invoice_id'],
    ARRAY['invoice_payments',            'accounting', 'invoice_id'],
    ARRAY['expense_categories',          'accounting', ''],
    ARRAY['expenses',                    'accounting', ''],
    ARRAY['module_designations',         'access',     ''],
    ARRAY['module_designation_companies','access',     ''],
    ARRAY['user_company_roles',          'people',     'user_id']
  ];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_module_audit ON %I', spec[1]);
    EXECUTE format(
      'CREATE TRIGGER trg_module_audit AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION fn_module_audit(%L, %L)',
      spec[1], spec[2], spec[3]);
  END LOOP;
END $$;

-- -- Baseline -------------------------------------------------------------------------------
-- Every existing record gets one "as it was when history began" snapshot, so a
-- record's timeline never starts in the middle with an unexplained first edit.
-- Idempotent: skipped for any record that already has a baseline row.
DO $$
DECLARE
  spec text[];
  specs text[][] := ARRAY[
    ARRAY['hr_departments','hr',''], ARRAY['hr_positions','hr',''], ARRAY['hr_employees','hr',''],
    ARRAY['hr_attendance','hr','employee_id'], ARRAY['hr_leave_types','hr',''],
    ARRAY['hr_leave_balances','hr','employee_id'], ARRAY['hr_leave_requests','hr','employee_id'],
    ARRAY['hr_pay_periods','hr',''], ARRAY['hr_payroll_runs','hr',''],
    ARRAY['hr_payroll_entries','hr','run_id'], ARRAY['hr_payroll_deductions','hr','entry_id'],
    ARRAY['hr_review_cycles','hr',''], ARRAY['hr_reviews','hr','employee_id'],
    ARRAY['hr_review_goals','hr','review_id'], ARRAY['hr_review_ratings','hr','review_id'],
    ARRAY['chart_of_accounts','accounting',''], ARRAY['journal_entries','accounting',''],
    ARRAY['journal_entry_lines','accounting','entry_id'], ARRAY['invoices','accounting',''],
    ARRAY['invoice_line_items','accounting','invoice_id'], ARRAY['invoice_payments','accounting','invoice_id'],
    ARRAY['expense_categories','accounting',''], ARRAY['expenses','accounting',''],
    ARRAY['user_company_roles','people','user_id']
  ];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    EXECUTE format($q$
      INSERT INTO module_audit_log (module, company_id, table_name, record_id, parent_id, operation, changes, source, changed_at)
      SELECT %L, t.company_id, %L, t.id, %s, 'INSERT', jsonb_build_object('snapshot', to_jsonb(t)), 'baseline', now()
        FROM %I t
       WHERE NOT EXISTS (SELECT 1 FROM module_audit_log m
                          WHERE m.table_name = %L AND m.record_id = t.id AND m.source = 'baseline')
    $q$, spec[2], spec[1],
         CASE WHEN spec[3] = '' THEN 'NULL::uuid' ELSE 't.' || quote_ident(spec[3]) END,
         spec[1], spec[1]);
  END LOOP;
END $$;

-- -- Who may read it --------------------------------------------------------------------------
-- Per-record history follows the record's own view permission (enforced in
-- routes/moduleHistory.js). The company-wide change log is its own grant, so a
-- superadmin can hand it to an auditor without handing them payroll.
INSERT INTO permissions (name, description, category) VALUES
  ('hr.history.view',         'See the full HR change log: who changed what, when, and why', 'hr'),
  ('accounting.history.view', 'See the full Accounting change log: who changed what, when, and why', 'accounting')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, category = EXCLUDED.category;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM custom_roles r
  JOIN permissions  p ON p.name IN ('hr.history.view', 'accounting.history.view')
 WHERE r.level::text IN ('company_admin', 'operations_manager')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO schema_migrations (filename, note)
VALUES ('313_module_audit_log.sql',
        'append-only module_audit_log + fn_module_audit on 26 tables (HR, accounting, memberships, designations); actor/reason via request headers; baseline snapshots; hr/accounting.history.view')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
