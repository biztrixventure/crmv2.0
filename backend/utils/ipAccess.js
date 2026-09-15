// ============================================================================
// utils/ipAccess.js -- IP access control (mig 319): who may use the CRM from
// which networks.
//
// ONE decision function, checkAccess(), pure and synchronous, applying the
// rules in this exact order:
//   1. master switch OFF                        -> ALLOW
//   2. superadmin, or holds ip_access.bypass    -> ALLOW
//   3. user's mode is 'anywhere'                -> ALLOW
//   4. IP matches an ACTIVE deny rule (theirs or global) -> DENY "blocked address"
//   5. there is at least one ACTIVE allow rule (theirs or global):
//        IP matches one -> ALLOW, otherwise     -> DENY "address not whitelisted"
//   6. no allow rules at all                    -> DENY "no permitted addresses configured"
// Deny always beats allow. A global rule (user_id NULL) applies to every
// restricted user, so an office-wide allow rule is enough to restrict someone
// to the office.
//
// DORMANT IS FREE. The master switch lives in memory: loaded at boot, refreshed
// by the scheduler every 60s (so the break-glass CLI works without a restart),
// and updated the instant an admin flips it. isEnabled() is a property read;
// with the switch OFF the request path touches nothing -- no query, no log, no
// last-seen stamp. IP_RESTRICTION_FORCE_OFF=true in the environment overrides
// the database entirely.
//
// ON, every request reads one shared in-memory snapshot of the policy (the
// restricted users + every active rule) -- two queries per 30s for the whole
// app, not per user. Any admin write drops it, so a removed rule bites on the
// very next request.
//
// Failures FAIL OPEN with a warning, like the rest of the auth path: a
// Supabase blip must not log the whole floor out.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const cache = require('./cache');
const logger = require('./logger');
const { parseIp, parseRule } = require('./ipAddress');
const { resolveClientIp } = require('./clientIp');
const { hasPermission, isSuperAdmin } = require('../models/helpers');

const KEYS = {
  enabled:   'security.ip_restriction.enabled',
  retention: 'security.ip_restriction.log_retention_days',
};
const DEFAULT_RETENTION_DAYS = 90;
const POLICY_TTL_MS = 30_000;
const SEEN_SAME_IP_MS = 5 * 60_000;   // last-seen stamp at most every 5 min per user...
const SEEN_FLOOR_MS = 60_000;         // ...and never more than once a minute, even on an IP change
const BLOCK_BURST_MS = 10_000;        // one tab's parallel polls = one log row, one revoke
const BYPASS_PERMISSION = 'ip_access.bypass';
const MANAGE_PERMISSION = 'ip_access.manage';

const blockedMessage = (ip) =>
  `Access from your current network (${ip || 'unknown address'}) is not permitted. Contact your administrator.`;

const forceOff = () => String(process.env.IP_RESTRICTION_FORCE_OFF || '').trim().toLowerCase() === 'true';

// -- The switch ---------------------------------------------------------------------
const state = { dbEnabled: false, enabled: false, retentionDays: DEFAULT_RETENTION_DAYS, loadedAt: 0 };

// THE hot-path read. Everything that enforces starts here.
function isEnabled() { return state.enabled; }

function applySettings(map) {
  const was = state.enabled;
  const v = map[KEYS.enabled];
  state.dbEnabled = v === true || v === 'true';
  const days = Number(map[KEYS.retention]);
  state.retentionDays = Number.isInteger(days) && days >= 1 && days <= 3650 ? days : DEFAULT_RETENTION_DAYS;
  state.enabled = state.dbEnabled && !forceOff();
  state.loadedAt = Date.now();
  if (was !== state.enabled) {
    logger.info('IP_ACCESS', `IP restriction is now ${state.enabled ? 'ON' : 'OFF'}${forceOff() ? ' (IP_RESTRICTION_FORCE_OFF)' : ''}`);
    invalidatePolicies();
    _seen.clear();
    _recentBlocks.clear();
  }
}

