// ============================================================================
// routes/companyReports.js -- /api/company-reports (mig 332)
//
// Per-agent performance for ONE company: transfers, conversion, sales, money,
// callbacks, dispositions, best partner, QA -- plus an "All companies" summary
// for estate-wide viewers.
//
// WHO MAY OPEN WHICH COMPANY (resolveScope -- the one place that decides):
//   superadmin, compliance_manager  -> any company (estate-wide by role)
//   readonly_admin                  -> the companies governance allows
//   everyone else                   -> ONLY companies they are an active
//     member of where their role holds a report permission
//     (view_company_reports / view_fronter_stats / view_closer_stats /
//     view_reports).
//   ...and then the PERSON decides (user_report_access, mig 333, set in User
//   Control Center -> Reports): can_view ON opens it without the permission,
//   OFF closes it even for an estate-wide role; company_ids hands one named
//   person exactly those companies. Superadmin is never overridden.
// A company_id the caller may not open is a 403, never a silent fallback to
// their own company -- a report that quietly shows a different company than
// the one asked for is how a manager ends up quoting the wrong numbers.
//
// PER-VIEWER RULES (applied after counting, in utils/companyReport.js):
//   money  -> the person's show_amounts switch when set, else
//             view_financial_data (readonly: governance flag). Without it every
//             amount AND every money ranking is removed.
//   QA     -> managers see scores; an agent-level viewer (fronter / trainee /
//             closer holding the tool switch) sees them only when
//             qa.agent_scores is on for their floor (utils/qaScoreVisibility).
//   resells-> hidden exactly where GET /sales hides them (resellPrivacy).
//
// All counting is app_company_agent_report() -- one round-trip, cached 60s per
// (company, range, resell-visibility). Nothing here loops over PostgREST.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin, hasPermission, getUserCompanies, getCompanyType } = require('../models/helpers');
const { getConfig, setConfig } = require('../utils/businessConfig');
const { readonlyAllowedCompanyIds, resolveGovernance } = require('../utils/readonlyGovernance');
const { shouldHideResellsForUser } = require('../utils/resellPrivacy');
const { scoresVisibleFor } = require('../utils/qaScoreVisibility');
const { safeUuid } = require('../utils/searchSanitize');
const { todayEt } = require('../utils/etUtils');
const cache = require('../utils/cache');
const logger = require('../utils/logger');
const report = require('../utils/companyReport');

const router = express.Router();

const NS = 'company_reports';
const REPORT_TTL_MS = 60 * 1000;
const CONFIG_KEY = 'reports.company';
const REPORT_PERMS = ['view_company_reports', 'view_fronter_stats', 'view_closer_stats', 'view_reports'];
const AGENT_LEVELS = new Set(['fronter', 'trainee', 'closer']);
const ACCESS_TTL_MS = 30 * 1000;

// ── access ──────────────────────────────────────────────────────────────────

// The person's own switches (mig 333). null = nothing decided for them.
async function readOverride(userId) {
  return cache.remember(NS, `acc|${userId}`, ACCESS_TTL_MS, async () => {
    const { data, error } = await supabaseAdmin
      .from('user_report_access').select('can_view, show_amounts, company_ids')
      .eq('user_id', userId).maybeSingle();
    // Table missing (deploy before 333) -> behave as "nothing decided".
    if (error) return null;
    return data || null;
  }).then(v => v || null);
}

async function roleMayReportOn(userId, companyId) {
  for (const perm of REPORT_PERMS) {
    if (await hasPermission(userId, companyId, perm)) return true;
  }
  return false;
}

/**
 * Which companies may this caller open?
 * @returns {{ global: boolean, allowed: string[]|null, superadmin: boolean,
 *             source: 'superadmin'|'estate'|'person'|'role'|'none', override: object|null }}
 *   allowed === null means every company.
 */
