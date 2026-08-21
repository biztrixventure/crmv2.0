// ============================================================================
// qa2AutoAssign.js — QA v2 Phase 8: turns a qa2_sampling_rule into pool rows.
// qa2Sweep.js's header already promised this: "sampling decides what gets
// ASSIGNED (Phase 8), never what gets RECORDED" — every call is written to
// qa2_call regardless of sampling; THIS is what decides which of those calls
// become a qa2_assignment.
//
// Auto-created rows always land UNASSIGNED (origin='auto', assigned_to=NULL)
// — the pool. Who actually reviews it is still self-claim or manual push
// (both Phase 7), never decided here. That keeps this module a pure
// "which calls enter the workflow" filter, not a workload router.
//
// per_agent_per_day / per_agent_per_week count EXISTING assignments for that
// agent+period (any origin) before topping up to `quantity` — the job runs
// every few minutes as new calls arrive, so a naive "assign N this run" would
// blow past the cap on the second run of the same day/week.
// ============================================================================

const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');

function dayKey(iso) { return (iso || '').slice(0, 10); }

// ISO 8601 week key (Thursday-anchored), e.g. "2026-W32" — matches the
// standard definition so a week never splits across a month boundary oddly.
function weekKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Fisher-Yates on a copy — used for 'percent' mode so which calls get
// skipped isn't just "whatever sorted first" every run.
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function candidatesForRule(rule) {
  let q = supabaseAdmin
    .from('qa2_call')
    .select('id, agent_user_id, call_at, talk_sec')
    .eq('company_id', rule.company_id)
    .eq('method_id', rule.method_id)
    .eq('qa_relevant', true)
    .order('call_at', { ascending: true })
    .limit(2000);
  const { data: calls, error } = await q;
  if (error) { logger.warn('QA2_AUTOASSIGN', `candidates ${rule.id}: ${error.message}`); return []; }

  const minTalk = Number(rule.min_talk_sec) || 0;
  const eligible = (calls || []).filter(c => (c.talk_sec || 0) >= minTalk);
  if (!eligible.length) return [];

  const callIds = eligible.map(c => c.id);
  const { data: existing } = await supabaseAdmin.from('qa2_assignment').select('call_id').in('call_id', callIds);
  const already = new Set((existing || []).map(a => a.call_id));
  return eligible.filter(c => !already.has(c.id));
}

