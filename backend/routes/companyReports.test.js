// ============================================================================
// companyReports.test.js (routes) -- the SCOPING boundary of /api/company-reports.
//
// The one promise this file pins: a person can only ever get numbers for a
// company they are allowed to open, and the RPC is only ever called with that
// company. A fronter manager at company A asking for company B gets a 403 and
// the database is never asked.
// ============================================================================
jest.mock('../config/database', () => {
  const fake = require('../testing/supabaseFake');
  return { supabaseAdmin: fake.admin, supabaseClient: fake.client };
});

const mockPerms = new Map();        // `${userId}|${companyId}|${perm}` -> true
const mockCompanies = new Map();    // userId -> [{ id, name, is_active }]
jest.mock('../models/helpers', () => ({
  hasPermission: jest.fn(async (uid, co, perm) => mockPerms.has(`${uid}|${co}|${perm}`)),
  isSuperAdmin: jest.fn(async (id) => id === '99999999-9999-4999-8999-999999999999'),
  getUserCompanies: jest.fn(async (id) => mockCompanies.get(id) || []),
  getCompanyType: jest.fn(async () => 'fronter'),
}));
jest.mock('../utils/readonlyGovernance', () => ({
  readonlyAllowedCompanyIds: jest.fn(async () => ['aaaaaaaa-0000-4000-8000-00000000000a']),
  resolveGovernance: jest.fn(async () => ({ flags: { view_financial_data: false } })),
}));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const express = require('express');
const request = require('supertest');
const fake = require('../testing/supabaseFake');
const cache = require('../utils/cache');
const { clearConfigCache } = require('../utils/businessConfig');
const { errorHandler } = require('../middleware/errorHandler');
const routes = require('./companyReports');

const CO_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const CO_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const MGR_A = '11111111-1111-4111-8111-111111111111';   // fronter_manager at A
const FRONTER = '22222222-2222-4222-8222-222222222222';  // plain fronter at A, no perms
const TOOLED = '33333333-3333-4333-8333-333333333333';   // fronter at A, reports switched on for them
const ADMIN = '99999999-9999-4999-8999-999999999999';
const RO = '44444444-4444-4444-8444-444444444444';

const USERS = {
  [MGR_A]: { id: MGR_A, role: 'fronter_manager', company_id: CO_A },
  [FRONTER]: { id: FRONTER, role: 'fronter', company_id: CO_A },
  [TOOLED]: { id: TOOLED, role: 'fronter', company_id: CO_A },
  [ADMIN]: { id: ADMIN, role: 'superadmin', company_id: null },
  [RO]: { id: RO, role: 'readonly_admin', company_id: null },
};

function buildApp() {
  const app = express();
  app.use(express.json());
  // Stand-in for authMiddleware: the header names the user.
  app.use((req, _res, next) => { req.user = USERS[req.get('x-user')]; next(); });
  app.use('/api/company-reports', routes);
  app.use(errorHandler);
  return app;
}

const RAW = {
  side: 'fronter', company: { id: CO_A, name: 'A', type: 'fronter' },
  range: { from: '2026-09-01', to: '2026-09-10', days: 10 },
  totals: { transfers: 5, xfer_sold: 1, sold: 2, active: 2, post_dates: 1, dp_sold: 250, dp_active: 250, qa_n: 1, qa_avg: 80, qa_pass: 1 },
  agents: [{ user_id: TOOLED, name: 'T', is_member_active: true, transfers: 5, xfer_sold: 1, sold: 2, active: 2, dp_sold: 250, dp_active: 250, qa_n: 1, qa_avg: 80, qa_pass: 1 }],
  pairs: [], people: {}, dispositions: [], boxes: [], daily: [],
};

let app;
let rpc;
beforeEach(() => {
  cache.clearAll();
  clearConfigCache();
  mockPerms.clear(); mockCompanies.clear();
  fake.reset({
    feature_flags: [{ key: 'tool_company_reports', default_enabled: false }],
    companies: [
      { id: CO_A, name: 'A', company_type: 'fronter', is_active: true },
      { id: CO_B, name: 'B', company_type: 'fronter', is_active: true },
    ],
    business_config: [],
    user_report_access: [],
    // seeded empty so a test can push into them (table() of an unseeded name is a detached [])
    permissions: [], role_permissions: [], user_company_roles: [], user_permission_overrides: [], user_profiles: [],
  });
  rpc = jest.spyOn(fake.admin, 'rpc').mockImplementation(async (fn, args) => {
    if (fn === 'app_company_agent_report') return { data: { ...RAW, company: { id: args.p_company } }, error: null };
    if (fn === 'app_company_report_overview') return { data: [], error: null };
    return { data: null, error: null };
  });
  mockCompanies.set(MGR_A, [{ id: CO_A, name: 'A', is_active: true }]);
  mockCompanies.set(FRONTER, [{ id: CO_A, name: 'A', is_active: true }]);
  mockCompanies.set(TOOLED, [{ id: CO_A, name: 'A', is_active: true }]);
  mockPerms.set(`${MGR_A}|${CO_A}|view_fronter_stats`, true);
  app = buildApp();
});
afterEach(() => rpc.mockRestore());