async function refreshSettings() {
  try {
    const { data, error } = await supabaseAdmin
      .from('business_config')
      .select('key, value')
      .eq('scope', 'global')
      .in('key', [KEYS.enabled, KEYS.retention]);
    if (error) throw new Error(error.message);
    applySettings(Object.fromEntries((data || []).map(r => [r.key, r.value])));
  } catch (e) {
    logger.warn('IP_ACCESS', `settings refresh failed, keeping enabled=${state.enabled}: ${e.message}`);
  }
  return getSettings();
}

function getSettings() {
  return {
    enabled: state.dbEnabled,
    effective_enabled: state.enabled,
    force_off: forceOff(),
    log_retention_days: state.retentionDays,
    loaded_at: state.loadedAt ? new Date(state.loadedAt).toISOString() : null,
  };
}

// Admin writes go through the normal business_config writer (its cache is
// cleared there), then the in-memory switch is re-read at once.
async function saveSettings({ enabled, retentionDays }, actorId) {
  const { setConfig } = require('./businessConfig');
  if (enabled !== undefined) await setConfig('global', KEYS.enabled, !!enabled, actorId || null);
  if (retentionDays !== undefined) await setConfig('global', KEYS.retention, retentionDays, actorId || null);
  return refreshSettings();
}

// -- Rules -------------------------------------------------------------------------------
// A DB row -> the shape checkAccess matches against. `match` holds BigInts and
// must never be sent to a client (JSON cannot carry a BigInt).
function compileRule(row) {
  if (!row) return null;
  const match = row.match || parseRule(String(row.ip_value ?? ''));
  if (!match) {
    logger.warn('IP_ACCESS', `ignoring unparsable rule ${row.id || ''} (${row.ip_value})`);
    return null;
  }
  return {
    id: row.id || null,
    user_id: row.user_id || null,
    type: row.type,
    is_active: row.is_active !== false,
    label: row.label || null,
    ip_value: match.text,
    match,
  };
}

const ALLOW = (code, reason, step, extra) => ({ allowed: true, code, reason, step, ...extra });
const DENY  = (code, reason, step, extra) => ({ allowed: false, code, reason, step, ...extra });

// The decision. Pure: same input, same answer, no I/O. `ip` may be text or
// parsed; rules may be DB rows or compiled rules.
function checkAccess({
  enabled = false, isSuperAdmin: superadmin = false, hasBypass = false,
  mode = 'anywhere', ip = null, userRules = [], globalRules = [],
} = {}) {
  if (!enabled) return ALLOW('restriction_off', 'IP restriction is off', 1);
  if (superadmin) return ALLOW('superadmin', 'superadmin always allowed', 2);
  if (hasBypass) return ALLOW('bypass_permission', 'has the IP bypass permission', 2);
  if (mode !== 'restricted') return ALLOW('anywhere', 'allowed from anywhere', 3);

  const addr = typeof ip === 'string' ? parseIp(ip) : ip;
  const active = [...userRules, ...globalRules].map(compileRule).filter(r => r && r.is_active);
  const hits = (r) => !!addr && addr.version === r.match.version && inRange(addr, r.match);

  const deny = active.find(r => r.type === 'deny' && hits(r));
  if (deny) return DENY('blocked_address', 'blocked address', 4, { rule_id: deny.id });

  const allows = active.filter(r => r.type === 'allow');
  if (allows.length) {
    const allow = allows.find(hits);
    if (allow) return ALLOW('whitelisted', 'matches an allow rule', 5, { rule_id: allow.id });
    return DENY('not_whitelisted', 'address not whitelisted', 5);
  }
  return DENY('no_allow_rules', 'no permitted addresses configured', 6);
}

// (value & mask) === network, with the mask built from the prefix.
function inRange(addr, match) {
  const bits = match.version === 4 ? 32 : 128;
  if (match.prefix === 0) return true;
  const shift = BigInt(bits - match.prefix);
  return (addr.value >> shift) === (match.network >> shift);
}

