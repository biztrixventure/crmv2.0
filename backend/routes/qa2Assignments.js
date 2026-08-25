// ============================================================================
// qa2Assignments.js — /qa2/queue, /qa2/pool, /qa2/assignments[/:id/*],
// /qa2/calls/:id[/recording-ticket]. Assignment workflow rules from build
// brief section 5:
//   - Three states (Unassigned/Assigned-not-started/In review) are derived
//     from assigned_to + status, no extra column — the UI filters on both.
//   - Claim is race-safe: the UPDATE's own .is('assigned_to', null) means
//     only ONE of two concurrent claims can actually affect a row.
//   - Unassign vs skip are different actions with different audit trails —
//     unassign is silent (routing), skip REQUIRES a reason and stamps who/when.
//   - Calibration is opt-in: a second qa2_assignment row for the SAME call,
//     sharing a calibration_group_id — the partial unique index on call_id
//     (mig 236) only applies when calibration_group_id IS NULL, so this never
//     conflicts with the normal one-assignment-per-call rule.
//
// Recording streaming reuses mediaTicket.js + the EXISTING /api/qa-media/
// stream route completely unmodified — that route only ever reads the
// ticket's {box_id, lead_id, recording_id} claims, so it serves a v2 ticket
// exactly like a v1 one. No new streaming infrastructure.
// ============================================================================

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/database');
const { resolveQa2Scope } = require('../utils/qa2ScopeResolver');
const { companyInScope, methodInScope } = require('../utils/qa2Scope');
const { issueTicket } = require('../utils/mediaTicket');
const { annotateHangups } = require('../utils/dialerBoxes');
const { resolveCustomerContext } = require('../utils/qa2CustomerContext');
const { resolveColumnAccess } = require('../utils/columnFilter');
const { applyQa2Sort, applyQa2Filters } = require('../utils/qa2ColumnFilter');
const { QA2_CALL_COLUMNS } = require('../config/recordColumns');
const logger = require('../utils/logger');

