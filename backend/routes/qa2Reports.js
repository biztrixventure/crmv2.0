// ============================================================================
// qa2Reports.js — /qa2/reports/{agent,parameters,reviewers,autofails,
// calibration,coverage}. Read-only aggregates over qa2_evaluation/qa2_answer/
// qa2_call, computed in Node the same way qa2AutoAssign.js and qa2Sweep.js
// already do — no new SQL views/RPCs for QA v2 anywhere in this build, so
// reports don't start that pattern either.
//
// SCOPING NUANCE: qa2Scope.js's own header says compliance sees everything
// for reporting "always, toggle or not" — but an UNTOGGLED compliance_manager
// resolves operationalCompanyIds/operationalMethodIds to [] (empty), not
// 'all'. Every filter below checks scope.isCompliance FIRST and skips the
// array filter entirely for them — the same bypass qa2Calibration.js already
// uses — otherwise a plain compliance_manager would see zero rows everywhere.
//
// "Final" evaluations for scoring aggregates = status IN (submitted,
// flagged) — flagged is still the live number until an override supersedes
// it; superseded/void/draft are excluded (mig 237's supersession model: the
// superseding evaluation IS the one that counts once it exists).
// ============================================================================

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/database');
const { resolveQa2Scope } = require('../utils/qa2ScopeResolver');
const { isYes } = require('../utils/qa2Scoring');

const LIVE_STATUSES = ['submitted', 'flagged'];

// Every section below fetches at most this many rows and aggregates in Node —
// there was no signal at all when a busy company/date-range quietly exceeded
// the cap, so a manager reading "142 evaluations" had no way to know it might
// really be 20,142. `truncated` below is cheap (no extra COUNT round trip):
// hitting the cap exactly is itself the signal, so the frontend can say
// "showing the most recent N — narrow your range for exact totals" instead of
// silently presenting a partial number as complete.
const capInfo = (rows, cap) => ({ truncated: (rows || []).length >= cap });

async function requireViewer(req, res) {
  const scope = await resolveQa2Scope(req);
  if (!scope.managerAccess && !scope.isCompliance) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return scope;
}

// null = no restriction; array (possibly empty) = restrict to these ids.
function scopedCompanyIds(scope) {
  if (scope.isCompliance || scope.operationalCompanyIds === 'all') return null;
  return scope.operationalCompanyIds;
}
function scopedMethodIds(scope) {
  if (scope.isCompliance || scope.operationalMethodIds === 'all') return null;
  return scope.operationalMethodIds;
}

function applyRange(q, column, from, to) {
  if (from) q = q.gte(column, from);
  if (to) q = q.lte(column, to);
  return q;
}

