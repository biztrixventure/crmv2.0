// ============================================================================
// routes/ipAccess.js -- /api/ip-access: the admin side of IP access control
// (mig 319). Enforcement itself lives in utils/ipAccess.js; this file only
// reads and changes the policy.
//
// WHO: superadmin, or a user holding ip_access.manage (granted to no role by
// default). Everyone else gets the app's standard 404 -- not a 403 -- so the
// endpoints do not advertise that the feature exists. The permission is
// SYSTEM-WIDE on purpose: the master switch and global rules have no company,
// so there is no per-company slice of this to hand out. Its description says
// "the WHOLE CRM" so nobody grants it expecting a company-scoped delegate.
//
// LOCKOUT SAFETY is enforced HERE, not only in the UI. A change that needs a
// human "yes" answers 409 { needs_confirm: <kind>, ... } and is applied only
// when resent with the matching flag:
//   enable            turning the master switch on       -> confirm: true
//   empty_allowlist   restricting someone with no allow   -> confirm_empty: true
//   self_lockout      a change that would block YOUR ip   -> acknowledge_self_lockout: true
// Superadmins always bypass the check, so they never see self_lockout.
//
// Every write lands in module_audit_log (module 'access') through the mig 319
// triggers, with the actor carried by utils/requestContext.
// ============================================================================
const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/database');
const { isSuperAdmin, hasPermission } = require('../models/helpers');
const cache = require('../utils/cache');
const { normalizeRule, normalizeIp } = require('../utils/ipAddress');
const { describeClientIp, resolveClientIp, readTrustedProxies, clientHeader } = require('../utils/clientIp');
const ipAccess = require('../utils/ipAccess');

const router = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES = ['anywhere', 'restricted'];
const TYPES = ['allow', 'deny'];
const RULE_COLS = 'id, user_id, type, ip_value, label, is_active, created_by, updated_by, created_at, updated_at';
const DIR_TTL_MS = 60_000;

const truthy = (v) => v === true || v === 'true' || v === '1' || v === 1;

// -- Gate -------------------------------------------------------------------------------
const actorIsSuper = async (req) => req.user?.role === 'superadmin' || isSuperAdmin(req.user?.id);

async function canManage(req) {
  if (!req.user?.id) return false;
  if (await actorIsSuper(req)) return true;
  if (!req.user.company_id) return false;
  return hasPermission(req.user.id, req.user.company_id, ipAccess.MANAGE_PERMISSION);
}

router.use(asyncHandler(async (req, res, next) => {
  if (await canManage(req)) return next();
  // Same body the app's catch-all 404 sends -- indistinguishable from "no such route".
  return res.status(404).json({ error: 'Route not found', path: req.originalUrl.split('?')[0], method: req.method });
}));

// -- Directory: every CRM login with name, role and company -------------------------------
async function userDirectory() {
  return cache.remember('ipAccessDir', 'all', DIR_TTL_MS, async () => {
    const authUsers = [];
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(error.message);
      const batch = data?.users || [];
      authUsers.push(...batch);
      if (batch.length < 1000) break;
    }
    const [profiles, roles] = await Promise.all([
      supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name'),
      supabaseAdmin.from('user_company_roles')
        .select('user_id, company_id, created_at, custom_roles(level, name), companies(name)')
        .eq('is_active', true),
    ]);
    const envList = (name) => new Set((process.env[name] || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean));
    const superEnv = envList('SUPERADMIN_EMAIL');
    const roEnv = envList('READONLY_ADMIN_EMAIL');
    const profileById = new Map((profiles.data || []).map(p => [p.user_id, p]));
    // Newest active assignment first -- the same "primary" authMiddleware picks.
    const rolesById = new Map();
    for (const r of [...(roles.data || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))) {
      if (!rolesById.has(r.user_id)) rolesById.set(r.user_id, []);
      rolesById.get(r.user_id).push(r);
    }

    const map = new Map();
    for (const u of authUsers) {
      if (u.app_metadata?.portal_client) continue;   // external recording-portal client, not staff
      const email = (u.email || '').toLowerCase();
      const p = profileById.get(u.id) || {};
      const assignments = rolesById.get(u.id) || [];
      const primary = assignments[0] || null;
      const stamped = u.app_metadata?.role;
      const isSuper = stamped === 'superadmin' || superEnv.has(email)
        || assignments.some(a => a.custom_roles?.level === 'superadmin');
      const isRo = !isSuper && (stamped === 'readonly_admin' || roEnv.has(email));
      map.set(u.id, {
        user_id: u.id,
        email: u.email || null,
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
        role_level: isSuper ? 'superadmin' : isRo ? 'readonly_admin' : (primary?.custom_roles?.level || null),
        role_name: isSuper ? 'Super Admin' : isRo ? 'Read-only Admin' : (primary?.custom_roles?.name || null),
        company_id: primary?.company_id || null,
        company_name: primary?.companies?.name || null,
        is_active: assignments.length > 0 || isSuper || isRo,
        is_superadmin: isSuper,
        last_sign_in_at: u.last_sign_in_at || null,
      });
    }
    return map;
  });
}

