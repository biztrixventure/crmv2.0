-- ============================================================================
-- 167_data_egress_governance.sql
-- Data-egress governance: audit log, numeric limits, field-selection + list
-- display config. See docs/export-governance-audit.md for the landscape.
--
-- WHY A FOCUSED export_audit_log (not activity_logs): the per-export daily-count
-- enforcement query runs on EVERY export/listen attempt and must be one index
-- scan on (user_id, action_type, created_at) filtered by status='allowed'.
-- Stuffing egress into activity_logs.metadata would force jsonb predicates on
-- that hot path and mix egress into the entity-edit log. Dedicated table = clean
-- indexes + first-class filter columns for the admin browser.
--
-- Idempotent. Apply after 166.
-- ============================================================================

-- ── 1a. egress audit log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS export_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid,                       -- CRM user OR portal-client auth id
  company_id     uuid,                       -- their company (NULL for portal clients)
  role_level     text,                       -- caller's role at the time (context/filtering)
  action_type    text NOT NULL,              -- 'csv_export' | 'recording_listen' (extensible)
  dataset        text,                        -- surface: 'sales','transfers','callbacks',
                                              -- 'callback_audit','reviews','data_analyzer',
                                              -- 'numbers','customer_profile','company_data',
                                              -- 'upload_batch'  OR a sale_id for recordings
  surface        text,                        -- finer origin label (endpoint / component)
  status         text NOT NULL DEFAULT 'allowed' CHECK (status IN ('allowed','denied')),
  deny_reason    text,                        -- populated when status='denied'
  row_count      int,                         -- rows exported (csv)
  duration_seconds int,                       -- clip length (recording_listen)
  filters_applied jsonb,                      -- exact filter snapshot at export time
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Enforcement hot path: today's ALLOWED count for one user+action.
CREATE INDEX IF NOT EXISTS idx_eal_enforce
  ON export_audit_log (user_id, action_type, created_at DESC) WHERE status = 'allowed';
-- Admin browse: newest first (+ company scoping).
CREATE INDEX IF NOT EXISTS idx_eal_created  ON export_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eal_company  ON export_audit_log (company_id, created_at DESC);
-- Filter-by-user / by-action in the admin table.
CREATE INDEX IF NOT EXISTS idx_eal_user     ON export_audit_log (user_id, created_at DESC);

-- ── 1b. numeric limits (role → company → user, most-specific row wins) ────────
CREATE TABLE IF NOT EXISTS egress_limits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type     text NOT NULL CHECK (scope_type IN ('role','company','user')),
  scope_id       text NOT NULL,               -- role level string | company uuid | user uuid
  action_type    text NOT NULL,               -- 'csv_export' | 'recording_listen'
  max_rows_per_export           int,           -- NULL = unlimited
  max_exports_per_day           int,           -- NULL = unlimited
  max_recording_minutes_per_day int,           -- NULL = unlimited
  updated_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id, action_type)
);
CREATE INDEX IF NOT EXISTS idx_egress_limits_lookup
  ON egress_limits (scope_type, scope_id, action_type);

-- Sensible starting defaults (all UNLIMITED so nothing changes on rollout —
-- governance is opt-in; superadmin tightens per role from the UI). Seeded as
-- explicit role rows so the admin UI has something to render/edit immediately.
INSERT INTO egress_limits (scope_type, scope_id, action_type,
                           max_rows_per_export, max_exports_per_day, max_recording_minutes_per_day)
VALUES
  ('role','closer',            'csv_export',       NULL, NULL, NULL),
  ('role','fronter',           'csv_export',       NULL, NULL, NULL),
  ('role','closer_manager',    'csv_export',       NULL, NULL, NULL),
  ('role','fronter_manager',   'csv_export',       NULL, NULL, NULL),
  ('role','operations_manager','csv_export',       NULL, NULL, NULL),
  ('role','company_admin',     'csv_export',       NULL, NULL, NULL),
  ('role','compliance_manager','csv_export',       NULL, NULL, NULL),
  ('role','portal_client',     'recording_listen', NULL, NULL, NULL)
ON CONFLICT (scope_type, scope_id, action_type) DO NOTHING;

-- ── 1c. export field-selection + 1d. list-display config ──────────────────────
-- Both live in business_config (global/company resolution + getConfig cascade),
-- mirroring drawer.layout / shell.layout exactly. No rows seeded → absence means
-- "all fields / hardcoded defaults", so existing exports + lists are unchanged
-- until a superadmin configures them.
--
--   export.columns.<dataset>.<role>  = ["field_key", ...]   (visible export cols)
--   list.layout.<shell>.<role>       = { "page_size": int,
--                                        "visible_columns": ["key", ...],
--                                        "default_view": "expanded"|"collapsed" }
--
-- (documented here; no INSERT — the resolvers fall back to code defaults.)

-- ── post-apply verification ───────────────────────────────────────────────────
-- SELECT tablename FROM pg_tables WHERE tablename IN ('export_audit_log','egress_limits');
-- SELECT indexname FROM pg_indexes WHERE tablename = 'export_audit_log';
-- -- enforcement plan (index-only-ish scan expected, no seq scan):
-- EXPLAIN ANALYZE SELECT count(*) FROM export_audit_log
--   WHERE user_id = (SELECT id FROM auth.users LIMIT 1)
--     AND action_type = 'csv_export' AND status = 'allowed'
--     AND created_at >= date_trunc('day', now());
