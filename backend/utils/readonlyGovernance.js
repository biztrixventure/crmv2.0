// ============================================================================
// readonlyGovernance — the ONE resolver for a readonly_admin's governance:
// which tabs, which companies, which fields (PII/financial), which export
// areas, and whether copying is blocked. Config lives in business_config under
// readonly_admin.* keys (scope 'global'), layered per-user OVER a role-wide
// default template:
//
//   readonly_admin.defaults              = { tabs, flags, companies, export }  (role template)
//   readonly_admin.nav.<uid>       (arr) = allowed tab ids            | absent = parity (all)
//   readonly_admin.flags.<uid>     (obj) = { view_pii, view_financial_data,
//                                            can_export, view_audit_history, no_copy }
//   readonly_admin.companies.<uid> (arr) = allowed company ids        | absent = parity (all)
//   readonly_admin.export.<uid>    (obj) = { <area>: bool }           | absent = parity (all on)
//
// Posture: FULL PARITY, OPT-OUT — an unconfigured RO sees everything a
// superadmin can (minus superadmin-only tabs). A superadmin removes access;
// absence never locks anyone out. Per-user beats role default beats parity.
//
// Enforcement is server-side: readonlyAllowedCompanyIds() + scopeToCompanies()
// isolate data by company; hideFlagsFor() + maskForReadonly() strip fields;
// canExportArea() gates downloads. The SAME resolved blob rides on /auth/me so
// the frontend hides tabs/buttons synchronously (no flash).
// ============================================================================
const cache = require('./cache');
const logger = require('./logger');
const { getConfig } = require('./businessConfig');
const { supabaseAdmin } = require('../config/database');
const { maskRows, maskProfile } = require('./readonlyMask');

const GOV_TTL_MS = 30_000;
const GOV_NS = 'ro_gov';

// Every capability flag + its default. no_copy defaults FALSE (copy allowed) so
// a fresh/existing RO is never locked out on deploy; the rest default TRUE
// (parity — they can see everything until a superadmin opts them out).
const DEFAULT_FLAGS = {
  view_financial_data: true,   // down/monthly payment, revenue rollups
  view_pii:            true,   // customer phone / email / address / name / VIN
  can_export:          true,   // global export kill-switch
  view_audit_history:  true,   // edit_history reveal on drawers
  no_copy:             false,  // when true → block select/copy/cut/right-click/drag
};
const FLAG_KEYS = Object.keys(DEFAULT_FLAGS);

// Downloadable data areas (dataset slugs matching egress + export buttons).
const EXPORT_AREAS = [
  'sales', 'transfers', 'callbacks', 'customer_profile',
  'numbers', 'data_analyzer', 'company_data', 'chat', 'reviews',
];
const allExportOn = () => Object.fromEntries(EXPORT_AREAS.map(a => [a, true]));

function sanitizeFlags(input, base) {
  const out = { ...(base || DEFAULT_FLAGS) };
  if (input && typeof input === 'object') {
    for (const k of FLAG_KEYS) if (k in input) out[k] = !!input[k];
  }
  return out;
}
function sanitizeExport(input, base) {
  const out = { ...(base || allExportOn()) };
  if (input && typeof input === 'object') {
    for (const a of EXPORT_AREAS) if (a in input) out[a] = !!input[a];
  }
  return out;
}
const cleanIds = (v) => Array.isArray(v)
  ? [...new Set(v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()))]
  : null;

// Resolve the merged governance for one RO user. Cached 30s (invalidated on any
// governance write). Returns { nav, flags, companies, export } where nav/companies
// are `null` when unconfigured (= parity/all).
async function resolveGovernance(userId) {
  if (!userId) return { nav: null, flags: { ...DEFAULT_FLAGS }, companies: null, export: allExportOn() };
  return cache.remember(GOV_NS, userId, GOV_TTL_MS, async () => {
    const [navU, flagsU, compU, expU, defaults] = await Promise.all([
      getConfig(null, `readonly_admin.nav.${userId}`, null),
      getConfig(null, `readonly_admin.flags.${userId}`, null),
      getConfig(null, `readonly_admin.companies.${userId}`, null),
      getConfig(null, `readonly_admin.export.${userId}`, null),
      getConfig(null, 'readonly_admin.defaults', null),
    ]);
    const d = defaults && typeof defaults === 'object' ? defaults : {};
    // flags: DEFAULT ← role-default ← per-user
    const flags = sanitizeFlags(flagsU, sanitizeFlags(d.flags, DEFAULT_FLAGS));
    // export: all-on ← role-default ← per-user
    const exportCfg = sanitizeExport(expU, sanitizeExport(d.export, allExportOn()));
    // nav / companies: per-user ?? role-default ?? null(parity)
    const nav = cleanIds(navU) ?? cleanIds(d.tabs) ?? null;
    const companies = cleanIds(compU) ?? cleanIds(d.companies) ?? null;
    return { nav, flags, companies, export: exportCfg };
  });
}