const labelFor = (dir, id) => {
  if (!id) return null;
  const u = dir.get(id);
  return u ? (u.name || u.email) : null;
};

// -- Serialisers ----------------------------------------------------------------------------
// cidr comes back as '203.0.113.44/32'; show the canonical form ('203.0.113.44').
const displayIp = (v) => {
  if (v == null) return null;
  const r = normalizeRule(String(v));
  return r.ok ? r.value : String(v);
};

const serializeRule = (row, dir) => ({
  id: row.id,
  user_id: row.user_id,
  scope: row.user_id ? 'user' : 'global',
  type: row.type,
  ip_value: displayIp(row.ip_value),
  label: row.label || null,
  is_active: row.is_active !== false,
  created_by: row.created_by || null,
  created_by_name: dir ? labelFor(dir, row.created_by) : null,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const publicVerdict = (v) => (v ? { allowed: v.allowed, code: v.code, reason: v.reason, step: v.step, rule_id: v.rule_id || null } : null);

const accessDefaults = (userId) => ({
  user_id: userId, ip_access_mode: 'anywhere',
  last_login_ip: null, last_login_at: null, last_seen_ip: null, last_seen_at: null,
  mode_changed_by: null, mode_changed_at: null,
});

async function loadAccess(userId) {
  const { data, error } = await supabaseAdmin.from('user_ip_access').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data || accessDefaults(userId);
}

async function loadRules({ userId = undefined, activeOnly = false } = {}) {
  let q = supabaseAdmin.from('user_ip_rules').select(RULE_COLS).order('created_at', { ascending: true });
  if (userId === null) q = q.is('user_id', null);
  else if (userId) q = q.eq('user_id', userId);
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

// -- Lockout safety -----------------------------------------------------------------------
// Would the ACTING admin still get in from where they are sitting right now if
// this change landed (with enforcement on)? Read fresh from the database, never
// from the enforcement cache, because this is the last line before a lockout.
async function selfVerdictAfter(req, change = {}) {
  if (await actorIsSuper(req)) return { allowed: true, code: 'superadmin', reason: 'superadmin always allowed', step: 2 };
  const actor = req.user.id;
  const ip = resolveClientIp(req);
  const [access, userRules, globalRules] = await Promise.all([
    loadAccess(actor), loadRules({ userId: actor, activeOnly: true }), loadRules({ userId: null, activeOnly: true }),
  ]);
  let mine = [...userRules];
  let globals = [...globalRules];
  const mode = change.mode || access.ip_access_mode;

  const drop = (id) => { mine = mine.filter(r => r.id !== id); globals = globals.filter(r => r.id !== id); };
  if (change.deleteRuleId) drop(change.deleteRuleId);
  if (change.rule) {
    if (change.rule.id) drop(change.rule.id);
    if (change.rule.is_active !== false) {
      if (change.rule.user_id === actor) mine.push(change.rule);
      else if (!change.rule.user_id) globals.push(change.rule);
    }
  }

  let hasBypass = false;
  if (mode === 'restricted' && req.user.company_id) {
    hasBypass = await hasPermission(actor, req.user.company_id, ipAccess.BYPASS_PERMISSION);
  }
  return {
    ...ipAccess.checkAccess({ enabled: true, isSuperAdmin: false, hasBypass, mode, ip, userRules: mine, globalRules: globals }),
    ip,
  };
}

function selfLockoutResponse(res, verdict) {
  return res.status(409).json({
    needs_confirm: 'self_lockout',
    ip: verdict.ip || null,
    reason: verdict.reason,
    error: `This change would block YOUR current address (${verdict.ip || 'unknown'}: ${verdict.reason}). `
      + 'While IP restriction is on you would be signed out immediately and could not sign back in from here.',
  });
}

// A change touches the acting admin when it is their own rule, their own mode,
// or a global rule (globals apply to every restricted user, them included).
const touchesActor = (req, ruleUserId) => !ruleUserId || ruleUserId === req.user.id;

// -- Policy summary (drives the warnings) ---------------------------------------------------
async function policySummary(dir) {
  const [accessRes, rules] = await Promise.all([
    supabaseAdmin.from('user_ip_access').select('user_id').eq('ip_access_mode', 'restricted'),
    loadRules({ activeOnly: true }),
  ]);
  if (accessRes.error) throw new Error(accessRes.error.message);
  const restricted = (accessRes.data || []).map(r => r.user_id);
  const globalAllow = rules.filter(r => !r.user_id && r.type === 'allow').length;
  const globalDeny = rules.filter(r => !r.user_id && r.type === 'deny').length;
  const allowByUser = new Map();
  for (const r of rules) if (r.user_id && r.type === 'allow') allowByUser.set(r.user_id, (allowByUser.get(r.user_id) || 0) + 1);
  const withoutAllow = globalAllow ? [] : restricted.filter(id => !allowByUser.get(id));
  return {
    restricted_count: restricted.length,
    global_allow_count: globalAllow,
    global_deny_count: globalDeny,
    restricted_without_allow: withoutAllow.map(id => ({ user_id: id, name: labelFor(dir, id) || id })),
  };
}

// ==========================================================================================
// GET /whoami -- the address the server sees for YOU, and how it got it.
// ==========================================================================================
router.get('/whoami', asyncHandler(async (req, res) => {
  const info = describeClientIp(req);
  const verdict = await ipAccess.evaluateAccess(
    { userId: req.user.id, companyId: req.user.company_id, isSuperAdmin: await actorIsSuper(req) },
    info.ip, { forceEnabled: true },
  );
  res.json({ ...info, would_pass: verdict.allowed, verdict: publicVerdict(verdict) });
}));

// ==========================================================================================
// GET /settings -- the switch, the environment it runs in, and what is at risk.
// ==========================================================================================
router.get('/settings', asyncHandler(async (req, res) => {
  const [settings, dir] = await Promise.all([ipAccess.refreshSettings(), userDirectory()]);
  res.json({
    settings,
    env: {
      force_off: settings.force_off,
      trusted_proxies: readTrustedProxies().list,
      client_header: clientHeader(),
    },
    summary: await policySummary(dir),
  });
}));

// ==========================================================================================
// PUT /settings -- { enabled?, log_retention_days?, confirm?, acknowledge_self_lockout? }
// ==========================================================================================
router.put('/settings', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const current = await ipAccess.refreshSettings();
  const updates = {};

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false.' });
    if (body.enabled && !current.enabled) {
      const who = describeClientIp(req);
      const dir = await userDirectory();
      const summary = await policySummary(dir);
      const self = await selfVerdictAfter(req);
      if (body.confirm !== true) {
        return res.status(409).json({
          needs_confirm: 'enable',
          detected_ip: who.ip,
          would_pass: self.allowed,
          warnings: who.warnings,
          summary,
          error: 'Confirm to turn IP restriction on.',
        });
      }
      if (!self.allowed && body.acknowledge_self_lockout !== true) return selfLockoutResponse(res, self);
    }
    updates.enabled = body.enabled;
  }

  if (body.log_retention_days !== undefined) {
    const n = Number(body.log_retention_days);
    if (!Number.isInteger(n) || n < 1 || n > 3650) {
      return res.status(400).json({ error: 'log_retention_days must be a whole number of days between 1 and 3650.' });
    }
    updates.retentionDays = n;
  }

  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to change.' });
  const settings = await ipAccess.saveSettings(updates, req.user.id);
  res.json({ settings });
}));