// -- Policy snapshot (restricted users + every active rule) ------------------------------
let _snap = null;
let _snapAt = 0;
let _snapInflight = null;
let _snapGen = 0;

async function loadSnapshot() {
  const gen = _snapGen;
  const [acc, rules] = await Promise.all([
    supabaseAdmin.from('user_ip_access').select('user_id').eq('ip_access_mode', 'restricted'),
    supabaseAdmin.from('user_ip_rules').select('id, user_id, type, ip_value, label, is_active').eq('is_active', true),
  ]);
  if (acc.error) throw new Error(`user_ip_access: ${acc.error.message}`);
  if (rules.error) throw new Error(`user_ip_rules: ${rules.error.message}`);
  const snap = { restricted: new Set((acc.data || []).map(r => r.user_id)), rulesByUser: new Map(), globalRules: [] };
  for (const row of rules.data || []) {
    const r = compileRule(row);
    if (!r) continue;
    if (r.user_id) {
      if (!snap.rulesByUser.has(r.user_id)) snap.rulesByUser.set(r.user_id, []);
      snap.rulesByUser.get(r.user_id).push(r);
    } else {
      snap.globalRules.push(r);
    }
  }
  // An admin write landed while this was loading: its invalidation wins, this
  // (possibly older) answer is used by whoever awaited it but never cached.
  if (gen === _snapGen) { _snap = snap; _snapAt = Date.now(); }
  return snap;
}

async function getSnapshot() {
  if (_snap && Date.now() - _snapAt < POLICY_TTL_MS) return _snap;
  if (!_snapInflight) {
    const p = loadSnapshot().finally(() => { if (_snapInflight === p) _snapInflight = null; });
    _snapInflight = p;
  }
  if (_snap) {
    // Stale-while-revalidate: nobody waits on the periodic refresh.
    _snapInflight.catch(e => logger.warn('IP_ACCESS', `policy refresh failed, using last snapshot: ${e.message}`));
    return _snap;
  }
  return _snapInflight;
}

// Call after ANY write to user_ip_access.ip_access_mode or user_ip_rules.
function invalidatePolicies() {
  _snapGen++;
  _snap = null;
  _snapInflight = null;
}

// Newest active company -- only needed to test the bypass permission, which is
// granted per company role. Same derivation as authMiddleware.
async function primaryCompanyId(userId) {
  return cache.remember('ipAccessCo', String(userId), 5 * 60_000, async () => {
    const { data } = await supabaseAdmin
      .from('user_company_roles').select('company_id')
      .eq('user_id', userId).eq('is_active', true)
      .order('created_at', { ascending: false }).limit(1);
    return data?.[0]?.company_id || null;
  });
}

// checkAccess with the policy looked up. `forceEnabled` answers "would this
// pass if restriction were ON?" -- what the admin screens show before enabling.
async function evaluateAccess({ userId, companyId = null, isSuperAdmin: superadmin = false }, ip, { forceEnabled = false } = {}) {
  const enabled = forceEnabled || isEnabled();
  if (!enabled) return checkAccess({ enabled: false });
  if (superadmin) return checkAccess({ enabled: true, isSuperAdmin: true });
  const snap = await getSnapshot();
  const mode = snap.restricted.has(userId) ? 'restricted' : 'anywhere';
  let hasBypass = false;
  // Only a restricted user can be blocked, so only they need the permission
  // lookup -- an 'anywhere' user is allowed at step 3 either way.
  if (mode === 'restricted') {
    const co = companyId || await primaryCompanyId(userId);
    if (co) hasBypass = await hasPermission(userId, co, BYPASS_PERMISSION);
  }
  return checkAccess({
    enabled: true, isSuperAdmin: false, hasBypass, mode, ip,
    userRules: snap.rulesByUser.get(userId) || [], globalRules: snap.globalRules,
  });
}

