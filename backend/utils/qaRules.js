// ============================================================================
// utils/qaRules.js — compliance work rules: WHO listens to WHAT (mig 186).
//
// A qa_routing_rules row binds one QA reviewer to a combination of:
//   work_types        tra | rcm | closer_sales | closer_dispo (any mix)
//   subject_user_ids  empty = every agent; else only these fronters/closers
//   dispositions      closer_dispo only; empty = any non-SALE disposition
//
// Two jobs:
//   materializeCloserWork(companyId, rules) — create the qa_assignments the
//     closer-side work types need (sales calls of closers; transfers that
//     landed on a closer with a matching disposition). tra/rcm base pools come
//     from the existing materializer RPCs.
//   applyCompanyRules(companyId)            — route the company's UNASSIGNED
//     pending tasks to the reviewers whose rules match (work type + subject +
//     disposition), balanced across matching reviewers. Runs before the
//     generic coverage round-robin, so specific rules always win.
//
// Deploy-safe: if migration 186 isn't applied yet every function no-ops with a
// soft log — materialization and the old routing keep working untouched.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { getConfig } = require('./businessConfig');
const logger = require('./logger');

const WORK_TYPES = ['tra', 'rcm', 'closer_sales', 'closer_dispo'];

const up = (s) => String(s || '').trim().toUpperCase();

// Work type of an assignment row — stored tag first, derived for older rows.
// No CRM link at all (raw dialer recording) = RCM whatever the subject's role.
function workTypeOf(row) {
  if (row.work_type) return row.work_type;
  if (row.sale_id) return 'closer_sales';
  if (row.method === 'tra') return 'tra';
  if (!row.transfer_id) return 'rcm';
  if (row.subject_role === 'closer') return 'closer_dispo';
  return 'rcm';
}

async function getActiveRules(companyId) {
  try {
    let q = supabaseAdmin.from('qa_routing_rules').select('*').eq('is_active', true).order('created_at', { ascending: true });
    if (companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) { logger.warn('QA_RULES', `rules read: ${error.message}`); return []; }
    return data || [];
  } catch { return []; }
}

// distinct companies that have at least one active rule (for the scheduler)
async function ruleCompanies() {
  const rules = await getActiveRules(null);
  return [...new Set(rules.map(r => r.company_id))];
}

// Insert assignment rows, tolerating the unique (transfer_id|sale_id, method)
// guards — batch first, row-by-row on conflict so non-duplicates still land.
async function insertAssignments(rows) {
  if (!rows.length) return 0;
  const { data, error } = await supabaseAdmin.from('qa_assignments').insert(rows).select('id');
  if (!error) return (data || []).length;
  if (!/duplicate key|unique/i.test(error.message)) { logger.warn('QA_RULES', `insert: ${error.message}`); return 0; }
  let n = 0;
  for (const row of rows) {
    const { error: e1 } = await supabaseAdmin.from('qa_assignments').insert(row);
    if (!e1) n++;
  }
  return n;
}

// Materialize the closer-side work types a company's rules ask for.
//   closer_sales — one assignment per recent sale (method rcm, role closer)
//   closer_dispo — one per recent transfer that landed on a closer and ended
//                  with a matching disposition (method rcm, role closer)
// Window = qa.retention_days (same as the TRA materializer) so purged rows are
// never recreated (no churn).
async function materializeCloserWork(companyId, rules) {
  const out = { closer_sales: 0, closer_dispo: 0 };
  const active = (rules || []).filter(r => r.is_active !== false);
  if (!active.length) return out;
  const types = new Set(active.flatMap(r => r.work_types || []));
  const retDaysRaw = Number(await getConfig(companyId, 'qa.retention_days', 2));
  const retDays = Number.isFinite(retDaysRaw) ? Math.min(30, Math.max(1, Math.round(retDaysRaw))) : 2;
  const since = new Date(Date.now() - retDays * 86400000).toISOString();

  try {
    if (types.has('closer_sales')) {
      const { data: sales } = await supabaseAdmin.from('sales')
        .select('id').eq('company_id', companyId).gte('created_at', since).limit(3000);
      const ids = (sales || []).map(s => s.id);
      if (ids.length) {
        const { data: existing } = await supabaseAdmin.from('qa_assignments')
          .select('sale_id').in('sale_id', ids);
        const have = new Set((existing || []).map(r => r.sale_id));
        const rows = ids.filter(id => !have.has(id)).map(id => ({
          company_id: companyId, method: 'rcm', subject_role: 'closer', sale_id: id,
          work_type: 'closer_sales', source: 'rule', status: 'pending', sampled: false,
        }));
        out.closer_sales = await insertAssignments(rows);
      }
    }

    if (types.has('closer_dispo')) {
      // union of the rules' disposition filters; any rule with an empty list
      // means "any non-SALE disposition" → no code filter, exclude SALE later.
      const dispoRules = active.filter(r => (r.work_types || []).includes('closer_dispo'));
      const anyOpen = dispoRules.some(r => !(r.dispositions || []).length);
      const codes = [...new Set(dispoRules.flatMap(r => (r.dispositions || []).map(up)).filter(Boolean))];

      let q = supabaseAdmin.from('transfers')
        .select('id, latest_disposition').eq('company_id', companyId)
        .not('assigned_closer_id', 'is', null).not('latest_disposition', 'is', null)
        .neq('vicidial_pending', true).gte('created_at', since).limit(3000);
      const { data: transfers } = await q;
      const match = (t) => {
        const d = up(t.latest_disposition);
        if (!d) return false;
        if (anyOpen) return d !== 'SALE';
        return codes.includes(d);
      };
      const ids = (transfers || []).filter(match).map(t => t.id);
      if (ids.length) {
        const { data: existing } = await supabaseAdmin.from('qa_assignments')
          .select('transfer_id').eq('method', 'rcm').in('transfer_id', ids);
        const have = new Set((existing || []).map(r => r.transfer_id));
        const rows = ids.filter(id => !have.has(id)).map(id => ({
          company_id: companyId, method: 'rcm', subject_role: 'closer', transfer_id: id,
          work_type: 'closer_dispo', source: 'rule', status: 'pending', sampled: false,
        }));
        out.closer_dispo = await insertAssignments(rows);
      }
    }
  } catch (e) { logger.warn('QA_RULES', `materializeCloserWork ${companyId}: ${e.message}`); }
  return out;
}