// ==========================================================================================
// GET /users -- every CRM login: mode, last seen, rule counts, would they pass.
// ==========================================================================================
router.get('/users', asyncHandler(async (req, res) => {
  const [dir, accessRes, rules] = await Promise.all([
    userDirectory(),
    supabaseAdmin.from('user_ip_access').select('*'),
    loadRules(),
  ]);
  if (accessRes.error) throw new Error(accessRes.error.message);
  const accessById = new Map((accessRes.data || []).map(a => [a.user_id, a]));
  const globalActive = rules.filter(r => !r.user_id && r.is_active);
  const rulesByUser = new Map();
  for (const r of rules) {
    if (!r.user_id) continue;
    if (!rulesByUser.has(r.user_id)) rulesByUser.set(r.user_id, []);
    rulesByUser.get(r.user_id).push(r);
  }

  // The bypass permission only matters for someone who could be blocked.
  const bypass = new Map();
  await Promise.all([...dir.values()]
    .filter(u => !u.is_superadmin && u.company_id && accessById.get(u.user_id)?.ip_access_mode === 'restricted')
    .map(async u => bypass.set(u.user_id, await hasPermission(u.user_id, u.company_id, ipAccess.BYPASS_PERMISSION))));

  const globalAllow = globalActive.filter(r => r.type === 'allow').length;
  const users = [...dir.values()].map(u => {
    const a = accessById.get(u.user_id) || accessDefaults(u.user_id);
    const own = rulesByUser.get(u.user_id) || [];
    const ownActive = own.filter(r => r.is_active);
    const ip = a.last_seen_ip || a.last_login_ip || null;
    const verdict = ipAccess.checkAccess({
      enabled: true, isSuperAdmin: u.is_superadmin, hasBypass: !!bypass.get(u.user_id),
      mode: a.ip_access_mode, ip, userRules: ownActive, globalRules: globalActive,
    });
    // Steps 1-3 pass whatever the address; past that, no address = unknown.
    const wouldPass = verdict.step <= 3 ? true : (ip ? verdict.allowed : null);
    const effectiveAllow = ownActive.filter(r => r.type === 'allow').length + globalAllow;
    return {
      ...u,
      ip_access_mode: a.ip_access_mode,
      last_seen_ip: a.last_seen_ip,
      last_seen_at: a.last_seen_at,
      last_login_ip: a.last_login_ip,
      last_login_at: a.last_login_at,
      rule_counts: {
        allow: ownActive.filter(r => r.type === 'allow').length,
        deny: ownActive.filter(r => r.type === 'deny').length,
        inactive: own.length - ownActive.length,
      },
      has_bypass: !!bypass.get(u.user_id),
      would_pass: wouldPass,
      verdict: publicVerdict(verdict),
      warning: a.ip_access_mode === 'restricted' && !u.is_superadmin && effectiveAllow === 0 ? 'no_allow_rules' : null,
    };
  }).sort((x, y) => String(x.name || x.email || '').localeCompare(String(y.name || y.email || '')));

  res.json({
    users,
    global: {
      allow: globalAllow,
      deny: globalActive.filter(r => r.type === 'deny').length,
    },
    settings: ipAccess.getSettings(),
  });
}));