// Superadmin as the login path knows it: the JWT stamp, the env roster, or a
// superadmin custom role (models/helpers.isSuperAdmin covers the last two).
async function isSuperAdminAccount(user) {
  if (!user?.id) return false;
  if (user.app_metadata?.role === 'superadmin') return true;
  const envList = (process.env.SUPERADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (user.email && envList.includes(String(user.email).toLowerCase())) return true;
  return isSuperAdmin(user.id);
}

// -- Side effects (all fire-and-forget: none may slow or fail a request) -----------------
const trunc = (v, n) => (v == null ? null : String(v).slice(0, n));

function writeLog(row) {
  try {
    supabaseAdmin.from('ip_access_logs').insert(row)
      .then(({ error }) => { if (error) logger.warn('IP_ACCESS', `log write failed: ${error.message}`); },
            (e) => logger.warn('IP_ACCESS', `log write failed: ${e.message}`));
  } catch (e) { logger.warn('IP_ACCESS', `log write failed: ${e.message}`); }
}

function logAttempt({ userId, ip, result, reason, event = 'request', req }) {
  writeLog({
    user_id: userId || null,
    ip_address: ip || null,
    result,
    reason: trunc(reason, 200),
    event,
    user_agent: trunc(req?.headers?.['user-agent'], 400),
    path: trunc(String(req?.originalUrl || req?.url || '').split('?')[0], 300),
  });
}

function upsertAccess(row) {
  try {
    supabaseAdmin.from('user_ip_access').upsert(row, { onConflict: 'user_id' })
      .then(({ error }) => { if (error) logger.warn('IP_ACCESS', `last-seen write failed: ${error.message}`); },
            (e) => logger.warn('IP_ACCESS', `last-seen write failed: ${e.message}`));
  } catch (e) { logger.warn('IP_ACCESS', `last-seen write failed: ${e.message}`); }
}

const _seen = new Map();   // userId -> { ip, at }
function touchLastSeen(userId, ip) {
  if (!userId) return;
  const now = Date.now();
  const prev = _seen.get(userId);
  if (prev) {
    const age = now - prev.at;
    if (age < SEEN_FLOOR_MS) return;
    if (prev.ip === ip && age < SEEN_SAME_IP_MS) return;
  }
  _seen.set(userId, { ip, at: now });
  upsertAccess({ user_id: userId, last_seen_ip: ip || null, last_seen_at: new Date(now).toISOString() });
}

function recordLogin(userId, ip, req, event, verdict) {
  const nowIso = new Date().toISOString();
  _seen.set(userId, { ip, at: Date.now() });
  upsertAccess({ user_id: userId, last_login_ip: ip || null, last_login_at: nowIso, last_seen_ip: ip || null, last_seen_at: nowIso });
  logAttempt({ userId, ip, result: 'allowed', reason: verdict?.reason, event, req });
}

const _recentBlocks = new Map();   // `${userId}|${ip}` -> ts
function firstInBurst(userId, ip) {
  const key = `${userId}|${ip}`;
  const now = Date.now();
  const prev = _recentBlocks.get(key);
  if (prev && now - prev < BLOCK_BURST_MS) return false;
  _recentBlocks.set(key, now);
  if (_recentBlocks.size > 5000) {
    for (const [k, t] of _recentBlocks) if (now - t > BLOCK_BURST_MS) _recentBlocks.delete(k);
  }
  return true;
}

// End the Supabase session behind this token: its refresh token is revoked, so
// it cannot be renewed. 'local' = this session only -- the same person signed
// in at an allowed office desk keeps that session.
function revokeSession(accessToken) {
  if (!accessToken) return;
  try {
    supabaseAdmin.auth.admin.signOut(accessToken, 'local')
      .then(({ error } = {}) => { if (error) logger.debug('IP_ACCESS', `session revoke: ${error.message}`); },
            (e) => logger.debug('IP_ACCESS', `session revoke: ${e.message}`));
  } catch (e) { logger.debug('IP_ACCESS', `session revoke: ${e.message}`); }
}

const bearer = (req) => {
  const h = req?.headers?.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

const blockedBody = (ip) => ({ error: blockedMessage(ip), code: 'IP_BLOCKED', ip: ip || null });

// -- Enforcement ------------------------------------------------------------------------
// Login, token refresh and magic-link exchange. Supabase has already minted the
// session by the time credentials are known, so a denial revokes it on the spot
// and the tokens are never handed back. Returns null (carry on) or
// { status, body } to send.
async function guardLogin(req, { user, session, event = 'login' } = {}) {
  if (!isEnabled()) return null;
  if (!user?.id) return null;
  const ip = resolveClientIp(req);
  let verdict;
  try {
    verdict = await evaluateAccess({ userId: user.id, isSuperAdmin: await isSuperAdminAccount(user) }, ip);
  } catch (e) {
    logger.warn('IP_ACCESS', `${event} check failed for ${user.id}, allowing: ${e.message}`);
    return null;
  }
  if (verdict.allowed) {
    // A refresh is not a login: stamp last-seen, keep the log for real sign-ins.
    if (event === 'refresh') touchLastSeen(user.id, ip);
    else recordLogin(user.id, ip, req, event, verdict);
    return null;
  }
  logger.warn('IP_ACCESS', `blocked ${event} for ${user.id} from ${ip}: ${verdict.reason}`);
  logAttempt({ userId: user.id, ip, result: 'blocked', reason: verdict.reason, event, req });
  revokeSession(session?.access_token);
  return { status: 403, body: blockedBody(ip) };
}

// Every authenticated request (called by middleware/ipAccessGate.js after
// authMiddleware has resolved req.user). Returns null (carry on) or
// { status, body } to send.
async function guardRequest(req) {
  if (!isEnabled()) return null;
  const u = req.user;
  if (!u?.id) return null;
  const ip = resolveClientIp(req);
  let verdict;
  try {
    verdict = await evaluateAccess({ userId: u.id, companyId: u.company_id || null, isSuperAdmin: u.role === 'superadmin' }, ip);
  } catch (e) {
    logger.warn('IP_ACCESS', `request check failed for ${u.id}, allowing: ${e.message}`);
    return null;
  }
  if (verdict.allowed) {
    touchLastSeen(u.id, ip);
    return null;
  }
  if (firstInBurst(u.id, ip)) {
    logger.warn('IP_ACCESS', `blocked session for ${u.id} from ${ip}: ${verdict.reason}`);
    logAttempt({ userId: u.id, ip, result: 'blocked', reason: verdict.reason, event: 'request', req });
    revokeSession(bearer(req));
  }
  return { status: 403, body: blockedBody(ip) };
}

// -- Housekeeping -----------------------------------------------------------------------
async function pruneLogs() {
  const cutoff = new Date(Date.now() - state.retentionDays * 86_400_000).toISOString();
  const { error, count } = await supabaseAdmin
    .from('ip_access_logs').delete({ count: 'exact' }).lt('created_at', cutoff);
  if (error) throw new Error(error.message);
  if (count) logger.info('IP_ACCESS', `pruned ${count} access-log row(s) older than ${state.retentionDays} days`);
  return count || 0;
}

// Test hooks -- never used by app code.
const __test = {
  setEnabled(v) { state.dbEnabled = !!v; state.enabled = !!v && !forceOff(); },
  reset() {
    state.dbEnabled = false; state.enabled = false; state.retentionDays = DEFAULT_RETENTION_DAYS; state.loadedAt = 0;
    invalidatePolicies(); _seen.clear(); _recentBlocks.clear();
  },
};

module.exports = {
  KEYS,
  BYPASS_PERMISSION,
  MANAGE_PERMISSION,
  isEnabled,
  refreshSettings,
  getSettings,
  saveSettings,
  checkAccess,
  compileRule,
  evaluateAccess,
  getSnapshot,
  invalidatePolicies,
  isSuperAdminAccount,
  guardLogin,
  guardRequest,
  touchLastSeen,
  blockedMessage,
  pruneLogs,
  __test,
};
