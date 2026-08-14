-- ============================================================================
-- fix_all_box_dialer_mappings.sql
--
-- Estate-wide follow-up to fix_wavetech_dialer_mappings.sql (which covered the
-- 5 wavetechpk agents and is already applied). Same failure mode: the agent is
-- working on the dialer but no ACTIVE CRM user carries their id, so
-- resolveAgent() returns nothing, the XFER webhook answers "agent not mapped",
-- and the transfer is never created — the lead is lost outright.
--
-- Method: agent_stats_export from every active box (last 3 days) diffed against
-- every user_profiles.vicidial_agent_ids belonging to a user with an active
-- company role. Audited 2026-08-14. CRM had 219 ids mapped, only 158 of them on
-- users with an active role.
--
--   agent        dialer name              calls  CRM state
--   -----------  -----------------------  -----  -------------------------------
--   TMC100654    Maham Jawed                443  id sits on "Sabir Ali Azan" (no active role)
--   ETC0987      Muhammad Hammad Azeem      381  active EasyTech fronter, NO ids
--   ETC0986      Zohaib Ali Awan            353  active EasyTech fronter, NO ids
--   ETC0953      Ali Shan                   169  active EasyTech fronter, only HAROON@ETC.COM
--   5009         Noman Ahmad                138  active EasyTech fronter, has stale "2009"
--   5006         Ali Shan                   120  (same person, wavetechpk numeric id)
--   5008         Huzaifa Shafiq              62  active EasyTech fronter, has stale "2008"
--   5010         Zain Ul Abidin Ali          37  active EasyTech fronter, has stale "2010"
--
-- NOTE on the numeric ids: EasyTech agents on wavetechpk hold plain numbers,
-- and the CRM still carries the pre-move 2xxx range while the box now issues
-- 5xxx. The old 2xxx values are left in place (harmless, and they keep history
-- resolvable) — this only ADDS the current ones.
--
-- SAFETY: step 1 is APPEND-ONLY. Step 2 moves TMC100654 off the profile that
-- cannot resolve. Run step 0 first and keep its output as the rollback record.
-- ============================================================================

-- ── STEP 0 — BEFORE snapshot (save this output) ─────────────────────────────
select user_id, first_name || ' ' || coalesce(last_name, '') as name, vicidial_agent_ids
from user_profiles
where user_id in (
  '838b5b2c-4bce-4e60-87ee-2cb08a31820a',  -- Muhammad Hammad Azeem
  '79fa027f-38ff-4b83-83ff-c385cd9a6ebc',  -- Zohaib Ali Awan
  '720f6e6e-14c7-4995-9426-b842cd3bd48a',  -- Ali Shan
  '1ef055e9-7a5e-4cd0-a391-ea2a1708dd79',  -- Noman Ahmad
  'ebd83f94-0870-4ff3-8346-b07933c868a7',  -- Huzaifa Shafiq
  '394899fb-ec7d-4d7d-be5f-f443c40737de',  -- Zain Ul Abidin Ali
  '88039ab9-1e61-447b-ac99-c9ac3ef26288',  -- Maham Javed
  '0088feef-2de3-4a23-9bcf-ee5548314bdd'   -- Sabir Ali Azan (holds TMC100654 wrongly)
);

-- ── STEP 1 — attach the missing dialer ids (append-only, idempotent) ────────
update user_profiles up
set vicidial_agent_ids =
      (select array(select distinct unnest(coalesce(up.vicidial_agent_ids, '{}') || m.agents)))
from (values
  ('838b5b2c-4bce-4e60-87ee-2cb08a31820a'::uuid, array['ETC0987']),            -- Muhammad Hammad Azeem
  ('79fa027f-38ff-4b83-83ff-c385cd9a6ebc'::uuid, array['ETC0986']),            -- Zohaib Ali Awan
  ('720f6e6e-14c7-4995-9426-b842cd3bd48a'::uuid, array['ETC0953', '5006']),    -- Ali Shan (both boxes)
  ('1ef055e9-7a5e-4cd0-a391-ea2a1708dd79'::uuid, array['5009']),               -- Noman Ahmad
  ('ebd83f94-0870-4ff3-8346-b07933c868a7'::uuid, array['5008']),               -- Huzaifa Shafiq
  ('394899fb-ec7d-4d7d-be5f-f443c40737de'::uuid, array['5010']),               -- Zain Ul Abidin Ali
  ('88039ab9-1e61-447b-ac99-c9ac3ef26288'::uuid, array['TMC100654'])           -- Maham Javed
) as m(user_id, agents)
where up.user_id = m.user_id
returning up.first_name || ' ' || coalesce(up.last_name, '') as name, up.vicidial_agent_ids;

-- ── STEP 2 — take TMC100654 off the profile that cannot resolve ─────────────
-- The dialer says TMC100654 is "Maham Jawed"; the CRM's active fronter is
-- "Maham Javed" (spelling), mapped in step 1. "Sabir Ali Azan" holds the id but
-- has no active company role, so it could only ever resolve to a null company.
update user_profiles
set vicidial_agent_ids = array(select unnest(vicidial_agent_ids) except select 'TMC100654')
where user_id = '0088feef-2de3-4a23-9bcf-ee5548314bdd'
returning first_name || ' ' || coalesce(last_name, '') as name, vicidial_agent_ids;

-- ── STEP 3 — verify: each id must resolve to exactly ONE active user ────────
select a.agent,
       count(*) filter (where ucr.is_active) as active_matches,
       string_agg(distinct up.first_name || ' ' || coalesce(up.last_name, '')
                  || ' [' || coalesce(cr.level::text, 'no role') || ']', ', ') as resolves_to
from (values ('ETC0987'), ('ETC0986'), ('ETC0953'), ('5006'), ('5008'), ('5009'), ('5010'), ('TMC100654')) as a(agent)
left join user_profiles up on up.vicidial_agent_ids @> array[a.agent]::text[]
left join user_company_roles ucr on ucr.user_id = up.user_id and ucr.is_active
left join custom_roles cr on cr.id = ucr.role_id
group by a.agent
order by a.agent;
-- Expect active_matches = 1 on every row. (cr.level is the role_level ENUM and
-- must be cast to text before coalescing with a literal, else Postgres 22P02.)

-- ── NOT INCLUDED — need a human decision, no confident CRM match ────────────
--   ONYX100091  Hussain Ali Mirza   46 calls  (inb box)  — no matching CRM user
--   TMC100257   Taha                30 calls  (inb box)  — name too generic to match
--   TMC100384   Zarar               28 calls  (inb box)  — name too generic to match
-- Map these by hand once you can confirm who they are.
--
-- ── ALSO WORTH CLEANING (inert, but misleading) ─────────────────────────────
-- Email-style values are never valid dialer agent ids; they are leftovers from
-- an old email-based backfill and can hide a genuinely missing mapping:
--   Ali Shan          HAROON@ETC.COM
--   Waleed Ali        A.MEHMOOD@WT.COM
--   Abdul Mueez Butt  DANIYAL@WT.COM
--   M. Abdullah Aftab SUPERADMIN867673@BIZTRIXVENTURE.COM
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Restore each user_id's array to the exact value captured in STEP 0.
