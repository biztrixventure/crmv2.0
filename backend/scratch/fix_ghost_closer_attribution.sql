-- ============================================================================
-- fix_ghost_closer_attribution.sql
--
-- Clears transfers.assigned_closer_id where it points at someone who cannot be
-- the closer, so cards stop showing an absent or incorrect person's name.
--
-- REPORTED SYMPTOM: lead WTI24047979 (3153359464) showed "No Answer by
-- M. Bilal Nasir" to fronter Bisam Haroon. Bilal Nasir has NO active company
-- role — the disposition arrived 2026-08-13 22:44 from dialer agent WTI1008,
-- which at that moment was mapped to his leftover profile. (WTI1008 has since
-- been moved to M. Abdullah Aftab by fix_wavetech_dialer_mappings.sql, so NEW
-- dispositions already attribute correctly.)
--
-- Two distinct faults produced the bad rows, both now blocked in code by
-- applyCloserDispo's isCloserSideUser guard (commit 0f5ac6f):
--
--   A) GHOST CLOSER — assigned_closer_id points at a user with no active
--      company role: 6,901 transfers across 25 profiles. The largest by far is
--      "Abandoned (Wavetech Infomatics)" (5,357) which is a placeholder, not a
--      person. Several others are duplicate profiles of people who ARE still
--      active (Danish Waris, Moiz Shahzad, Bilal Nasir) where the dialer id sat
--      on the dead copy.
--
--   B) SELF-CLOSED — assigned_closer_id equals created_by, i.e. the fronter was
--      recorded as the closer of their own transfer: 2,472 rows, 519 in the
--      last 30 days. Caused by a fronter dispositioning their own lead (often
--      seconds after transferring), which fires the same closer webhook.
--
-- WHY CLEARING IS THE RIGHT REPAIR: the true closer is not recoverable for these
-- rows — the dialer's call log is purged nightly, so the evidence is gone. A
-- NULL closer is honest ("we do not know who worked it"); leaving the wrong name
-- is not, and it actively misleads managers. The disposition itself is
-- untouched: disposition_actions keeps the full record of what was set and by
-- whom, so no history is lost.
--
-- SAFETY: a transfer that produced a SALE is never touched — closer attribution
-- there drives payouts and must not be altered by a bulk script. Run STEP 0 and
-- export its output; that is the rollback record.
-- ============================================================================

-- ── STEP 0 — BEFORE snapshot. EXPORT THIS OUTPUT (it is the rollback data) ──
create temp table tmp_ghost_closer_backup as
select t.id, t.assigned_closer_id, t.assigned_to, t.created_by, t.vicidial_vendor_code
from transfers t
where t.assigned_closer_id is not null
  and not exists (select 1 from sales s where s.transfer_id = t.id)
  and (
        not exists (select 1 from user_company_roles ucr
                    where ucr.user_id = t.assigned_closer_id and ucr.is_active)
     or t.assigned_closer_id = t.created_by
  );

select count(*) as rows_to_change from tmp_ghost_closer_backup;
-- Download this result before continuing:
select * from tmp_ghost_closer_backup;

-- ── STEP 1 — DRY RUN: exactly what would change, and why ───────────────────
select case when t.assigned_closer_id = t.created_by
              then 'B: fronter set as own closer'
            else 'A: closer has no active role' end as reason,
       count(*) as rows
from transfers t
where t.assigned_closer_id is not null
  and not exists (select 1 from sales s where s.transfer_id = t.id)
  and (
        not exists (select 1 from user_company_roles ucr
                    where ucr.user_id = t.assigned_closer_id and ucr.is_active)
     or t.assigned_closer_id = t.created_by
  )
group by 1;

-- ── STEP 2 — APPLY. Only after STEP 0's output is exported. ────────────────
update transfers t
set assigned_closer_id = null,
    assigned_to        = null
where t.assigned_closer_id is not null
  -- never touch a transfer that converted: closer attribution drives payouts
  and not exists (select 1 from sales s where s.transfer_id = t.id)
  and (
        not exists (select 1 from user_company_roles ucr
                    where ucr.user_id = t.assigned_closer_id and ucr.is_active)
     or t.assigned_closer_id = t.created_by
  );

-- ── STEP 3 — VERIFY: both counts must be 0 (sold transfers excluded) ───────
select
  (select count(*) from transfers t
     where t.assigned_closer_id is not null
       and not exists (select 1 from sales s where s.transfer_id = t.id)
       and not exists (select 1 from user_company_roles ucr
                       where ucr.user_id = t.assigned_closer_id and ucr.is_active)) as ghost_closers_left,
  (select count(*) from transfers t
     where t.assigned_closer_id is not null
       and not exists (select 1 from sales s where s.transfer_id = t.id)
       and t.assigned_closer_id = t.created_by) as self_closed_left;

-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- From the STEP 0 export (temp tables vanish at session end, so export first):
--   update transfers t set assigned_closer_id = b.assigned_closer_id,
--                          assigned_to        = b.assigned_to
--   from tmp_ghost_closer_backup b where b.id = t.id;

-- ── SEPARATE FOLLOW-UP, NOT DONE HERE ──────────────────────────────────────
-- Duplicate profiles are the underlying cause for several of these: Danish
-- Waris, Moiz Shahzad and Bilal Nasir each exist twice, with the dialer id
-- landing on the copy that has no active role. Merging those profiles is a
-- people decision, not a bulk edit — review them in the User Control Center.
