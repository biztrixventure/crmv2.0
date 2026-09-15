// ============================================================================
// ipAccess.test.js (routes) -- the /api/ip-access admin API (mig 319):
// who may reach it, and the lockout-safety confirmations it enforces
// server-side. Also: the master switch is invisible through /business-config.
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
const mockPerms = new Map();   // `${userId}|${perm}` -> true
jest.mock('../models/helpers', () => ({
  hasPermission: jest.fn(async (uid, _co, perm) => mockPerms.has(`${uid}|${perm}`)),
  isSuperAdmin: jest.fn(async (id) => id === '22222222-2222-4222-8222-222222222222'),
  resolveScopedCompanyId: jest.fn(async () => null),
}));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const express = require('express');
const request = require('supertest');
const fake = require('../testing/supabaseFake');
const cache = require('../utils/cache');
const { clearConfigCache } = require('../utils/businessConfig');
const ipAccess = require('../utils/ipAccess');
const { configureTrustProxy } = require('../utils/clientIp');
const { authMiddleware } = require('../middleware/authMiddleware');
const { errorHandler } = require('../middleware/errorHandler');
const ipAccessRoutes = require('./ipAccess');
const businessConfigRoutes = require('./businessConfig');

const AGENT = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const MANAGER = '44444444-4444-4444-8444-444444444444';
const MGR_RULE = '55555555-5555-4555-8555-555555555555';

function buildApp() {
  const app = express();
  configureTrustProxy(app);
  app.use(express.json());
  app.use('/api/ip-access', authMiddleware, ipAccessRoutes);
  app.use('/api/business-config', authMiddleware, businessConfigRoutes);
  app.use(errorHandler);
  return app;
}

const as = (id, ip = '203.0.113.9') => ({ Authorization: `Bearer at-${id}`, 'X-Forwarded-For': ip });
const role = (user_id, level, company_id = 'co-1') => ({
  user_id, company_id, is_active: true, created_at: '2026-01-01T00:00:00Z',
  custom_roles: { level, name: level }, companies: { name: 'Acme' },
});

let app;
beforeEach(() => {
  ipAccess.__test.reset();
  cache.clearAll();
  clearConfigCache();
  mockPerms.clear();
  mockPerms.set(`${MANAGER}|ip_access.manage`, true);
  fake.reset({
    user_company_roles: [role(AGENT, 'fronter'), role(MANAGER, 'company_admin')],
    user_profiles: [
      { user_id: AGENT, first_name: 'Ali', last_name: 'Agent' },
      { user_id: MANAGER, first_name: 'Mona', last_name: 'Manager' },
      { user_id: ADMIN, first_name: 'Sam', last_name: 'Admin' },
    ],
    user_ip_access: [],
    user_ip_rules: [],
    ip_access_logs: [],
    business_config: [
      { scope: 'global', key: 'security.ip_restriction.enabled', value: false },
      { scope: 'global', key: 'security.ip_restriction.log_retention_days', value: 90 },
      { scope: 'global', key: 'kpi.today_timezone', value: 'America/New_York' },
    ],
  }, {
    users: [
      { id: AGENT, email: 'agent@example.com', app_metadata: {} },
      { id: MANAGER, email: 'manager@example.com', app_metadata: {} },
      { id: ADMIN, email: 'admin@example.com', app_metadata: { role: 'superadmin' } },
    ],
  });
  app = buildApp();
});

describe('who may reach it', () => {
  test('a regular user gets a plain 404 -- the endpoints do not reveal themselves', async () => {
    const r = await request(app).get('/api/ip-access/settings').set(as(AGENT));
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('Route not found');
  });

  test('superadmin and an ip_access.manage holder get in', async () => {
    expect((await request(app).get('/api/ip-access/settings').set(as(ADMIN))).status).toBe(200);
    expect((await request(app).get('/api/ip-access/settings').set(as(MANAGER))).status).toBe(200);
  });

  test('whoami reports the address the server sees', async () => {
    const r = await request(app).get('/api/ip-access/whoami').set(as(ADMIN, '198.51.100.44'));
    expect(r.body).toMatchObject({ ip: '198.51.100.44', peer_trusted: true, would_pass: true });
  });
});