// Route the company's unassigned pending tasks by its rules. Specific rules run
// BEFORE the generic coverage round-robin (caller order guarantees it). Returns
// { assigned, byReviewer } — byReviewer feeds notifications.
async function applyCompanyRules(companyId) {
  const result = { assigned: 0, byReviewer: {} };
  const rules = await getActiveRules(companyId);
  if (!rules.length) return result;

  try {
    const { data: tasks } = await supabaseAdmin.from('qa_assignments')
      .select('id, method, transfer_id, sale_id, subject_role, work_type')
      .eq('company_id', companyId).eq('status', 'pending').is('assigned_to', null)
      .order('created_at', { ascending: true }).limit(5000);
    if (!tasks || !tasks.length) return result;

    // resolve each task's subject user + disposition in two batched reads
    const tIds = [...new Set(tasks.map(t => t.transfer_id).filter(Boolean))];
    const sIds = [...new Set(tasks.map(t => t.sale_id).filter(Boolean))];
    const tById = {}; const sById = {};
    for (let i = 0; i < tIds.length; i += 400) {
      const { data } = await supabaseAdmin.from('transfers')
        .select('id, created_by, assigned_closer_id, latest_disposition').in('id', tIds.slice(i, i + 400));
      (data || []).forEach(t => { tById[t.id] = t; });
    }
    for (let i = 0; i < sIds.length; i += 400) {
      const { data } = await supabaseAdmin.from('sales').select('id, closer_id').in('id', sIds.slice(i, i + 400));
      (data || []).forEach(s => { sById[s.id] = s; });
    }

    // reviewer → task ids, balanced: when several rules match a task, the
    // reviewer with the fewest picks this run takes it.
    const picks = {};   // reviewer_id -> [task ids]
    const load = (rid) => (picks[rid] || []).length;

    for (const task of tasks) {
      const wt = workTypeOf(task);
      const t = task.transfer_id ? tById[task.transfer_id] : null;
      const s = task.sale_id ? sById[task.sale_id] : null;
      const subject = task.subject_role === 'closer'
        ? (s?.closer_id || t?.assigned_closer_id || null)
        : (t?.created_by || null);
      const dispo = up(t?.latest_disposition);

      const matching = rules.filter(r => {
        if (!(r.work_types || []).includes(wt)) return false;
        const subjects = r.subject_user_ids || [];
        if (subjects.length && (!subject || !subjects.includes(subject))) return false;
        if (wt === 'closer_dispo') {
          const codes = (r.dispositions || []).map(up).filter(Boolean);
          if (codes.length && !codes.includes(dispo)) return false;
        }
        return true;
      });
      if (!matching.length) continue;
      const reviewers = [...new Set(matching.map(r => r.reviewer_id))];
      reviewers.sort((a, b) => load(a) - load(b));
      (picks[reviewers[0]] ||= []).push(task.id);
    }

    const stamp = new Date().toISOString();
    for (const [reviewer, ids] of Object.entries(picks)) {
      for (let i = 0; i < ids.length; i += 400) {
        const chunk = ids.slice(i, i + 400);
        const { error } = await supabaseAdmin.from('qa_assignments')
          .update({ assigned_to: reviewer, assigned_at: stamp }).in('id', chunk);
        if (error) { logger.warn('QA_RULES', `route → ${reviewer}: ${error.message}`); continue; }
        result.assigned += chunk.length;
        result.byReviewer[reviewer] = (result.byReviewer[reviewer] || 0) + chunk.length;
      }
    }
    if (result.assigned) logger.info('QA_RULES', `rules routed ${result.assigned} task(s) in ${companyId}`);
  } catch (e) { logger.warn('QA_RULES', `applyCompanyRules ${companyId}: ${e.message}`); }
  return result;
}

module.exports = { WORK_TYPES, workTypeOf, getActiveRules, ruleCompanies, materializeCloserWork, applyCompanyRules };
