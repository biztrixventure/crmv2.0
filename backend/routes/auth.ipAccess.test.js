// ============================================================================
// auth.ipAccess.test.js -- IP access control at the front door (mig 319):
// POST /auth/login, /auth/refresh and /auth/exchange, through the real auth
// router, against the in-memory Supabase fake. Credentials are checked first;
// a denial then revokes the session Supabase just minted and returns no tokens.
// ============================================================================
process.env.IP_TRUSTED_PROXIES = 'loopback';

jest.mock('../config/database', () => {
  const fake = require('../testing/supabaseFake');
  return { supabaseAdmin: fake.admin, supabaseClient: fake.client };
});
jest.mock('../models/helpers', () => ({
  hasPermission: jest.fn(async () => false),
  isSuperAdmin: jest.fn(async () => false),
}));
jest.mock('../utils/readonlyGovernance', () => ({ resolveGovernance: jest.fn(async () => ({})) }));
jest.mock('../utils/egressGuard', () => ({ resolveExportPerms: jest.fn(async () => ({})) }));
jest.mock('../utils/businessConfig', () => ({ getConfig: jest.fn(async (_c, _k, fallback) => fallback) }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const express = require('express');
const request = require('supertest');
const fake = require('../testing/supabaseFake');
const cache = require('../utils/cache');
const ipAccess = require('../utils/ipAccess');
const { configureTrustProxy } = require('../utils/clientIp');
const authRoutes = require('./auth');

const AGENT = '11111111-1111-4111-8111-111111111111';
const BOSS = '22222222-2222-4222-8222-222222222222';
const PASSWORD = 'secret123';

function buildApp() {
  const app = express();
  configureTrustProxy(app);
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
}

const login = (app, email, ip) => request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email, password: PASSWORD });
const IP_TABLES = new Set(['user_ip_access', 'user_ip_rules', 'ip_access_logs']);

function seed({ rules } = {}) {
  fake.reset({
    user_company_roles: [{
      id: 'ucr-1', user_id: AGENT, role_id: 'role-f', company_id: 'co-1', is_active: true, created_at: '2026-01-01T00:00:00Z',
      custom_roles: { id: 'role-f', name: 'Fronter', level: 'fronter' },
      companies: { name: 'Acme', company_type: 'fronter', logo_url: null },
    }],
    user_profiles: [{ user_id: AGENT, first_name: 'Ali', last_name: 'Agent' }, { user_id: BOSS, first_name: 'Sam', last_name: 'Boss' }],
    role_permissions: [{ role_id: 'role-f', permissions: { name: 'view_transfers' } }],
    user_permission_overrides: [],
    permissions: [{ name: 'view_transfers' }],
    user_ip_access: [{ user_id: AGENT, ip_access_mode: 'restricted' }, { user_id: BOSS, ip_access_mode: 'restricted' }],
    user_ip_rules: rules || [
      { id: 'r1', user_id: AGENT, type: 'allow', ip_value: '203.0.113.0/24', is_active: true },
      { id: 'r2', user_id: BOSS, type: 'deny', ip_value: '0.0.0.0/0', is_active: true },
    ],
    ip_access_logs: [],
  }, {
    users: [
      { id: AGENT, email: 'agent@example.com', password: PASSWORD, app_metadata: {} },
      { id: BOSS, email: 'boss@example.com', password: PASSWORD, app_metadata: { role: 'superadmin' } },
    ],
  });
}

let app;
beforeEach(() => {
  ipAccess.__test.reset();
  cache.clearAll();
  seed();
  app = buildApp();
});