async function requireScope(req, res) {
  const scope = await resolveQa2Scope(req);
  if (!scope.isCompliance && !scope.managerAccess && scope.role !== 'qa_agent') {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return scope;
}

// Batch-resolve display names for CRM user ids — same shape qa2Reports.js's
// own nameMap() already uses. agent_user (the raw dialer login string) stays
// on every response as a fallback for whoever has no user_profiles row yet.
// What the CLOSER did with the transfer, for a batch of calls (mig 277's
// resolver). A TRA row is the fronter's leg, so its own dispo is 'XFER' and
// says nothing about how the lead actually went — reviewing a fronter without
// that is half the picture. Best-effort: a failure here must never take a queue
// or a review screen down with it.
async function closerDispoMap(callIds) {
  const ids = [...new Set((callIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  try {
    const { data, error } = await supabaseAdmin.rpc('app_qa2_closer_dispo', { p_call_ids: ids });
    if (error) throw new Error(error.message);
    return new Map((data || []).map(r => [r.call_id, { dispo: r.closer_dispo, source: r.closer_dispo_source }]));
  } catch (e) {
    logger.warn('QA2_CALLS', `closer dispo lookup failed: ${e.message}`);
    return new Map();
  }
}

async function nameMap(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
  return new Map((data || []).map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown']));
}

function callInScope(scope, call) {
  return companyInScope(scope, call.company_id) && (!call.method_id || methodInScope(scope, call.method_id));
}

// ── /qa2/queue — my own assignments (the three states live here) ──────────

router.get('/queue', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { status, sort_by, sort_dir, filters } = req.query;
  const access = await resolveColumnAccess(req, QA2_CALL_COLUMNS);

  // !inner changes nothing about the result set (call_id is NOT NULL, every
  // assignment has a matching call) — it's required syntax for the embedded
  // filter/sort calls below.
  let query = supabaseAdmin
    .from('qa2_assignment')
    .select(`id, call_id, assigned_to, assigned_at, opened_at, status, origin, calibration_group_id,
             priority, due_at, period, created_at,
             qa2_call!inner(id, company_id, leg, agent_user, agent_user_id, customer_phone, dispo_raw, call_at,
                       recording_state, method_id, talk_sec, hangup_label, hangup_reason,
                       qa2_method(label), companies(name))`)
    .eq('assigned_to', req.user.id);
  query = status ? query.eq('status', status) : query.in('status', ['pending', 'in_review']);
  query = applyQa2Filters(query, filters, QA2_CALL_COLUMNS, access.blocked, 'qa2_call');
  query = applyQa2Sort(query, sort_by, sort_dir, access.sortMap, 'qa2_call', 'created_at', false);
  query = query.limit(200);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  const names = await nameMap((data || []).map(a => a.qa2_call?.agent_user_id));
  const closerDispos = await closerDispoMap((data || []).map(a => a.qa2_call?.id));
  const assignments = (data || []).map(a => (a.qa2_call
    ? { ...a, qa2_call: { ...a.qa2_call,
        agent_name: names.get(a.qa2_call.agent_user_id) || a.qa2_call.agent_user || null,
        closer_dispo: closerDispos.get(a.qa2_call.id)?.dispo || null,
        closer_dispo_source: closerDispos.get(a.qa2_call.id)?.source || null } }
    : a));

  // Counts for EVERY status, not just the one being viewed. The queue's status
  // tiles are a switcher, and a switcher that can only count the tab you are
  // already on is useless — it showed "—" for the other two, so an agent could
  // not see they had work waiting without clicking each tile in turn. Cheap:
  // three head-only counts, no rows fetched.
  const countFor = async (st) => {
    const { count } = await supabaseAdmin
      .from('qa2_assignment')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', req.user.id).eq('status', st);
    return count || 0;
  };
  const [pending, in_review, scored] = await Promise.all([
    countFor('pending'), countFor('in_review'), countFor('scored'),
  ]);

  res.json({ assignments, columns: access.catalog, counts: { pending, in_review, scored } });
}));

// How many days of work the Pool offers. Anything older stays in the database
// and stays assignable BY A MANAGER from Load Day — this only bounds what an
// agent is shown to self-claim.
const POOL_WINDOW_DAYS = 7;

// ── /qa2/pool — self-claimable within my grants ────────────────────────────

router.get('/pool', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  if (scope.operationalCompanyIds !== 'all' && !scope.operationalCompanyIds.length) return res.json({ assignments: [], columns: {} });
  if (scope.operationalMethodIds !== 'all' && !scope.operationalMethodIds.length) return res.json({ assignments: [], columns: {} });

  const { sort_by, sort_dir, filters } = req.query;
  const access = await resolveColumnAccess(req, QA2_CALL_COLUMNS);

  // Company/method scope now applies directly on the embedded qa2_call table
  // via !inner — one query instead of the previous fetch-500-ids-then-filter
  // two-step, and without that step's 500-row id cap.
  let query = supabaseAdmin
    .from('qa2_assignment')
    .select(`id, call_id, status, created_at,
             qa2_call!inner(id, company_id, leg, agent_user, agent_user_id, customer_phone, dispo_raw, call_at,
                       recording_state, method_id, qa2_method(label), companies(name))`)
    .is('assigned_to', null)
    .eq('status', 'pending')
    .is('calibration_group_id', null)
    .eq('qa2_call.qa_relevant', true)
    .not('qa2_call.method_id', 'is', null);
  if (scope.operationalCompanyIds !== 'all') query = query.in('qa2_call.company_id', scope.operationalCompanyIds);
  if (scope.operationalMethodIds !== 'all') query = query.in('qa2_call.method_id', scope.operationalMethodIds);
  // ── how far back the Pool reaches ────────────────────────────────────────
  // It reached back forever, so an agent opening the Pool met months of stale
  // work ahead of this week's calls. Reviewing a call from six weeks ago tells
  // nobody anything useful now, and it buries the work that matters.
  //
  // Seven days, matched on the call's OWN time first: recorded_at is the
  // dialer's stamp (mig 275) and call_at is when the CRM heard about it, which
  // can be days out. Either being inside the window keeps the row — a call with
  // no audio yet has no recorded_at, and dropping those would quietly hide
  // exactly the rows someone still needs to chase.
  const cutoff = new Date(Date.now() - POOL_WINDOW_DAYS * 86400000).toISOString();
  query = query.or(`recorded_at.gte.${cutoff},call_at.gte.${cutoff}`, { foreignTable: 'qa2_call' });

  query = applyQa2Filters(query, filters, QA2_CALL_COLUMNS, access.blocked, 'qa2_call');
  query = applyQa2Sort(query, sort_by, sort_dir, access.sortMap, 'qa2_call', 'created_at', true);
  query = query.limit(200);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  const names = await nameMap((data || []).map(a => a.qa2_call?.agent_user_id));
  const closerDispos = await closerDispoMap((data || []).map(a => a.qa2_call?.id));
  const assignments = (data || []).map(a => (a.qa2_call
    ? { ...a, qa2_call: { ...a.qa2_call,
        agent_name: names.get(a.qa2_call.agent_user_id) || a.qa2_call.agent_user || null,
        closer_dispo: closerDispos.get(a.qa2_call.id)?.dispo || null,
        closer_dispo_source: closerDispos.get(a.qa2_call.id)?.source || null } }
    : a));

  // Counts for EVERY status, not just the one being viewed. The queue's status
  // tiles are a switcher, and a switcher that can only count the tab you are
  // already on is useless — it showed "—" for the other two, so an agent could
  // not see they had work waiting without clicking each tile in turn. Cheap:
  // three head-only counts, no rows fetched.
  const countFor = async (st) => {
    const { count } = await supabaseAdmin
      .from('qa2_assignment')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', req.user.id).eq('status', st);
    return count || 0;
  };
  const [pending, in_review, scored] = await Promise.all([
    countFor('pending'), countFor('in_review'), countFor('scored'),
  ]);

  res.json({ assignments, columns: access.catalog, counts: { pending, in_review, scored } });
}));

// ── claim / manual push / unassign / skip / calibrate ──────────────────────

router.post('/assignments/:id/claim', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { id } = req.params;

  const { data: a } = await supabaseAdmin
    .from('qa2_assignment').select('id, call_id, assigned_to, qa2_call(company_id, method_id)').eq('id', id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  if (a.assigned_to) return res.status(409).json({ error: 'Already claimed' });
  if (!callInScope(scope, a.qa2_call)) return res.status(403).json({ error: 'Not within your grants' });

  const now = new Date().toISOString();
  const { data: claimed, error } = await supabaseAdmin
    .from('qa2_assignment')
    .update({ assigned_to: req.user.id, assigned_by: req.user.id, assigned_at: now, origin: 'self_claim', claimed_at: now })
    .eq('id', id).is('assigned_to', null)
    .select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!claimed) return res.status(409).json({ error: 'Someone else just claimed this' });
  res.json({ assignment: claimed });
}));

