// ============================================================================
// qa2Assign.js — /qa2/assign/* — the QA manager's assignment workbench.
//
// One screen's worth of questions answered in one call, plus one endpoint that
// hands work out:
//
//   GET  /qa2/assign/workbench  — my agents, what each is allowed to review,
//                                 what each is already carrying, and how much
//                                 unassigned work exists per method
//   POST /qa2/assign/bulk       — hand out N calls of method M to agent A, for
//                                 any number of (agent, method, count) rows at
//                                 once. dry_run returns the same plan without
//                                 writing anything.
//   POST /qa2/assign/return     — push un-started work back to the pool
//
// ── the rule that matters ──────────────────────────────────────────────────
// An agent may only be given a method they are GRANTED (qa2_agent_method), and
// only work from a company they are granted (qa2_agent_company, intersected
// with their manager's companies). That is enforced HERE, in the endpoint, not
// in the UI. The existing manual-push route (qa2Assignments.js) checks the
// call's company and nothing else — it would happily hand a TRA call to an
// agent who only does RCM, who would then be looking at work they cannot open.
// The UI greys those pairings out, but a stale tab, a replayed request or a
// direct API call has to be refused too, so every pair is re-checked here and
// a refused pair comes back WITH ITS REASON rather than being silently dropped.
//
// ── why "available" is not simply "unassigned" ─────────────────────────────
// The auto-assign sampler writes pool rows (origin='auto', assigned_to=NULL).
// Pushing one of those to an agent is an ordinary assignment, not a second
// conflicting row, so both shapes count as assignable: a call with no
// assignment row (insert one) and a call whose assignment nobody has claimed
// (update it). Both paths are race-safe — the insert leans on mig 236's unique
// index, the update carries its own .is('assigned_to', null) — so two managers
// assigning at the same moment cannot hand one call to two people.
// ============================================================================

const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { resolveQa2Scope } = require('../utils/qa2ScopeResolver');
const logger = require('../utils/logger');

const router = express.Router();

// Hard ceiling per (agent, method) row in one request. A manager handing out a
// day's work deals in tens; a four-digit number is a slip or a script.
const MAX_PER_ALLOCATION = 500;

async function requireManager(req, res) {
  const scope = await resolveQa2Scope(req);
  if (!scope.managerAccess) { res.status(403).json({ error: 'QA manager access required' }); return null; }
  return scope;
}

// The manager's own companies. 'all' (superadmin) means NO company filter
// rather than an empty list — an empty array would filter everything out.
function managerCompanyFilter(scope) {
  return scope.operationalCompanyIds === 'all' ? null : (scope.operationalCompanyIds || []);
}

async function nameMap(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data } = await supabaseAdmin
    .from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
  return new Map((data || []).map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown']));
}

// Everything about MY team in one shot: who they are, which methods and
// companies they are granted, and what they are already carrying. The grants
// are what the UI uses to grey out an impossible pairing, and what /bulk
// re-checks before writing anything.
async function loadTeam(managerId) {
  const { data: team } = await supabaseAdmin
    .from('qa2_team_member').select('agent_id, assigned_at').eq('manager_id', managerId);
  const agentIds = (team || []).map(t => t.agent_id);
  if (!agentIds.length) return [];

  const [{ data: methods }, { data: companies }, { data: load }, names] = await Promise.all([
    supabaseAdmin.from('qa2_agent_method').select('agent_id, method_id').in('agent_id', agentIds),
    supabaseAdmin.from('qa2_agent_company').select('agent_id, company_id').in('agent_id', agentIds),
    supabaseAdmin.from('qa2_assignment').select('assigned_to, status').in('assigned_to', agentIds),
    nameMap(agentIds),
  ]);

  const byAgent = (rows, key) => {
    const m = new Map();
    for (const r of (rows || [])) {
      if (!m.has(r.agent_id)) m.set(r.agent_id, []);
      m.get(r.agent_id).push(r[key]);
    }
    return m;
  };
  const methodsBy = byAgent(methods, 'method_id');
  const companiesBy = byAgent(companies, 'company_id');

  const loadBy = new Map();
  for (const a of (load || [])) {
    const cur = loadBy.get(a.assigned_to) || { open: 0, in_review: 0, done: 0 };
    if (a.status === 'pending') cur.open++;
    else if (a.status === 'in_review') cur.in_review++;
    else if (a.status === 'completed' || a.status === 'scored') cur.done++;
    loadBy.set(a.assigned_to, cur);
  }

  return (team || []).map(t => ({
    agent_id: t.agent_id,
    name: names.get(t.agent_id) || 'Unknown',
    method_ids: methodsBy.get(t.agent_id) || [],
    company_ids: companiesBy.get(t.agent_id) || [],
    workload: loadBy.get(t.agent_id) || { open: 0, in_review: 0, done: 0 },
  }));
}