describe('POST /auth/login', () => {
  test('switch OFF: a restricted user with ZERO allow rules still logs in -- and no IP table is touched', async () => {
    seed({ rules: [] });
    const r = await login(app, 'agent@example.com', '198.51.100.9');
    expect(r.status).toBe(200);
    expect(r.body.token).toBe(`at-${AGENT}`);
    expect(fake.calls.filter(c => IP_TABLES.has(c.table))).toEqual([]);
    expect(fake.signOuts).toEqual([]);
  });

  test('switch ON, restricted, non-matching address: denied at login -- no tokens, session revoked, logged', async () => {
    ipAccess.__test.setEnabled(true);
    const r = await login(app, 'agent@example.com', '198.51.100.9');
    expect(r.status).toBe(403);
    expect(r.body).toEqual({
      error: 'Access from your current network (198.51.100.9) is not permitted. Contact your administrator.',
      code: 'IP_BLOCKED',
      ip: '198.51.100.9',
    });
    expect(r.body.token).toBeUndefined();
    expect(r.body.refresh_token).toBeUndefined();
    expect(fake.signOuts).toEqual([{ jwt: `at-${AGENT}`, scope: 'local' }]);
    expect(fake.table('ip_access_logs')).toMatchObject([
      { user_id: AGENT, ip_address: '198.51.100.9', result: 'blocked', event: 'login', reason: 'address not whitelisted' },
    ]);
  });

  test('switch ON, restricted, matching allow rule: logged in, "allowed" row written', async () => {
    ipAccess.__test.setEnabled(true);
    const r = await login(app, 'agent@example.com', '203.0.113.20');
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ id: AGENT, role: 'fronter' });
    expect(fake.signOuts).toEqual([]);
    expect(fake.table('ip_access_logs')).toMatchObject([{ result: 'allowed', event: 'login', ip_address: '203.0.113.20' }]);
    expect(fake.table('user_ip_access').find(a => a.user_id === AGENT)).toMatchObject({ last_login_ip: '203.0.113.20' });
  });

  test('wrong password is still a plain 401 -- the IP check never runs for bad credentials', async () => {
    ipAccess.__test.setEnabled(true);
    const r = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.9')
      .send({ email: 'agent@example.com', password: 'not-the-password' });
    expect(r.status).toBe(401);
    expect(fake.table('ip_access_logs')).toEqual([]);
  });

  test('switch ON: the superadmin logs in from anywhere, even with a deny-everything rule', async () => {
    ipAccess.__test.setEnabled(true);
    const r = await login(app, 'boss@example.com', '198.51.100.9');
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe('superadmin');
    expect(fake.signOuts).toEqual([]);
  });

  test('a spoofed X-Forwarded-For does not get a login through', async () => {
    ipAccess.__test.setEnabled(true);
    const r = await login(app, 'agent@example.com', '203.0.113.20, 198.51.100.9');
    expect(r.status).toBe(403);
    expect(r.body.ip).toBe('198.51.100.9');
  });
});

describe('POST /auth/refresh and /auth/exchange', () => {
  test('a session cannot be renewed from a blocked network', async () => {
    ipAccess.__test.setEnabled(true);
    const blocked = await request(app).post('/api/auth/refresh').set('X-Forwarded-For', '198.51.100.9').send({ refresh_token: `rt-${AGENT}` });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('IP_BLOCKED');
    const ok = await request(app).post('/api/auth/refresh').set('X-Forwarded-For', '203.0.113.20').send({ refresh_token: `rt-${AGENT}` });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBe(`at-${AGENT}`);
  });

  test('a magic-link exchange from a blocked network is refused', async () => {
    ipAccess.__test.setEnabled(true);
    const r = await request(app).post('/api/auth/exchange').set('X-Forwarded-For', '198.51.100.9').send({ access_token: `at-${AGENT}` });
    expect(r.status).toBe(403);
    expect(fake.table('ip_access_logs')[0]).toMatchObject({ result: 'blocked', event: 'exchange' });
  });

  test('switch OFF: refresh behaves exactly as before', async () => {
    const r = await request(app).post('/api/auth/refresh').set('X-Forwarded-For', '198.51.100.9').send({ refresh_token: `rt-${AGENT}` });
    expect(r.status).toBe(200);
    expect(fake.calls.filter(c => IP_TABLES.has(c.table))).toEqual([]);
  });
});
