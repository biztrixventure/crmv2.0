// ============================================================================
// ipAccess.test.js -- the IP access decision (mig 319).
//
// checkAccess() is pure, so most of the spec is tested straight against it.
// guardLogin() / evaluateAccess() run against an in-memory Supabase fake, which
// also records every query -- that is how "switch off = zero queries" is proven.
// ============================================================================
jest.mock('../config/database', () => {
  const fake = require('../testing/supabaseFake');
  return { supabaseAdmin: fake.admin, supabaseClient: fake.client };
});
jest.mock('../models/helpers', () => ({
  hasPermission: jest.fn(async () => false),
  isSuperAdmin: jest.fn(async () => false),
}));
jest.mock('./logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const fake = require('../testing/supabaseFake');
const helpers = require('../models/helpers');
const cache = require('./cache');
const ipAccess = require('./ipAccess');
const { checkAccess } = ipAccess;

const allow = (ip_value, extra = {}) => ({ type: 'allow', ip_value, is_active: true, ...extra });
const deny = (ip_value, extra = {}) => ({ type: 'deny', ip_value, is_active: true, ...extra });
const ON = { enabled: true };

describe('checkAccess -- the six steps, in order', () => {
  test('1. switch OFF: a restricted user with ZERO allow rules still gets in', () => {
    const v = checkAccess({ enabled: false, mode: 'restricted', ip: '198.51.100.9', userRules: [], globalRules: [] });
    expect(v).toMatchObject({ allowed: true, code: 'restriction_off', step: 1 });
  });

  test('1. switch OFF beats even a matching deny rule', () => {
    const v = checkAccess({ enabled: false, mode: 'restricted', ip: '198.51.100.9', userRules: [deny('198.51.100.9')] });
    expect(v.allowed).toBe(true);
  });

  test('2. superadmin bypasses everything while the switch is on', () => {
    const v = checkAccess({ ...ON, isSuperAdmin: true, mode: 'restricted', ip: '198.51.100.9', userRules: [deny('0.0.0.0/0')] });
    expect(v).toMatchObject({ allowed: true, code: 'superadmin', step: 2 });
  });

  test('2. the bypass permission bypasses everything', () => {
    const v = checkAccess({ ...ON, hasBypass: true, mode: 'restricted', ip: '198.51.100.9', userRules: [] });
    expect(v).toMatchObject({ allowed: true, code: 'bypass_permission', step: 2 });
  });

  test.each(['198.51.100.9', '8.8.8.8', '2001:db8::1', '10.0.0.1', null])(
    "3. mode 'anywhere' is allowed from any address (%p)", (ip) => {
      const v = checkAccess({ ...ON, mode: 'anywhere', ip, userRules: [deny('0.0.0.0/0')], globalRules: [deny('::/0')] });
      expect(v).toMatchObject({ allowed: true, code: 'anywhere', step: 3 });
    });

  test('4. a matching deny rule blocks -- "blocked address"', () => {
    const v = checkAccess({ ...ON, mode: 'restricted', ip: '198.51.100.9', userRules: [deny('198.51.100.0/24', { id: 'd1' })] });
    expect(v).toMatchObject({ allowed: false, code: 'blocked_address', reason: 'blocked address', step: 4, rule_id: 'd1' });
  });

  test('4. deny beats an overlapping allow', () => {
    const rules = [allow('10.0.0.0/8'), deny('10.1.2.3')];
    expect(checkAccess({ ...ON, mode: 'restricted', ip: '10.1.2.3', userRules: rules })).toMatchObject({ allowed: false, reason: 'blocked address' });
    expect(checkAccess({ ...ON, mode: 'restricted', ip: '10.1.2.4', userRules: rules })).toMatchObject({ allowed: true, code: 'whitelisted' });
  });

  test('4. a GLOBAL deny rule applies to a restricted user', () => {
    const v = checkAccess({ ...ON, mode: 'restricted', ip: '203.0.113.9', userRules: [allow('203.0.113.0/24')], globalRules: [deny('203.0.113.9')] });
    expect(v).toMatchObject({ allowed: false, reason: 'blocked address' });
  });

  test('5. a matching allow rule lets them in', () => {
    const v = checkAccess({ ...ON, mode: 'restricted', ip: '203.0.113.77', userRules: [allow('203.0.113.0/24', { id: 'a1' })] });
    expect(v).toMatchObject({ allowed: true, code: 'whitelisted', step: 5, rule_id: 'a1' });
  });

  test('5. a non-matching address is refused -- "address not whitelisted"', () => {
    const v = checkAccess({ ...ON, mode: 'restricted', ip: '198.51.100.9', userRules: [allow('203.0.113.0/24')] });
    expect(v).toMatchObject({ allowed: false, code: 'not_whitelisted', reason: 'address not whitelisted', step: 5 });
  });

  test('5. a GLOBAL allow rule counts (office-wide allowlist)', () => {
    const v = checkAccess({ ...ON, mode: 'restricted', ip: '203.0.113.5', userRules: [], globalRules: [allow('203.0.113.0/24')] });
    expect(v).toMatchObject({ allowed: true, code: 'whitelisted' });
  });

  test('6. restricted with no allow rules at all -- "no permitted addresses configured"', () => {
    const v = checkAccess({ ...ON, mode: 'restricted', ip: '203.0.113.5', userRules: [deny('198.51.100.1')], globalRules: [] });
    expect(v).toMatchObject({ allowed: false, code: 'no_allow_rules', reason: 'no permitted addresses configured', step: 6 });
  });

  test('inactive rules are ignored (an inactive allow does not count, an inactive deny does not block)', () => {
    const rules = [allow('203.0.113.0/24', { is_active: false })];
    expect(checkAccess({ ...ON, mode: 'restricted', ip: '203.0.113.5', userRules: rules })).toMatchObject({ allowed: false, step: 6 });
    const rules2 = [allow('203.0.113.0/24'), deny('203.0.113.5', { is_active: false })];
    expect(checkAccess({ ...ON, mode: 'restricted', ip: '203.0.113.5', userRules: rules2 })).toMatchObject({ allowed: true });
  });

  test('an unknown address is never whitelisted for a restricted user', () => {
    expect(checkAccess({ ...ON, mode: 'restricted', ip: null, userRules: [allow('0.0.0.0/0')] })).toMatchObject({ allowed: false, step: 5 });
  });
});

describe('checkAccess -- CIDR matching end to end', () => {
  test('IPv4 CIDR', () => {
    const rules = [allow('192.0.2.0/25')];
    expect(checkAccess({ ...ON, mode: 'restricted', ip: '192.0.2.127', userRules: rules }).allowed).toBe(true);
    expect(checkAccess({ ...ON, mode: 'restricted', ip: '192.0.2.128', userRules: rules }).allowed).toBe(false);
  });

  test('IPv6 CIDR', () => {
    const rules = [allow('2001:db8:abcd::/48')];
    expect(checkAccess({ ...ON, mode: 'restricted', ip: '2001:db8:abcd:12::1', userRules: rules }).allowed).toBe(true);
    expect(checkAccess({ ...ON, mode: 'restricted', ip: '2001:db8:abce::1', userRules: rules }).allowed).toBe(false);
  });

  test('an IPv4 client never matches an IPv6 rule, and vice versa', () => {
    expect(checkAccess({ ...ON, mode: 'restricted', ip: '203.0.113.5', userRules: [allow('::/0')] }).allowed).toBe(false);
    expect(checkAccess({ ...ON, mode: 'restricted', ip: '2001:db8::5', userRules: [allow('0.0.0.0/0')] }).allowed).toBe(false);
  });

  test('stored cidr text (/32) from Postgres matches', () => {
    expect(checkAccess({ ...ON, mode: 'restricted', ip: '203.0.113.44', userRules: [allow('203.0.113.44/32')] }).allowed).toBe(true);
  });
});

// -- With the policy looked up ----------------------------------------------------------
const U = { id: '11111111-1111-4111-8111-111111111111', email: 'agent@example.com', app_metadata: {} };
const SA = { id: '22222222-2222-4222-8222-222222222222', email: 'boss@example.com', app_metadata: { role: 'superadmin' } };
const req = (ip) => ({
  headers: { 'user-agent': 'jest' }, originalUrl: '/api/auth/login',
  socket: { remoteAddress: ip }, app: { get: () => () => false },
});

beforeEach(() => {
  ipAccess.__test.reset();
  cache.clearAll();
  helpers.hasPermission.mockReset().mockResolvedValue(false);
  helpers.isSuperAdmin.mockReset().mockResolvedValue(false);
  fake.reset({
    user_ip_access: [{ user_id: U.id, ip_access_mode: 'restricted' }],
    user_ip_rules: [{ id: 'r1', user_id: U.id, type: 'allow', ip_value: '203.0.113.0/24', is_active: true }],
  });
});

describe('guardLogin / evaluateAccess', () => {
  test('switch OFF: nothing is checked and NO query runs', async () => {
    const out = await ipAccess.guardLogin(req('198.51.100.9'), { user: U, session: { access_token: 'tok' } });
    expect(out).toBeNull();
    expect(fake.calls).toHaveLength(0);
    expect(fake.signOuts).toHaveLength(0);
  });

  test('switch OFF: a restricted user with zero rules is allowed', async () => {
    fake.reset({ user_ip_access: [{ user_id: U.id, ip_access_mode: 'restricted' }], user_ip_rules: [] });
    const v = await ipAccess.evaluateAccess({ userId: U.id }, '198.51.100.9');
    expect(v.allowed).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });

  test('switch ON, restricted, outside address: denied at login, session revoked, attempt logged', async () => {
    ipAccess.__test.setEnabled(true);
    const out = await ipAccess.guardLogin(req('198.51.100.9'), { user: U, session: { access_token: 'tok-1' } });
    expect(out.status).toBe(403);
    expect(out.body).toMatchObject({ code: 'IP_BLOCKED', ip: '198.51.100.9' });
    expect(out.body.error).toBe('Access from your current network (198.51.100.9) is not permitted. Contact your administrator.');
    expect(fake.signOuts).toEqual([{ jwt: 'tok-1', scope: 'local' }]);
    const logs = fake.table('ip_access_logs');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ user_id: U.id, ip_address: '198.51.100.9', result: 'blocked', reason: 'address not whitelisted', event: 'login' });
  });

  test('switch ON, restricted, allowed address: allowed, "allowed" row + last login stamped', async () => {
    ipAccess.__test.setEnabled(true);
    const out = await ipAccess.guardLogin(req('203.0.113.20'), { user: U, session: { access_token: 'tok' } });
    expect(out).toBeNull();
    expect(fake.signOuts).toHaveLength(0);
    expect(fake.table('ip_access_logs')[0]).toMatchObject({ result: 'allowed', event: 'login', ip_address: '203.0.113.20' });
    expect(fake.table('user_ip_access')[0]).toMatchObject({ user_id: U.id, last_login_ip: '203.0.113.20', last_seen_ip: '203.0.113.20' });
  });

  test("switch ON, 'anywhere' user: allowed from anywhere", async () => {
    ipAccess.__test.setEnabled(true);
    fake.reset({ user_ip_access: [], user_ip_rules: [] });
    for (const ip of ['198.51.100.9', '2001:db8::99', '8.8.4.4']) {
      expect((await ipAccess.evaluateAccess({ userId: U.id }, ip)).allowed).toBe(true);
    }
  });

  test('switch ON: superadmin bypass works at login from any address', async () => {
    ipAccess.__test.setEnabled(true);
    fake.reset({
      user_ip_access: [{ user_id: SA.id, ip_access_mode: 'restricted' }],
      user_ip_rules: [{ id: 'd', user_id: SA.id, type: 'deny', ip_value: '0.0.0.0/0', is_active: true }],
    });
    expect(await ipAccess.guardLogin(req('198.51.100.9'), { user: SA, session: { access_token: 't' } })).toBeNull();
    expect(fake.signOuts).toHaveLength(0);
  });

  test('switch ON: a refresh from a blocked network is refused too (but not logged as a login)', async () => {
    ipAccess.__test.setEnabled(true);
    const out = await ipAccess.guardLogin(req('198.51.100.9'), { user: U, session: { access_token: 't' }, event: 'refresh' });
    expect(out.status).toBe(403);
    expect(fake.table('ip_access_logs')[0]).toMatchObject({ result: 'blocked', event: 'refresh' });
  });

  test('switch ON: the bypass permission is honoured for a restricted user', async () => {
    ipAccess.__test.setEnabled(true);
    helpers.hasPermission.mockResolvedValue(true);
    const v = await ipAccess.evaluateAccess({ userId: U.id, companyId: 'co-1' }, '198.51.100.9');
    expect(v).toMatchObject({ allowed: true, code: 'bypass_permission' });
    expect(helpers.hasPermission).toHaveBeenCalledWith(U.id, 'co-1', 'ip_access.bypass');
  });

  test('forceEnabled answers "would this pass if it were on?" without turning anything on', async () => {
    const v = await ipAccess.evaluateAccess({ userId: U.id }, '198.51.100.9', { forceEnabled: true });
    expect(v.allowed).toBe(false);
    expect(ipAccess.isEnabled()).toBe(false);
  });

  test('a failing policy load fails OPEN (a database blip must not lock everyone out)', async () => {
    ipAccess.__test.setEnabled(true);
    const spy = jest.spyOn(fake.admin, 'from').mockImplementation(() => { throw new Error('db down'); });
    try {
      expect(await ipAccess.guardLogin(req('198.51.100.9'), { user: U, session: {} })).toBeNull();
    } finally { spy.mockRestore(); }
  });

  test('invalidatePolicies makes a rule change bite on the very next check', async () => {
    ipAccess.__test.setEnabled(true);
    expect((await ipAccess.evaluateAccess({ userId: U.id }, '203.0.113.20')).allowed).toBe(true);
    fake.reset({ user_ip_access: [{ user_id: U.id, ip_access_mode: 'restricted' }], user_ip_rules: [] });
    // cached snapshot still allows...
    expect((await ipAccess.evaluateAccess({ userId: U.id }, '203.0.113.20')).allowed).toBe(true);
    ipAccess.invalidatePolicies();
    expect((await ipAccess.evaluateAccess({ userId: U.id }, '203.0.113.20'))).toMatchObject({ allowed: false, step: 6 });
  });
});

