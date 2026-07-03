// ============================================================================
// utils/qaMaterializer.js — QA worklist materialization driver.
//
// Runs on the scheduler tick. For every company that has QA explicitly enabled
// (a company-scoped qa.methods override with a non-empty list), it calls the
// set-based RPCs from migration 172:
//   • TRA → app_qa_materialize_tra   (full coverage of in-scope transfers)
//   • RCM → app_qa_materialize_rcm   (frozen random sample of the PREVIOUS
//                                     complete period's calls)
//
// SAFETY: the GLOBAL qa.methods default is [] (mig 171). We never scan/enable a
// company that has no company-scoped override — so a company only ever gets QA
// after a qa_manager turns it on. Everything is wrapped so a missing table/RPC
// (migrations not yet applied) logs softly and never crashes the process.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { getConfig } = require('./businessConfig');
const logger = require('./logger');

// ── period math (previous complete period) ──────────────────────────────────
// We sample the PREVIOUS complete period, not the in-progress one, so the frozen
// sample sees the whole period's calls (never a half-day). All boundaries in UTC
// — good enough for sampling; flag if a business-tz boundary is later required.
function previousPeriod(kind) {
  const now = new Date();
  if (kind === 'day') {
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); // today 00:00
    const start = new Date(end.getTime() - 86400000);                                          // yesterday 00:00
    const label = start.toISOString().slice(0, 10);                                            // YYYY-MM-DD
    return { label, start, end };
  }
  // week (ISO, Monday start)
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7;                 // 0 = Monday
  const thisWeekStart = new Date(d.getTime() - dow * 86400000);
  const end = thisWeekStart;                            // start of THIS week = end of last week
  const start = new Date(end.getTime() - 7 * 86400000); // start of last week
  // ISO week label
  const tmp = new Date(start.getTime());
  tmp.setUTCDate(tmp.getUTCDate() + 3);                 // nearest Thursday
  const week1 = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
  const wk = 1 + Math.round(((tmp - week1) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  const label = `${tmp.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
  return { label, start, end };
}

// Companies with QA turned on = company-scoped qa.methods overrides that aren't
// empty. One cheap query, no full company scan.
async function enabledCompanies() {
  const { data, error } = await supabaseAdmin
    .from('business_config').select('scope, value').eq('key', 'qa.methods');
  if (error) { logger.warn('QA_JOBS', `read qa.methods: ${error.message}`); return []; }
  const out = [];
  for (const row of data || []) {
    if (typeof row.scope !== 'string' || !row.scope.startsWith('company:')) continue;
    const methods = Array.isArray(row.value) ? row.value : [];
    if (!methods.length) continue;
    out.push({ companyId: row.scope.slice('company:'.length), methods });
  }
  return out;
}

// Materialize ONE company's worklist right now (used by the hourly job AND the
// on-demand "Pull calls now" button / the auto-pull when QA is toggled on).
// `methods` optional — resolved from config if omitted. Returns {tra, rcm}.
async function materializeCompany(companyId, methods) {
  if (!methods) {
    const m = await getConfig(companyId, 'qa.methods', []);
    methods = Array.isArray(m) ? m : [];
  }
  let tra = 0, rcm = 0;
  if (methods.includes('tra')) {
    try {
      const pop = await getConfig(companyId, 'qa.tra.population', { statuses: ['all'] });
      const statuses = Array.isArray(pop?.statuses) && pop.statuses.length ? pop.statuses : ['all'];
      const { data, error } = await supabaseAdmin.rpc('app_qa_materialize_tra', { p_company_id: companyId, p_statuses: statuses });
      if (error) logger.warn('QA_JOBS', `TRA ${companyId}: ${error.message}`);
      else tra = data || 0;
    } catch (e) { logger.warn('QA_JOBS', `TRA ${companyId} error: ${e.message}`); }
  }
  if (methods.includes('rcm')) {
    try {
      const covers = await getConfig(companyId, 'qa.rcm.covers', ['fronter']);
      const sample = await getConfig(companyId, 'qa.rcm.sample', { mode: 'percentage', value: 10, period: 'week' });
      const kind = sample?.period === 'day' ? 'day' : 'week';
      const { label, start, end } = previousPeriod(kind);
      const { data, error } = await supabaseAdmin.rpc('app_qa_materialize_rcm', {
        p_company_id: companyId,
        p_covers: Array.isArray(covers) && covers.length ? covers : ['fronter'],
        p_mode: sample?.mode === 'fixed' ? 'fixed' : 'percentage',
        p_value: Number.isFinite(+sample?.value) ? +sample.value : 10,
        p_period: label, p_start: start.toISOString(), p_end: end.toISOString(),
      });
      if (error) logger.warn('QA_JOBS', `RCM ${companyId}: ${error.message}`);
      else rcm = data || 0;
    } catch (e) { logger.warn('QA_JOBS', `RCM ${companyId} error: ${e.message}`); }
  }
  return { tra, rcm };
}

async function runQaMaterialization() {
  let companies;
  try { companies = await enabledCompanies(); }
  catch (e) { logger.warn('QA_JOBS', `enabledCompanies error: ${e.message}`); return; }
  if (!companies.length) return;   // nobody has QA on — nothing to do

  let traTotal = 0, rcmTotal = 0;
  for (const { companyId, methods } of companies) {
    const r = await materializeCompany(companyId, methods);
    traTotal += r.tra; rcmTotal += r.rcm;
  }
  if (traTotal || rcmTotal) {
    logger.info('QA_JOBS', `QA materialize: +${traTotal} TRA, +${rcmTotal} RCM across ${companies.length} co(s)`);
  }
}

module.exports = { runQaMaterialization, materializeCompany, previousPeriod };