// ── GET /qa2/assign/workbench ──────────────────────────────────────────────
// Query: company_ids (csv), date_from, date_to (YYYY-MM-DD), require_recording,
// min_talk_sec. Every filter also applies to the per-method counts, so the
// number on a method chip is exactly what a bulk assign with the same filters
// would draw from. A count that quietly means something else is worse than no
// count at all.
router.get('/workbench', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;

  const mine = managerCompanyFilter(scope);
  const asked = String(req.query.company_ids || '').split(',').map(s => s.trim()).filter(Boolean);
  // Intersect what was asked for with what this manager owns — asking for a
  // company outside the scope narrows to nothing, it never widens.
  const companyIds = asked.length
    ? (mine ? asked.filter(id => mine.includes(id)) : asked)
    : mine;

  const requireRecording = req.query.require_recording !== 'false';
  const minTalk = Math.max(0, parseInt(req.query.min_talk_sec, 10) || 0);
  const from = req.query.date_from ? `${req.query.date_from}T00:00:00.000Z` : null;
  const to   = req.query.date_to   ? `${req.query.date_to}T23:59:59.999Z`   : null;

  const [{ data: methods }, { data: pool, error: poolErr }, agents, { data: companies }] = await Promise.all([
    supabaseAdmin.from('qa2_method').select('id, code, name, is_active').eq('is_active', true).order('name'),
    supabaseAdmin.rpc('app_qa2_assign_pool', {
      p_company_ids: companyIds && companyIds.length ? companyIds : null,
      p_method_ids: null,
      p_from: from,
      p_to: to,
      p_require_recording: requireRecording,
      p_min_talk: minTalk,
    }),
    loadTeam(req.user.id),
    supabaseAdmin.from('companies').select('id, name').order('name'),
  ]);
  if (poolErr) return res.status(500).json({ error: poolErr.message });

  const poolBy = new Map((pool || []).map(r => [r.method_id, r]));
  const inScope = (c) => !mine || mine.includes(c.id);

  res.json({
    filters: {
      company_ids: companyIds || [],
      date_from: req.query.date_from || null,
      date_to: req.query.date_to || null,
      require_recording: requireRecording,
      min_talk_sec: minTalk,
    },
    companies: (companies || []).filter(inScope).map(c => ({ id: c.id, name: c.name })),
    methods: (methods || []).map(m => {
      const p = poolBy.get(m.id) || {};
      return {
        id: m.id, code: m.code, name: m.name,
        available: Number(p.available || 0),
        with_recording: Number(p.with_recording || 0),
        awaiting_audio: Number(p.awaiting_audio || 0),
        total: Number(p.total || 0),
      };
    }),
    agents,
  });
}));

