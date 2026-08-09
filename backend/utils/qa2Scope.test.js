// ============================================================================
// qa2Scope.test.js — unit coverage for deriveScope(), the pure decision
// function behind the ONE scoping helper every /qa2 route uses. No Supabase
// mocking needed — resolveQa2Scope() is a thin fetch-then-delegate wrapper
// around this, so testing the decision logic directly is what matters.
// ============================================================================

const { deriveScope, companyInScope, methodInScope } = require('./qa2Scope');

describe('deriveScope — superadmin', () => {
  test('sees everything, operationally, regardless of role field', () => {
    const scope = deriveScope({ role: 'compliance_manager', superadmin: true });
    expect(scope.isCompliance).toBe(true);
    expect(scope.managerAccess).toBe(true);
    expect(scope.operationalCompanyIds).toBe('all');
    expect(scope.operationalMethodIds).toBe('all');
  });
});

describe('deriveScope — compliance_manager', () => {
  test('WITHOUT the toggle: isCompliance true, managerAccess false, zero operational companies', () => {
    const scope = deriveScope({ role: 'compliance_manager', superadmin: false, hasLiveManagerAccess: false });
    expect(scope.isCompliance).toBe(true);   // still sees org chart + cross-team reports
    expect(scope.managerAccess).toBe(false); // but CANNOT create methods/forms/manage a team
    expect(scope.operationalCompanyIds).toEqual([]);
    expect(scope.operationalMethodIds).toEqual([]);
  });

  test('WITH a live toggle: managerAccess true, but scoped to THEIR OWN qa2_manager_company rows only — not all companies', () => {
    const scope = deriveScope({
      role: 'compliance_manager', superadmin: false, hasLiveManagerAccess: true,
      managerCompanyIds: ['co-1', 'co-2'],
    });
    expect(scope.isCompliance).toBe(true);
    expect(scope.managerAccess).toBe(true);
    // NOT 'all' — "identical authority to a real qa_manager, no more" means
    // the same company-scoping mechanism, not their innate cross-company view.
    expect(scope.operationalCompanyIds).toEqual(['co-1', 'co-2']);
    expect(scope.operationalMethodIds).toBe('all'); // manager tier sees all methods within their scope
  });

  test('a REVOKED toggle (hasLiveManagerAccess false even if a row once existed) behaves identically to never-toggled', () => {
    const scope = deriveScope({ role: 'compliance_manager', superadmin: false, hasLiveManagerAccess: false, managerCompanyIds: ['co-1'] });
    expect(scope.managerAccess).toBe(false);
    expect(scope.operationalCompanyIds).toEqual([]); // managerCompanyIds ignored once access isn't live
  });
});

describe('deriveScope — qa_manager (real role)', () => {
  test('managerAccess true, isCompliance false, scoped to own qa2_manager_company rows', () => {
    const scope = deriveScope({ role: 'qa_manager', superadmin: false, managerCompanyIds: ['co-5'] });
    expect(scope.isCompliance).toBe(false);   // cannot see other managers' teams/scores
    expect(scope.managerAccess).toBe(true);
    expect(scope.operationalCompanyIds).toEqual(['co-5']);
    expect(scope.operationalMethodIds).toBe('all');
  });

  test('a manager assigned zero companies has zero operational scope, not "all"', () => {
    const scope = deriveScope({ role: 'qa_manager', superadmin: false, managerCompanyIds: [] });
    expect(scope.operationalCompanyIds).toEqual([]);
  });
});

describe('deriveScope — qa_agent', () => {
  test('operational companies are the INTERSECTION of manager companies and own grants, not the union', () => {
    const scope = deriveScope({
      role: 'qa_agent', superadmin: false,
      agentManagerCompanyIds: ['co-1', 'co-2', 'co-3'],  // manager owns these
      agentCompanyIds: ['co-2', 'co-4'],                  // agent was explicitly granted these
    });
    // co-2 is in both -> in scope. co-1/co-3 (manager has, agent wasn't granted) -> out.
    // co-4 (agent was granted, but manager doesn't/no-longer owns it) -> out.
    expect(scope.operationalCompanyIds).toEqual(['co-2']);
  });

  test('a revoked manager-side company grant removes agent access even if qa2_agent_company still lists it (mig 232 revoke ordering)', () => {
    const scope = deriveScope({
      role: 'qa_agent', superadmin: false,
      agentManagerCompanyIds: [],           // manager no longer owns anything
      agentCompanyIds: ['co-9'],            // stale grant not yet cleaned up
    });
    expect(scope.operationalCompanyIds).toEqual([]);
  });

  test('operationalMethodIds is the agent\'s own explicit qa2_agent_method grants, never "all"', () => {
    const scope = deriveScope({ role: 'qa_agent', superadmin: false, agentMethodIds: ['m-1'] });
    expect(scope.operationalMethodIds).toEqual(['m-1']);
  });

  test('isCompliance and managerAccess are both false for an agent', () => {
    const scope = deriveScope({ role: 'qa_agent', superadmin: false });
    expect(scope.isCompliance).toBe(false);
    expect(scope.managerAccess).toBe(false);
  });
});

describe('deriveScope — fronter/closer/unknown roles', () => {
  test('no /qa2 scope at all', () => {
    for (const role of ['fronter', 'closer', 'operations_manager', undefined]) {
      const scope = deriveScope({ role, superadmin: false });
      expect(scope.isCompliance).toBe(false);
      expect(scope.managerAccess).toBe(false);
      expect(scope.operationalCompanyIds).toEqual([]);
      expect(scope.operationalMethodIds).toEqual([]);
    }
  });
});

describe('companyInScope / methodInScope helpers', () => {
  test('"all" short-circuits to true for any id', () => {
    const scope = { operationalCompanyIds: 'all', operationalMethodIds: 'all' };
    expect(companyInScope(scope, 'anything')).toBe(true);
    expect(methodInScope(scope, 'anything')).toBe(true);
  });
  test('array scope only matches listed ids', () => {
    const scope = { operationalCompanyIds: ['co-1'], operationalMethodIds: ['m-1'] };
    expect(companyInScope(scope, 'co-1')).toBe(true);
    expect(companyInScope(scope, 'co-2')).toBe(false);
    expect(methodInScope(scope, 'm-1')).toBe(true);
    expect(methodInScope(scope, 'm-2')).toBe(false);
  });
});