async function nameMap(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { data } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
  return new Map((data || []).map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown']));
}

// ── GET /qa2/reports/overview — the department as it stands today ─────────
// Every other section here is computed from qa2_evaluation, and a department
// that has just started scoring has almost nothing in that table: 11,234
// reviewable calls, 3,399 assignments, 2 scored evaluations. So every chart a
// manager opened was honestly empty, and an empty chart reads as a broken one.
//
// This answers the questions that DO have answers on day one — what was
// captured, does it have audio, is both legs of it there, who is holding it,
// and what is still waiting to be handed out. One RPC (mig 276) rather than a
// dozen counts, and the same scoping every other section uses.
router.get('/reports/overview', asyncHandler(async (req, res) => {
  const scope = await requireViewer(req, res);
  if (!scope) return;

  const companyIds = scopedCompanyIds(scope);
  const methodIds = scopedMethodIds(scope);
  // An empty (not null) scope array means "restricted to nothing" — return the
  // empty shape rather than passing NULL, which the RPC reads as "no filter"
  // and would show this caller the whole department.
  const restrictedToNothing = (companyIds && !companyIds.length) || (methodIds && !methodIds.length);

  // Same query contract as every other section here — company_id / from / to —
  // so the one filter bar drives all of them.
  const { company_id, from, to } = req.query;
  const asked = company_id ? [company_id] : [];
  const effectiveCompanies = asked.length
    ? (companyIds ? asked.filter(id => companyIds.includes(id)) : asked)
    : companyIds;

  const empty = { pipeline: {}, by_method: [], by_company: [], daily: [], team: [] };
  if (restrictedToNothing) return res.json({ ...empty, range: { from: from || null, to: to || null } });

  const { data, error } = await supabaseAdmin.rpc('app_qa2_overview', {
    p_company_ids: effectiveCompanies && effectiveCompanies.length ? effectiveCompanies : null,
    p_method_ids: methodIds && methodIds.length ? methodIds : null,
    p_from: from ? `${from}T00:00:00.000Z` : null,
    p_to: to ? `${to}T23:59:59.999Z` : null,
  });
  if (error) return res.status(500).json({ error: error.message });

  const out = data || empty;
  const names = await nameMap((out.team || []).map(t => t.agent_id));
  out.team = (out.team || []).map(t => ({ ...t, name: names.get(t.agent_id) || 'Unknown' }));
  out.range = { from: from || null, to: to || null };
  res.json(out);
}));

// ── GET /qa2/reports/agent — per subject (the person being scored) ─────────

router.get('/reports/agent', asyncHandler(async (req, res) => {
  const scope = await requireViewer(req, res);
  if (!scope) return;
  const { company_id, from, to } = req.query;

  const AGENT_CAP = 75000;
  let q = supabaseAdmin.from('qa2_evaluation')
    .select('subject_user_id, company_id, final_score, result, autofail_result, submitted_at')
    .in('status', LIVE_STATUSES).order('submitted_at', { ascending: false }).limit(AGENT_CAP);
  const companyIds = scopedCompanyIds(scope);
  if (companyIds !== null) q = q.in('company_id', companyIds);
  if (company_id) q = q.eq('company_id', company_id);
  q = applyRange(q, 'submitted_at', from, to);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const byAgent = new Map();
  const byDay = new Map();
  for (const e of (data || [])) {
    if (!e.subject_user_id) continue;
    const a = byAgent.get(e.subject_user_id) || { agent_id: e.subject_user_id, count: 0, score_sum: 0, pass: 0, autofail: 0 };
    a.count += 1;
    if (e.final_score != null) a.score_sum += Number(e.final_score);
    if (e.result === 'pass') a.pass += 1;
    if (e.autofail_result === 'fail') a.autofail += 1;
    byAgent.set(e.subject_user_id, a);

    if (e.submitted_at) {
      const day = e.submitted_at.slice(0, 10);
      const d = byDay.get(day) || { date: day, count: 0, score_sum: 0 };
      d.count += 1;
      if (e.final_score != null) d.score_sum += Number(e.final_score);
      byDay.set(day, d);
    }
  }
  const names = await nameMap([...byAgent.keys()]);
  const agents = [...byAgent.values()]
    .map(a => ({ agent_id: a.agent_id, name: names.get(a.agent_id) || 'Unknown', count: a.count, avg_score: a.count ? Math.round((a.score_sum / a.count) * 10) / 10 : null, pass_rate: a.count ? Math.round((a.pass / a.count) * 1000) / 10 : null, autofail_rate: a.count ? Math.round((a.autofail / a.count) * 1000) / 10 : null }))
    .sort((x, y) => y.count - x.count);
  const daily = [...byDay.values()].map(d => ({ date: d.date, count: d.count, avg_score: d.count ? Math.round((d.score_sum / d.count) * 10) / 10 : null })).sort((x, y) => x.date.localeCompare(y.date));

  res.json({ agents, daily, ...capInfo(data, AGENT_CAP) });
}));

// ── GET /qa2/reports/performance — people, ranked, with WHY ────────────────
// One call answers the coaching questions the agent/parameter reports only hint
// at: who is scoring well or badly (closers and fronters separately — they are
// scored on different forms), whether each person is improving (this period vs
// the equal-length period before it), and WHICH parameter each person fails
// most — the thing a manager needs to say in the 1:1. role=reviewer turns the
// same lens on the QA agents: volume, pace, strictness vs the team, and what
// they flag most. Everything is computed from live evaluations + their answers.
router.get('/reports/performance', asyncHandler(async (req, res) => {
  const scope = await requireViewer(req, res);
  if (!scope) return;
  const { company_id } = req.query;
  const role = ['fronter', 'closer', 'reviewer'].includes(req.query.role) ? req.query.role : 'closer';

  // Period: explicit range, else the last 30 days. The previous period is the
  // same length immediately before it — that is what "improving" is measured on.
  const DAY = 86400000;
  const to   = req.query.to   ? new Date(req.query.to)   : new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 30 * DAY);
  const span = Math.max(DAY, to.getTime() - from.getTime());
  const prevTo = new Date(from.getTime() - 1), prevFrom = new Date(from.getTime() - span);
  const iso = d => d.toISOString();

  const companyIds = scopedCompanyIds(scope);
  const EVAL_CAP = 20000;
  const baseEvals = (lo, hi, cols) => {
    let q = supabaseAdmin.from('qa2_evaluation').select(cols)
      .in('status', LIVE_STATUSES).gte('submitted_at', iso(lo)).lte('submitted_at', iso(hi))
      .order('submitted_at', { ascending: false }).limit(EVAL_CAP);
    if (role !== 'reviewer') q = q.eq('subject_role', role);
    if (companyIds !== null) q = q.in('company_id', companyIds);
    if (company_id) q = q.eq('company_id', company_id);
    return q;
  };

  const [{ data: cur, error: e1 }, { data: prev, error: e2 }] = await Promise.all([
    baseEvals(from, to, 'id, subject_user_id, reviewer_id, company_id, final_score, result, autofail_result, submitted_at, active_seconds, qa2_call(qa2_method(label))'),
    baseEvals(prevFrom, prevTo, 'subject_user_id, reviewer_id, final_score'),
  ]);
  if (e1) return res.status(500).json({ error: e1.message });
  if (e2) return res.status(500).json({ error: e2.message });

  const keyOf = e => (role === 'reviewer' ? e.reviewer_id : e.subject_user_id);

  // Answers for the current period, chunked — the per-person parameter picture.
  const ids = (cur || []).map(e => e.id);
  const answers = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabaseAdmin.from('qa2_answer')
      .select('evaluation_id, value_num, value_text, value_bool, is_na, qa2_parameter!inner(lineage_id, label, role)')
      .in('evaluation_id', ids.slice(i, i + 150));
    answers.push(...(data || []));
  }
  const evalOwner = new Map((cur || []).map(e => [e.id, keyOf(e)]));
  const isNegative = (row) => {
    const p = row.qa2_parameter;
    return ['autofail', 'penalty'].includes(p.role) ? isYes(row) : (row.value_text || '').toUpperCase() === 'N';
  };

  // team-level parameter picture (the benchmark every person is compared to)
  const teamParams = new Map();   // lineage → {label, role, answered, flagged}
  const personParams = new Map(); // person → lineage → {answered, flagged}
  for (const row of answers) {
    if (row.is_na) continue;
    const p = row.qa2_parameter;
    const owner = evalOwner.get(row.evaluation_id);
    const neg = isNegative(row);
    const t = teamParams.get(p.lineage_id) || { lineage_id: p.lineage_id, label: p.label, role: p.role, answered: 0, flagged: 0 };
    t.label = p.label; t.answered++; if (neg) t.flagged++;
    teamParams.set(p.lineage_id, t);
    if (!owner) continue;
    const pm = personParams.get(owner) || new Map();
    const pp = pm.get(p.lineage_id) || { answered: 0, flagged: 0 };
    pp.answered++; if (neg) pp.flagged++;
    pm.set(p.lineage_id, pp); personParams.set(owner, pm);
  }
  const rate = (f, a) => (a ? Math.round((f / a) * 1000) / 10 : null);
  const parameters = [...teamParams.values()]
    .map(t => ({ ...t, flag_rate: rate(t.flagged, t.answered) }))
    .sort((x, y) => (y.flag_rate ?? -1) - (x.flag_rate ?? -1));

  // people
  const people = new Map();
  for (const e of (cur || [])) {
    const k = keyOf(e); if (!k) continue;
    const p = people.get(k) || { id: k, count: 0, score_sum: 0, scored: 0, pass: 0, autofail: 0, active_sum: 0, active_n: 0, days: new Set(), last_at: null, recent: [] };
    p.count++;
    if (e.final_score != null) { p.score_sum += Number(e.final_score); p.scored++; }
    if (e.result === 'pass') p.pass++;
    if (e.autofail_result === 'fail') p.autofail++;
    if (e.active_seconds > 0) { p.active_sum += e.active_seconds; p.active_n++; }
    if (e.submitted_at) { p.days.add(e.submitted_at.slice(0, 10)); if (!p.last_at || e.submitted_at > p.last_at) p.last_at = e.submitted_at; }
    if (p.recent.length < 8) p.recent.push({ id: e.id, submitted_at: e.submitted_at, final_score: e.final_score, result: e.result, autofail: e.autofail_result === 'fail', method: e.qa2_call?.qa2_method?.label || null, other_id: role === 'reviewer' ? e.subject_user_id : e.reviewer_id });
    people.set(k, p);
  }
  const prevAgg = new Map();
  for (const e of (prev || [])) {
    const k = keyOf(e); if (!k || e.final_score == null) continue;
    const a = prevAgg.get(k) || { sum: 0, n: 0 }; a.sum += Number(e.final_score); a.n++; prevAgg.set(k, a);
  }

  const teamScored = (cur || []).filter(e => e.final_score != null);
  const team = {
    count: (cur || []).length,
    people: people.size,
    avg_score: teamScored.length ? Math.round((teamScored.reduce((s, e) => s + Number(e.final_score), 0) / teamScored.length) * 10) / 10 : null,
    pass_rate: rate((cur || []).filter(e => e.result === 'pass').length, (cur || []).length),
    autofail_rate: rate((cur || []).filter(e => e.autofail_result === 'fail').length, (cur || []).length),
  };

  const names = await nameMap([...people.keys(), ...[...people.values()].flatMap(p => p.recent.map(r => r.other_id))]);
  const out = [...people.values()].map(p => {
    const avg = p.scored ? Math.round((p.score_sum / p.scored) * 10) / 10 : null;
    const pa = prevAgg.get(p.id);
    const prevAvg = pa && pa.n ? Math.round((pa.sum / pa.n) * 10) / 10 : null;
    const pm = personParams.get(p.id) || new Map();
    const params = {};
    let weakest = null;
    for (const [lin, v] of pm) {
      const r = rate(v.flagged, v.answered);
      params[lin] = { answered: v.answered, flagged: v.flagged, flag_rate: r };
      // weakest = highest flag rate with at least 2 answers, so one bad call
      // does not brand someone; ties go to the more-answered parameter
      if (v.answered >= 2 && r != null && r > 0 && (!weakest || r > weakest.flag_rate || (r === weakest.flag_rate && v.answered > weakest.answered))) {
        weakest = { lineage_id: lin, label: teamParams.get(lin)?.label || '?', flag_rate: r, answered: v.answered };
      }
    }
    return {
      id: p.id, name: names.get(p.id) || 'Unknown',
      count: p.count, avg_score: avg, pass_rate: rate(p.pass, p.count), autofail_rate: rate(p.autofail, p.count),
      prev_avg_score: prevAvg, delta: avg != null && prevAvg != null ? Math.round((avg - prevAvg) * 10) / 10 : null,
      last_at: p.last_at, weakest, params,
      recent: p.recent.map(r => ({ ...r, other_name: names.get(r.other_id) || null })),
      // reviewer lens
      ...(role === 'reviewer' ? {
        per_day: p.days.size ? Math.round((p.count / p.days.size) * 10) / 10 : null,
        avg_active_min: p.active_n ? Math.round((p.active_sum / p.active_n) / 6) / 10 : null,
        strictness: avg != null && team.avg_score != null ? Math.round((avg - team.avg_score) * 10) / 10 : null,
      } : {}),
    };
  }).sort((x, y) => (y.avg_score ?? -1) - (x.avg_score ?? -1) || y.count - x.count);

  res.json({
    role, period: { from: iso(from), to: iso(to), prev_from: iso(prevFrom), prev_to: iso(prevTo) },
    team, parameters, people: out, ...capInfo(cur, EVAL_CAP),
  });
}));