// The person's own switches (User Control Center -> Reports).
const grant = (user_id, row) => fake.table('user_report_access').push({ user_id, can_view: null, show_amounts: null, company_ids: null, ...row });

const get = (user, path) => request(app).get(`/api/company-reports${path}`).set('x-user', user);

describe('company scoping', () => {
  test('a manager opens their own company; the RPC is asked for exactly that company', async () => {
    const r = await get(MGR_A, `/?company_id=${CO_A}&from=2026-09-01&to=2026-09-10`);
    expect(r.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('app_company_agent_report', expect.objectContaining({ p_company: CO_A, p_from: '2026-09-01', p_to: '2026-09-10' }));
  });

  test('a manager asking for ANOTHER company is refused and the database is never asked', async () => {
    const r = await get(MGR_A, `/?company_id=${CO_B}`);
    expect(r.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  test('no company named -> their own company, never someone else', async () => {
    const r = await get(MGR_A, '/');
    expect(r.status).toBe(200);
    expect(rpc.mock.calls[0][1].p_company).toBe(CO_A);
  });

  test('a fronter with no report permission and no tool switch is refused', async () => {
    const r = await get(FRONTER, `/?company_id=${CO_A}`);
    expect(r.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  test('the per-person switch ON opens their OWN companies only', async () => {
    grant(TOOLED, { can_view: true });
    expect((await get(TOOLED, `/?company_id=${CO_A}`)).status).toBe(200);
    expect((await get(TOOLED, `/?company_id=${CO_B}`)).status).toBe(403);
  });

  test('the per-person switch OFF closes the reports even for a manager with the permission', async () => {
    grant(MGR_A, { can_view: false });
    expect((await get(MGR_A, `/?company_id=${CO_A}`)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  test('picked companies hand one named person exactly those companies', async () => {
    grant(TOOLED, { can_view: true, company_ids: [CO_B] });
    expect((await get(TOOLED, `/?company_id=${CO_B}`)).status).toBe(200);
    expect((await get(TOOLED, `/?company_id=${CO_A}`)).status).toBe(403);
  });

  test('OFF beats an estate-wide role too', async () => {
    grant(RO, { can_view: false });
    expect((await get(RO, `/?company_id=${CO_A}`)).status).toBe(403);
  });

  test('superadmin may open any company; readonly only the governance list', async () => {
    expect((await get(ADMIN, `/?company_id=${CO_B}`)).status).toBe(200);
    expect((await get(RO, `/?company_id=${CO_A}`)).status).toBe(200);
    expect((await get(RO, `/?company_id=${CO_B}`)).status).toBe(403);
  });

  test('a malformed company id is a 400, not a query', async () => {
    const r = await get(ADMIN, "/?company_id=x' or 1=1");
    expect(r.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  test('/scope lists only the companies the caller may open', async () => {
    const r = await get(MGR_A, '/scope');
    expect(r.body.companies.map(c => c.id)).toEqual([CO_A]);
    expect(r.body.global).toBe(false);
    const a = await get(ADMIN, '/scope');
    expect(a.body.companies.map(c => c.id).sort()).toEqual([CO_A, CO_B]);
  });

  test('the All-companies overview is refused to a company manager', async () => {
    expect((await get(MGR_A, '/overview')).status).toBe(403);
    expect((await get(ADMIN, '/overview')).status).toBe(200);
  });
});

describe('what a viewer is shown', () => {
  test('without view_financial_data no amount leaves the server', async () => {
    const r = await get(MGR_A, `/?company_id=${CO_A}`);
    expect(r.body.can_see_money).toBe(false);
    expect(JSON.stringify(r.body)).not.toMatch(/"dp_sold"|"dp_active"|"est_collected"/);
  });

  test('with view_financial_data the money is there', async () => {
    mockPerms.set(`${MGR_A}|${CO_A}|view_financial_data`, true);
    const r = await get(MGR_A, `/?company_id=${CO_A}`);
    expect(r.body.totals.dp_sold).toBe(250);
  });

  test('the amounts switch OFF hides money from a manager who holds view_financial_data', async () => {
    mockPerms.set(`${MGR_A}|${CO_A}|view_financial_data`, true);
    grant(MGR_A, { show_amounts: false });
    const r = await get(MGR_A, `/?company_id=${CO_A}`);
    expect(r.status).toBe(200);
    expect(r.body.can_see_money).toBe(false);
    expect(JSON.stringify(r.body)).not.toMatch(/"dp_sold"/);
  });

  test('the amounts switch ON shows money to someone without view_financial_data', async () => {
    grant(MGR_A, { show_amounts: true });
    const r = await get(MGR_A, `/?company_id=${CO_A}`);
    expect(r.body.totals.dp_sold).toBe(250);
  });

  test('an agent-level viewer sees no QA when qa.agent_scores is off for fronters (the default)', async () => {
    grant(TOOLED, { can_view: true });
    const r = await get(TOOLED, `/?company_id=${CO_A}`);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toMatch(/"qa_avg"|"qa_n"/);
  });

  test('a manager sees QA', async () => {
    const r = await get(MGR_A, `/?company_id=${CO_A}`);
    expect(r.body.totals.qa_avg).toBe(80);
  });

  test('post-dates stay out of sold', async () => {
    const r = await get(MGR_A, `/?company_id=${CO_A}`);
    expect(r.body.totals.sold).toBe(2);
    expect(r.body.totals.post_dates).toBe(1);
  });
});

describe('per-person access endpoints', () => {
  test('only superadmin may change someone\'s access; the change applies at once', async () => {
    const put = (as, body) => request(app).put(`/api/company-reports/access/${FRONTER}`).set('x-user', as).send(body);
    expect((await put(MGR_A, { can_view: true })).status).toBe(403);
    expect((await get(FRONTER, `/?company_id=${CO_A}`)).status).toBe(403);   // primes the access cache
    const r = await put(ADMIN, { can_view: true, show_amounts: false, company_ids: [CO_A, 'junk'] });
    expect(r.status).toBe(200);
    expect(r.body.override).toEqual({ can_view: true, show_amounts: false, company_ids: [CO_A] });
    expect((await get(FRONTER, `/?company_id=${CO_A}`)).status).toBe(200);   // cache invalidated
  });

  test('GET /access lists who can open the reports and who sees the amounts', async () => {
    const t = (n, rows) => fake.table(n).push(...rows);
    t('permissions', [{ id: 'p1', name: 'view_fronter_stats' }, { id: 'p2', name: 'view_financial_data' }]);
    t('role_permissions', [{ role_id: 'r-fm', permission_id: 'p1' }, { role_id: 'r-ca', permission_id: 'p1' }, { role_id: 'r-ca', permission_id: 'p2' }]);
    t('user_company_roles', [
      { user_id: MGR_A, company_id: CO_A, role_id: 'r-fm', is_active: true, custom_roles: { level: 'fronter_manager' } },
      { user_id: TOOLED, company_id: CO_A, role_id: 'r-ca', is_active: true, custom_roles: { level: 'company_admin' } },
      { user_id: FRONTER, company_id: CO_A, role_id: 'r-f', is_active: true, custom_roles: { level: 'fronter' } },
    ]);
    t('user_permission_overrides', []);
    t('user_profiles', [{ user_id: MGR_A, first_name: 'Mona' }, { user_id: TOOLED, first_name: 'Cara' }, { user_id: FRONTER, first_name: 'Fred' }]);
    grant(TOOLED, { show_amounts: false });   // company admin, amounts switched off for them

    expect((await get(MGR_A, '/access')).status).toBe(403);
    const r = await get(ADMIN, '/access');
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.people.map(p => [p.name, p]));
    expect(by.Mona).toMatchObject({ can_view: true, amounts: false, view_source: 'role' });
    expect(by.Cara).toMatchObject({ can_view: true, amounts: false, amounts_source: 'person' });
    expect(by.Fred).toBeUndefined();          // a fronter with nothing set is not listed
  });

  test('back to "role decides" on both switches removes the row', async () => {
    grant(FRONTER, { can_view: true });
    await request(app).put(`/api/company-reports/access/${FRONTER}`).set('x-user', ADMIN).send({ can_view: null, show_amounts: null });
    expect(fake.table('user_report_access').filter(r => r.user_id === FRONTER)).toHaveLength(0);
  });
});

describe('settings', () => {
  test('only superadmin can write, and junk is sanitized', async () => {
    const body = { config: { placeholder_users: ['nope', MGR_A], earner_metric: 'bogus', best_partner_min: 3 } };
    expect((await request(app).put('/api/company-reports/config').set('x-user', MGR_A).send(body)).status).toBe(403);
    const r = await request(app).put('/api/company-reports/config').set('x-user', ADMIN).send(body);
    expect(r.status).toBe(200);
    expect(r.body.config).toMatchObject({ placeholder_users: [MGR_A], earner_metric: 'dp_sold', best_partner_min: 3 });
  });
});