// ==========================================================================================
// GET /users/:userId -- one user's mode, rules, verdict, recent attempts, history.
// ==========================================================================================
router.get('/users/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!UUID.test(userId)) return res.status(400).json({ error: 'Invalid user id.' });
  const dir = await userDirectory();
  const user = dir.get(userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const [access, own, globals, attempts, history] = await Promise.all([
    loadAccess(userId),
    loadRules({ userId }),
    loadRules({ userId: null }),
    supabaseAdmin.from('ip_access_logs')
      .select('id, ip_address, result, reason, event, path, user_agent, created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    loadHistory({ userId, limit: 30 }, dir),
  ]);
  if (attempts.error) throw new Error(attempts.error.message);

  let hasBypass = false;
  if (!user.is_superadmin && user.company_id && access.ip_access_mode === 'restricted') {
    hasBypass = await hasPermission(userId, user.company_id, ipAccess.BYPASS_PERMISSION);
  }
  const ownActive = own.filter(r => r.is_active);
  const globalActive = globals.filter(r => r.is_active);
  const seenIp = access.last_seen_ip || access.last_login_ip || null;
  const verdictFor = (ip, mode = access.ip_access_mode) => publicVerdict(ipAccess.checkAccess({
    enabled: true, isSuperAdmin: user.is_superadmin, hasBypass, mode, ip, userRules: ownActive, globalRules: globalActive,
  }));
  const effectiveAllow = ownActive.filter(r => r.type === 'allow').length + globalActive.filter(r => r.type === 'allow').length;
  const isSelf = userId === req.user.id;

  res.json({
    user,
    access: {
      ip_access_mode: access.ip_access_mode,
      last_login_ip: access.last_login_ip, last_login_at: access.last_login_at,
      last_seen_ip: access.last_seen_ip, last_seen_at: access.last_seen_at,
      mode_changed_by: access.mode_changed_by, mode_changed_by_name: labelFor(dir, access.mode_changed_by),
      mode_changed_at: access.mode_changed_at,
    },
    has_bypass: hasBypass,
    rules: own.map(r => serializeRule(r, dir)),
    global_rules: globals.map(r => serializeRule(r, dir)),
    effective_allow_count: effectiveAllow,
    warning: access.ip_access_mode === 'restricted' && !user.is_superadmin && effectiveAllow === 0 ? 'no_allow_rules' : null,
    // "Would they get in?" from where they were last seen -- and, if this is
    // not already restricted, what restricting them would do.
    verdict_last_seen: seenIp ? verdictFor(seenIp) : null,
    verdict_if_restricted: seenIp ? verdictFor(seenIp, 'restricted') : null,
    viewer_is_self: isSelf,
    viewer_ip: isSelf ? resolveClientIp(req) : null,
    recent_attempts: attempts.data || [],
    history,
    settings: ipAccess.getSettings(),
  });
}));

