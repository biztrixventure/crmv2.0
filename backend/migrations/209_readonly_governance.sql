-- ============================================================================
-- 209_readonly_governance.sql
-- SuperAdmin governance for the readonly_admin role. Two additive pieces:
--
--   1. readonly_activity_log — broad RO activity telemetry (tab opens, record
--      views, blocked copies, blocked write attempts). Kept SEPARATE from
--      export_audit_log (167) on purpose: that table's hot path is the egress
--      enforcement index idx_eal_enforce, and this high-volume navigation
--      stream must never touch it. Exports + recording-listens stay in
--      export_audit_log; the per-user timeline MERGES both at read time.
--
--   2. egress_limits.dataset — a per-AREA dimension so a superadmin can set
--      row/day export caps for one read-only admin per data area (sales,
--      transfers, callbacks, …), not just globally. NULL dataset = "all areas"
--      (exactly today's behavior — additive, nothing changes on rollout).
--
-- Everything else in this feature (which tabs a RO sees, which companies they
-- are scoped to, PII/financial masking flags, per-area export on/off, no-copy)
-- lives in business_config under readonly_admin.* keys — no schema needed.
--
-- Idempotent. Apply AFTER 208. (208 = qa_teams; confirm it is applied first.)
-- ============================================================================

-- ── 1. readonly activity log ────────────────────────────────────────────────
-- Role-agnostic by design (role_level column) so it can widen beyond
-- readonly_admin later with no schema change — just start writing other roles.
CREATE TABLE IF NOT EXISTS readonly_activity_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,                -- the actor (RO admin)
  role_level   text,                         -- actor role at event time (context/filter)
  company_id   uuid,                         -- actor company if any (RO is usually cross-company/null)
  action_type  text NOT NULL,                -- 'tab_open'|'record_view'|'copy_blocked'|'blocked_write'
  surface      text,                         -- tab id / component / route ('cc-sales','SaleDetailDrawer')
  dataset      text,                         -- entity type when relevant: 'sales'|'transfers'|'callbacks'|'reviews'
  record_id    text,                         -- id of the record opened/viewed (text: uuid or synthetic)
  http_method  text,                         -- blocked_write only: 'POST'|'PUT'|'DELETE'|'PATCH'
  path         text,                         -- blocked_write only: req.originalUrl (query stripped)
  detail       jsonb,                        -- small structured extras (NEVER raw PII payloads)
  source       text NOT NULL DEFAULT 'server'
                 CHECK (source IN ('server','client')),  -- trust marker: server=unforgeable, client=soft
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Per-user newest-first — the timeline query (GET /readonly-admins/:userId/activity).
CREATE INDEX IF NOT EXISTS idx_ral_user    ON readonly_activity_log (user_id, created_at DESC);
-- Global newest-first (cross-RO browse / retention prune scan).
CREATE INDEX IF NOT EXISTS idx_ral_created ON readonly_activity_log (created_at DESC);
-- Filter-by-action in the admin table.
CREATE INDEX IF NOT EXISTS idx_ral_action  ON readonly_activity_log (action_type, created_at DESC);

-- RLS on, NO permissive policy → deny-all for anon/authenticated; the
-- service-role backend bypasses RLS (matches the mig-167/180 posture).
ALTER TABLE readonly_activity_log ENABLE ROW LEVEL SECURITY;

-- ── 2. egress_limits per-area (dataset) dimension ───────────────────────────
-- Additive nullable column. NULL = "all areas" (back-compat). The old UNIQUE
-- (scope_type, scope_id, action_type) is replaced by a functional unique index
-- that treats NULL dataset as the sentinel '*', so a per-area row and the
-- catch-all row can coexist without colliding.
ALTER TABLE egress_limits ADD COLUMN IF NOT EXISTS dataset text;   -- NULL = all areas

-- Drop the old 3-col unique constraint if present (name from the CREATE TABLE
-- inline UNIQUE — Postgres auto-names it egress_limits_scope_type_scope_id_action_type_key).
ALTER TABLE egress_limits DROP CONSTRAINT IF EXISTS egress_limits_scope_type_scope_id_action_type_key;

-- New uniqueness including dataset (NULL folded to '*').
CREATE UNIQUE INDEX IF NOT EXISTS uq_egress_limits_scope_area
  ON egress_limits (scope_type, scope_id, action_type, COALESCE(dataset, '*'));

-- Lookup index for the resolver (kept alongside the existing idx_egress_limits_lookup).
CREATE INDEX IF NOT EXISTS idx_egress_limits_area
  ON egress_limits (scope_type, scope_id, action_type, dataset);

-- ── post-apply verification ─────────────────────────────────────────────────
-- SELECT tablename FROM pg_tables WHERE tablename = 'readonly_activity_log';
-- SELECT indexname  FROM pg_indexes WHERE tablename = 'readonly_activity_log';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'egress_limits' AND column_name = 'dataset';
-- SELECT indexname FROM pg_indexes WHERE tablename = 'egress_limits';