describe('the master switch', () => {
  test('turning it on needs an explicit confirmation that names your address', async () => {
    const first = await request(app).put('/api/ip-access/settings').set(as(ADMIN, '198.51.100.44')).send({ enabled: true });
    expect(first.status).toBe(409);
    expect(first.body).toMatchObject({ needs_confirm: 'enable', detected_ip: '198.51.100.44', would_pass: true });
    expect(ipAccess.isEnabled()).toBe(false);

    const ok = await request(app).put('/api/ip-access/settings').set(as(ADMIN, '198.51.100.44')).send({ enabled: true, confirm: true });
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ enabled: true, effective_enabled: true });
    expect(ipAccess.isEnabled()).toBe(true);
    expect(fake.table('business_config').find(r => r.key === 'security.ip_restriction.enabled').value).toBe(true);
  });

  test('turning it off needs no confirmation', async () => {
    ipAccess.__test.setEnabled(true);
    const r = await request(app).put('/api/ip-access/settings').set(as(ADMIN)).send({ enabled: false });
    expect(r.status).toBe(200);
    expect(ipAccess.isEnabled()).toBe(false);
  });

  test('a delegated manager who would lock THEMSELVES out must acknowledge it', async () => {
    fake.table('user_ip_access').push({ user_id: MANAGER, ip_access_mode: 'restricted' });   // no allow rules
    const r = await request(app).put('/api/ip-access/settings').set(as(MANAGER)).send({ enabled: true, confirm: true });
    expect(r.status).toBe(409);
    expect(r.body.needs_confirm).toBe('self_lockout');
    const ok = await request(app).put('/api/ip-access/settings').set(as(MANAGER))
      .send({ enabled: true, confirm: true, acknowledge_self_lockout: true });
    expect(ok.status).toBe(200);
  });

  test('retention is range-checked', async () => {
    expect((await request(app).put('/api/ip-access/settings').set(as(ADMIN)).send({ log_retention_days: 0 })).status).toBe(400);
    const r = await request(app).put('/api/ip-access/settings').set(as(ADMIN)).send({ log_retention_days: 30 });
    expect(r.status).toBe(200);
    expect(r.body.settings.log_retention_days).toBe(30);
  });

  test('GET /business-config (open to every signed-in user) never shows security.* keys', async () => {
    const r = await request(app).get('/api/business-config').set(as(AGENT));
    expect(r.status).toBe(200);
    expect(r.body.config['kpi.today_timezone']).toBe('America/New_York');
    expect(Object.keys(r.body.config).filter(k => k.startsWith('security.'))).toEqual([]);
  });

  test('security.* cannot be written through /business-config -- not even by a superadmin', async () => {
    const r = await request(app).put('/api/business-config').set(as(ADMIN))
      .send({ scope: 'global', key: 'security.ip_restriction.enabled', value: true });
    expect(r.status).toBe(403);
    expect(fake.table('business_config').find(x => x.key === 'security.ip_restriction.enabled').value).toBe(false);
  });
});

describe('access mode', () => {
  test('restricting someone with an empty allowlist is refused until confirmed', async () => {
    const r = await request(app).put(`/api/ip-access/users/${AGENT}/mode`).set(as(ADMIN)).send({ mode: 'restricted' });
    expect(r.status).toBe(409);
    expect(r.body.needs_confirm).toBe('empty_allowlist');
    expect(fake.table('user_ip_access')).toEqual([]);

    const ok = await request(app).put(`/api/ip-access/users/${AGENT}/mode`).set(as(ADMIN)).send({ mode: 'restricted', confirm_empty: true });
    expect(ok.status).toBe(200);
    expect(fake.table('user_ip_access')[0]).toMatchObject({ user_id: AGENT, ip_access_mode: 'restricted', mode_changed_by: ADMIN });
  });

  test('a global allow rule means the list is not empty', async () => {
    fake.table('user_ip_rules').push({ id: 'g1', user_id: null, type: 'allow', ip_value: '203.0.113.0/24', is_active: true });
    const r = await request(app).put(`/api/ip-access/users/${AGENT}/mode`).set(as(ADMIN)).send({ mode: 'restricted' });
    expect(r.status).toBe(200);
  });

  test('back to anywhere is always allowed', async () => {
    fake.table('user_ip_access').push({ user_id: AGENT, ip_access_mode: 'restricted' });
    const r = await request(app).put(`/api/ip-access/users/${AGENT}/mode`).set(as(ADMIN)).send({ mode: 'anywhere' });
    expect(r.status).toBe(200);
    expect(fake.table('user_ip_access')[0].ip_access_mode).toBe('anywhere');
  });

  test('bad input is a 400', async () => {
    expect((await request(app).put(`/api/ip-access/users/${AGENT}/mode`).set(as(ADMIN)).send({ mode: 'sometimes' })).status).toBe(400);
    expect((await request(app).put('/api/ip-access/users/not-a-uuid/mode').set(as(ADMIN)).send({ mode: 'anywhere' })).status).toBe(400);
  });
});

