-- ============================================================================
-- fix_wavetech_dialer_mappings.sql
--
-- WHY: after the WTI box moved to wavetechpk.i5.tel, five agents who are
-- actively working full shifts on the dialer are not resolvable to a CRM user.
-- resolveAgent() therefore returns no user/company, and routes/vicidial.js
-- answers the XFER webhook with "agent not mapped" and creates NO transfer —
-- so every lead these agents send is silently lost, and their closer
-- dispositions never attach.
--
-- Verified against the live wavetechpk roster (agent_stats_export, last 3 days)
-- and cross-checked against user_profiles.vicidial_agent_ids on 2026-08-14:
--
--   agent    dialer name          calls  login     CRM state before this fix
--   -------  -------------------  -----  --------  ---------------------------
--   WTI1066  Neeha James            518   6:46:03  active Wavetech fronter, NO ids
--   WTI1029  Waleed Ali             370   6:30:23  active Wavetech fronter, only A.MEHMOOD@WT.COM
--   WTI1008  M. Abdullah Aftab      197   8:35:35  id sits on "M. Bilal Nasir" (no active role)
--   WTI1010  Danish Waris            52   8:22:17  active 1-Vertex closer, only TMC ids
--   WTI1056  Ahmed Mehmood           27   0:24:04  active Wavetech fronter_manager, NO ids
--
-- Last CRM transfer seen from WTI1029 / WTI1066 was 2026-08-07, and from
-- WTI1010 was 2026-07-20 — i.e. the loss has been running for a week+.
--
-- SAFETY: step 1 is APPEND-ONLY (existing ids are preserved, duplicates
-- collapsed). Step 2 removes WTI1008 from the wrong profile so one dialer id
-- cannot sit on two people — the duplicate-profile condition that previously
-- made attribution drift between companies. Run step 0 first and keep the
-- output: it is the rollback record.
-- ============================================================================

-- ── STEP 0 — BEFORE snapshot (save this output before running anything else) ──
select user_id, first_name || ' ' || coalesce(last_name, '') as name, vicidial_agent_ids
from user_profiles
where user_id in (
  '5c441aff-c875-4c1a-9539-1867e896f145',  -- Neeha James
  '527a8a16-d3a3-4918-ac24-a0d644d3fe81',  -- Waleed Ali
  '44e659bc-cdc9-4911-b77a-b8f09d63b4d5',  -- Ahmed Mehmood
  '556a4a44-a64c-4587-b42e-da20dc548e2e',  -- M. Abdullah Aftab
  '93e269bf-f74e-4095-9eda-f525e339c2d9',  -- Danish Waris
  '9a4be532-2aa3-4748-bf44-c092f10de565'   -- M. Bilal Nasir (holds WTI1008 wrongly)
);

-- ── STEP 1 — attach the missing dialer ids (append-only, idempotent) ─────────
update user_profiles up
set vicidial_agent_ids =
      (select array(select distinct unnest(coalesce(up.vicidial_agent_ids, '{}') || array[m.agent])))
from (values
  ('5c441aff-c875-4c1a-9539-1867e896f145'::uuid, 'WTI1066'),  -- Neeha James       (Wavetech fronter)
  ('527a8a16-d3a3-4918-ac24-a0d644d3fe81'::uuid, 'WTI1029'),  -- Waleed Ali        (Wavetech fronter)
  ('44e659bc-cdc9-4911-b77a-b8f09d63b4d5'::uuid, 'WTI1056'),  -- Ahmed Mehmood     (Wavetech fronter_manager)
  ('556a4a44-a64c-4587-b42e-da20dc548e2e'::uuid, 'WTI1008'),  -- M. Abdullah Aftab (1-Vertex closer)
  ('93e269bf-f74e-4095-9eda-f525e339c2d9'::uuid, 'WTI1010')   -- Danish Waris      (1-Vertex closer)
) as m(user_id, agent)
where up.user_id = m.user_id
returning up.first_name || ' ' || coalesce(up.last_name, '') as name, up.vicidial_agent_ids;

-- ── STEP 2 — take WTI1008 off the wrong profile ─────────────────────────────
-- "M. Bilal Nasir" (9a4be532…) holds WTI1008 but has NO active company role, so
-- it can only ever resolve to a null company. The dialer says WTI1008 is
-- M. Abdullah Aftab, who step 1 just mapped. One id must belong to one person.
update user_profiles
set vicidial_agent_ids = array(select unnest(vicidial_agent_ids) except select 'WTI1008')
where user_id = '9a4be532-2aa3-4748-bf44-c092f10de565'
returning first_name || ' ' || coalesce(last_name, '') as name, vicidial_agent_ids;

-- ── STEP 3 — verify: every id below must resolve to exactly ONE active user ──
select a.agent,
       count(*) filter (where ucr.is_active) as active_matches,
       string_agg(distinct up.first_name || ' ' || coalesce(up.last_name, '') || ' [' || coalesce(cr.level, 'no role') || ']', ', ') as resolves_to
from (values ('WTI1066'), ('WTI1029'), ('WTI1056'), ('WTI1008'), ('WTI1010')) as a(agent)
left join user_profiles up on up.vicidial_agent_ids @> array[a.agent]::text[]
left join user_company_roles ucr on ucr.user_id = up.user_id and ucr.is_active
left join custom_roles cr on cr.id = ucr.role_id
group by a.agent
order by a.agent;
-- Expect active_matches = 1 for every row. A 0 means still unmapped (transfers
-- keep being dropped); a 2+ means two profiles share the id and attribution can
-- land in the wrong company — fix the duplicate profile before moving on.

-- ── ROLLBACK (only if needed) ───────────────────────────────────────────────
-- Restore each user_id's vicidial_agent_ids to the exact array captured in STEP 0:
--   update user_profiles set vicidial_agent_ids = '{...}' where user_id = '...';