describe('the master switch', () => {
  test('IP_RESTRICTION_FORCE_OFF overrides a database value of ON', async () => {
    fake.reset({ business_config: [{ scope: 'global', key: 'security.ip_restriction.enabled', value: true }] });
    process.env.IP_RESTRICTION_FORCE_OFF = 'true';
    try {
      const s = await ipAccess.refreshSettings();
      expect(s).toMatchObject({ enabled: true, effective_enabled: false, force_off: true });
      expect(ipAccess.isEnabled()).toBe(false);
    } finally { delete process.env.IP_RESTRICTION_FORCE_OFF; }
    await ipAccess.refreshSettings();
    expect(ipAccess.isEnabled()).toBe(true);
  });

  test('a failed refresh keeps the last known state', async () => {
    ipAccess.__test.setEnabled(true);
    const spy = jest.spyOn(fake.admin, 'from').mockImplementation(() => { throw new Error('db down'); });
    try {
      await ipAccess.refreshSettings();
      expect(ipAccess.isEnabled()).toBe(true);
    } finally { spy.mockRestore(); }
  });

  test('retention defaults to 90 days and is range-checked', async () => {
    fake.reset({ business_config: [{ scope: 'global', key: 'security.ip_restriction.log_retention_days', value: 99999 }] });
    expect((await ipAccess.refreshSettings()).log_retention_days).toBe(90);
    fake.reset({ business_config: [{ scope: 'global', key: 'security.ip_restriction.log_retention_days', value: 30 }] });
    expect((await ipAccess.refreshSettings()).log_retention_days).toBe(30);
  });

  test('pruneLogs removes rows older than the retention window only', async () => {
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
    const fresh = new Date().toISOString();
    fake.reset({ ip_access_logs: [{ id: 1, created_at: old }, { id: 2, created_at: fresh }] });
    await ipAccess.refreshSettings();   // retention back to the default 90
    expect(await ipAccess.pruneLogs()).toBe(1);
    expect(fake.table('ip_access_logs').map(r => r.id)).toEqual([2]);
  });
});
