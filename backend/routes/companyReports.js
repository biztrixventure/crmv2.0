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
//     member of, AND for each one either a report permission on their role
//     (view_company_reports / view_fronter_stats / view_closer_stats /
//     view_reports) OR the per-person tool switch `tool_company_reports`
//     (User Control Center -> Tools). Two doors, same as Accounting/HR/Training.
// A company_id the caller may not open is a 403, never a silent fallback to
// their own company -- a report that quietly shows a different company than
// the one asked for is how a manager ends up quoting the wrong numbers.
//
// PER-VIEWER RULES (applied after counting, in utils/companyReport.js):
//   money  -> view_financial_data (readonly: governance flag). Without it every
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
const { isFeatureEnabled } = require('../utils/featureGate');
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
const TOOL_KEY = 'tool_company_reports';
const REPORT_PERMS = ['view_company_reports', 'view_fronter_stats', 'view_closer_stats', 'view_reports'];
const AGENT_LEVELS = new Set(['fronter', 'trainee', 'closer']);

// ── access ──────────────────────────────────────────────────────────────────

// isFeatureEnabled() ASSUMES ON for a key missing from the catalog. A report
// switch that defaults to "everyone" if the catalog row is ever lost is the
// wrong failure, so check the catalog first (same guard as requireToolAccess).
async function toolOn(userId, companyId) {
  const inCatalog = await cache.remember(NS, 'flag-exists', 5 * 60 * 1000, async () => {
    const { data } = await supabaseAdmin.from('feature_flags').select('key').eq('key', TOOL_KEY).maybeSingle();
    return !!data;
  });
  if (!inCatalog) return false;
  return !!(await isFeatureEnabled(TOOL_KEY, companyId, userId));
}

async function mayReportOn(userId, companyId) {
  for (const perm of REPORT_PERMS) {
    if (await hasPermission(userId, companyId, perm)) return true;
  }
  return toolOn(userId, companyId);
}

/**
 * Which companies may this caller open?
 * @returns {{ global: boolean, allowed: string[]|null, superadmin: boolean }}
 *   allowed === null means every company.
 */
async function resolveScope(req) {
  const { id, role } = req.user || {};
  if (!id) return { global: false, allowed: [], superadmin: false };
  if (role === 'superadmin' || await isSuperAdmin(id)) return { global: true, allowed: null, superadmin: true };
  if (role === 'readonly_admin') return { global: true, allowed: await readonlyAllowedCompanyIds(req), superadmin: false };
  if (role === 'compliance_manager') return { global: true, allowed: null, superadmin: false };

  const mine = await getUserCompanies(id);
  const allowed = [];
  for (const c of mine) {
    if (c.is_active === false) continue;
    if (await mayReportOn(id, c.id)) allowed.push(c.id);
  }
  return { global: false, allowed, superadmin: false };
}

const inScope = (scope, companyId) => !!companyId && (scope.allowed === null || scope.allowed.includes(companyId));

async function canSeeMoney(req, scope, companyId) {
  if (scope.superadmin) return true;
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
  if (!scope.global) return res.status(403).json({ error: 'Only estate-wide roles can compare companies.' });
  const range = report.parseRange(req.query.from, req.query.to, todayEt());
  if (range.error) return res.status(400).json({ error: range.error });

  const ids = scope.allowed;   // null = every company
  if (Array.isArray(ids) && !ids.length) return res.json({ companies: [], range, can_see_money: false });

  const [canFin, cfg] = await Promise.all([canSeeMoney(req, scope, req.user.company_id), readConfig(null)]);
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
  res.json({ ...report.buildOverview(raw, cfg, { canFin }), range });
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

module.exports = router;
module.exports.__test = { resolveScope, mayReportOn, toolOn };
