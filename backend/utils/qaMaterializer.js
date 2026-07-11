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
const { autoAssignCompany } = require('./qaAutoAssign');
const { getActiveRules, materializeCloserWork, applyCompanyRules } = require('./qaRules');
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

// retention window in days — clamp 1..30, default 2.
function clampRetentionDays(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 2;
  return Math.min(30, Math.max(1, Math.round(n)));
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
  const retDays = clampRetentionDays(await getConfig(companyId, 'qa.retention_days', 2));
  let tra = 0, rcm = 0;
  if (methods.includes('tra')) {
    try {
      const pop = await getConfig(companyId, 'qa.tra.population', { statuses: ['all'] });
      const statuses = Array.isArray(pop?.statuses) && pop.statuses.length ? pop.statuses : ['all'];
      // Only materialize RECENT transfers. Untouched TRA rows age out via the
      // retention purge; bounding materialization to the same window means a
      // purged row's transfer is out of scope → never recreated (no churn).
      const since = new Date(Date.now() - retDays * 86400000).toISOString();
      const { data, error } = await supabaseAdmin.rpc('app_qa_materialize_tra', { p_company_id: companyId, p_statuses: statuses, p_since: since });
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
  // Route the freshly-materialized (and any older unassigned) tasks. Compliance
  // WORK RULES first (who listens to what — specific reviewer/work-type/subject
  // combos), then the generic per-company coverage round-robin picks up the
  // leftovers. No rule + no coverage → stays in the pool for a manual assign.
  let assigned = 0;
  try { assigned += (await applyCompanyRules(companyId)).assigned; }
  catch (e) { logger.warn('QA_JOBS', `rules ${companyId}: ${e.message}`); }
  try { assigned += (await autoAssignCompany(companyId)).assigned; }
  catch (e) { logger.warn('QA_JOBS', `auto-assign ${companyId}: ${e.message}`); }
  return { tra, rcm, assigned };
}

// ── retention purge ─────────────────────────────────────────────────────────
// Drop QA assignments nobody ever touched: still 'pending' AND unassigned AND
// older than qa.retention_days. KEEPS everything worked (assigned_to set) or
// moved past pending (in_review/scored/skipped) forever, plus their reviews.
// Paired with the TRA lookback window so a purged row is never recreated.
async function purgeStaleQaAssignments() {
  const retDays = clampRetentionDays(await getConfig(null, 'qa.retention_days', 2));
  const cutoff = new Date(Date.now() - retDays * 86400000).toISOString();
  try {
    const { data, error } = await supabaseAdmin
      .from('qa_assignments')
      .delete()
      .eq('status', 'pending')
      .is('assigned_to', null)
      .lt('created_at', cutoff)
      .select('id');
    if (error) { logger.warn('QA_JOBS', `retention purge: ${error.message}`); return 0; }
    const n = (data || []).length;
    if (n) logger.info('QA_JOBS', `QA retention: purged ${n} stale unassigned assignment(s) older than ${retDays}d`);
    return n;
  } catch (e) { logger.warn('QA_JOBS', `retention purge error: ${e.message}`); return 0; }
}

async function runQaMaterialization() {
  let companies;
  try { companies = await enabledCompanies(); }
  catch (e) { logger.warn('QA_JOBS', `enabledCompanies error: ${e.message}`); companies = []; }

  let traTotal = 0, rcmTotal = 0;
  for (const { companyId, methods } of companies) {
    const r = await materializeCompany(companyId, methods);
    traTotal += r.tra; rcmTotal += r.rcm;
  }
  if (traTotal || rcmTotal) {
    logger.info('QA_JOBS', `QA materialize: +${traTotal} TRA, +${rcmTotal} RCM across ${companies.length} co(s)`);
  }

  // Compliance WORK RULES run even for companies whose qa.methods is off — a
  // rule is explicit intent. Materialize the base pools a rule needs (tra/rcm
  // via the RPCs, closer work here) and route.
  try {
    const rules = await getActiveRules(null);
    const byCo = {};
    for (const r of rules) (byCo[r.company_id] ||= []).push(r);
    const enabledSet = new Set(companies.map(c => c.companyId));
    for (const [coId, coRules] of Object.entries(byCo)) {
      const types = new Set(coRules.flatMap(r => r.work_types || []));
      const base = ['tra', 'rcm'].filter(t => types.has(t));
      if (base.length && !enabledSet.has(coId)) await materializeCompany(coId, base);
      const c = await materializeCloserWork(coId, coRules);
      const routed = await applyCompanyRules(coId);
      if (c.closer_sales || c.closer_dispo || routed.assigned) {
        logger.info('QA_JOBS', `rules ${coId}: +${c.closer_sales} sales, +${c.closer_dispo} dispo, routed ${routed.assigned}`);
      }
    }
  } catch (e) { logger.warn('QA_JOBS', `rules pass: ${e.message}`); }

  // retention runs even if nothing was materialized this tick (backlog drains).
  await purgeStaleQaAssignments();
}

module.exports = { runQaMaterialization, materializeCompany, previousPeriod, purgeStaleQaAssignments };