async function resolveScope(req) {
  const { id, role } = req.user || {};
  const none = (override = null) => ({ global: false, allowed: [], superadmin: false, source: 'none', override });
  if (!id) return none();
  if (role === 'superadmin' || await isSuperAdmin(id)) {
    return { global: true, allowed: null, superadmin: true, source: 'superadmin', override: null };
  }

  const o = await readOverride(id);
  if (o?.can_view === false) return none(o);                       // OFF beats every role
  const picked = Array.isArray(o?.company_ids) && o.company_ids.length ? o.company_ids : null;

  if (role === 'readonly_admin') {
    const gov = await readonlyAllowedCompanyIds(req);                // null = every company
    const allowed = picked ? (gov ? picked.filter(c => gov.includes(c)) : picked) : gov;
    return { global: true, allowed, superadmin: false, source: 'estate', override: o };
  }
  if (role === 'compliance_manager') {
    return { global: true, allowed: picked, superadmin: false, source: picked ? 'person' : 'estate', override: o };
  }

  const mine = (await getUserCompanies(id)).filter(c => c.is_active !== false).map(c => c.id);
  if (o?.can_view === true) {
    return { global: false, allowed: picked || mine, superadmin: false, source: 'person', override: o };
  }
  const allowed = [];
  for (const c of mine) {
    if (await roleMayReportOn(id, c)) allowed.push(c);
  }
  return { global: false, allowed, superadmin: false, source: allowed.length ? 'role' : 'none', override: o };
}

const inScope = (scope, companyId) => !!companyId && (scope.allowed === null || scope.allowed.includes(companyId));

async function canSeeMoney(req, scope, companyId) {
  if (scope.superadmin) return true;
  // The person's report-only switch beats the role, both ways.
  if (typeof scope.override?.show_amounts === 'boolean') return scope.override.show_amounts;
  if (req.user.role === 'readonly_admin') {
    const gov = await resolveGovernance(req.user.id);
    return gov?.flags?.view_financial_data !== false;
  }
  // Estate-wide roles hold their permissions in their OWN company.
  const permCompany = scope.global ? (req.user.company_id || companyId) : companyId;
  return !!(await hasPermission(req.user.id, permCompany, 'view_financial_data'));
}

async function canSeeQa(req) {
  if (!AGENT_LEVELS.has(req.user.role)) return true;
  return (await scoresVisibleFor(req)).visible;
}

async function companyNames() {
  return cache.remember(NS, 'company-names', 5 * 60 * 1000, async () => {
    const { data } = await supabaseAdmin.from('companies').select('id, name, company_type, is_active').order('name');
    return data || [];
  });
}

async function readConfig(companyId) {
  return report.sanitizeConfig(await getConfig(companyId || null, CONFIG_KEY, report.DEFAULT_CONFIG));
}

// ── GET /scope -- which companies the picker offers ────────────────────────
router.get('/scope', asyncHandler(async (req, res) => {
  const scope = await resolveScope(req);
  const all = await companyNames();
  const companies = all
    .filter(c => c.is_active !== false && inScope(scope, c.id))
    .map(c => ({ id: c.id, name: c.name, company_type: c.company_type }));
  const own = companies.some(c => c.id === req.user.company_id) ? req.user.company_id : null;
  res.json({
    global: scope.global,
    // several companies, or all of them -> the All-companies comparison opens
    multi: scope.allowed === null || scope.allowed.length > 1,
    source: scope.source,
    can_configure: scope.superadmin,
    companies,
    default_company_id: own || companies[0]?.id || null,
  });
}));