router.post('/assignments', asyncHandler(async (req, res) => {
  const scope = await resolveQa2Scope(req);
  if (!scope.managerAccess) return res.status(403).json({ error: 'Forbidden' });
  const { call_id, assigned_to } = req.body || {};
  if (!call_id || !assigned_to) return res.status(400).json({ error: 'call_id and assigned_to required' });

  const { data: call } = await supabaseAdmin.from('qa2_call').select('company_id, method_id').eq('id', call_id).maybeSingle();
  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (!companyInScope(scope, call.company_id)) return res.status(403).json({ error: 'Call is outside your companies' });

  // The same rule /qa2/assign/bulk enforces, applied to the one-at-a-time push
  // this route has always been. It used to check the CALL and never the AGENT,
  // so a TRA call could be pushed to an agent granted only RCM — they would
  // then be holding work the Pool and Queue will not let them open. A
  // superadmin scope has no team of its own, so the team check only applies to
  // a real manager handing work to their own people.
  const [{ data: onTeam }, { data: granted }] = await Promise.all([
    supabaseAdmin.from('qa2_team_member').select('agent_id')
      .eq('agent_id', assigned_to).eq('manager_id', req.user.id).maybeSingle(),
    call.method_id
      ? supabaseAdmin.from('qa2_agent_method').select('method_id')
          .eq('agent_id', assigned_to).eq('method_id', call.method_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!scope.superadmin && !onTeam) {
    return res.status(403).json({ error: 'That reviewer is not on your team' });
  }
  if (call.method_id && !granted) {
    return res.status(403).json({ error: "That reviewer is not granted this call's method — grant it on the Team tab first" });
  }

  const { data: existing } = await supabaseAdmin
    .from('qa2_assignment').select('id').eq('call_id', call_id).is('calibration_group_id', null).maybeSingle();
  const now = new Date().toISOString();

  if (existing) {
    const { data: row, error } = await supabaseAdmin
      .from('qa2_assignment')
      .update({ assigned_to, assigned_by: req.user.id, assigned_at: now, origin: 'manual', status: 'pending' })
      .eq('id', existing.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ assignment: row });
  }
  const { data: row, error } = await supabaseAdmin
    .from('qa2_assignment')
    .insert({ call_id, assigned_to, assigned_by: req.user.id, assigned_at: now, origin: 'manual', status: 'pending' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ assignment: row });
}));

router.post('/assignments/:id/unassign', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { id } = req.params;
  const { data: a } = await supabaseAdmin.from('qa2_assignment').select('id, assigned_to').eq('id', id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  if (a.assigned_to !== req.user.id && !scope.managerAccess) return res.status(403).json({ error: 'Forbidden' });

  const { data: row, error } = await supabaseAdmin
    .from('qa2_assignment')
    .update({ assigned_to: null, assigned_by: null, assigned_at: null, status: 'pending' })
    .eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ assignment: row });
}));

