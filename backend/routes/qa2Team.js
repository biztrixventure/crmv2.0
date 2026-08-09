// ============================================================================
// qa2Team.js — /qa2/team/* — a QA manager sub-assigning THEIR OWN companies
// and methods to THEIR OWN agents. Never org-chart wiring (that's
// qa2Org.js, compliance-only) — this is purely "who on my team works what."
//
// Phase 8 adds sampling rules (feeds qa2AutoAssign.js — company+method
// review-type config) and agent targets (per_day pace, method_id NULL =
// across all methods) — both manager-owned config, so they live here
// alongside agent-companies/agent-methods rather than in a new file.
// ============================================================================

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/database');
const { resolveQa2Scope } = require('../utils/qa2ScopeResolver');
const { companyInScope, methodInScope } = require('../utils/qa2Scope');

async function requireManager(req, res) {
  const scope = await resolveQa2Scope(req);
  if (!scope.managerAccess) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return scope;
}

async function logGrant(entity, action, subjectId, objectId, actorId, note) {
  await supabaseAdmin.from('qa2_grant_log').insert({
    entity, action, subject_id: subjectId, object_id: objectId, actor_id: actorId, note: note || null,
  });
}

// mig 232: one agent -> exactly one manager. A QA manager can only
// sub-assign work to their own team, never someone else's agent.
async function agentBelongsToManager(agentId, managerId) {
  const { data } = await supabaseAdmin
    .from('qa2_team_member').select('agent_id').eq('agent_id', agentId).eq('manager_id', managerId).maybeSingle();
  return !!data;
}

// My own agent roster — GET /agent-companies and /agent-methods only ever
// list GRANTS, so an agent with zero grants so far would never appear in
// either. The Team tab needs an actual roster to populate its pickers.
router.get('/roster', asyncHandler(async (req, res) => {
  if (!(await requireManager(req, res))) return;
  const { data: team, error } = await supabaseAdmin
    .from('qa2_team_member').select('agent_id, assigned_at').eq('manager_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  const agentIds = (team || []).map(t => t.agent_id);
  if (!agentIds.length) return res.json({ agents: [] });

  const { data: profiles } = await supabaseAdmin
    .from('user_profiles').select('user_id, first_name, last_name').in('user_id', agentIds);
  const nameById = new Map((profiles || []).map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown']));

  res.json({ agents: (team || []).map(t => ({ agent_id: t.agent_id, name: nameById.get(t.agent_id) || 'Unknown', assigned_at: t.assigned_at })) });
}));

// ── /qa2/team/agent-companies ───────────────────────────────────────────────

router.get('/agent-companies', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  const { data: team } = await supabaseAdmin.from('qa2_team_member').select('agent_id').eq('manager_id', req.user.id);
  const agentIds = (team || []).map(t => t.agent_id);
  if (!agentIds.length) return res.json({ grants: [] });
  const { data, error } = await supabaseAdmin
    .from('qa2_agent_company')
    .select('id, agent_id, company_id, assigned_by, assigned_at, companies(name)')
    .in('agent_id', agentIds);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ grants: data || [] });
}));

router.post('/agent-companies', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  const { agent_id, company_id } = req.body || {};
  if (!agent_id || !company_id) return res.status(400).json({ error: 'agent_id and company_id required' });

  if (!(await agentBelongsToManager(agent_id, req.user.id))) {
    return res.status(403).json({ error: 'This agent is not on your team' });
  }
  // Cannot sub-assign a company the manager doesn't themselves have —
  // qa2Scope's agent-side intersection logic depends on this invariant.
  if (!companyInScope(scope, company_id)) {
    return res.status(403).json({ error: 'You are not assigned to this company' });
  }

  const { data: row, error } = await supabaseAdmin
    .from('qa2_agent_company')
    .insert({ agent_id, company_id, assigned_by: req.user.id })
    .select().single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) return res.status(409).json({ error: 'Already granted' });
    return res.status(500).json({ error: error.message });
  }
  await logGrant('agent_company', 'grant', agent_id, company_id, req.user.id, null);
  res.status(201).json({ grant: row });
}));