// ── GET / -- one company's report ──────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const scope = await resolveScope(req);
  const asked = req.query.company_id ? safeUuid(req.query.company_id) : null;
  if (req.query.company_id && !asked) return res.status(400).json({ error: 'Invalid company.' });

  let companyId = asked;
  if (!companyId) {
    companyId = inScope(scope, req.user.company_id) ? req.user.company_id : (scope.allowed || [])[0] || null;
  }
  if (!companyId) return res.status(403).json({ error: 'Company Reports is not enabled for you.' });
  if (!inScope(scope, companyId)) {
    return res.status(403).json({ error: 'You can only open reports for your own company.' });
  }

  const range = report.parseRange(req.query.from, req.query.to, todayEt());
  if (range.error) return res.status(400).json({ error: range.error });

  const companyType = await getCompanyType(companyId);
  const [hideResells, canFin, showQa, cfg, names] = await Promise.all([
    shouldHideResellsForUser(req.user.role, companyId, companyType),
    canSeeMoney(req, scope, companyId),
    canSeeQa(req),
    readConfig(companyId),
    companyNames(),
  ]);

  const raw = await cache.remember(NS, `r|${companyId}|${range.from}|${range.to}|${hideResells ? 1 : 0}`, REPORT_TTL_MS, async () => {
    const { data, error } = await supabaseAdmin.rpc('app_company_agent_report', {
      p_company: companyId, p_from: range.from, p_to: range.to, p_hide_resells: !!hideResells,
    });
    if (error) {
      logger.error('COMPANY_REPORTS', `report ${companyId}: ${error.message}`);
      throw Object.assign(new Error('The report could not be built. Try a shorter date range.'), { statusCode: 500 });
    }
    return data || undefined;   // undefined is not cached
  });
  if (!raw) return res.status(404).json({ error: 'Company not found.' });

  const nameMap = Object.fromEntries(names.map(c => [c.id, c.name]));
  res.json(report.buildReport(raw, cfg, { canFin, showQa, companyNames: nameMap }));
}));

// ── GET /overview -- every company side by side (estate-wide viewers) ─────
router.get('/overview', asyncHandler(async (req, res) => {
  const scope = await resolveScope(req);
  // Anyone who may open more than one company may compare them -- only theirs.
  if (!(scope.allowed === null || scope.allowed.length > 1)) {
    return res.status(403).json({ error: 'Comparing companies needs access to more than one.' });
  }
  const range = report.parseRange(req.query.from, req.query.to, todayEt());
  if (range.error) return res.status(400).json({ error: range.error });

  const ids = scope.allowed;   // null = every company
  if (Array.isArray(ids) && !ids.length) return res.json({ companies: [], range, can_see_money: false });

  const [canFin, showQa, cfg] = await Promise.all([canSeeMoney(req, scope, req.user.company_id), canSeeQa(req), readConfig(null)]);
  const key = `o|${range.from}|${range.to}|${ids ? ids.slice().sort().join(',') : '*'}`;
  const raw = await cache.remember(NS, key, REPORT_TTL_MS, async () => {
    const { data, error } = await supabaseAdmin.rpc('app_company_report_overview', {
      p_from: range.from, p_to: range.to, p_companies: ids,
    });
    if (error) {
      logger.error('COMPANY_REPORTS', `overview: ${error.message}`);
      throw Object.assign(new Error('The overview could not be built. Try a shorter date range.'), { statusCode: 500 });
    }
    return data || [];
  });
  let out = report.buildOverview(raw, cfg, { canFin, days: range.days });
  if (!showQa) out = report.stripFields(out, report.QA_FIELDS);
  res.json({ ...out, range });
}));

// ── settings (superadmin): placeholders, earner metric, sample size, … ──────
router.get('/config', asyncHandler(async (req, res) => {
  const scope = await resolveScope(req);
  if (!scope.superadmin) return res.status(403).json({ error: 'Superadmin only.' });
  const companyId = req.query.company_id ? safeUuid(req.query.company_id) : null;
  res.json({
    config: await readConfig(companyId),
    earner_metrics: report.EARNER_METRICS,
    scope: companyId ? `company:${companyId}` : 'global',
  });
}));

router.put('/config', asyncHandler(async (req, res) => {
  const scope = await resolveScope(req);
  if (!scope.superadmin) return res.status(403).json({ error: 'Superadmin only.' });
  const companyId = req.body?.company_id ? safeUuid(req.body.company_id) : null;
  if (req.body?.company_id && !companyId) return res.status(400).json({ error: 'Invalid company.' });
  const clean = report.sanitizeConfig(req.body?.config);
  await setConfig(companyId ? `company:${companyId}` : 'global', CONFIG_KEY, clean, req.user.id);
  res.json({ config: clean });
}));