router.post('/assignments/:id/skip', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { id } = req.params;
  const { reason } = req.body || {};
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'A skip reason is required' });

  const { data: a } = await supabaseAdmin.from('qa2_assignment').select('id, assigned_to').eq('id', id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  if (a.assigned_to !== req.user.id && !scope.managerAccess) return res.status(403).json({ error: 'Forbidden' });

  const { data: row, error } = await supabaseAdmin
    .from('qa2_assignment')
    .update({ status: 'skipped', skip_reason: reason.trim(), skipped_by: req.user.id, skipped_at: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ assignment: row });
}));

router.post('/assignments/:id/calibrate', asyncHandler(async (req, res) => {
  const scope = await resolveQa2Scope(req);
  if (!scope.managerAccess) return res.status(403).json({ error: 'Forbidden' });
  const { id } = req.params;
  const { agent_id } = req.body || {};
  if (!agent_id) return res.status(400).json({ error: 'agent_id required' });

  const { data: original } = await supabaseAdmin.from('qa2_assignment').select('*').eq('id', id).maybeSingle();
  if (!original) return res.status(404).json({ error: 'Assignment not found' });

  const groupId = original.calibration_group_id || crypto.randomUUID();
  if (!original.calibration_group_id) {
    await supabaseAdmin.from('qa2_assignment').update({ calibration_group_id: groupId }).eq('id', id);
  }
  const { data: row, error } = await supabaseAdmin
    .from('qa2_assignment')
    .insert({
      call_id: original.call_id, assigned_to: agent_id, assigned_by: req.user.id,
      assigned_at: new Date().toISOString(), origin: 'manual', status: 'pending', calibration_group_id: groupId,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ assignment: row, calibration_group_id: groupId });
}));

// ── /qa2/calls/:id + recording ticket ───────────────────────────────────────

// Three ways a user may see a call: it is inside their granted companies and
// methods, it is assigned to them, or it is THE OTHER LEG of a call assigned to
// them.
//
// That third rule is the whole point of leg pairing (mig 258/260). Reviewing a
// closer leg means listening to the fronter's leg for context, and that fronter
// leg usually belongs to a different company (EasyTech fronts, 1-Vertex closes)
// and a different method (TRA), so neither of the first two rules covers it —
// the Review screen showed the linked call and then 403'd on its audio.
async function canSeeCall(scope, userId, call) {
  if (callInScope(scope, call)) return true;
  const ids = [call.id, call.linked_call_id].filter(Boolean);
  const { data: mine } = await supabaseAdmin
    .from('qa2_assignment').select('id').in('call_id', ids).eq('assigned_to', userId).limit(1);
  if (mine && mine.length) return true;
  // The link is written on both rows, but a row can also be the twin of a call
  // that points AT it — check that direction too rather than trusting symmetry.
  const { data: pointing } = await supabaseAdmin
    .from('qa2_call').select('id').eq('linked_call_id', call.id).limit(5);
  if (pointing && pointing.length) {
    const { data: theirs } = await supabaseAdmin
      .from('qa2_assignment').select('id')
      .in('call_id', pointing.map(p => p.id)).eq('assigned_to', userId).limit(1);
    if (theirs && theirs.length) return true;
  }
  return false;
}