// ==========================================================================================
// PUT /users/:userId/mode -- { mode, confirm_empty?, acknowledge_self_lockout? }
// ==========================================================================================
router.put('/users/:userId/mode', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { mode } = req.body || {};
  if (!UUID.test(userId)) return res.status(400).json({ error: 'Invalid user id.' });
  if (!MODES.includes(mode)) return res.status(400).json({ error: `mode must be one of: ${MODES.join(', ')}.` });
  const dir = await userDirectory();
  const user = dir.get(userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (mode === 'restricted') {
    const [own, globals] = await Promise.all([
      loadRules({ userId, activeOnly: true }), loadRules({ userId: null, activeOnly: true }),
    ]);
    const allowCount = [...own, ...globals].filter(r => r.type === 'allow').length;
    if (allowCount === 0 && !truthy(req.body?.confirm_empty) && !user.is_superadmin) {
      return res.status(409).json({
        needs_confirm: 'empty_allowlist',
        error: `${user.name || user.email} has no active allow rules and there is no global allow rule. `
          + 'Restricted with an empty list, they will be blocked from EVERY network as soon as IP restriction is on.',
      });
    }
  }

  if (userId === req.user.id) {
    const self = await selfVerdictAfter(req, { mode });
    if (!self.allowed && !truthy(req.body?.acknowledge_self_lockout)) return selfLockoutResponse(res, self);
  }

  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin.from('user_ip_access').upsert({
    user_id: userId, ip_access_mode: mode,
    mode_changed_by: req.user.id, mode_changed_at: nowIso, updated_at: nowIso,
  }, { onConflict: 'user_id' });
  if (error) return res.status(400).json({ error: error.message });
  ipAccess.invalidatePolicies();
  res.json({ ok: true, user_id: userId, ip_access_mode: mode });
}));

// ==========================================================================================
// Rules
// ==========================================================================================
function readRuleInput(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.type !== undefined) {
    if (!TYPES.includes(body.type)) return { error: 'type must be allow or deny.', field: 'type' };
    out.type = body.type;
  }
  if (!partial || body.ip_value !== undefined) {
    const n = normalizeRule(body.ip_value);
    if (!n.ok) return { error: n.error, field: 'ip_value' };
    out.ip_value = n.value;
    out.masked = n.masked;
  }
  if (body.label !== undefined) {
    const label = body.label == null ? '' : String(body.label).trim();
    if (label.length > 120) return { error: 'Label must be 120 characters or fewer.', field: 'label' };
    out.label = label || null;
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') return { error: 'is_active must be true or false.', field: 'is_active' };
    out.is_active = body.is_active;
  }
  return { value: out };
}

const duplicate = (error) => error?.code === '23505' || /duplicate key/i.test(error?.message || '');

// GET /rules?scope=global  |  GET /rules?user_id=<uuid>  -- active and inactive.
router.get('/rules', asyncHandler(async (req, res) => {
  const userId = req.query.user_id ? String(req.query.user_id) : null;
  if (userId && !UUID.test(userId)) return res.status(400).json({ error: 'Invalid user id.' });
  const [rows, dir] = await Promise.all([loadRules({ userId: userId || null }), userDirectory()]);
  res.json({ rules: rows.map(r => serializeRule(r, dir)) });
}));