router.delete('/agent-companies/:agentId/:companyId', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  const { agentId, companyId } = req.params;
  if (!(await agentBelongsToManager(agentId, req.user.id))) {
    return res.status(403).json({ error: 'This agent is not on your team' });
  }
  const { error } = await supabaseAdmin.from('qa2_agent_company').delete().eq('agent_id', agentId).eq('company_id', companyId);
  if (error) return res.status(500).json({ error: error.message });
  await logGrant('agent_company', 'revoke', agentId, companyId, req.user.id, null);

  // Untouched (pending, unopened) assignments for this agent in this company
  // return to the pool — same rule as org-level company removal (qa2Org.js).
  const { data: calls } = await supabaseAdmin.from('qa2_call').select('id').eq('company_id', companyId);
  const callIds = (calls || []).map(c => c.id);
  let returned = 0;
  if (callIds.length) {
    const { data: updated } = await supabaseAdmin
      .from('qa2_assignment')
      .update({ assigned_to: null, assigned_by: null, assigned_at: null })
      .in('call_id', callIds).eq('assigned_to', agentId).eq('status', 'pending')
      .select('id');
    returned = (updated || []).length;
  }

  res.json({ ok: true, returned_to_pool: returned });
}));

// ── /qa2/team/agent-methods ─────────────────────────────────────────────────
// Methods are a global catalog (any manager may use any method), so
// methodInScope() is always true for a manager-tier scope — this check
// exists for when Phase 4 adds method archiving/visibility rules, not
// because managers are pre-scoped to a subset of methods today.

router.get('/agent-methods', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  const { data: team } = await supabaseAdmin.from('qa2_team_member').select('agent_id').eq('manager_id', req.user.id);
  const agentIds = (team || []).map(t => t.agent_id);
  if (!agentIds.length) return res.json({ grants: [] });
  const { data, error } = await supabaseAdmin
    .from('qa2_agent_method')
    .select('id, agent_id, method_id, qa2_method(label, code)')
    .in('agent_id', agentIds);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ grants: data || [] });
}));

router.post('/agent-methods', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  const { agent_id, method_id } = req.body || {};
  if (!agent_id || !method_id) return res.status(400).json({ error: 'agent_id and method_id required' });
  if (!(await agentBelongsToManager(agent_id, req.user.id))) {
    return res.status(403).json({ error: 'This agent is not on your team' });
  }
  if (!methodInScope(scope, method_id)) {
    return res.status(403).json({ error: 'You do not have access to this method' });
  }

  const { data: row, error } = await supabaseAdmin
    .from('qa2_agent_method')
    .insert({ agent_id, method_id })
    .select().single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) return res.status(409).json({ error: 'Already granted' });
    return res.status(500).json({ error: error.message });
  }
  await logGrant('agent_method', 'grant', agent_id, method_id, req.user.id, null);
  res.status(201).json({ grant: row });
}));

router.delete('/agent-methods/:agentId/:methodId', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  const { agentId, methodId } = req.params;
  if (!(await agentBelongsToManager(agentId, req.user.id))) {
    return res.status(403).json({ error: 'This agent is not on your team' });
  }
  const { error } = await supabaseAdmin.from('qa2_agent_method').delete().eq('agent_id', agentId).eq('method_id', methodId);
  if (error) return res.status(500).json({ error: error.message });
  await logGrant('agent_method', 'revoke', agentId, methodId, req.user.id, null);
  res.json({ ok: true });
}));

// ── /qa2/team/sampling-rules — feeds qa2AutoAssign.js ───────────────────────

const SAMPLING_MODES = ['full_coverage', 'per_agent_per_day', 'per_agent_per_week', 'percent'];

router.get('/sampling-rules', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  let q = supabaseAdmin.from('qa2_sampling_rule').select('*, companies(name), qa2_method(label)').order('created_at', { ascending: false });
  if (scope.operationalCompanyIds !== 'all') q = q.in('company_id', scope.operationalCompanyIds);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ rules: data || [] });
}));