function invalidateGovernance(userId) {
  if (userId) cache.invalidate(GOV_NS, userId);
  else cache.invalidateNamespace(GOV_NS);
}

const isReadonly = (req) => req?.user?.role === 'readonly_admin';

// The company-id allow-list for a request's actor. null = unrestricted (every
// company) — superadmin, or a readonly_admin whose companies are unconfigured
// (parity). An ARRAY (possibly empty) = strictly those companies only.
async function readonlyAllowedCompanyIds(req) {
  if (!isReadonly(req)) return null;                 // only RO is scoped here
  const gov = await resolveGovernance(req.user.id);
  return Array.isArray(gov.companies) ? gov.companies : null;
}

// Apply an allow-list to a Supabase query builder. null = no filter. An empty
// array = an impossible sentinel so the RO sees nothing (explicit lockout).
const IMPOSSIBLE_ID = '00000000-0000-0000-0000-000000000000';
function scopeToCompanies(query, allowedIds, column = 'company_id') {
  if (!Array.isArray(allowedIds)) return query;
  return query.in(column, allowedIds.length ? allowedIds : [IMPOSSIBLE_ID]);
}

// Is a single company id in scope for this request? (for /:id routes)
function companyInScope(allowedIds, companyId) {
  if (!Array.isArray(allowedIds)) return true;       // unrestricted
  return companyId != null && allowedIds.includes(companyId);
}

// hide-flags for the masker from a resolved governance blob.
const hideFlagsFor = (gov) => ({
  pii:       !(gov?.flags?.view_pii ?? true),
  financial: !(gov?.flags?.view_financial_data ?? true),
});

// Mask an array/single record set (or a customer-profile object) for a request.
// No-op for non-RO or when the RO may see everything.
async function maskForReadonly(data, dataset, req, { isProfile = false } = {}) {
  if (!isReadonly(req)) return data;
  const gov = await resolveGovernance(req.user.id);
  const hide = hideFlagsFor(gov);
  if (!hide.pii && !hide.financial) return data;
  return isProfile ? maskProfile(data, hide) : maskRows(data, hide);
}

// May this RO export the given data area? Global can_export kill-switch first,
// then the per-area toggle. Non-RO always true.
async function canExportArea(req, dataset) {
  if (!isReadonly(req)) return true;
  const gov = await resolveGovernance(req.user.id);
  if (gov.flags.can_export === false) return false;
  if (!dataset) return true;
  const cfg = gov.export || {};
  return cfg[dataset] !== false;   // absent/true = allowed
}

// ── activity telemetry (fire-and-forget; never throws, never awaited into a
//    response — mirrors egressGuard.logEgress) ──────────────────────────────
async function logReadonlyActivity(entry) {
  try {
    await supabaseAdmin.from('readonly_activity_log').insert({
      user_id:     entry.userId || null,
      role_level:  entry.role || null,
      company_id:  entry.companyId || null,
      action_type: entry.actionType,
      surface:     entry.surface || null,
      dataset:     entry.dataset || null,
      record_id:   entry.recordId != null ? String(entry.recordId) : null,
      http_method: entry.httpMethod || null,
      path:        entry.path || null,
      detail:      entry.detail || null,
      source:      entry.source || 'server',
    });
  } catch (e) {
    logger.warn('RO_ACTIVITY', `log failed: ${e.message}`);
  }
}

async function bulkLogReadonlyActivity(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  try {
    await supabaseAdmin.from('readonly_activity_log').insert(rows);
  } catch (e) {
    logger.warn('RO_ACTIVITY', `bulk log failed: ${e.message}`);
  }
}

module.exports = {
  DEFAULT_FLAGS, FLAG_KEYS, EXPORT_AREAS, allExportOn, sanitizeFlags, sanitizeExport,
  resolveGovernance, invalidateGovernance, isReadonly,
  readonlyAllowedCompanyIds, scopeToCompanies, companyInScope,
  hideFlagsFor, maskForReadonly, canExportArea,
  logReadonlyActivity, bulkLogReadonlyActivity,
};
