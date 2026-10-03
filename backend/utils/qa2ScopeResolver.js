// ============================================================================
// qa2ScopeResolver.js — the DB-fetching half of the qa2 scoping helper.
// Split from qa2Scope.js specifically so that file can stay pure (zero
// requires, unit-testable without Supabase env vars) while this one does the
// actual row-fetching and hands the result to deriveScope().
// ============================================================================

const { supabaseAdmin } = require('../config/database');
const { isSuperAdmin } = require('../models/helpers');
const { deriveScope } = require('./qa2Scope');
const cache = require('./cache');

// Every QA2 request resolves this -- including each autosave while a reviewer
// types -- and for a QA agent it is two to three sequential reads (~0.45s each).
// Grants change when a manager rewires the team, not between keystrokes, so the
// answer is kept 30s per user+role (the same window hasPermission uses).
const SCOPE_TTL_MS = 30 * 1000;

async function resolveQa2Scope(req) {
  return cache.remember('qa2_scope', `${req.user.id}|${req.user.role}`, SCOPE_TTL_MS, () => resolveQa2ScopeUncached(req));
}

async function resolveQa2ScopeUncached(req) {
  const userId = req.user.id;
  const role = req.user.role;
  const superadmin = role === 'superadmin' || await isSuperAdmin(userId);

  if (superadmin) {
    return deriveScope({ role, superadmin });
  }

  if (role === 'compliance_manager') {
    const { data } = await supabaseAdmin
      .from('qa2_manager_access')
      .select('id')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .maybeSingle();
    const hasLiveManagerAccess = !!data;
    let managerCompanyIds = [];
    if (hasLiveManagerAccess) {
      const { data: comps } = await supabaseAdmin.from('qa2_manager_company').select('company_id').eq('manager_id', userId);
      managerCompanyIds = (comps || []).map(r => r.company_id);
    }
    return deriveScope({ role, superadmin: false, hasLiveManagerAccess, managerCompanyIds });
  }

  if (role === 'qa_manager') {
    const { data: comps } = await supabaseAdmin.from('qa2_manager_company').select('company_id').eq('manager_id', userId);
    return deriveScope({ role, superadmin: false, managerCompanyIds: (comps || []).map(r => r.company_id) });
  }

  if (role === 'qa_agent') {
    const [{ data: team }, { data: agentComps }, { data: agentMeths }] = await Promise.all([
      supabaseAdmin.from('qa2_team_member').select('manager_id').eq('agent_id', userId).maybeSingle(),
      supabaseAdmin.from('qa2_agent_company').select('company_id').eq('agent_id', userId),
      supabaseAdmin.from('qa2_agent_method').select('method_id').eq('agent_id', userId),
    ]);
    let agentManagerCompanyIds = [];
    if (team && team.manager_id) {
      const { data: mgrComps } = await supabaseAdmin.from('qa2_manager_company').select('company_id').eq('manager_id', team.manager_id);
      agentManagerCompanyIds = (mgrComps || []).map(r => r.company_id);
    }
    return deriveScope({
      role, superadmin: false,
      agentManagerCompanyIds,
      agentCompanyIds: (agentComps || []).map(r => r.company_id),
      agentMethodIds: (agentMeths || []).map(r => r.method_id),
    });
  }

  // fronter / closer / anything else — no /qa2 scope at all.
  return deriveScope({ role, superadmin: false });
}

module.exports = { resolveQa2Scope };