router.post('/sampling-rules', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  const { company_id, method_id, mode, quantity, min_talk_sec } = req.body || {};
  if (!company_id || !method_id || !mode) return res.status(400).json({ error: 'company_id, method_id and mode required' });
  if (!SAMPLING_MODES.includes(mode)) return res.status(400).json({ error: `mode must be one of ${SAMPLING_MODES.join(', ')}` });
  if (mode !== 'full_coverage' && !(Number(quantity) > 0)) return res.status(400).json({ error: 'quantity must be greater than 0 for this mode' });
  if (mode === 'percent' && Number(quantity) > 100) return res.status(400).json({ error: 'percent quantity cannot exceed 100' });
  if (!companyInScope(scope, company_id)) return res.status(403).json({ error: 'You are not assigned to this company' });
  if (!methodInScope(scope, method_id)) return res.status(403).json({ error: 'You do not have access to this method' });

  const { data: row, error } = await supabaseAdmin
    .from('qa2_sampling_rule')
    .insert({ company_id, method_id, mode, quantity: mode === 'full_coverage' ? null : Number(quantity), min_talk_sec: Number(min_talk_sec) || 0 })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ rule: row });
}));

router.put('/sampling-rules/:id', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  const { id } = req.params;
  const { data: existing } = await supabaseAdmin.from('qa2_sampling_rule').select('company_id').eq('id', id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Rule not found' });
  if (!companyInScope(scope, existing.company_id)) return res.status(403).json({ error: 'You are not assigned to this company' });

  const { mode, quantity, min_talk_sec, is_active } = req.body || {};
  const patch = {};
  if (mode !== undefined) {
    if (!SAMPLING_MODES.includes(mode)) return res.status(400).json({ error: `mode must be one of ${SAMPLING_MODES.join(', ')}` });
    patch.mode = mode;
  }
  const effectiveMode = mode !== undefined ? mode : undefined;
  if (quantity !== undefined) patch.quantity = quantity === null ? null : Number(quantity);
  if (min_talk_sec !== undefined) patch.min_talk_sec = Number(min_talk_sec) || 0;
  if (is_active !== undefined) patch.is_active = !!is_active;
  if (effectiveMode === 'percent' && patch.quantity != null && patch.quantity > 100) {
    return res.status(400).json({ error: 'percent quantity cannot exceed 100' });
  }

  const { data: row, error } = await supabaseAdmin.from('qa2_sampling_rule').update(patch).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ rule: row });
}));

router.delete('/sampling-rules/:id', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  const { id } = req.params;
  const { data: existing } = await supabaseAdmin.from('qa2_sampling_rule').select('company_id').eq('id', id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Rule not found' });
  if (!companyInScope(scope, existing.company_id)) return res.status(403).json({ error: 'You are not assigned to this company' });
  const { error } = await supabaseAdmin.from('qa2_sampling_rule').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// ── /qa2/team/targets ────────────────────────────────────────────────────────
// method_id NULL = a pace target across all of the agent's methods combined,
// per mig 236's UNIQUE(agent_id, method_id) — NULL is a distinct key there
// (Postgres treats each NULL as unique), so an agent can hold both an
// all-methods target and a per-method one at once without conflicting.

router.get('/targets', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  const { data: team } = await supabaseAdmin.from('qa2_team_member').select('agent_id').eq('manager_id', req.user.id);
  const agentIds = (team || []).map(t => t.agent_id);
  if (!agentIds.length) return res.json({ targets: [] });
  const { data, error } = await supabaseAdmin
    .from('qa2_agent_target').select('id, agent_id, method_id, per_day, qa2_method(label)').in('agent_id', agentIds);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ targets: data || [] });
}));

router.post('/targets', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  const { agent_id, method_id, per_day } = req.body || {};
  if (!agent_id || !(Number(per_day) > 0)) return res.status(400).json({ error: 'agent_id and a positive per_day required' });
  if (!(await agentBelongsToManager(agent_id, req.user.id))) return res.status(403).json({ error: 'This agent is not on your team' });
  if (method_id && !methodInScope(scope, method_id)) return res.status(403).json({ error: 'You do not have access to this method' });

  const { data: row, error } = await supabaseAdmin
    .from('qa2_agent_target')
    .upsert({ agent_id, method_id: method_id || null, per_day: Number(per_day) }, { onConflict: 'agent_id,method_id' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ target: row });
}));

router.delete('/targets/:id', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  const { id } = req.params;
  const { data: existing } = await supabaseAdmin.from('qa2_agent_target').select('agent_id').eq('id', id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Target not found' });
  if (!(await agentBelongsToManager(existing.agent_id, req.user.id))) return res.status(403).json({ error: 'This agent is not on your team' });
  const { error } = await supabaseAdmin.from('qa2_agent_target').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

module.exports = router;