// ── GET /qa2/reports/parameters — flag rate per question, across versions ──

router.get('/reports/parameters', asyncHandler(async (req, res) => {
  const scope = await requireViewer(req, res);
  if (!scope) return;
  const { company_id, from, to } = req.query;

  const PARAM_CAP = 75000;
  let q = supabaseAdmin.from('qa2_answer')
    .select('parameter_id, value_num, value_text, value_bool, is_na, qa2_parameter!inner(id, key, label, role, lineage_id), qa2_evaluation!inner(id, status, company_id, submitted_at)')
    .in('qa2_evaluation.status', LIVE_STATUSES).limit(PARAM_CAP);
  const companyIds = scopedCompanyIds(scope);
  if (companyIds !== null) q = q.in('qa2_evaluation.company_id', companyIds);
  if (company_id) q = q.eq('qa2_evaluation.company_id', company_id);
  if (from) q = q.gte('qa2_evaluation.submitted_at', from);
  if (to) q = q.lte('qa2_evaluation.submitted_at', to);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const byLineage = new Map();
  for (const row of (data || [])) {
    if (row.is_na) continue;
    const p = row.qa2_parameter;
    const key = p.lineage_id;
    const entry = byLineage.get(key) || { lineage_id: key, label: p.label, role: p.role, answered: 0, flagged: 0 };
    entry.label = p.label; // last-seen label wins — the most recent version's wording
    entry.answered += 1;
    // Flag semantics mirror qa2Evaluations.js's own submit-time comment gate:
    // for autofail/penalty questions a "Yes" answer IS the failure signal;
    // for everything else, an explicit "N" is the negative signal.
    const negative = ['autofail', 'penalty'].includes(p.role) ? isYes(row) : (row.value_text || '').toUpperCase() === 'N';
    if (negative) entry.flagged += 1;
    byLineage.set(key, entry);
  }
  const parameters = [...byLineage.values()]
    .map(p => ({ ...p, flag_rate: p.answered ? Math.round((p.flagged / p.answered) * 1000) / 10 : 0 }))
    .sort((x, y) => y.flag_rate - x.flag_rate);

  res.json({ parameters, ...capInfo(data, PARAM_CAP) });
}));

