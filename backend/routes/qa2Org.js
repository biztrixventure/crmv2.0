// ============================================================================
// qa2Org.js — /qa2/org/* — compliance-only org chart wiring. Toggle QA
// access onto a compliance manager, assign companies to a QA manager, assign
// QA agents to a QA manager. Never method/form management — that's the QA
// manager's operational job (see qa2Team.js and Phase 4's qa2Methods.js).
//
// Gated on scope.isCompliance (role-based, via qa2Scope) rather than
// hasPermission — org-chart authority is a role-level thing, not something
// meant to be selectively revoked per-user via user_permission_overrides the
// way an ordinary permission is. If a superadmin wants to take this away
// from one compliance manager specifically, that's a role change, not an
// override — known simplification, flagging it rather than silently
// deciding it doesn't matter.
// ============================================================================

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/database');
const { resolveQa2Scope } = require('../utils/qa2ScopeResolver');
const { getConfig, setConfig } = require('../utils/businessConfig');

async function requireCompliance(req, res) {
  const scope = await resolveQa2Scope(req);
  if (!scope.isCompliance) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return scope;
}

async function logGrant(entity, action, subjectId, objectId, actorId, note) {
  await supabaseAdmin.from('qa2_grant_log').insert({
    entity, action, subject_id: subjectId, object_id: objectId, actor_id: actorId, note: note || null,
  });
}

// ── /qa2/org/manager-access — toggle QA access onto a compliance manager ───

router.get('/manager-access', asyncHandler(async (req, res) => {
  if (!(await requireCompliance(req, res))) return;
  const { data, error } = await supabaseAdmin
    .from('qa2_manager_access')
    .select('id, user_id, granted_by, granted_at, revoked_by, revoked_at')
    .order('granted_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ grants: data || [] });
}));

router.post('/manager-access', asyncHandler(async (req, res) => {
  if (!(await requireCompliance(req, res))) return;
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  // Only makes sense on a real compliance_manager — a qa_manager already has
  // this authority natively and doesn't need a grant.
  const { data: roleRow } = await supabaseAdmin
    .from('user_company_roles')
    .select('custom_roles(level)')
    .eq('user_id', user_id).eq('is_active', true).limit(1).maybeSingle();
  const level = Array.isArray(roleRow?.custom_roles) ? roleRow.custom_roles[0]?.level : roleRow?.custom_roles?.level;
  if (level !== 'compliance_manager') {
    return res.status(400).json({ error: 'QA access can only be toggled onto a compliance_manager' });
  }

  const { data: existing } = await supabaseAdmin
    .from('qa2_manager_access').select('id').eq('user_id', user_id).is('revoked_at', null).maybeSingle();
  if (existing) return res.status(409).json({ error: 'This user already has a live QA access grant' });

  const { data: grant, error } = await supabaseAdmin
    .from('qa2_manager_access')
    .insert({ user_id, granted_by: req.user.id })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  await logGrant('manager_access', 'grant', user_id, null, req.user.id, null);
  res.status(201).json({ grant });
}));

router.delete('/manager-access/:userId', asyncHandler(async (req, res) => {
  if (!(await requireCompliance(req, res))) return;
  const { userId } = req.params;
  const { data: existing } = await supabaseAdmin
    .from('qa2_manager_access').select('id').eq('user_id', userId).is('revoked_at', null).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'No live QA access grant for this user' });

  const { error } = await supabaseAdmin
    .from('qa2_manager_access')
    .update({ revoked_at: new Date().toISOString(), revoked_by: req.user.id })
    .eq('id', existing.id);
  if (error) return res.status(500).json({ error: error.message });
  await logGrant('manager_access', 'revoke', userId, null, req.user.id, null);
  res.json({ ok: true });
}));

// ── /qa2/org/manager-companies — assign companies to a QA manager ──────────
// One company -> exactly one QA manager, structurally (PK on company_id in
// mig 232). Reassigning logs a revoke against the old manager and a grant to
// the new one rather than silently overwriting — the ledger exists to answer
// "who managed this company on date X."