// ── POST /qa2/assign/bulk ──────────────────────────────────────────────────
// Body: {
//   allocations: [{ agent_id, method_id, count }],   // the matrix, explicit
//   company_ids?, date_from?, date_to?, require_recording?, min_talk_sec?,
//   dry_run?
// }
// Returns one result row per allocation, ALWAYS — including refused ones, with
// the reason. A manager who asked for 40 and got 12 needs to see which of the
// two things happened: the agent is not allowed that method, or the work isn't
// there.
router.post('/bulk', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;

  const body = req.body || {};
  const allocations = Array.isArray(body.allocations) ? body.allocations : [];
  if (!allocations.length) return res.status(400).json({ error: 'allocations required' });
  if (allocations.length > 200) return res.status(400).json({ error: 'Too many allocations in one request' });

  const dryRun = !!body.dry_run;
  const requireRecording = body.require_recording !== false;
  const minTalk = Math.max(0, parseInt(body.min_talk_sec, 10) || 0);
  const from = body.date_from ? `${body.date_from}T00:00:00.000Z` : null;
  const to   = body.date_to   ? `${body.date_to}T23:59:59.999Z`   : null;

  const mine = managerCompanyFilter(scope);
  const askedCompanies = Array.isArray(body.company_ids) ? body.company_ids.filter(Boolean) : [];
  const baseCompanies = askedCompanies.length
    ? (mine ? askedCompanies.filter(id => mine.includes(id)) : askedCompanies)
    : mine;

  const team = await loadTeam(req.user.id);
  const teamBy = new Map(team.map(a => [a.agent_id, a]));
  const { data: methodRows } = await supabaseAdmin.from('qa2_method').select('id, code, name');
  const methodBy = new Map((methodRows || []).map(m => [m.id, m]));

  const now = new Date().toISOString();
  const results = [];
  // Calls handed out earlier in THIS request are off the table for later
  // allocations — two agents in one submit must not receive the same call.
  const takenThisRequest = [];

  for (const alloc of allocations) {
    const agentId = alloc?.agent_id;
    const methodId = alloc?.method_id;
    const want = Math.min(MAX_PER_ALLOCATION, Math.max(0, parseInt(alloc?.count, 10) || 0));
    const agent = teamBy.get(agentId);
    const method = methodBy.get(methodId);
    const row = {
      agent_id: agentId,
      agent_name: agent?.name || null,
      method_id: methodId,
      method_code: method?.code || null,
      requested: want,
      assigned: 0,
      reason: null,
    };

    if (!agent)  { row.reason = 'not_on_your_team'; results.push(row); continue; }
    if (!method) { row.reason = 'unknown_method';   results.push(row); continue; }
    if (!want)   { row.reason = 'zero_requested';   results.push(row); continue; }
    // THE rule: an agent never receives a method they were not granted.
    if (!agent.method_ids.includes(methodId)) { row.reason = 'method_not_granted'; results.push(row); continue; }

    // Company scope for THIS agent = the request filter, narrowed by the
    // agent's own company grants. An agent with no company rows at all is
    // treated as unrestricted within their manager's companies — that is how
    // the Team tab has always presented "no grants yet".
    let companyIds = baseCompanies;
    if (agent.company_ids.length) {
      companyIds = companyIds ? companyIds.filter(id => agent.company_ids.includes(id)) : agent.company_ids;
    }
    if (companyIds && !companyIds.length) { row.reason = 'no_company_overlap'; results.push(row); continue; }

    const { data: picks, error: pickErr } = await supabaseAdmin.rpc('app_qa2_assign_pick', {
      p_method_id: methodId,
      p_company_ids: companyIds && companyIds.length ? companyIds : null,
      p_from: from,
      p_to: to,
      p_require_recording: requireRecording,
      p_min_talk: minTalk,
      p_limit: want,
      p_exclude: takenThisRequest.length ? takenThisRequest : null,
    });
    if (pickErr) { row.reason = `lookup_failed: ${pickErr.message}`; results.push(row); continue; }

    const candidates = picks || [];
    if (!candidates.length) { row.reason = 'no_work_available'; results.push(row); continue; }

    if (dryRun) {
      row.assigned = candidates.length;
      row.reason = candidates.length < want ? 'partial_only_this_much_available' : null;
      candidates.forEach(c => takenThisRequest.push(c.call_id));
      results.push(row);
      continue;
    }

    // Path A — an unclaimed pool row already exists: claim it for this agent.
    // .is('assigned_to', null) is the race guard; a concurrent claim simply
    // returns fewer rows and the count below reflects what really happened.
    const poolIds = candidates.filter(c => c.assignment_id).map(c => c.assignment_id);
    let claimed = [];
    if (poolIds.length) {
      const { data, error } = await supabaseAdmin
        .from('qa2_assignment')
        .update({ assigned_to: agentId, assigned_by: req.user.id, assigned_at: now, origin: 'manual', status: 'pending' })
        .in('id', poolIds).is('assigned_to', null)
        .select('id, call_id');
      if (error) logger.warn('QA2_ASSIGN', `claim pool rows for ${agentId}: ${error.message}`);
      claimed = data || [];
    }

    // Path B — no assignment row yet: create one, already assigned.
    const fresh = candidates.filter(c => !c.assignment_id);
    let inserted = [];
    if (fresh.length) {
      const rows = fresh.map(c => ({
        call_id: c.call_id, assigned_to: agentId, assigned_by: req.user.id,
        assigned_at: now, origin: 'manual', status: 'pending', priority: 0,
      }));
      const { data, error } = await supabaseAdmin.from('qa2_assignment').insert(rows).select('id, call_id');
      if (error) {
        // Mig 236's unique index rejected the whole batch because ONE call was
        // assigned by someone else a moment ago. Retry row by row so the other
        // thirty-nine still land — losing a batch to one collision is worse.
        logger.warn('QA2_ASSIGN', `batch insert collided (${error.message}) — retrying individually`);
        for (const r of rows) {
          const { data: one } = await supabaseAdmin.from('qa2_assignment').insert(r).select('id, call_id').maybeSingle();
          if (one) inserted.push(one);
        }
      } else {
        inserted = data || [];
      }
    }

    const got = claimed.length + inserted.length;
    row.assigned = got;
    if (got < want) row.reason = got === 0 ? 'no_work_available' : 'partial_only_this_much_available';
    [...claimed, ...inserted].forEach(a => takenThisRequest.push(a.call_id));
    results.push(row);
  }

  const total = results.reduce((n, r) => n + r.assigned, 0);
  if (!dryRun && total) {
    logger.info('QA2_ASSIGN', `${req.user.email || req.user.id} assigned ${total} call(s) across ${results.filter(r => r.assigned).length} allocation(s)`);
  }
  res.json({ dry_run: dryRun, total_assigned: total, results });
}));