// ── GET /qa2/reports/reviewers — volume, avg score given, listen time ──────

router.get('/reports/reviewers', asyncHandler(async (req, res) => {
  const scope = await requireViewer(req, res);
  if (!scope) return;
  const { company_id, from, to } = req.query;

  const REVIEWER_CAP = 75000;
  let q = supabaseAdmin.from('qa2_evaluation')
    .select('reviewer_id, company_id, final_score, status, active_seconds, superseded_by, submitted_at')
    .in('status', [...LIVE_STATUSES, 'superseded']).order('submitted_at', { ascending: false }).limit(REVIEWER_CAP);
  const companyIds = scopedCompanyIds(scope);
  if (companyIds !== null) q = q.in('company_id', companyIds);
  if (company_id) q = q.eq('company_id', company_id);
  q = applyRange(q, 'submitted_at', from, to);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const byReviewer = new Map();
  for (const e of (data || [])) {
    if (!e.reviewer_id) continue;
    const r = byReviewer.get(e.reviewer_id) || { reviewer_id: e.reviewer_id, count: 0, score_sum: 0, score_n: 0, active_sum: 0, flagged: 0, overridden: 0 };
    r.count += 1;
    r.active_sum += e.active_seconds || 0;
    if (e.final_score != null) { r.score_sum += Number(e.final_score); r.score_n += 1; }
    if (e.status === 'flagged') r.flagged += 1;
    if (e.superseded_by) r.overridden += 1;
    byReviewer.set(e.reviewer_id, r);
  }

  // Both depend only on reviewerIds, not on each other — was two sequential
  // round trips, now one wait.
  const reviewerIds = [...byReviewer.keys()];
  const [{ data: listens }, names] = await Promise.all([
    reviewerIds.length
      ? supabaseAdmin.from('qa2_listen_log').select('user_id, seconds_played').in('user_id', reviewerIds)
      : Promise.resolve({ data: [] }),
    nameMap(reviewerIds),
  ]);
  const listenByUser = new Map();
  for (const l of (listens || [])) listenByUser.set(l.user_id, (listenByUser.get(l.user_id) || 0) + (l.seconds_played || 0));

  const reviewers = [...byReviewer.values()]
    .map(r => ({
      reviewer_id: r.reviewer_id, name: names.get(r.reviewer_id) || 'Unknown', count: r.count,
      avg_score: r.score_n ? Math.round((r.score_sum / r.score_n) * 10) / 10 : null,
      avg_active_seconds: r.count ? Math.round(r.active_sum / r.count) : 0,
      flagged_count: r.flagged, overridden_count: r.overridden,
      listen_seconds: listenByUser.get(r.reviewer_id) || 0,
    }))
    .sort((x, y) => y.count - x.count);

  res.json({ reviewers, ...capInfo(data, REVIEWER_CAP) });
}));