router.get('/manager-companies', asyncHandler(async (req, res) => {
  if (!(await requireCompliance(req, res))) return;
  const { data, error } = await supabaseAdmin
    .from('qa2_manager_company')
    .select('company_id, manager_id, assigned_by, assigned_at, companies(name)')
    .order('assigned_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ assignments: data || [] });
}));

router.post('/manager-companies', asyncHandler(async (req, res) => {
  if (!(await requireCompliance(req, res))) return;
  const { company_id, manager_id } = req.body || {};
  if (!company_id || !manager_id) return res.status(400).json({ error: 'company_id and manager_id required' });

  const { data: company } = await supabaseAdmin.from('companies').select('id').eq('id', company_id).maybeSingle();
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const { data: existing } = await supabaseAdmin.from('qa2_manager_company').select('manager_id').eq('company_id', company_id).maybeSingle();
  const isReassignment = !!existing && existing.manager_id !== manager_id;
  if (isReassignment) {
    await logGrant('manager_company', 'revoke', existing.manager_id, company_id, req.user.id, 'reassigned');
  }

  const { data: row, error } = await supabaseAdmin
    .from('qa2_manager_company')
    .upsert({ company_id, manager_id, assigned_by: req.user.id, assigned_at: new Date().toISOString() }, { onConflict: 'company_id' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!existing || isReassignment) {
    await logGrant('manager_company', 'grant', manager_id, company_id, req.user.id, null);
  }
  res.status(201).json({ assignment: row });
}));

router.delete('/manager-companies/:companyId', asyncHandler(async (req, res) => {
  if (!(await requireCompliance(req, res))) return;
  const { companyId } = req.params;
  const { data: existing } = await supabaseAdmin.from('qa2_manager_company').select('manager_id').eq('company_id', companyId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'No manager assigned to this company' });

  const { error } = await supabaseAdmin.from('qa2_manager_company').delete().eq('company_id', companyId);
  if (error) return res.status(500).json({ error: error.message });
  await logGrant('manager_company', 'revoke', existing.manager_id, companyId, req.user.id, null);

  // Untouched (status='pending') assignments for calls in this company
  // return to the unassigned pool immediately — in-progress (in_review) work
  // is left alone so the agent can finish it. Locked-in decision, mig 236's
  // header comment.
  const { data: calls } = await supabaseAdmin.from('qa2_call').select('id').eq('company_id', companyId);
  const callIds = (calls || []).map(c => c.id);
  let returned = 0;
  if (callIds.length) {
    const { data: updated } = await supabaseAdmin
      .from('qa2_assignment')
      .update({ assigned_to: null, assigned_by: null, assigned_at: null })
      .in('call_id', callIds)
      .eq('status', 'pending')
      .select('id');
    returned = (updated || []).length;
  }

  res.json({ ok: true, returned_to_pool: returned });
}));

// ── /qa2/org/team-members — assign QA agents to a QA manager ───────────────
// One agent -> exactly one QA manager, structurally (PK on agent_id).

router.get('/team-members', asyncHandler(async (req, res) => {
  if (!(await requireCompliance(req, res))) return;
  const { data, error } = await supabaseAdmin
    .from('qa2_team_member')
    .select('agent_id, manager_id, assigned_by, assigned_at')
    .order('assigned_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ members: data || [] });
}));

router.post('/team-members', asyncHandler(async (req, res) => {
  if (!(await requireCompliance(req, res))) return;
  const { agent_id, manager_id } = req.body || {};
  if (!agent_id || !manager_id) return res.status(400).json({ error: 'agent_id and manager_id required' });

  // Only a QA agent can be put on a QA team. The picker used to list every user
  // in the business — 96 fronters and 25 closers ahead of the 5 QA agents — and
  // nothing stopped one being assigned. A fronter on a QA team gets a reviewer's
  // queue over their own colleagues' calls, so this is the guard that matters;
  // the filtered picker is only the convenience.
  const { data: agentRoles } = await supabaseAdmin
    .from('user_company_roles')
    .select('custom_roles(level)')
    .eq('user_id', agent_id).eq('is_active', true);
  const levels = (agentRoles || []).map(r => r.custom_roles?.level).filter(Boolean);
  if (!levels.includes('qa_agent')) {
    return res.status(400).json({
      error: levels.length
        ? `That user is a ${levels.join('/')}, not a QA agent — give them the QA agent role first`
        : 'That user has no active role — give them the QA agent role first',
    });
  }

  const { data: existing } = await supabaseAdmin.from('qa2_team_member').select('manager_id').eq('agent_id', agent_id).maybeSingle();
  const isReassignment = !!existing && existing.manager_id !== manager_id;

  if (isReassignment) {
    // Moving an agent to a different manager: in-flight (in_review)
    // assignments stay untouched so they can finish that work, but their
    // company/method sub-grants under the OLD manager are revoked — carrying
    // them forward could leave the agent visible into companies the NEW
    // manager was never assigned. Locked-in decision (build brief Q4).
    const [{ data: oldCompanies }, { data: oldMethods }] = await Promise.all([
      supabaseAdmin.from('qa2_agent_company').select('company_id').eq('agent_id', agent_id),
      supabaseAdmin.from('qa2_agent_method').select('method_id').eq('agent_id', agent_id),
    ]);
    for (const c of (oldCompanies || [])) await logGrant('agent_company', 'revoke', agent_id, c.company_id, req.user.id, 'manager changed');
    for (const m of (oldMethods || [])) await logGrant('agent_method', 'revoke', agent_id, m.method_id, req.user.id, 'manager changed');
    await supabaseAdmin.from('qa2_agent_company').delete().eq('agent_id', agent_id);
    await supabaseAdmin.from('qa2_agent_method').delete().eq('agent_id', agent_id);
    await logGrant('team_member', 'revoke', agent_id, existing.manager_id, req.user.id, 'reassigned');
  }

  const { data: row, error } = await supabaseAdmin
    .from('qa2_team_member')
    .upsert({ agent_id, manager_id, assigned_by: req.user.id, assigned_at: new Date().toISOString() }, { onConflict: 'agent_id' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!existing || isReassignment) {
    await logGrant('team_member', 'grant', agent_id, manager_id, req.user.id, null);
  }
  res.status(201).json({ member: row });
}));

router.delete('/team-members/:agentId', asyncHandler(async (req, res) => {
  if (!(await requireCompliance(req, res))) return;
  const { agentId } = req.params;
  const { data: existing } = await supabaseAdmin.from('qa2_team_member').select('manager_id').eq('agent_id', agentId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'This agent has no QA manager assigned' });

  const [{ data: oldCompanies }, { data: oldMethods }] = await Promise.all([
    supabaseAdmin.from('qa2_agent_company').select('company_id').eq('agent_id', agentId),
    supabaseAdmin.from('qa2_agent_method').select('method_id').eq('agent_id', agentId),
  ]);
  for (const c of (oldCompanies || [])) await logGrant('agent_company', 'revoke', agentId, c.company_id, req.user.id, 'removed from QA org');
  for (const m of (oldMethods || [])) await logGrant('agent_method', 'revoke', agentId, m.method_id, req.user.id, 'removed from QA org');
  await supabaseAdmin.from('qa2_agent_company').delete().eq('agent_id', agentId);
  await supabaseAdmin.from('qa2_agent_method').delete().eq('agent_id', agentId);

  const { error } = await supabaseAdmin.from('qa2_team_member').delete().eq('agent_id', agentId);
  if (error) return res.status(500).json({ error: error.message });
  await logGrant('team_member', 'revoke', agentId, existing.manager_id, req.user.id, null);

  res.json({ ok: true });
}));

// ── /qa2/org/v1-freeze — the v1→v2 cutover date (build brief section 11) ───
// Read is compliance-scoped (same as everything else here); SETTING it is
// superadmin-only — locking every v1 reviewer out is a bigger call than
// routine org wiring, so it gets a stricter gate than requireCompliance.

router.get('/v1-freeze', asyncHandler(async (req, res) => {
  if (!(await requireCompliance(req, res))) return;
  const freezeAt = await getConfig(null, 'qa.v1_freeze_at', null);
  res.json({ freeze_at: freezeAt });
}));

router.post('/v1-freeze', asyncHandler(async (req, res) => {
  const scope = await requireCompliance(req, res);
  if (!scope) return;
  if (!scope.superadmin) return res.status(403).json({ error: 'Superadmin only' });
  const { freeze_at } = req.body || {};
  if (freeze_at !== null && freeze_at !== undefined && Number.isNaN(new Date(freeze_at).getTime())) {
    return res.status(400).json({ error: 'Invalid date' });
  }
  const value = freeze_at || null;
  await setConfig('global', 'qa.v1_freeze_at', value, req.user.id);
  res.json({ ok: true, freeze_at: value });
}));

module.exports = router;
