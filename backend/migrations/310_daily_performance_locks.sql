-- ============================================================================
-- 310 — daily performance locks
--
-- A calendar day whose performance figures have been reviewed and FINALISED.
--
-- The lock stores a SNAPSHOT, not just a flag. Sales and transfers stay
-- editable after a lock -- a late correction is legitimate and must not be
-- blocked -- so without a frozen copy a "finalised" number would keep drifting
-- and the day-by-day history would mean nothing. With the snapshot, the frozen
-- figure and the live figure can be compared, and a day that moved after being
-- signed off is visible instead of silent.
--
-- TWO SCOPES, both allowed on the same date:
--   scope='company'  the whole project for that day, every team plus anyone on
--                    no team. Locked by an operations manager / company admin.
--   scope='team'     one team's day. Locked by that team's lead.
-- They are separate rows because they answer to different people; a project
-- lock does not imply its teams are individually signed off, or the reverse.
--
-- Unlock is a soft reverse: the row keeps its history and gains unlocked_by /
-- unlocked_at, so "this day was finalised, then reopened by X" survives. Only
-- an operations manager / company admin can unlock (a finalise a team lead can
-- undo alone is not a finalise) -- enforced in the route, recorded here.
--
-- APPLIED 2026-09-09 via apply_migration. Verified: 11 columns, 4 indexes, and
-- all four constraint behaviours exercised against the live database --
-- duplicate active lock blocked, company-scope-with-team blocked,
-- team-scope-without-team blocked, relock after unlock allowed.
-- ============================================================================
CREATE TABLE IF NOT EXISTS daily_performance_locks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  scope        text NOT NULL CHECK (scope IN ('company', 'team')),
  -- Required for scope='team', forbidden for scope='company'. Enforced below
  -- rather than trusted: a team row with no team is unattributable, and a
  -- company row carrying one would double-count against its own team row.
  team_id      uuid REFERENCES teams(id) ON DELETE CASCADE,
  perf_date    date NOT NULL,
  -- The frozen numbers. Shape is whatever utils/dailyPerformance returns
  -- (transfers / approved / cancelled / pending / conversion, plus a per-team
  -- breakdown on a company lock) -- jsonb so adding a metric never needs a
  -- migration, and an OLD lock keeps the exact shape it was signed off with.
  stats        jsonb NOT NULL DEFAULT '{}'::jsonb,
  note         text,
  locked_by    uuid NOT NULL,
  locked_at    timestamptz NOT NULL DEFAULT now(),
  unlocked_by  uuid,
  unlocked_at  timestamptz,
  CONSTRAINT dpl_team_scope_shape CHECK (
    (scope = 'team'    AND team_id IS NOT NULL) OR
    (scope = 'company' AND team_id IS NULL)
  )
);

-- One ACTIVE lock per scope per day; unlocked rows stay as history. Partial
-- uniqueness rather than a plain unique: relocking a reopened day must be
-- allowed, and the old row has to survive alongside the new one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dpl_active_company
  ON daily_performance_locks (company_id, perf_date)
  WHERE scope = 'company' AND unlocked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dpl_active_team
  ON daily_performance_locks (team_id, perf_date)
  WHERE scope = 'team' AND unlocked_at IS NULL;

-- The calendar reads a month at a time, per company.
CREATE INDEX IF NOT EXISTS idx_dpl_company_date
  ON daily_performance_locks (company_id, perf_date DESC);

COMMENT ON TABLE daily_performance_locks IS
  'A finalised calendar day of performance figures, with the numbers frozen at lock time. scope=company is the whole project (ops manager); scope=team is one team (team lead). Unlock is soft: the row keeps unlocked_by/unlocked_at as history.';