// POST /rules -- { user_id|null, type, ip_value, label?, is_active?, acknowledge_self_lockout? }
router.post('/rules', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const userId = body.user_id || null;
  if (userId && !UUID.test(userId)) return res.status(400).json({ error: 'Invalid user id.', field: 'user_id' });
  const input = readRuleInput(body);
  if (input.error) return res.status(400).json(input);
  const { masked, ...fields } = input.value;

  if (userId) {
    const dir = await userDirectory();
    if (!dir.get(userId)) return res.status(404).json({ error: 'User not found.' });
  }

  if (touchesActor(req, userId)) {
    const self = await selfVerdictAfter(req, { rule: { user_id: userId, is_active: true, ...fields } });
    if (!self.allowed && !truthy(body.acknowledge_self_lockout)) return selfLockoutResponse(res, self);
  }

  const { data, error } = await supabaseAdmin.from('user_ip_rules')
    .insert({ user_id: userId, is_active: true, ...fields, created_by: req.user.id, updated_by: req.user.id })
    .select(RULE_COLS).single();
  if (error) {
    if (duplicate(error)) return res.status(409).json({ error: `There is already a ${fields.type} rule for ${fields.ip_value}${userId ? ' on this user' : ' (global)'}.` });
    return res.status(400).json({ error: error.message });
  }
  ipAccess.invalidatePolicies();
  res.status(201).json({
    rule: serializeRule(data),
    note: masked ? `Stored as ${fields.ip_value} -- the host part of the range was cleared.` : null,
  });
}));

// PUT /rules/:id -- { type?, ip_value?, label?, is_active?, acknowledge_self_lockout? }
router.put('/rules/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!UUID.test(id)) return res.status(400).json({ error: 'Invalid rule id.' });
  const { data: existing, error: exErr } = await supabaseAdmin.from('user_ip_rules').select(RULE_COLS).eq('id', id).maybeSingle();
  if (exErr) return res.status(400).json({ error: exErr.message });
  if (!existing) return res.status(404).json({ error: 'Rule not found.' });

  const input = readRuleInput(req.body || {}, { partial: true });
  if (input.error) return res.status(400).json(input);
  const { masked, ...fields } = input.value;
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to change.' });

  if (touchesActor(req, existing.user_id)) {
    const next = { ...existing, ...fields };
    const self = await selfVerdictAfter(req, { rule: next });
    if (!self.allowed && !truthy(req.body?.acknowledge_self_lockout)) return selfLockoutResponse(res, self);
  }

  const { data, error } = await supabaseAdmin.from('user_ip_rules')
    .update({ ...fields, updated_by: req.user.id, updated_at: new Date().toISOString() })
    .eq('id', id).select(RULE_COLS).single();
  if (error) {
    if (duplicate(error)) return res.status(409).json({ error: 'An identical rule already exists.' });
    return res.status(400).json({ error: error.message });
  }
  ipAccess.invalidatePolicies();
  res.json({
    rule: serializeRule(data),
    note: masked ? `Stored as ${fields.ip_value} -- the host part of the range was cleared.` : null,
  });
}));

// DELETE /rules/:id  (acknowledge_self_lockout in the body or query)
router.delete('/rules/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!UUID.test(id)) return res.status(400).json({ error: 'Invalid rule id.' });
  const { data: existing, error: exErr } = await supabaseAdmin.from('user_ip_rules').select(RULE_COLS).eq('id', id).maybeSingle();
  if (exErr) return res.status(400).json({ error: exErr.message });
  if (!existing) return res.status(404).json({ error: 'Rule not found.' });

  if (touchesActor(req, existing.user_id)) {
    const self = await selfVerdictAfter(req, { deleteRuleId: id });
    const ack = truthy(req.body?.acknowledge_self_lockout) || truthy(req.query?.acknowledge_self_lockout);
    if (!self.allowed && !ack) return selfLockoutResponse(res, self);
  }

  const { error } = await supabaseAdmin.from('user_ip_rules').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  ipAccess.invalidatePolicies();
  res.json({ ok: true });
}));

