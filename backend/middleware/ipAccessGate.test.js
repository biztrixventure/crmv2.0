// ============================================================================
// ipAccessGate.test.js -- IP access control on a LIVE session (mig 319).
//
// Runs the real authMiddleware (only JWT signature checking is stubbed) with the
// gate chained inside it, plus the real /api/ip-access admin router, against the
// in-memory Supabase fake. supertest connects from loopback, which the test
// trusts as a proxy, so X-Forwarded-For plays the part of "where the user is".
// ============================================================================
process.env.IP_TRUSTED_PROXIES = 'loopback';

jest.mock('../config/database', () => {
  const fake = require('../testing/supabaseFake');
  return { supabaseAdmin: fake.admin, supabaseClient: fake.client };
});
jest.mock('../config/auth', () => ({
  verifyToken: async (header) => {
    const { admin } = require('../testing/supabaseFake');
    const { data } = await admin.auth.getUser(String(header).replace(/^Bearer /, ''));
    if (!data?.user) throw new Error('bad token');
    return { sub: data.user.id, email: data.user.email, app_metadata: data.user.app_metadata, role: 'authenticated' };
  },
}));
jest.mock('../models/helpers', () => ({
  hasPermission: jest.fn(async () => false),
  isSuperAdmin: jest.fn(async (id) => id === '22222222-2222-4222-8222-222222222222'),
}));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const express = require('express');
const request = require('supertest');
const fake = require('../testing/supabaseFake');
const cache = require('../utils/cache');
const ipAccess = require('../utils/ipAccess');
const { configureTrustProxy } = require('../utils/clientIp');
const { authMiddleware } = require('./authMiddleware');
const ipAccessRoutes = require('../routes/ipAccess');

const AGENT = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const IP_TABLES = new Set(['user_ip_access', 'user_ip_rules', 'ip_access_logs', 'business_config']);

function buildApp() {
  const app = express();
  configureTrustProxy(app);
  app.use(express.json());
  app.use('/api/ip-access', authMiddleware, ipAccessRoutes);
  app.get('/api/work', authMiddleware, (req, res) => res.json({ ok: true, user: req.user.id }));
  // A router that mounts authMiddleware a second time -- the gate must still decide once.
  app.get('/api/double', authMiddleware, authMiddleware, (req, res) => res.json({ ok: true }));
  return app;
}

const as = (id, ip) => ({ Authorization: `Bearer at-${id}`, 'X-Forwarded-For': ip });
const seed = ({ rules = [], mode = 'restricted' } = {}) => fake.reset({
  user_company_roles: [{
    user_id: AGENT, company_id: 'co-1', is_active: true, created_at: '2026-01-01T00:00:00Z',
    custom_roles: { level: 'fronter', name: 'Fronter' }, companies: { name: 'Acme' },
  }],
  user_profiles: [{ user_id: AGENT, first_name: 'Ali', last_name: 'Agent' }, { user_id: ADMIN, first_name: 'Sam', last_name: 'Admin' }],
  user_ip_access: [{ user_id: AGENT, ip_access_mode: mode }],
  user_ip_rules: rules,
}, {
  users: [
    { id: AGENT, email: 'agent@example.com', app_metadata: {} },
    { id: ADMIN, email: 'admin@example.com', app_metadata: { role: 'superadmin' } },
  ],
});

let app;
beforeEach(() => {
  ipAccess.__test.reset();
  cache.clearAll();
  app = buildApp();
});

describe('switch OFF', () => {
  test('a restricted user with zero allow rules works normally, and the gate runs NO query', async () => {
    seed({ rules: [] });
    const r = await request(app).get('/api/work').set(as(AGENT, '198.51.100.9'));
    expect(r.status).toBe(200);
    expect(fake.calls.filter(c => IP_TABLES.has(c.table))).toEqual([]);
    expect(fake.signOuts).toEqual([]);
    expect(fake.table('ip_access_logs')).toEqual([]);
  });
});