// For the per-agent cap modes: how many assignments this agent already has
// for calls of this method within the given period (any origin) — the
// baseline the new quota tops up from.
async function existingCountsByAgentPeriod(methodId, keyFn) {
  const { data, error } = await supabaseAdmin
    .from('qa2_assignment')
    .select('qa2_call!inner(agent_user_id, call_at, method_id)')
    .eq('qa2_call.method_id', methodId);
  if (error) { logger.warn('QA2_AUTOASSIGN', `existing counts ${methodId}: ${error.message}`); return new Map(); }
  const counts = new Map();
  for (const row of (data || [])) {
    const c = row.qa2_call;
    const key = `${c.agent_user_id}:${keyFn(c.call_at)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

async function selectByRule(rule, candidates) {
  if (rule.mode === 'full_coverage') return candidates;

  if (rule.mode === 'percent') {
    const pct = Math.max(0, Math.min(100, Number(rule.quantity) || 0));
    const n = Math.round(candidates.length * (pct / 100));
    return shuffled(candidates).slice(0, n);
  }

  const perPeriod = rule.mode === 'per_agent_per_day' ? dayKey : weekKey;
  const quantity = Math.max(0, Number(rule.quantity) || 0);
  if (!quantity) return [];

  const existingCounts = await existingCountsByAgentPeriod(rule.method_id, perPeriod);
  const runningCounts = new Map();
  const picked = [];
  for (const c of candidates) {
    if (!c.agent_user_id || !c.call_at) continue;
    const key = `${c.agent_user_id}:${perPeriod(c.call_at)}`;
    const already = existingCounts.get(key) || 0;
    const takenThisRun = runningCounts.get(key) || 0;
    if (already + takenThisRun >= quantity) continue;
    runningCounts.set(key, takenThisRun + 1);
    picked.push(c);
  }
  return picked;
}

async function runQa2AutoAssign() {
  const { data: rules, error } = await supabaseAdmin.from('qa2_sampling_rule').select('*').eq('is_active', true);
  if (error) { logger.warn('QA2_AUTOASSIGN', `rules: ${error.message}`); return { created: 0 }; }
  if (!rules || !rules.length) return { created: 0 };

  let created = 0;
  for (const rule of rules) {
    try {
      const candidates = await candidatesForRule(rule);
      if (!candidates.length) continue;
      const selected = await selectByRule(rule, candidates);
      if (!selected.length) continue;

      const now = new Date().toISOString();
      const rows = selected.map(c => ({ call_id: c.id, status: 'pending', origin: 'auto', assigned_to: null, priority: 0, created_at: now }));
      const { error: insErr } = await supabaseAdmin.from('qa2_assignment').insert(rows);
      if (insErr) { logger.warn('QA2_AUTOASSIGN', `insert rule ${rule.id}: ${insErr.message}`); continue; }
      created += rows.length;
    } catch (e) { logger.warn('QA2_AUTOASSIGN', `rule ${rule.id}: ${e.message}`); }
  }
  if (created) logger.info('QA2_AUTOASSIGN', `created ${created} pool assignment(s) from sampling rules`);
  return { created };
}

// Ageing purge — untouched (still 'pending', still unassigned) rows drop
// after 2 days, matching v1's mig 177 retention EXACTLY (qa2AutoAssign's own
// migration comment calls this out by name). Assigned, opened, or resolved
// work never ages out — only rows nobody has touched yet.
const RETENTION_DAYS = 2;

async function purgeStaleQa2Assignments() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
  try {
    const { data, error } = await supabaseAdmin
      .from('qa2_assignment')
      .delete()
      .eq('status', 'pending')
      .is('assigned_to', null)
      .lt('created_at', cutoff)
      .select('id');
    if (error) { logger.warn('QA2_AUTOASSIGN', `retention purge: ${error.message}`); return 0; }
    const n = (data || []).length;
    if (n) logger.info('QA2_AUTOASSIGN', `QA v2 retention: purged ${n} stale unassigned assignment(s) older than ${RETENTION_DAYS}d`);
    return n;
  } catch (e) { logger.warn('QA2_AUTOASSIGN', `retention purge error: ${e.message}`); return 0; }
}

// ── retention for the calls QA will never open ──────────────────────────────
// Every dial becomes a qa2_call row (~50k/day). Mig 262 parks the ones nobody
// reviews as 'skipped' so their audio is never chased; this clears the parked
// rows out once they are old enough. The RPC only touches rows that carry no
// method, transfer, sale, paired leg, recording, evaluation, assignment or
// listen-log — anything a human or the CRM touched is left alone. Batched,
// looped until a pass comes back short so a long backlog drains over several
// ticks instead of one giant delete.
const PARKED_RETENTION_DAYS = 14;
const PARKED_BATCH = 5000;
const PARKED_MAX_BATCHES = 10;

async function purgeParkedQa2Calls() {
  let total = 0;
  try {
    for (let i = 0; i < PARKED_MAX_BATCHES; i++) {
      const { data, error } = await supabaseAdmin.rpc('app_qa2_purge_parked', {
        p_days: PARKED_RETENTION_DAYS, p_limit: PARKED_BATCH,
      });
      if (error) { logger.warn('QA2_AUTOASSIGN', `parked purge: ${error.message}`); break; }
      const n = Number(data || 0);
      total += n;
      if (n < PARKED_BATCH) break;   // caught up
    }
    if (total) logger.info('QA2_AUTOASSIGN', `QA v2 retention: purged ${total} parked call(s) older than ${PARKED_RETENTION_DAYS}d`);
  } catch (e) { logger.warn('QA2_AUTOASSIGN', `parked purge error: ${e.message}`); }
  return total;
}

module.exports = { runQa2AutoAssign, purgeStaleQa2Assignments, purgeParkedQa2Calls };