// POST /users/:userId/rules/from-current -- one-click allow rule for the address
// this user most recently connected from. { source?: 'last_seen'|'last_login'|'request', label? }
// 'request' (your own address, right now) is only for your own record.
router.post('/users/:userId/rules/from-current', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!UUID.test(userId)) return res.status(400).json({ error: 'Invalid user id.' });
  const source = (req.body?.source || 'last_seen');
  const dir = await userDirectory();
  const user = dir.get(userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  let ip = null;
  let when = null;
  if (source === 'request') {
    if (userId !== req.user.id) return res.status(400).json({ error: 'Your current address can only be added to your own record.' });
    ip = resolveClientIp(req);
    when = new Date().toISOString();
  } else {
    const access = await loadAccess(userId);
    if (source === 'last_login') { ip = access.last_login_ip; when = access.last_login_at; }
    else { ip = access.last_seen_ip || access.last_login_ip; when = access.last_seen_at || access.last_login_at; }
  }
  const ipText = normalizeIp(ip);
  if (!ipText) {
    return res.status(404).json({
      error: 'No address has been recorded for this user yet. Addresses are recorded once IP restriction is on '
        + '(everyone stays allowed while they are set to "anywhere"), or add the address by hand.',
    });
  }

  const { data: found } = await supabaseAdmin.from('user_ip_rules').select(RULE_COLS)
    .eq('user_id', userId).eq('type', 'allow').eq('ip_value', ipText).maybeSingle();
  if (found) {
    if (!found.is_active) {
      const { data: revived, error } = await supabaseAdmin.from('user_ip_rules')
        .update({ is_active: true, updated_by: req.user.id, updated_at: new Date().toISOString() })
        .eq('id', found.id).select(RULE_COLS).single();
      if (error) return res.status(400).json({ error: error.message });
      ipAccess.invalidatePolicies();
      return res.json({ rule: serializeRule(revived), existed: true, note: `${ipText} was already on the list (inactive) -- switched it back on.` });
    }
    return res.json({ rule: serializeRule(found), existed: true, note: `${ipText} is already allowed for this user.` });
  }

  const stamp = when ? new Date(when).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const defaultLabel = source === 'request' ? `My address on ${stamp}` : `Last ${source === 'last_login' ? 'login' : 'seen'} ${stamp}`;
  const label = String(req.body?.label || '').trim().slice(0, 120) || defaultLabel;
  const { data, error } = await supabaseAdmin.from('user_ip_rules')
    .insert({ user_id: userId, type: 'allow', ip_value: ipText, label, is_active: true, created_by: req.user.id, updated_by: req.user.id })
    .select(RULE_COLS).single();
  if (error) return res.status(duplicate(error) ? 409 : 400).json({ error: error.message });
  ipAccess.invalidatePolicies();
  res.status(201).json({ rule: serializeRule(data), existed: false });
}));