// ── GET /qa2/reports/autofails ──────────────────────────────────────────────

router.get('/reports/autofails', asyncHandler(async (req, res) => {
  const scope = await requireViewer(req, res);
  if (!scope) return;
  const { company_id, from, to } = req.query;

  const AUTOFAIL_CAP = 3000;
  let q = supabaseAdmin.from('qa2_evaluation')
    .select('id, company_id, call_id, reviewer_id, subject_user_id, submitted_at, qa2_call(agent_user, qa2_method(label), companies(name))')
    .in('status', LIVE_STATUSES).eq('autofail_result', 'fail')
    .order('submitted_at', { ascending: false }).limit(AUTOFAIL_CAP);
  const companyIds = scopedCompanyIds(scope);
  if (companyIds !== null) q = q.in('company_id', companyIds);
  if (company_id) q = q.eq('company_id', company_id);
  q = applyRange(q, 'submitted_at', from, to);
  const { data: evaluations, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // The answers query (needs evalIds) and the name lookup (needs the
  // reviewer/subject ids already on `evaluations`) don't depend on each
  // other — was two sequential round trips, now one wait.
  const evalIds = (evaluations || []).map(e => e.id);
  const [{ data: answers }, names] = await Promise.all([
    evalIds.length
      ? supabaseAdmin.from('qa2_answer')
          .select('evaluation_id, is_na, value_num, value_text, value_bool, qa2_parameter!inner(label, role, lineage_id)')
          .in('evaluation_id', evalIds).eq('qa2_parameter.role', 'autofail')
      : Promise.resolve({ data: [] }),
    nameMap((evaluations || []).flatMap(e => [e.reviewer_id, e.subject_user_id])),
  ]);
  const counts = new Map();
  for (const a of (answers || [])) {
    if (a.is_na || !isYes(a)) continue;
    const key = a.qa2_parameter.lineage_id;
    const entry = counts.get(key) || { lineage_id: key, label: a.qa2_parameter.label, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  const byParameter = [...counts.values()].sort((x, y) => y.count - x.count);

  const recent = (evaluations || []).slice(0, 50).map(e => ({
    evaluation_id: e.id, submitted_at: e.submitted_at,
    company: e.qa2_call?.companies?.name || '—', method: e.qa2_call?.qa2_method?.label || '—', agent: e.qa2_call?.agent_user || '—',
    reviewer: names.get(e.reviewer_id) || 'Unknown', subject: names.get(e.subject_user_id) || 'Unknown',
  }));

  res.json({ total: (evaluations || []).length, by_parameter: byParameter, recent, ...capInfo(evaluations, AUTOFAIL_CAP) });
}));

// ── GET /qa2/reports/calibration — inter-rater variance summary ────────────

router.get('/reports/calibration', asyncHandler(async (req, res) => {
  const scope = await requireViewer(req, res);
  if (!scope) return;

  // `id` is selected up front now — the old code re-fetched effectively the
  // same rows a second time (assignmentsFull) just to get each row's id after
  // already having everything else about it. One query does both jobs.
  const CALIBRATION_CAP = 8000;
  const { data: assignments, error } = await supabaseAdmin
    .from('qa2_assignment')
    .select('id, calibration_group_id, qa2_call(company_id, agent_user, qa2_method(label), companies(name))')
    .not('calibration_group_id', 'is', null).limit(CALIBRATION_CAP);
  if (error) return res.status(500).json({ error: error.message });

  const companyIds = scopedCompanyIds(scope);
  const inScope = (row) => companyIds === null || companyIds.includes(row.qa2_call?.company_id);
  const groupMeta = new Map();
  const scopedAssignments = [];
  for (const row of (assignments || [])) {
    if (!inScope(row)) continue;
    if (!groupMeta.has(row.calibration_group_id)) groupMeta.set(row.calibration_group_id, row.qa2_call);
    scopedAssignments.push(row);
  }
  if (!groupMeta.size) return res.json({ groups: [], avg_variance: null, ...capInfo(assignments, CALIBRATION_CAP) });

  const assignmentIds = scopedAssignments.map(a => a.id);
  const { data: evaluations } = assignmentIds.length
    ? await supabaseAdmin.from('qa2_evaluation').select('assignment_id, final_score').in('assignment_id', assignmentIds).in('status', LIVE_STATUSES)
    : { data: [] };
  const scoreByAssignment = new Map((evaluations || []).filter(e => e.final_score != null).map(e => [e.assignment_id, Number(e.final_score)]));

  const scoresByGroup = new Map();
  for (const a of scopedAssignments) {
    const score = scoreByAssignment.get(a.id);
    if (score == null) continue;
    const arr = scoresByGroup.get(a.calibration_group_id) || [];
    arr.push(score);
    scoresByGroup.set(a.calibration_group_id, arr);
  }

  const groups = [];
  let varianceSum = 0, varianceN = 0;
  for (const [groupId, call] of groupMeta.entries()) {
    const scores = scoresByGroup.get(groupId) || [];
    const variance = scores.length >= 2 ? Math.max(...scores) - Math.min(...scores) : null;
    if (variance != null) { varianceSum += variance; varianceN += 1; }
    groups.push({
      calibration_group_id: groupId, scored_count: scores.length, scores, variance,
      company: call?.companies?.name || '—', method: call?.qa2_method?.label || '—', agent: call?.agent_user || '—',
    });
  }
  groups.sort((x, y) => (y.variance ?? -1) - (x.variance ?? -1));

  res.json({ groups, avg_variance: varianceN ? Math.round((varianceSum / varianceN) * 10) / 10 : null, ...capInfo(assignments, CALIBRATION_CAP) });
}));

// ── GET /qa2/reports/coverage — how much recorded volume gets reviewed ─────

router.get('/reports/coverage', asyncHandler(async (req, res) => {
  const scope = await requireViewer(req, res);
  if (!scope) return;
  const { company_id, from, to } = req.query;

  const COVERAGE_CAP = 75000;
  let q = supabaseAdmin.from('qa2_call').select('id, company_id, method_id, qa_relevant, call_at, companies(name), qa2_method(label)')
    .order('call_at', { ascending: false }).limit(COVERAGE_CAP);
  const companyIds = scopedCompanyIds(scope);
  if (companyIds !== null) q = q.in('company_id', companyIds);
  if (company_id) q = q.eq('company_id', company_id);
  q = applyRange(q, 'call_at', from, to);
  const { data: calls, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Both only depend on callIds, not on each other — was two sequential
  // round trips, now one wait.
  const callIds = (calls || []).map(c => c.id);
  const [{ data: assignments }, { data: evaluations }] = await Promise.all([
    callIds.length ? supabaseAdmin.from('qa2_assignment').select('call_id').in('call_id', callIds) : Promise.resolve({ data: [] }),
    callIds.length ? supabaseAdmin.from('qa2_evaluation').select('call_id').in('call_id', callIds).in('status', [...LIVE_STATUSES, 'superseded']) : Promise.resolve({ data: [] }),
  ]);
  const assignedCallIds = new Set((assignments || []).map(a => a.call_id));
  const scoredCallIds = new Set((evaluations || []).map(e => e.call_id));

  const rows = new Map();
  for (const c of (calls || [])) {
    if (!c.qa_relevant) continue;
    const key = `${c.company_id}:${c.method_id || 'unclassified'}`;
    const r = rows.get(key) || {
      company_id: c.company_id, company: c.companies?.name || '—',
      method_id: c.method_id, method: c.method_id ? (c.qa2_method?.label || '—') : 'Unclassified',
      total: 0, assigned: 0, scored: 0,
    };
    r.total += 1;
    if (assignedCallIds.has(c.id)) r.assigned += 1;
    if (scoredCallIds.has(c.id)) r.scored += 1;
    rows.set(key, r);
  }
  const result = [...rows.values()]
    .map(r => ({ ...r, coverage_pct: r.total ? Math.round((r.assigned / r.total) * 1000) / 10 : 0 }))
    .sort((x, y) => x.company.localeCompare(y.company) || x.method.localeCompare(y.method));

  res.json({ rows: result, ...capInfo(calls, COVERAGE_CAP) });
}));

module.exports = router;