router.get('/calls/:id', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { id } = req.params;
  const { data: call, error } = await supabaseAdmin.from('qa2_call').select('*, companies(name)').eq('id', id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (!(await canSeeCall(scope, req.user.id, call))) return res.status(403).json({ error: 'Forbidden' });

  let linked = null;
  if (call.linked_call_id) {
    const { data } = await supabaseAdmin.from('qa2_call').select('*, companies(name)').eq('id', call.linked_call_id).maybeSingle();
    linked = data || null;
  }

  // None of these four depend on each other's result — was four sequential
  // round trips stacked in the response the Review screen is waiting on,
  // now one wait for the slowest of them. Error handling is unchanged: the
  // two best-effort lookups still swallow their own failure and log it
  // rather than breaking the screen — only now inline in the Promise.all
  // instead of a separate try/catch block each.
  const [names, closerDispos, customerContext, hangup] = await Promise.all([
    nameMap([call.agent_user_id, linked?.agent_user_id]),
    closerDispoMap([call.id, linked?.id]),
    resolveCustomerContext(call).catch(e => {
      logger.warn('QA2_CALLS', `customer context lookup failed for ${call.id}: ${e.message}`);
      return null;
    }),
    // Who hung up — reuses dialerBoxes.js's own hangup annotator (v1's exact
    // mechanism: VICIdial's phone_number_log, matched by agent+time window),
    // never reimplemented.
    annotateHangups([{ start_time: call.call_at, agent_user: call.agent_user }], call.customer_phone)
      .then(([row]) => row ? {
        label: row.hangup_label || null, reason: row.hangup_reason || null,
        call_status: row.call_status || null, unavailable: !!row.hangup_unavailable,
      } : null)
      .catch(e => {
        logger.warn('QA2_CALLS', `hangup lookup failed for ${call.id}: ${e.message}`);
        return null;
      }),
  ]);
  call.closer_dispo = closerDispos.get(call.id)?.dispo || null;
  call.closer_dispo_source = closerDispos.get(call.id)?.source || null;
  if (linked) linked.closer_dispo = closerDispos.get(linked.id)?.dispo || null;
  call.agent_name = names.get(call.agent_user_id) || call.agent_user || null;
  call.company_name = call.companies?.name || null;
  if (linked) {
    linked.agent_name = names.get(linked.agent_user_id) || linked.agent_user || null;
    linked.company_name = linked.companies?.name || null;
  }

  // PERSIST WHO HUNG UP. Lists (queue, Load Day) cannot afford a dialer round
  // trip per row, so the answer is stored on the call the first time anyone
  // learns it — here when a review opens, and in the poller once a clip is
  // found. Falls back to the stored value when the dialer log has aged out.
  const live = hangup && hangup.label ? hangup : null;
  if (live && (call.hangup_label !== live.label || call.hangup_reason !== live.reason)) {
    supabaseAdmin.from('qa2_call').update({
      hangup_label: live.label, hangup_reason: live.reason, hangup_status: live.call_status || null,
    }).eq('id', call.id).then(() => {}, () => {});
  }
  const hangupOut = live || (call.hangup_label
    ? { label: call.hangup_label, reason: call.hangup_reason, call_status: call.hangup_status, unavailable: false }
    : hangup);

  res.json({ call, linked, customer_context: customerContext, hangup: hangupOut });
}));

router.post('/calls/:id/recording-ticket', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { id } = req.params;
  const { data: call } = await supabaseAdmin
    .from('qa2_call').select('id, company_id, method_id, box_id, dialer_lead_id, recording_id, recording_state, linked_call_id').eq('id', id).maybeSingle();
  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (call.recording_state !== 'found' || !call.recording_id) {
    return res.status(404).json({ error: 'No recording available for this call yet' });
  }
  if (!(await canSeeCall(scope, req.user.id, call))) return res.status(403).json({ error: 'Forbidden' });

  const ticket = issueTicket({ userId: req.user.id, box_id: call.box_id, lead_id: call.dialer_lead_id, recording_id: call.recording_id });
  res.json({ url: `/api/qa-media/stream?ticket=${ticket}` });
}));

module.exports = router;