// ==========================================================================================
// GET /logs -- access attempts. ?user_id&result&event&ip&from&to&page&limit
// Newest first; the UI opens on result=blocked.
// ==========================================================================================
router.get('/logs', asyncHandler(async (req, res) => {
  const { user_id, result, event, ip, from, to } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

  let q = supabaseAdmin.from('ip_access_logs')
    .select('id, user_id, ip_address, result, reason, event, user_agent, path, created_at', { count: 'exact' });
  if (user_id) {
    if (!UUID.test(String(user_id))) return res.status(400).json({ error: 'Invalid user id.' });
    q = q.eq('user_id', user_id);
  }
  if (result) {
    if (!['allowed', 'blocked'].includes(result)) return res.status(400).json({ error: 'result must be allowed or blocked.' });
    q = q.eq('result', result);
  }
  if (event) {
    if (!['login', 'refresh', 'exchange', 'request'].includes(event)) return res.status(400).json({ error: 'Unknown event.' });
    q = q.eq('event', event);
  }
  if (ip) {
    const exact = normalizeIp(ip);
    if (exact) q = q.eq('ip_address', exact);
    else q = q.ilike('ip_address', `%${String(ip).trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  }
  for (const [val, op] of [[from, 'gte'], [to, 'lte']]) {
    if (!val) continue;
    const d = new Date(String(val));
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: `Invalid date: ${val}` });
    q = q[op]('created_at', d.toISOString());
  }
  q = q.order('created_at', { ascending: false }).range((page - 1) * limit, page * limit - 1);

  const [{ data, error, count }, dir] = await Promise.all([q, userDirectory()]);
  if (error) return res.status(400).json({ error: error.message });
  res.json({
    logs: (data || []).map(l => ({
      ...l,
      user_name: labelFor(dir, l.user_id),
      user_email: dir.get(l.user_id)?.email || null,
    })),
    total: count || 0,
    page,
    limit,
  });
}));

// ==========================================================================================
// GET /history -- who changed the switch, a mode, or a rule. ?user_id&limit
// ==========================================================================================
async function loadHistory({ userId = null, limit = 50 } = {}, dir) {
  let q = supabaseAdmin.from('module_audit_log')
    .select('id, table_name, record_id, parent_id, operation, changes, changed_by, reason, source, changed_at')
    .eq('module', 'access')
    .in('table_name', ['user_ip_rules', 'user_ip_access', 'business_config'])
    .order('id', { ascending: false })
    .limit(limit);
  if (userId) q = q.or(`parent_id.eq.${userId},record_id.eq.${userId}`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  // An UPDATE row only carries the fields that changed. When the address did
  // not change, name the rule from its current row instead.
  const updatedRuleIds = [...new Set((data || [])
    .filter(e => e.table_name === 'user_ip_rules' && e.operation === 'UPDATE').map(e => e.record_id))];
  const ruleById = new Map();
  if (updatedRuleIds.length) {
    const { data: live } = await supabaseAdmin.from('user_ip_rules').select('id, type, ip_value, label').in('id', updatedRuleIds);
    for (const r of live || []) ruleById.set(r.id, r);
  }

  return (data || []).map(e => ({
    id: e.id,
    table_name: e.table_name,
    operation: e.operation,
    subject_user_id: e.table_name === 'business_config' ? null : (e.parent_id || null),
    subject_name: e.table_name === 'business_config' ? null : labelFor(dir, e.parent_id),
    changed_by: e.changed_by,
    changed_by_name: labelFor(dir, e.changed_by) || (e.source && e.source !== 'api' ? e.source : null),
    source: e.source,
    changed_at: e.changed_at,
    summary: describeChange(e, ruleById.get(e.record_id)),
  }));
}

function describeChange(e, liveRule = null) {
  const c = e.changes || {};
  const snap = c.snapshot || {};
  const nv = (k) => (c[k] && typeof c[k] === 'object' && 'new' in c[k] ? c[k].new : undefined);
  const ov = (k) => (c[k] && typeof c[k] === 'object' && 'old' in c[k] ? c[k].old : undefined);

  if (e.table_name === 'business_config') {
    const key = snap.key || '';
    const value = e.operation === 'UPDATE' ? nv('value') : snap.value;
    const isSwitch = key === ipAccess.KEYS.enabled || (e.operation === 'UPDATE' && nv('value') !== undefined && typeof nv('value') === 'boolean');
    if (isSwitch && typeof value === 'boolean') return `Turned IP restriction ${value ? 'ON' : 'OFF'}`;
    if (typeof value === 'number') return `Set access-log retention to ${value} days`;
    return e.operation === 'DELETE' ? 'Removed an IP access setting' : 'Changed an IP access setting';
  }

  if (e.table_name === 'user_ip_access') {
    const to = e.operation === 'UPDATE' ? nv('ip_access_mode') : snap.ip_access_mode;
    const from = e.operation === 'UPDATE' ? ov('ip_access_mode') : null;
    return from ? `Access mode ${from} -> ${to}` : `Access mode set to ${to}`;
  }

  if (e.table_name === 'user_ip_rules') {
    const ip = displayIp(snap.ip_value ?? nv('ip_value') ?? ov('ip_value'));
    const scope = (snap.user_id === null || (e.operation !== 'UPDATE' && !snap.user_id)) ? 'global ' : '';
    if (e.operation === 'INSERT') return `Added ${scope}${snap.type} rule ${ip}${snap.label ? ` (${snap.label})` : ''}`;
    if (e.operation === 'DELETE') return `Deleted ${scope}${snap.type} rule ${ip}${snap.label ? ` (${snap.label})` : ''}`;
    const parts = [];
    if (nv('ip_value') !== undefined) parts.push(`address ${displayIp(ov('ip_value'))} -> ${displayIp(nv('ip_value'))}`);
    if (nv('type') !== undefined) parts.push(`type ${ov('type')} -> ${nv('type')}`);
    if (nv('is_active') !== undefined) parts.push(nv('is_active') ? 'switched on' : 'switched off');
    if (nv('label') !== undefined) parts.push(`label "${ov('label') || ''}" -> "${nv('label') || ''}"`);
    const which = liveRule ? `${liveRule.type} rule ${displayIp(liveRule.ip_value)}` : 'Rule';
    return parts.length ? `${which} changed: ${parts.join(', ')}` : `${which} changed`;
  }
  return `${e.operation} ${e.table_name}`;
}

router.get('/history', asyncHandler(async (req, res) => {
  const userId = req.query.user_id ? String(req.query.user_id) : null;
  if (userId && !UUID.test(userId)) return res.status(400).json({ error: 'Invalid user id.' });
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const dir = await userDirectory();
  res.json({ history: await loadHistory({ userId, limit }, dir) });
}));

module.exports = router;
