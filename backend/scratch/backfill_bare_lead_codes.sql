-- ============================================================================
-- backfill_bare_lead_codes.sql        (options #2 and #3)
--
-- Adds the missing dialer-box prefix to lead codes that arrived as a bare
-- number, so recordings can be found again.
--
-- THE PROBLEM: a VICIdial lead_id is unique only WITHIN a box. "1063959" on its
-- own cannot identify a customer, so parseVendorCode() can't name a box and
-- every box-scoped lookup — recording search, QA2 box_id, closer-dispo exact
-- match — skips its precise path and either widens and guesses or gives up.
-- One box sends the raw lead_id instead of the prefixed vendor_lead_code, which
-- is why so many rows look like this.
--
-- THE RULE (identical to normalizeLeadCode() in utils/dialerBoxes.js, which now
-- does this at ingest so no NEW row can arrive bare): the agent id carries the
-- box — WTI1003 -> WTI, TMC100259 -> TMC — and the agent who fired the event is
-- by definition on the box the lead lives on, so the prefix is recovered
-- losslessly. Prefixes are read from vicidial_boxes rather than hardcoded.
--
-- Anything ambiguous is LEFT ALONE: no agent recorded, an agent whose prefix is
-- not a known active box, or a purely numeric agent id (EasyTech's wavetechpk
-- logins are plain numbers, so they carry no box letter and cannot be resolved
-- this way).
--
-- Measured 2026-08-15:
--   transfers : 737 bare, 733 resolvable, of which 19 would COLLIDE (skipped)
--   qa2_call  : 41,689 bare, 36,713 with no recording found yet,
--               36,257 of those resolvable. The 4,976 that already found a
--               recording are deliberately untouched — they are working.
-- ============================================================================


-- ############################################################################
-- PART A — transfers.vicidial_vendor_code        (option #3)
-- ############################################################################

-- ── A0 — BEFORE snapshot. EXPORT THIS (it is the rollback record) ──────────
create temp table tmp_bare_code_backup as
select t.id, t.vicidial_vendor_code as old_code, t.vicidial_agent, t.created_by
from transfers t
where t.vicidial_vendor_code ~ '^[0-9]+$'
  and upper(substring(t.vicidial_agent from '^[A-Za-z]+')) in
      (select upper(prefix) from vicidial_boxes where is_active);
select count(*) as rows_captured from tmp_bare_code_backup;
select * from tmp_bare_code_backup;   -- download before continuing

-- ── A1 — DRY RUN: what changes, and what is skipped and why ───────────────
with fixable as (
  select t.id, t.created_by, t.vicidial_vendor_code as old_code,
         upper(substring(t.vicidial_agent from '^[A-Za-z]+')) || t.vicidial_vendor_code as new_code
  from transfers t
  where t.vicidial_vendor_code ~ '^[0-9]+$'
    and upper(substring(t.vicidial_agent from '^[A-Za-z]+')) in
        (select upper(prefix) from vicidial_boxes where is_active)
)
select
  count(*) as resolvable,
  count(*) filter (where exists (
      select 1 from transfers x
      where x.vicidial_vendor_code = f.new_code and x.created_by = f.created_by and x.id <> f.id)) as skipped_would_collide,
  count(*) filter (where not exists (
      select 1 from transfers x
      where x.vicidial_vendor_code = f.new_code and x.created_by = f.created_by and x.id <> f.id)) as will_update
from fixable f;

-- ── A2 — APPLY ────────────────────────────────────────────────────────────
-- The collision guard matters: uniqueness is (vicidial_vendor_code, created_by)
-- per migration 250. A collision means that fronter ALREADY has a row with the
-- prefixed code — i.e. the bare row is a duplicate of it. Renaming would violate
-- the index, so those 19 rows are left as-is for separate review rather than
-- merged blind.
update transfers t
set vicidial_vendor_code = upper(substring(t.vicidial_agent from '^[A-Za-z]+')) || t.vicidial_vendor_code
where t.vicidial_vendor_code ~ '^[0-9]+$'
  and upper(substring(t.vicidial_agent from '^[A-Za-z]+')) in
      (select upper(prefix) from vicidial_boxes where is_active)
  and not exists (
    select 1 from transfers x
    where x.vicidial_vendor_code = upper(substring(t.vicidial_agent from '^[A-Za-z]+')) || t.vicidial_vendor_code
      and x.created_by = t.created_by
      and x.id <> t.id
  );

-- ── A3 — VERIFY ───────────────────────────────────────────────────────────
select
  count(*) filter (where vicidial_vendor_code ~ '^[0-9]+$') as still_bare,
  count(*) filter (where vicidial_vendor_code ~ '^[A-Za-z]+[0-9]+$') as prefixed
from transfers where vicidial_vendor_code is not null;
-- still_bare should drop to roughly the 19 collisions plus rows with no usable
-- agent prefix (numeric agent ids / no agent recorded).


-- ############################################################################
-- PART B — qa2_call.vendor_code   (option #2, drives QA recording lookup)
-- ############################################################################

-- ── B0 — BEFORE snapshot. EXPORT THIS ─────────────────────────────────────
create temp table tmp_qa2_bare_backup as
select q.id, q.vendor_code as old_code, q.dialer_lead_id, q.box_id, q.agent_user,
       q.recording_state, q.recording_attempts
from qa2_call q
where q.vendor_code ~ '^[0-9]+$'
  and q.recording_id is null
  and upper(substring(q.agent_user from '^[A-Za-z]+')) in
      (select upper(prefix) from vicidial_boxes where is_active);
select count(*) as rows_captured from tmp_qa2_bare_backup;

-- ── B1 — DRY RUN ──────────────────────────────────────────────────────────
select count(*) as will_update from tmp_qa2_bare_backup;

-- ── B2 — APPLY, in batches ────────────────────────────────────────────────
-- Scoped to rows with NO recording yet: those are the ones that need the prefix
-- in order to find one. Rows that already resolved a recording are working and
-- are left untouched — which also keeps this clear of uq_qa2_call_recording
-- (box_id, recording_id), so it cannot violate that index.
--
-- Run this statement repeatedly until it reports 0 rows. Batching keeps each
-- transaction small on a ~36k row table.
with batch as (
  select q.id,
         upper(substring(q.agent_user from '^[A-Za-z]+')) as pfx
  from qa2_call q
  where q.vendor_code ~ '^[0-9]+$'
    and q.recording_id is null
    and upper(substring(q.agent_user from '^[A-Za-z]+')) in
        (select upper(prefix) from vicidial_boxes where is_active)
  limit 5000
)
update qa2_call q
set vendor_code = b.pfx || q.vendor_code,
    -- box_id was NULL precisely because the bare code named no box; now it can.
    box_id = coalesce(q.box_id, (select vb.id from vicidial_boxes vb
                                 where upper(vb.prefix) = b.pfx and vb.is_active limit 1)),
    -- re-arm the poller so it retries with the now-resolvable code
    recording_state = 'pending',
    recording_attempts = 0
from batch b
where q.id = b.id;

-- ── B3 — VERIFY ───────────────────────────────────────────────────────────
select
  count(*) filter (where vendor_code ~ '^[0-9]+$') as still_bare,
  count(*) filter (where box_id is null) as no_box_resolved,
  count(*) filter (where recording_state = 'pending') as pending_lookup
from qa2_call;


-- ── ROLLBACK ───────────────────────────────────────────────────────────────
--   update transfers t set vicidial_vendor_code = b.old_code
--   from tmp_bare_code_backup b where b.id = t.id;
--
--   update qa2_call q set vendor_code = b.old_code, box_id = b.box_id,
--                         recording_state = b.recording_state,
--                         recording_attempts = b.recording_attempts
--   from tmp_qa2_bare_backup b where b.id = q.id;
--
-- Temp tables vanish at session end — export A0 and B0 to files first.