describe('switch ON -- mid-session enforcement', () => {
  const RULE_ID = '33333333-3333-4333-8333-333333333333';
  const OFFICE_RULE = { id: RULE_ID, user_id: AGENT, type: 'allow', ip_value: '203.0.113.0/24', is_active: true };

  test('an allowed session keeps working and has its last-seen address stamped', async () => {
    seed({ rules: [OFFICE_RULE] });
    ipAccess.__test.setEnabled(true);
    const r = await request(app).get('/api/work').set(as(AGENT, '203.0.113.20'));
    expect(r.status).toBe(200);
    expect(fake.table('user_ip_access').find(a => a.user_id === AGENT)).toMatchObject({ last_seen_ip: '203.0.113.20' });
    // Per-request traffic is never written to the access log -- only denials and logins are.
    expect(fake.table('ip_access_logs')).toEqual([]);
  });

  test('moving to another network ends the session on the next request', async () => {
    seed({ rules: [OFFICE_RULE] });
    ipAccess.__test.setEnabled(true);
    expect((await request(app).get('/api/work').set(as(AGENT, '203.0.113.20'))).status).toBe(200);

    const r = await request(app).get('/api/work').set(as(AGENT, '198.51.100.9'));
    expect(r.status).toBe(403);
    expect(r.body).toEqual({
      error: 'Access from your current network (198.51.100.9) is not permitted. Contact your administrator.',
      code: 'IP_BLOCKED',
      ip: '198.51.100.9',
    });
    expect(fake.signOuts).toEqual([{ jwt: `at-${AGENT}`, scope: 'local' }]);
    expect(fake.table('ip_access_logs')).toMatchObject([
      { user_id: AGENT, ip_address: '198.51.100.9', result: 'blocked', reason: 'address not whitelisted', event: 'request', path: '/api/work' },
    ]);
  });

  test('an admin removing the rule logs the user out on their very next request', async () => {
    seed({ rules: [OFFICE_RULE] });
    ipAccess.__test.setEnabled(true);
    expect((await request(app).get('/api/work').set(as(AGENT, '203.0.113.20'))).status).toBe(200);

    // The superadmin deletes the office rule (from anywhere -- superadmin always passes).
    const del = await request(app).delete(`/api/ip-access/rules/${RULE_ID}`).set(as(ADMIN, '8.8.8.8'));
    expect(del.status).toBe(200);
    expect(fake.table('user_ip_rules')).toEqual([]);

    const r = await request(app).get('/api/work').set(as(AGENT, '203.0.113.20'));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('IP_BLOCKED');
    expect(fake.signOuts).toEqual([{ jwt: `at-${AGENT}`, scope: 'local' }]);
    expect(fake.table('ip_access_logs')[0]).toMatchObject({ result: 'blocked', reason: 'no permitted addresses configured' });
  });

  test('switching a user to restricted takes effect immediately', async () => {
    seed({ rules: [], mode: 'anywhere' });
    ipAccess.__test.setEnabled(true);
    expect((await request(app).get('/api/work').set(as(AGENT, '198.51.100.9'))).status).toBe(200);
    const put = await request(app).put(`/api/ip-access/users/${AGENT}/mode`).set(as(ADMIN, '8.8.8.8'))
      .send({ mode: 'restricted', confirm_empty: true });
    expect(put.status).toBe(200);
    expect((await request(app).get('/api/work').set(as(AGENT, '198.51.100.9'))).status).toBe(403);
  });

  test('a superadmin is never blocked mid-session', async () => {
    seed({ rules: [{ id: 'g', user_id: null, type: 'deny', ip_value: '0.0.0.0/0', is_active: true }] });
    fake.table('user_ip_access').push({ user_id: ADMIN, ip_access_mode: 'restricted' });
    ipAccess.__test.setEnabled(true);
    const r = await request(app).get('/api/work').set(as(ADMIN, '198.51.100.9'));
    expect(r.status).toBe(200);
  });

  test('a burst of blocked requests from one tab is one log row and one revoke', async () => {
    seed({ rules: [OFFICE_RULE] });
    ipAccess.__test.setEnabled(true);
    for (let i = 0; i < 4; i++) {
      expect((await request(app).get('/api/work').set(as(AGENT, '198.51.100.9'))).status).toBe(403);
    }
    expect(fake.table('ip_access_logs')).toHaveLength(1);
    expect(fake.signOuts).toHaveLength(1);
  });

  test('authMiddleware mounted twice on a route still decides once', async () => {
    seed({ rules: [OFFICE_RULE] });
    ipAccess.__test.setEnabled(true);
    const r = await request(app).get('/api/double').set(as(AGENT, '203.0.113.20'));
    expect(r.status).toBe(200);
    const snapshotLoads = fake.calls.filter(c => c.table === 'user_ip_rules' && c.op === 'select');
    expect(snapshotLoads).toHaveLength(1);
  });

  test('a spoofed X-Forwarded-For does not get a blocked user in', async () => {
    seed({ rules: [OFFICE_RULE] });
    ipAccess.__test.setEnabled(true);
    // The user claims the office address; the trusted proxy appends the real one.
    const r = await request(app).get('/api/work').set(as(AGENT, '203.0.113.20, 198.51.100.9'));
    expect(r.status).toBe(403);
    expect(r.body.ip).toBe('198.51.100.9');
  });
});
