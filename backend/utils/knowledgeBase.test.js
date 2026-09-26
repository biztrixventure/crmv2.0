// ============================================================================
// knowledgeBase.test.js -- tenant isolation for the scripts / rebuttals / FAQ
// knowledge base (mig 331).
//
// Before 331 every script and FAQ was estate-wide and only compliance could
// write one. Opening writing up to the people who coach a floor is only safe if
// three rules hold, and each is one assertion here:
//   - a company's manager reads THEIR rows plus the shared ones, never another
//     tenant's (a bare select was the leak this replaced);
//   - a caller with no company reads the shared rows only -- not everything;
//   - a shared row (company_id NULL) is editable by estate-wide authority only,
//     so one floor's wording cannot silently become every floor's.
// ============================================================================
jest.mock('../config/database', () => ({ supabaseAdmin: { from: jest.fn() } }));
jest.mock('../models/helpers', () => ({
  isSuperAdmin: jest.fn(async () => false),
  hasPermission: jest.fn(async () => false),
}));

const { supabaseAdmin } = require('../config/database');
const helpers = require('../models/helpers');
const kb = require('./knowledgeBase');

const COMPANY = '11111111-1111-1111-1111-111111111111';
const OTHER   = '22222222-2222-2222-2222-222222222222';

// A query stub that records the filter the scope helper applied.
function queryStub() {
  const calls = [];
  const q = {
    calls,
    or: (arg) => { calls.push(['or', arg]); return q; },
    is: (col, val) => { calls.push(['is', col, val]); return q; },
  };
  return q;
}

// teams lookup answering "does this person lead a team here".
const leadsTeam = (yes) => supabaseAdmin.from.mockReturnValue({
  select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: yes ? [{ id: 'team1' }] : [] }) }) }) }) }),
});

const reqFor = (over = {}) => ({ user: { id: 'u1', role: 'fronter_manager', company_id: COMPANY, ...over } });

beforeEach(() => {
  helpers.isSuperAdmin.mockResolvedValue(false);
  helpers.hasPermission.mockResolvedValue(false);
  supabaseAdmin.from.mockReset();
});

describe('scopeRead', () => {
  test('a company sees its own rows OR the shared ones', () => {
    const q = kb.scopeRead(queryStub(), { companyId: COMPANY, estate: false });
    expect(q.calls).toEqual([['or', `company_id.eq.${COMPANY},company_id.is.null`]]);
  });

  test('no company means the shared rows only, never an unfiltered read', () => {
    const q = kb.scopeRead(queryStub(), { companyId: null, estate: false });
    expect(q.calls).toEqual([['is', 'company_id', null]]);
  });

  test('estate-wide authority reads every company', () => {
    const q = kb.scopeRead(queryStub(), { companyId: null, estate: true });
    expect(q.calls).toEqual([]);
  });
});

describe('canManageCompany', () => {
  test('the manage_faqs permission carries it for that company', async () => {
    helpers.hasPermission.mockResolvedValue(true);
    await expect(kb.canManageCompany(reqFor(), COMPANY)).resolves.toBe(true);
  });

  test('a team lead carries it holding no permission at all', async () => {
    leadsTeam(true);
    await expect(kb.canManageCompany(reqFor(), COMPANY)).resolves.toBe(true);
  });

  test('leading no team and holding no permission is a no', async () => {
    leadsTeam(false);
    await expect(kb.canManageCompany(reqFor(), COMPANY)).resolves.toBe(false);
  });

  test('compliance may write for any company', async () => {
    await expect(kb.canManageCompany(reqFor({ role: 'compliance_manager' }), OTHER)).resolves.toBe(true);
  });
});

describe('guardRow', () => {
  const rowIs = (row) => supabaseAdmin.from.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }),
  });

  test('a SHARED row is refused to a company manager, with the reason', async () => {
    rowIs({ id: 's1', company_id: null });
    helpers.hasPermission.mockResolvedValue(true);
    const g = await kb.guardRow(reqFor(), 'scripts', 's1');
    expect(g.status).toBe(403);
    expect(g.error).toMatch(/shared with every company/i);
  });

  test('a shared row is editable by a superadmin', async () => {
    rowIs({ id: 's1', company_id: null });
    helpers.isSuperAdmin.mockResolvedValue(true);
    await expect(kb.guardRow(reqFor(), 'scripts', 's1')).resolves.toMatchObject({ row: { id: 's1' } });
  });

  test('another company row is refused', async () => {
    // first call loads the row, later calls answer the teams lookup
    supabaseAdmin.from
      .mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's2', company_id: OTHER } }) }) }) })
      .mockReturnValue({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }) }) });
    const g = await kb.guardRow(reqFor(), 'scripts', 's2');
    expect(g.status).toBe(403);
  });

  test('a missing row is a 404, not a 403', async () => {
    rowIs(null);
    await expect(kb.guardRow(reqFor(), 'scripts', 'nope')).resolves.toMatchObject({ status: 404 });
  });
});

describe('writeCompany', () => {
  test('a manager writes their own company', async () => {
    helpers.hasPermission.mockResolvedValue(true);
    await expect(kb.writeCompany(reqFor())).resolves.toEqual({ companyId: COMPANY });
  });

  test('global:true is ignored for a company manager -- it writes their company', async () => {
    helpers.hasPermission.mockResolvedValue(true);
    const req = { ...reqFor(), body: { global: true } };
    await expect(kb.writeCompany(req)).resolves.toEqual({ companyId: COMPANY });
  });

  test('global:true from a superadmin writes the shared row', async () => {
    helpers.isSuperAdmin.mockResolvedValue(true);
    const req = { ...reqFor(), body: { global: true } };
    await expect(kb.writeCompany(req)).resolves.toEqual({ companyId: null });
  });

  test('no company means nowhere to save -- never a silent shared row', async () => {
    const r = await kb.writeCompany(reqFor({ company_id: null }));
    expect(r.companyId).toBeUndefined();
    expect(r.status).toBe(400);
  });
});

describe('readCompanyFilter', () => {
  test('a company manager is pinned to their own company, whatever they ask for', async () => {
    leadsTeam(false);
    const req = { ...reqFor(), query: { company_id: OTHER } };
    await expect(kb.readCompanyFilter(req)).resolves.toEqual({ companyId: COMPANY, estate: false });
  });

  test('an admin asking for all gets every company', async () => {
    helpers.isSuperAdmin.mockResolvedValue(true);
    const req = { ...reqFor(), query: { company_id: 'all' } };
    await expect(kb.readCompanyFilter(req)).resolves.toEqual({ companyId: null, estate: true });
  });

  test('an admin may pin the list to one company', async () => {
    helpers.isSuperAdmin.mockResolvedValue(true);
    const req = { ...reqFor(), query: { company_id: OTHER } };
    await expect(kb.readCompanyFilter(req)).resolves.toEqual({ companyId: OTHER, estate: false });
  });
});