// ── POST /qa2/assign/return ────────────────────────────────────────────────
// Hand work back to the pool in bulk — the inverse of the matrix above, for an
// over-allocation or an agent going off shift. Only touches work nobody has
// started; an assignment already in review keeps its owner.
router.post('/return', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  const { agent_id, method_id, limit } = req.body || {};
  if (!agent_id) return res.status(400).json({ error: 'agent_id required' });

  const team = await loadTeam(req.user.id);
  if (!team.some(a => a.agent_id === agent_id)) return res.status(403).json({ error: 'Not on your team' });

  let q = supabaseAdmin
    .from('qa2_assignment')
    .select('id, qa2_call!inner(method_id)')
    .eq('assigned_to', agent_id)
    .eq('status', 'pending');
  if (method_id) q = q.eq('qa2_call.method_id', method_id);
  const { data: rows, error } = await q.limit(Math.min(500, Math.max(1, parseInt(limit, 10) || 500)));
  if (error) return res.status(500).json({ error: error.message });

  const ids = (rows || []).map(r => r.id);
  if (!ids.length) return res.json({ returned: 0 });

  const { data: done, error: upErr } = await supabaseAdmin
    .from('qa2_assignment')
    .update({ assigned_to: null, assigned_by: null, assigned_at: null, status: 'pending' })
    .in('id', ids).eq('status', 'pending')
    .select('id');
  if (upErr) return res.status(500).json({ error: upErr.message });
  res.json({ returned: (done || []).length });
}));

module.exports = router;
