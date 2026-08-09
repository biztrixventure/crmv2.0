// ============================================================================
// qa2Scope.js — the ONE scoping helper every /qa2 route uses to resolve a
// caller to what they may see and operate on. Per the build brief section 8:
//
//   compliance_manager (or superadmin) -> sees EVERYTHING (all companies,
//     all managers) for ORG-CHART and cross-team REPORTING purposes, always,
//     toggle or not — that's their job regardless.
//   qa_manager (real role, OR a compliance_manager with a LIVE
//     qa2_manager_access grant) -> OPERATIONAL authority (methods, forms,
//     team, queue, score) scoped to companies in qa2_manager_company where
//     they are manager_id. IMPORTANT: a toggled compliance_manager does NOT
//     get to operate on every company just because they can SEE every
//     company — "identical authority to a real qa_manager, no more" means
//     they need companies assigned to their OWN qa2_manager_company rows
//     exactly like a real manager. isCompliance and managerAccess are
//     deliberately separate flags so a route can require the right one for
//     the right action (org routes check isCompliance; methods/forms/team
//     routes check managerAccess).
//   qa_agent -> intersection of their manager's companies (via
//     qa2_team_member -> qa2_manager_company) AND their own explicit
//     qa2_agent_company grants — being in one table isn't enough if the
//     other was revoked. Further filtered by qa2_agent_method for
//     method-level access.
//   fronter/closer -> nothing here; they only ever hit /qa2/my-scores,
//     which doesn't use this helper (it scopes by subject_user_id = self).
//
// deriveScope() is the pure decision function — this file has ZERO requires
// on purpose, so it's unit-testable with no Supabase env vars, no mocking.
// resolveQa2Scope(), the thin async wrapper that fetches the rows and calls
// this, lives in qa2ScopeResolver.js instead — importing THAT file is what
// pulls in config/database.js, never this one.
// ============================================================================

// Pure. Given already-resolved role/grant data, decide what a caller may see.
function deriveScope({
  role,
  superadmin,
  hasLiveManagerAccess,
  managerCompanyIds,        // companies THIS user manages, if they're a manager (real or toggled)
  agentManagerCompanyIds,   // companies the AGENT's manager owns (only relevant for role='qa_agent')
  agentCompanyIds,          // the agent's own explicit qa2_agent_company grants
  agentMethodIds,           // the agent's own explicit qa2_agent_method grants
}) {
  const isCompliance = !!superadmin || role === 'compliance_manager';
  const managerAccess = !!superadmin || role === 'qa_manager' ||
    (role === 'compliance_manager' && !!hasLiveManagerAccess);

  let operationalCompanyIds = [];
  if (superadmin) {
    operationalCompanyIds = 'all';
  } else if (managerAccess) {
    operationalCompanyIds = managerCompanyIds || [];
  } else if (role === 'qa_agent') {
    const managerSet = new Set(agentManagerCompanyIds || []);
    operationalCompanyIds = (agentCompanyIds || []).filter(id => managerSet.has(id));
  }

  const operationalMethodIds = superadmin || managerAccess
    ? 'all'
    : (role === 'qa_agent' ? (agentMethodIds || []) : []);

  return {
    role,
    superadmin: !!superadmin,
    isCompliance,          // org-chart wiring (mig 232) + cross-team reports — always, toggle irrelevant
    managerAccess,         // operational QA authority — real qa_manager OR live-toggled compliance_manager
    operationalCompanyIds, // 'all' | uuid[] — companies this caller may act within for methods/forms/team/queue/score
    operationalMethodIds,  // 'all' | uuid[] — methods this caller may act within
  };
}

// Small route-guard helpers built on the scope, since most routes just need
// a yes/no rather than the full object.
function requireCompliance(scope) {
  return scope.isCompliance;
}
function requireManagerAccess(scope) {
  return scope.managerAccess;
}
function companyInScope(scope, companyId) {
  if (scope.operationalCompanyIds === 'all') return true;
  return scope.operationalCompanyIds.includes(companyId);
}
function methodInScope(scope, methodId) {
  if (scope.operationalMethodIds === 'all') return true;
  return scope.operationalMethodIds.includes(methodId);
}

module.exports = {
  deriveScope,
  requireCompliance,
  requireManagerAccess,
  companyInScope,
  methodInScope,
};