// ============================================================================
// Per-person access -- User Control Center -> Reports (superadmin only).
// "Why" is answered by utils/companyReport.effectiveAccess, from plain data,
// so the one-person view and the everyone list can never disagree.
// ============================================================================
const WATCHED_PERMS = [...report.REPORT_PERMS, 'view_financial_data'];

async function requireSuper(req, res) {
  const scope = await resolveScope(req);
  if (!scope.superadmin) { res.status(403).json({ error: 'Superadmin only.' }); return false; }
  return true;
}

// Page through a PostgREST select (1,000-row cap).
async function selectAll(build) {
  const out = [];
  for (let p = 0; p < 50; p++) {
    const { data, error } = await build().range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Everything needed to describe access for `userIds` (or everyone): active
 * memberships with effective report/money permissions, the person's switches,
 * names. Five reads, however many people.
 */
async function loadAccessInputs(userIds = null) {
  const scoped = (q) => (userIds ? q.in('user_id', userIds) : q);
  // The five permission ids first, then plain permission_id filters.
  const { data: permRows, error: permErr } = await supabaseAdmin
    .from('permissions').select('id, name').in('name', WATCHED_PERMS);
  if (permErr) throw permErr;
  const permName = new Map((permRows || []).map(p => [p.id, p.name]));
  const permIds = [...permName.keys()];
  const none = () => Promise.resolve([]);

  const [ucr, rolePerms, overrides, switches, profiles] = await Promise.all([
    selectAll(() => scoped(supabaseAdmin.from('user_company_roles')
      .select('user_id, company_id, role_id, custom_roles(level)').eq('is_active', true)).order('user_id')),
    permIds.length ? selectAll(() => supabaseAdmin.from('role_permissions')
      .select('role_id, permission_id').in('permission_id', permIds).order('role_id')) : none(),
    permIds.length ? selectAll(() => scoped(supabaseAdmin.from('user_permission_overrides')
      .select('user_id, company_id, override_type, permission_id').in('permission_id', permIds)).order('user_id')) : none(),
    selectAll(() => scoped(supabaseAdmin.from('user_report_access')
      .select('user_id, can_view, show_amounts, company_ids, updated_at')).order('user_id')),
    selectAll(() => scoped(supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name')).order('user_id')),
  ]);

  const byRole = new Map();
  for (const r of rolePerms) {
    const n = permName.get(r.permission_id);
    if (!n) continue;
    if (!byRole.has(r.role_id)) byRole.set(r.role_id, new Set());
    byRole.get(r.role_id).add(n);
  }
  const ov = new Map();                     // `${user}|${company}` -> { grant:Set, revoke:Set }
  for (const o of overrides) {
    const k = `${o.user_id}|${o.company_id}`;
    if (!ov.has(k)) ov.set(k, { grant: new Set(), revoke: new Set() });
    const n = permName.get(o.permission_id);
    if (o.override_type === 'grant') ov.get(k).grant.add(n);
    else if (o.override_type === 'revoke') ov.get(k).revoke.add(n);
  }
  const memberships = new Map();
  for (const m of ucr) {
    const perms = new Set(byRole.get(m.role_id) || []);
    const x = ov.get(`${m.user_id}|${m.company_id}`);
    if (x) { x.grant.forEach(n => perms.add(n)); x.revoke.forEach(n => perms.delete(n)); }
    if (!memberships.has(m.user_id)) memberships.set(m.user_id, []);
    memberships.get(m.user_id).push({ company_id: m.company_id, level: m.custom_roles?.level || null, perms: [...perms] });
  }
  return {
    memberships,
    switches: new Map(switches.map(r => [r.user_id, r])),
    names: new Map(profiles.map(p => [p.user_id, [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || null])),
  };
}

const publicOverride = (o) => ({
  can_view: typeof o?.can_view === 'boolean' ? o.can_view : null,
  show_amounts: typeof o?.show_amounts === 'boolean' ? o.show_amounts : null,
  company_ids: Array.isArray(o?.company_ids) && o.company_ids.length ? o.company_ids : null,
});

// GET /access -- everyone who can open Company Reports today, and whether they
// see amounts. Superadmins are not listed: they always see everything.
router.get('/access', asyncHandler(async (req, res) => {
  if (!await requireSuper(req, res)) return;
  const [inputs, all] = await Promise.all([loadAccessInputs(), companyNames()]);
  const companies = all.filter(c => c.is_active !== false).map(c => ({ id: c.id, name: c.name }));
  const coName = Object.fromEntries(companies.map(c => [c.id, c.name]));
  const people = [];
  const ids = new Set([...inputs.memberships.keys(), ...inputs.switches.keys()]);
  for (const id of ids) {
    const memberships = (inputs.memberships.get(id) || []).map(m => ({ ...m, company: coName[m.company_id] || null }));
    const override = inputs.switches.get(id) || null;
    const eff = report.effectiveAccess({ memberships, override, companies });
    if (!eff.can_view && !override) continue;          // nothing to say about them
    people.push({
      user_id: id,
      name: inputs.names.get(id) || '(no name)',
      roles: memberships.map(m => ({ company: m.company, level: m.level })),
      override: publicOverride(override),
      ...eff,
    });
  }
  people.sort((a, b) => (Number(b.can_view) - Number(a.can_view)) || String(a.name).localeCompare(String(b.name)));
  res.json({ people, companies });
}));

// GET /access/:userId -- one person: their switches + what they get and why.
router.get('/access/:userId', asyncHandler(async (req, res) => {
  if (!await requireSuper(req, res)) return;
  const userId = safeUuid(req.params.userId);
  if (!userId) return res.status(400).json({ error: 'Invalid user.' });
  const [inputs, all] = await Promise.all([loadAccessInputs([userId]), companyNames()]);
  const companies = all.filter(c => c.is_active !== false).map(c => ({ id: c.id, name: c.name, company_type: c.company_type }));
  const coName = Object.fromEntries(companies.map(c => [c.id, c.name]));
  const memberships = (inputs.memberships.get(userId) || []).map(m => ({ ...m, company: coName[m.company_id] || null }));
  const override = inputs.switches.get(userId) || null;
  res.json({
    user_id: userId,
    override: publicOverride(override),
    memberships: memberships.map(m => ({
      company_id: m.company_id, company: m.company, level: m.level,
      report_perm: report.REPORT_PERMS.some(p => m.perms.includes(p)),
      money_perm: m.perms.includes('view_financial_data'),
    })),
    effective: report.effectiveAccess({ memberships, override, companies }),
    // what the role alone would give -- so the screen can say what "Role decides" means
    role_only: report.effectiveAccess({ memberships, override: null, companies }),
    companies,
  });
}));

// PUT /access/:userId  { can_view, show_amounts, company_ids } -- null = role decides.
router.put('/access/:userId', asyncHandler(async (req, res) => {
  if (!await requireSuper(req, res)) return;
  const userId = safeUuid(req.params.userId);
  if (!userId) return res.status(400).json({ error: 'Invalid user.' });
  const b = req.body || {};
  const tri = (v) => (v === true || v === false ? v : null);
  const all = await companyNames();
  const known = new Set(all.map(c => c.id));
  const ids = Array.isArray(b.company_ids)
    ? [...new Set(b.company_ids.map(safeUuid).filter(id => id && known.has(id)))]
    : [];
  const row = {
    can_view: tri(b.can_view),
    show_amounts: tri(b.show_amounts),
    // a company list only means something when the reports are switched ON
    company_ids: tri(b.can_view) === true && ids.length ? ids : null,
  };

  if (row.can_view === null && row.show_amounts === null) {
    const { error } = await supabaseAdmin.from('user_report_access').delete().eq('user_id', userId);
    if (error) throw error;
  } else {
    const { error } = await supabaseAdmin.from('user_report_access')
      .upsert({ user_id: userId, ...row, updated_by: req.user.id, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
  }
  cache.invalidate(NS, `acc|${userId}`);
  res.json({ override: row });
}));

module.exports = router;
module.exports.__test = { resolveScope, roleMayReportOn, readOverride };