describe('rules', () => {
  test('malformed addresses are rejected with a readable message', async () => {
    const r = await request(app).post('/api/ip-access/rules').set(as(ADMIN)).send({ user_id: AGENT, type: 'allow', ip_value: '300.1.1.1' });
    expect(r.status).toBe(400);
    expect(r.body.field).toBe('ip_value');
    expect(fake.table('user_ip_rules')).toEqual([]);
  });

  test('input is normalised before it is stored', async () => {
    const r = await request(app).post('/api/ip-access/rules').set(as(ADMIN))
      .send({ user_id: AGENT, type: 'allow', ip_value: ' 203.0.113.44/24 ', label: 'Head office' });
    expect(r.status).toBe(201);
    expect(r.body.rule).toMatchObject({ ip_value: '203.0.113.0/24', type: 'allow', label: 'Head office', scope: 'user' });
    expect(r.body.note).toMatch(/Stored as 203\.0\.113\.0\/24/);
    expect(fake.table('user_ip_rules')[0]).toMatchObject({ ip_value: '203.0.113.0/24', created_by: ADMIN });
  });

  test('IPv6 rules are normalised too', async () => {
    const r = await request(app).post('/api/ip-access/rules').set(as(ADMIN)).send({ user_id: null, type: 'deny', ip_value: '2001:0DB8::0/32' });
    expect(r.status).toBe(201);
    expect(r.body.rule).toMatchObject({ ip_value: '2001:db8::/32', scope: 'global' });
  });

  test('a duplicate rule is a 409', async () => {
    const body = { user_id: AGENT, type: 'allow', ip_value: '203.0.113.7' };
    expect((await request(app).post('/api/ip-access/rules').set(as(ADMIN)).send(body)).status).toBe(201);
    expect((await request(app).post('/api/ip-access/rules').set(as(ADMIN)).send(body)).status).toBe(409);
  });

  test('a rule that would block YOUR current address needs an "I understand"', async () => {
    // The manager is restricted to the office and is sitting in it.
    fake.table('user_ip_access').push({ user_id: MANAGER, ip_access_mode: 'restricted' });
    fake.table('user_ip_rules').push({ id: MGR_RULE, user_id: MANAGER, type: 'allow', ip_value: '203.0.113.0/24', is_active: true });

    // A global deny covering where they sit.
    const deny = await request(app).post('/api/ip-access/rules').set(as(MANAGER, '203.0.113.9'))
      .send({ user_id: null, type: 'deny', ip_value: '203.0.113.9' });
    expect(deny.status).toBe(409);
    expect(deny.body).toMatchObject({ needs_confirm: 'self_lockout', ip: '203.0.113.9' });

    // Deleting their own only allow rule.
    const del = await request(app).delete(`/api/ip-access/rules/${MGR_RULE}`).set(as(MANAGER, '203.0.113.9'));
    expect(del.status).toBe(409);
    expect(fake.table('user_ip_rules')).toHaveLength(1);

    const ack = await request(app).delete(`/api/ip-access/rules/${MGR_RULE}?acknowledge_self_lockout=true`).set(as(MANAGER, '203.0.113.9'));
    expect(ack.status).toBe(200);
    expect(fake.table('user_ip_rules')).toHaveLength(0);
  });

  test('GET /rules lists global rules, active and inactive, in display form', async () => {
    fake.table('user_ip_rules').push(
      { id: 'g1', user_id: null, type: 'allow', ip_value: '203.0.113.0/24', is_active: true },
      { id: 'g2', user_id: null, type: 'deny', ip_value: '198.51.100.7/32', is_active: false },
      { id: 'u1', user_id: AGENT, type: 'allow', ip_value: '10.0.0.1/32', is_active: true },
    );
    const r = await request(app).get('/api/ip-access/rules?scope=global').set(as(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.rules.map(x => [x.ip_value, x.is_active, x.scope])).toEqual([
      ['203.0.113.0/24', true, 'global'], ['198.51.100.7', false, 'global'],
    ]);
    const mine = await request(app).get(`/api/ip-access/rules?user_id=${AGENT}`).set(as(ADMIN));
    expect(mine.body.rules.map(x => x.ip_value)).toEqual(['10.0.0.1']);
  });

  test('a rule for someone ELSE never triggers the self-lockout check', async () => {
    fake.table('user_ip_access').push({ user_id: MANAGER, ip_access_mode: 'restricted' });
    const r = await request(app).post('/api/ip-access/rules').set(as(MANAGER, '203.0.113.9'))
      .send({ user_id: AGENT, type: 'deny', ip_value: '203.0.113.9' });
    expect(r.status).toBe(201);
  });
});

describe('"Add current IP"', () => {
  test('turns the address the user last connected from into an allow rule, once', async () => {
    fake.table('user_ip_access').push({ user_id: AGENT, ip_access_mode: 'restricted', last_seen_ip: '198.51.100.23', last_seen_at: '2026-09-14T09:00:00Z' });
    const r = await request(app).post(`/api/ip-access/users/${AGENT}/rules/from-current`).set(as(ADMIN)).send({});
    expect(r.status).toBe(201);
    expect(r.body.rule).toMatchObject({ type: 'allow', ip_value: '198.51.100.23', label: 'Last seen 2026-09-14' });
    const again = await request(app).post(`/api/ip-access/users/${AGENT}/rules/from-current`).set(as(ADMIN)).send({});
    expect(again.status).toBe(200);
    expect(again.body.existed).toBe(true);
    expect(fake.table('user_ip_rules')).toHaveLength(1);
  });

  test('explains itself when no address has been recorded yet', async () => {
    const r = await request(app).post(`/api/ip-access/users/${AGENT}/rules/from-current`).set(as(ADMIN)).send({});
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/No address has been recorded/);
  });

  test('your own current address, for your own record only', async () => {
    const mine = await request(app).post(`/api/ip-access/users/${MANAGER}/rules/from-current`).set(as(MANAGER, '198.51.100.61')).send({ source: 'request' });
    expect(mine.status).toBe(201);
    expect(mine.body.rule.ip_value).toBe('198.51.100.61');
    const theirs = await request(app).post(`/api/ip-access/users/${AGENT}/rules/from-current`).set(as(MANAGER, '198.51.100.61')).send({ source: 'request' });
    expect(theirs.status).toBe(400);
  });
});

