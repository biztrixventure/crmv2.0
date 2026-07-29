-- ============================================================================
-- 216_team_quotas.sql
-- Two-tier TEAM QUOTAS. Supersedes teams.goal_monthly_sales / goal_monthly_
-- transfers (two fixed metrics, monthly-only, no per-member split) with one
-- table that carries both tiers:
--
--   TEAM tier    (user_id IS NULL)      — set by superadmin / company_admin.
--                                         "this team must produce 1,500
--                                          transfers this month."
--   MEMBER tier  (user_id IS NOT NULL)  — set by the TEAM LEAD, sub-allocating
--                                         across their people on their own
--                                         schedule. Optionally linked to the
--                                         team quota via parent_quota_id.
--
-- Deliberate: a member allocation does NOT require a parent. The lead may hand
-- someone "3 sales this month" while the team quota is transfers-only, and the
-- allocations are NOT required to sum to the parent — over- and under-
-- allocation are both normal states the UI reports as a gap.
--
-- Modelled on spiff_campaigns (mig 043): metric + target_value + starts_at /
-- ends_at. Kept a SEPARATE table because a SPIFF is a reward campaign fanned
-- out to arbitrary users/roles/companies with a prize, while a quota is an
-- obligation on ONE team with a parent→child allocation tree and no reward.
-- Merging them would leave reward_amount/target_roles null on every quota row
-- and team_id/parent_quota_id null on every SPIFF.
--
-- `metric` is free text validated against a CATALOG in backend/utils/
-- quotaMetrics.js (extensible at runtime via business_config `quota.metrics`),
-- NOT a CHECK constraint — "the operator wants to define other quota kinds
-- later" must not require a migration.
--
-- DATE, not timestamptz: every period is a whole business day or a run of
-- them, and sales are windowed on sale_date (an ET business day). Storing
-- instants is what leaked a neighbouring day into spiffMetrics' windows.
--
-- Additive + idempotent. Apply AFTER 215.
-- ============================================================================

CREATE TABLE IF NOT EXISTS team_quotas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id)   ON DELETE CASCADE,
  team_id         uuid NOT NULL REFERENCES teams(id)       ON DELETE CASCADE,
  parent_quota_id uuid REFERENCES team_quotas(id)          ON DELETE SET NULL,
  user_id         uuid REFERENCES auth.users(id)           ON DELETE CASCADE,

  metric          text    NOT NULL,                 -- catalog key (see quotaMetrics.js)
  target_value    numeric NOT NULL CHECK (target_value > 0),

  period_kind     text NOT NULL DEFAULT 'month'
                    CHECK (period_kind IN ('day', 'week', 'month', 'range')),
  starts_at       date NOT NULL,
  ends_at         date NOT NULL,

  label           text,                             -- optional human name ("July push")
  notes           text,
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('draft', 'active', 'archived')),

  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT team_quotas_period_sane CHECK (ends_at >= starts_at),
  -- A TEAM-tier quota is never a child of anything; a MEMBER-tier quota may or
  -- may not have a parent.
  CONSTRAINT team_quotas_tier_shape CHECK (
    (user_id IS NULL AND parent_quota_id IS NULL) OR (user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_team_quotas_team    ON team_quotas (team_id);
CREATE INDEX IF NOT EXISTS idx_team_quotas_company ON team_quotas (company_id, status);
CREATE INDEX IF NOT EXISTS idx_team_quotas_user    ON team_quotas (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_quotas_parent  ON team_quotas (parent_quota_id) WHERE parent_quota_id IS NOT NULL;
-- The member-facing widget asks "my live quotas today" — one index serves it.
CREATE INDEX IF NOT EXISTS idx_team_quotas_window  ON team_quotas (status, starts_at, ends_at);

-- One live quota per (team, metric, window) per tier. Archived rows are exempt
-- so a finished quota can be re-issued for the same window without a conflict.
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_quota_team_tier
  ON team_quotas (team_id, metric, starts_at, ends_at)
  WHERE user_id IS NULL AND status <> 'archived';
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_quota_member_tier
  ON team_quotas (team_id, user_id, metric, starts_at, ends_at)
  WHERE user_id IS NOT NULL AND status <> 'archived';

COMMENT ON TABLE  team_quotas IS
  'Two-tier team quotas. user_id IS NULL = team target (set by admin); user_id NOT NULL = member allocation (set by the team lead). Allocations need not sum to the parent.';
COMMENT ON COLUMN team_quotas.metric IS
  'Catalog key validated in backend/utils/quotaMetrics.js — transfers | sales_won | sales_submitted | revenue | callbacks, plus any key added at runtime via business_config quota.metrics. Intentionally NOT a CHECK constraint so new quota kinds need no migration.';
COMMENT ON COLUMN team_quotas.parent_quota_id IS
  'Optional link from a member allocation up to the team quota it spends. NULL is legitimate: a lead may set a member target for a metric the team quota does not cover.';

-- ── RLS: deny-all for anon/authenticated; the service-role backend bypasses it
--    (same posture as 211 teams — all access goes through routes/quotas.js).
ALTER TABLE team_quotas ENABLE ROW LEVEL SECURITY;

-- ── Backfill: carry the legacy teams.goal_monthly_* targets in as real
--    CURRENT-MONTH team quotas so nothing visibly disappears when the UI stops
--    reading those columns. The columns are intentionally NOT dropped here —
--    routes/teams.js and MyTeam.jsx still select them, and dropping mid-deploy
--    would 500 the Teams tab. A later cleanup migration removes them once every
--    surface reads team_quotas.
INSERT INTO team_quotas (company_id, team_id, metric, target_value, period_kind, starts_at, ends_at, label, status, created_by)
SELECT t.company_id, t.id, 'sales_won', t.goal_monthly_sales, 'month',
       date_trunc('month', now())::date,
       (date_trunc('month', now()) + interval '1 month' - interval '1 day')::date,
       'Migrated monthly goal', 'active', t.created_by
FROM teams t
WHERE t.goal_monthly_sales IS NOT NULL AND t.goal_monthly_sales > 0
ON CONFLICT DO NOTHING;

INSERT INTO team_quotas (company_id, team_id, metric, target_value, period_kind, starts_at, ends_at, label, status, created_by)
SELECT t.company_id, t.id, 'transfers', t.goal_monthly_transfers, 'month',
       date_trunc('month', now())::date,
       (date_trunc('month', now()) + interval '1 month' - interval '1 day')::date,
       'Migrated monthly goal', 'active', t.created_by
FROM teams t
WHERE t.goal_monthly_transfers IS NOT NULL AND t.goal_monthly_transfers > 0
ON CONFLICT DO NOTHING;

-- ── post-apply verification ─────────────────────────────────────────────────
-- SELECT metric, count(*), min(starts_at), max(ends_at) FROM team_quotas GROUP BY metric;
--   expect: sales_won 4, transfers 4  (the 4 teams that had goal_monthly_* set)
-- SELECT conname FROM pg_constraint WHERE conrelid = 'team_quotas'::regclass;
-- SELECT indexname FROM pg_indexes WHERE tablename = 'team_quotas';
