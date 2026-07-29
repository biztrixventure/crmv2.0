-- ============================================================================
-- 218_quota_milestones.sql
-- A reward LADDER inside a quota (mig 216).
--
-- A quota answers "what must be produced by when". A milestone answers "and
-- what happens along the way": at 750 of 1,500 transfers there is a prize, at
-- 1,000 another. Both tiers get them —
--
--   TEAM-tier quota   → superadmin / company_admin sets milestones for the team
--                       (the lead earns them on behalf of their team)
--   MEMBER-tier quota → the TEAM LEAD sets milestones per member while
--                       allocating, on the same permission that lets them
--                       allocate at all (teams.lead_can_allocate, mig 217)
--
-- Attached to the QUOTA, not to a team or a user. A quota already carries the
-- metric, the window and the owner, so hanging the ladder off it means a
-- milestone can never disagree with the target it belongs to, and deleting a
-- quota takes its ladder with it (ON DELETE CASCADE).
--
-- EVALUATED LIVE, NOT LOCKED (the operator's explicit choice). A milestone is
-- "earned" exactly while actual >= threshold, recomputed from the same counter
-- that scores the quota — there is no award table and no frozen record. The
-- consequence, stated plainly because it is a real one: if a sale is later
-- cancelled and the number drops back below the line, the milestone stops
-- reading as earned. Notifications do NOT re-fire on a re-cross, because they
-- carry a permanent dedup key, so nobody is congratulated twice for one prize.
--
-- `threshold_kind` supports both an absolute count ("at 750") and a percentage
-- ("at 50%"), because a lead handing out ten different member targets should
-- not have to do the arithmetic ten times. Percent resolves against the parent
-- quota's target_value at read time.
--
-- Additive + idempotent. Apply AFTER 217.
-- ============================================================================

CREATE TABLE IF NOT EXISTS quota_milestones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quota_id            uuid NOT NULL REFERENCES team_quotas(id) ON DELETE CASCADE,

  threshold_kind      text NOT NULL DEFAULT 'value'
                        CHECK (threshold_kind IN ('value', 'percent')),
  -- absolute count when kind='value'; percent of the quota target when
  -- kind='percent'. Above 100 is allowed on purpose — a stretch prize at 120%
  -- of quota is a normal thing to offer.
  threshold           numeric NOT NULL CHECK (threshold > 0),

  label               text,                    -- "Halfway push"
  reward_amount       numeric,                 -- optional cash value
  reward_description  text,                    -- "Dinner voucher", "$100 bonus"

  -- Per-milestone notification switches. These NARROW the recipients; they can
  -- never add anyone. The global PWA event matrix (routes/pwa.js) and the
  -- per-company notifications.* config still gate delivery on top of these, so
  -- a superadmin retains the final say across every company at once.
  notify_earner       boolean NOT NULL DEFAULT true,   -- the member (or the team's lead, on a team quota)
  notify_lead         boolean NOT NULL DEFAULT true,   -- that member's team lead
  notify_managers     boolean NOT NULL DEFAULT false,  -- company_admin / operations_manager (noisy on a big floor)

  is_active           boolean NOT NULL DEFAULT true,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quota_milestones_quota ON quota_milestones (quota_id);

-- One live milestone per (quota, kind, threshold). Two prizes at exactly 750 on
-- the same quota is a data-entry mistake, not a feature. Inactive rows are
-- exempt so a removed milestone can be re-created at the same threshold.
CREATE UNIQUE INDEX IF NOT EXISTS uq_quota_milestone_threshold
  ON quota_milestones (quota_id, threshold_kind, threshold)
  WHERE is_active;

COMMENT ON TABLE quota_milestones IS
  'Reward ladder inside a team_quota. Evaluated LIVE against the quota''s live actual (no award/lock table): earned exactly while actual >= resolved threshold. Notifications fire once via a permanent dedup key and do not re-fire on a re-cross.';
COMMENT ON COLUMN quota_milestones.threshold IS
  'Absolute count when threshold_kind=value; percent of the parent quota target when threshold_kind=percent. Values above 100 percent are permitted deliberately (stretch prizes).';

-- RLS on, deny-all for anon/authenticated; the service-role backend bypasses it
-- (same posture as 211 teams and 216 team_quotas — all access via routes/quotas.js).
ALTER TABLE quota_milestones ENABLE ROW LEVEL SECURITY;

-- ── post-apply verification ─────────────────────────────────────────────────
-- SELECT tablename FROM pg_tables WHERE tablename = 'quota_milestones';
-- SELECT indexname FROM pg_indexes WHERE tablename = 'quota_milestones';
--   expect: idx_quota_milestones_quota, uq_quota_milestone_threshold
-- SELECT count(*) FROM quota_milestones;   -- expect 0 (new feature, no backfill)