describe('users list + access log', () => {
  test('the list shows mode, last seen and a would-pass indicator', async () => {
    fake.table('user_ip_access').push({ user_id: AGENT, ip_access_mode: 'restricted', last_seen_ip: '198.51.100.9' });
    fake.table('user_ip_rules').push({ id: 'a', user_id: AGENT, type: 'allow', ip_value: '203.0.113.0/24', is_active: true });
    const r = await request(app).get('/api/ip-access/users').set(as(ADMIN));
    expect(r.status).toBe(200);
    const agent = r.body.users.find(u => u.user_id === AGENT);
    expect(agent).toMatchObject({ ip_access_mode: 'restricted', last_seen_ip: '198.51.100.9', would_pass: false, warning: null });
    const admin = r.body.users.find(u => u.user_id === ADMIN);
    expect(admin).toMatchObject({ is_superadmin: true, would_pass: true, ip_access_mode: 'anywhere' });
  });

  test('a restricted user with nothing allowed carries a warning', async () => {
    fake.table('user_ip_access').push({ user_id: AGENT, ip_access_mode: 'restricted' });
    const r = await request(app).get('/api/ip-access/users').set(as(ADMIN));
    expect(r.body.users.find(u => u.user_id === AGENT).warning).toBe('no_allow_rules');
  });

  test('logs filter by result, newest first', async () => {
    fake.table('ip_access_logs').push(
      { id: 1, user_id: AGENT, ip_address: '198.51.100.9', result: 'blocked', event: 'login', created_at: '2026-09-10T10:00:00Z' },
      { id: 2, user_id: AGENT, ip_address: '203.0.113.9', result: 'allowed', event: 'login', created_at: '2026-09-11T10:00:00Z' },
      { id: 3, user_id: AGENT, ip_address: '198.51.100.10', result: 'blocked', event: 'request', created_at: '2026-09-12T10:00:00Z' },
    );
    const r = await request(app).get('/api/ip-access/logs?result=blocked').set(as(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.logs.map(l => l.id)).toEqual([3, 1]);
    expect(r.body.logs[0]).toMatchObject({ user_name: 'Ali Agent', user_email: 'agent@example.com' });
    const byIp = await request(app).get('/api/ip-access/logs?ip=198.51.100.9').set(as(ADMIN));
    expect(byIp.body.logs.map(l => l.id)).toEqual([1]);
    const range = await request(app).get('/api/ip-access/logs?from=2026-09-11T00:00:00Z&to=2026-09-11T23:59:59Z').set(as(ADMIN));
    expect(range.body.logs.map(l => l.id)).toEqual([2]);
  });
});
