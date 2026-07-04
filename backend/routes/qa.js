// ============================================================================
// /qa — QA Department API (TRA full-coverage + RCM sampled call review).
//
//   GET    /qa/queue                       — worklist (own / pool / all), page-1 count
//   POST   /qa/assignments/:id/assign      — manager assigns an item to a qa_agent
//   GET    /qa/assignments/:id/candidates  — recording legs for this assignment
//   POST   /qa/reviews                     — submit a scorecard → review + scores
//   GET    /qa/scorecards                  — list (company + global templates)
//   POST   /qa/scorecards                  — create
//   PUT    /qa/scorecards/:id              — update
//   DELETE /qa/scorecards/:id              — soft-off (is_active=false)
//   GET    /qa/reports                     — aggregate scoring stats
//   GET    /qa/config                      — resolved qa.* for a company
//   PUT    /qa/config                      — set a qa.* company override
//
// Schema: migs 170–172. Permissions (mig 169): view_qa_queue, submit_qa_review,
// assign_qa_tasks, manage_qa_config, view_qa_reports, view_all_qa_reviews.
// Recording resolution reuses the shared dialer library (listCandidatesByLeadId)
// — fronter-leg capable, no fork.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin, hasPermission, getUserCompanies } = require('../models/helpers');
const { getConfig, setConfig } = require('../utils/businessConfig');
const { isSheetConfig, computeSheetReview, isY } = require('../utils/qaSheetFormula');
const { listCandidatesByLeadId, locationForRecording, listDayRecordings } = require('../utils/dialerBoxes');
const { materializeCompany } = require('../utils/qaMaterializer');
const { notifyUsers, getUserIdsByLevel } = require('../utils/notificationService');
const logger = require('../utils/logger');
const axios = require('axios');

const router = express.Router();

// permission gate: superadmin bypass, else per (user, primary company).
async function can(req, key) {
  if (await isSuperAdmin(req.user.id)) return true;
  return hasPermission(req.user.id, req.user.company_id, key);
}
// company scope: superadmin / view_all → every company (null = no filter); else
// the companies this QA user actually belongs to (getUserCompanies).
async function allowedCompanyIds(req) {
  if (await isSuperAdmin(req.user.id)) return null;
  if (await hasPermission(req.user.id, req.user.company_id, 'view_all_qa_reviews')) return null;
  const cos = await getUserCompanies(req.user.id);
  return cos.map(c => c.id);
}
const leadDigits = (code) => { const m = String(code || '').match(/(\d+)\s*$/); return m ? m[1] : null; };

// ── queue ───────────────────────────────────────────────────────────────────
router.get('/queue', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const page   = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const offset = (page - 1) * limit;
  const wantCount = offset === 0 ? 'exact' : undefined;

  let q = supabaseAdmin.from('qa_assignments')
    .select('*', { count: wantCount })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const allowed = await allowedCompanyIds(req);
  if (allowed) { if (!allowed.length) return res.json({ items: [], total: 0, page, limit }); q = q.in('company_id', allowed); }
  if (req.query.company_id)   q = q.eq('company_id', req.query.company_id);
  if (req.query.method)       q = q.eq('method', req.query.method);
  if (req.query.subject_role) q = q.eq('subject_role', req.query.subject_role);
  if (req.query.status)       q = q.eq('status', req.query.status);
  if (req.query.mine === 'true')     q = q.eq('assigned_to', req.user.id);
  if (req.query.unassigned === 'true') q = q.is('assigned_to', null);
  if (req.query.date_from)    q = q.gte('created_at', req.query.date_from);
  if (req.query.date_to)      q = q.lte('created_at', `${req.query.date_to}T23:59:59.999Z`);

  const { data, error, count } = await q;
  if (error) { logger.warn('QA', `queue: ${error.message}`); return res.status(500).json({ error: error.message }); }

  // hydrate display fields from the referenced transfer / sale (batched)
  const tIds = [...new Set((data || []).map(r => r.transfer_id).filter(Boolean))];
  const sIds = [...new Set((data || []).map(r => r.sale_id).filter(Boolean))];
  const [tRes, sRes, aRes] = await Promise.all([
    tIds.length ? supabaseAdmin.from('transfers').select('id, customer_name, normalized_phone, vicidial_vendor_code, created_at, created_by').in('id', tIds) : Promise.resolve({ data: [] }),
    sIds.length ? supabaseAdmin.from('sales').select('id, customer_name, customer_phone, sale_date, closer_id, transfer_id').in('id', sIds) : Promise.resolve({ data: [] }),
    Promise.resolve({ data: [] }),
  ]);
  const tById = Object.fromEntries((tRes.data || []).map(t => [t.id, t]));
  const sById = Object.fromEntries((sRes.data || []).map(s => [s.id, s]));
  // assignee names
  const assignees = [...new Set((data || []).map(r => r.assigned_to).filter(Boolean))];
  let names = {};
  if (assignees.length) {
    const { data: up } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', assignees);
    names = Object.fromEntries((up || []).map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim()]));
  }

  const items = (data || []).map(r => {
    const t = r.transfer_id ? tById[r.transfer_id] : null;
    const s = r.sale_id ? sById[r.sale_id] : null;
    return {
      ...r,
      customer_name: t?.customer_name || s?.customer_name || null,
      customer_phone: t?.normalized_phone || s?.customer_phone || null,
      subject_date: t?.created_at || s?.sale_date || r.created_at,
      vendor_code: t?.vicidial_vendor_code || null,
      assignee_name: r.assigned_to ? (names[r.assigned_to] || null) : null,
    };
  });
  res.json({ items, total: offset === 0 ? (count || 0) : null, page, limit });
}));

// ── assign an item to a qa_agent ──────────────────────────────────────────────
router.post('/assignments/:id/assign', asyncHandler(async (req, res) => {
  if (!(await can(req, 'assign_qa_tasks'))) return res.status(403).json({ error: 'Forbidden' });
  const assignedTo = req.body?.assigned_to || null;   // null clears back to the pool
  const { data: a } = await supabaseAdmin.from('qa_assignments').select('id, company_id').eq('id', req.params.id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(a.company_id)) return res.status(403).json({ error: 'Forbidden' });
  const { data, error } = await supabaseAdmin.from('qa_assignments')
    .update({ assigned_to: assignedTo }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (assignedTo) {
    notifyUsers([assignedTo], {
      companyId: a.company_id, type: 'qa_assignment',
      title: 'New QA review assigned', message: 'A call has been assigned to you for QA review.',
      data: { assignment_id: a.id },
    }).catch(() => {});
  }
  res.json({ assignment: data });
}));

// ── recording candidates for an assignment (reuses the shared dialer lib) ──────
router.get('/assignments/:id/candidates', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  const { data: a } = await supabaseAdmin.from('qa_assignments')
    .select('id, company_id, method, subject_role, transfer_id, sale_id, status, assigned_to').eq('id', req.params.id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(a.company_id)) return res.status(403).json({ error: 'Forbidden' });

  // resolve the transfer that carries the dialer lead code (closer path goes via sale)
  let transferId = a.transfer_id;
  if (!transferId && a.sale_id) {
    const { data: s } = await supabaseAdmin.from('sales').select('transfer_id').eq('id', a.sale_id).maybeSingle();
    transferId = s?.transfer_id || null;
  }
  let candidates = [];
  if (transferId) {
    const { data: t } = await supabaseAdmin.from('transfers').select('vicidial_vendor_code').eq('id', transferId).maybeSingle();
    const lead = leadDigits(t?.vicidial_vendor_code);
    if (lead) { try { candidates = await listCandidatesByLeadId(lead); } catch (e) { logger.warn('QA', `candidates ${lead}: ${e.message}`); } }
  }
  // first open by the assignee moves it into 'in_review' (progress signal)
  if (a.status === 'pending' && a.assigned_to === req.user.id) {
    await supabaseAdmin.from('qa_assignments').update({ status: 'in_review' }).eq('id', a.id);
  }
  res.json({ assignment_id: a.id, candidates });
}));

// ── recording stream proxy (mirrors compliance/recordings/stream; kept under
// /qa so QA plays are egress-audited and independent of compliance perms) ──────
router.get('/recordings/stream', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  const ref = { box_id: req.query.box_id, lead_id: req.query.lead_id, recording_id: req.query.recording_id };
  const reresolve = () => locationForRecording(ref);
  let url = req.query.location && /^https?:\/\//.test(req.query.location) ? req.query.location : await reresolve();
  if (!url) return res.status(404).json({ error: 'Recording not found' });
  const pipe = async (u, retry) => {
    try {
      const upstream = await axios.get(u, {
        responseType: 'stream', timeout: 30000,
        headers: req.headers.range ? { Range: req.headers.range } : {},
        validateStatus: s => s >= 200 && s < 400,
      });
      res.status(upstream.status === 206 ? 206 : 200);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, no-store');
      if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
      if (upstream.headers['content-range'])  res.setHeader('Content-Range', upstream.headers['content-range']);
      upstream.data.pipe(res);
      upstream.data.on('error', () => { try { res.end(); } catch { /* noop */ } });
    } catch (e) {
      if (!retry && !res.headersSent) { const fresh = await reresolve().catch(() => null); if (fresh && fresh !== u) return pipe(fresh, true); }
      if (!res.headersSent) res.status(502).json({ error: 'Could not load audio' });
    }
  };
  return pipe(url, false);
}));

// ── agent-id resolution for the day-recording browser ────────────────────────
// company scope = agent ids of the company's users; all scope = every mapped id.
async function agentIdsForCompany(companyId) {
  const { data: ucr } = await supabaseAdmin.from('user_company_roles').select('user_id').eq('company_id', companyId).eq('is_active', true);
  const uids = [...new Set((ucr || []).map(r => r.user_id))];
  if (!uids.length) return { ids: [], nameByAgent: {} };
  const { data: profs } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name, vicidial_agent_ids').in('user_id', uids);
  return foldAgents(profs);
}
async function allAgentIds() {
  const { data: profs } = await supabaseAdmin.from('user_profiles').select('first_name, last_name, vicidial_agent_ids').not('vicidial_agent_ids', 'is', null);
  return foldAgents(profs);
}
function foldAgents(profs) {
  const ids = new Set(); const nameByAgent = {};
  for (const p of profs || []) for (const a of (p.vicidial_agent_ids || [])) {
    const A = String(a).toUpperCase(); if (!A) continue;
    ids.add(A); nameByAgent[A] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || A;
  }
  return { ids: [...ids], nameByAgent };
}

// ── whole-day recording browser ──────────────────────────────────────────────
// GET /qa/day-recordings?date=YYYY-MM-DD&scope=company|all&company_id=&search=
// Pulls EVERY recording for a day across the (company's, or all mapped) agents
// and boxes — the "load the day, then search any number" surface. Cached 15 min.
router.get('/day-recordings', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  const date = String(req.query.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date=YYYY-MM-DD is required' });

  let ids = [], nameByAgent = {};
  if (req.query.scope === 'all') {
    if (!(await isSuperAdmin(req.user.id)) && !(await hasPermission(req.user.id, req.user.company_id, 'view_all_qa_reviews'))) {
      return res.status(403).json({ error: 'Not allowed to load recordings across all companies' });
    }
    ({ ids, nameByAgent } = await allAgentIds());
  } else {
    const companyId = req.query.company_id || req.user.company_id;
    const allowed = await allowedCompanyIds(req);
    if (allowed && !allowed.includes(companyId)) return res.status(403).json({ error: 'Forbidden' });
    ({ ids, nameByAgent } = await agentIdsForCompany(companyId));
  }
  if (!ids.length) return res.json({ date, agents: 0, total: 0, recordings: [], note: 'No dialer agent ids mapped for this company.' });

  const rows = await listDayRecordings({ date, agentIds: ids });
  const search = String(req.query.search || '').replace(/\D/g, '');
  const filtered = search ? rows.filter(r => (r.phone || '').includes(search) || String(r.lead_id || '').includes(search)) : rows;
  res.json({
    date, agents: ids.length, total: rows.length, shown: filtered.length,
    recordings: filtered.map(r => ({ ...r, agent_name: nameByAgent[String(r.agent_user || '').toUpperCase()] || null })),
  });
}));

// resolve the scorecard for a (company, method): company override → global starter
async function resolveScorecard(companyId, method) {
  const cfgId = await getConfig(companyId, `qa.scorecard.${method}`, null);
  if (cfgId) {
    const { data } = await supabaseAdmin.from('qa_scorecards').select('*').eq('id', cfgId).eq('is_active', true).maybeSingle();
    if (data) return data;
  }
  // company-scoped active scorecard for the method, else the global starter
  const { data: co } = await supabaseAdmin.from('qa_scorecards').select('*')
    .eq('company_id', companyId).eq('method', method).eq('is_active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (co) return co;
  const { data: g } = await supabaseAdmin.from('qa_scorecards').select('*')
    .is('company_id', null).eq('method', method).eq('is_active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return g || null;
}

// ── helpers shared by review submit + edit ────────────────────────────────────
// subject: TRA/fronter → transfer.created_by; closer → sale.closer_id / assigned closer
async function resolveSubjectUser(a) {
  if (a.subject_role === 'fronter' && a.transfer_id) {
    const { data: t } = await supabaseAdmin.from('transfers').select('created_by').eq('id', a.transfer_id).maybeSingle();
    return t?.created_by || null;
  }
  if (a.subject_role === 'closer') {
    if (a.sale_id) { const { data: s } = await supabaseAdmin.from('sales').select('closer_id').eq('id', a.sale_id).maybeSingle(); return s?.closer_id || null; }
    if (a.transfer_id) { const { data: t } = await supabaseAdmin.from('transfers').select('assigned_closer_id').eq('id', a.transfer_id).maybeSingle(); return t?.assigned_closer_id || null; }
  }
  return null;
}

// feedback-to-agent: reviewed agent + their managers (never the reviewer)
async function notifyReviewed(a, subjectUserId, reviewerId, title, message, data) {
  try {
    const recipients = new Set();
    if (subjectUserId) recipients.add(subjectUserId);
    const mgrLevels = a.subject_role === 'fronter'
      ? ['fronter_manager', 'operations_manager', 'company_admin']
      : ['closer_manager', 'operations_manager', 'company_admin'];
    (await getUserIdsByLevel(a.company_id, mgrLevels)).forEach(id => recipients.add(id));
    recipients.delete(reviewerId);
    if (recipients.size) {
      notifyUsers([...recipients], { companyId: a.company_id, type: 'qa_review', title, message, data }).catch(() => {});
    }
  } catch (e) { logger.warn('QA', `notify: ${e.message}`); }
}

// sheet model: persist every field's RAW entered value + derived contribution
async function replaceSheetScores(reviewId, cfg, values, out) {
  const rows = [];
  const add = (key, raw, points) => {
    if (raw === undefined) return;
    rows.push({ review_id: reviewId, criterion_key: key, raw_value: raw == null ? null : String(raw), points: points ?? 0, note: null });
  };
  for (const rc of (cfg.rating_criteria || [])) {
    const n = parseInt(values[rc.key], 10);
    add(rc.key, values[rc.key], Number.isFinite(n) ? Math.max(0, Math.min(rc.scale ?? 4, n)) : 0);
  }
  for (const f of ((cfg.autofail || {}).fields || [])) add(f.key, values[f.key], 0);
  for (const f of (cfg.penalty_flags  || [])) add(f.key, values[f.key], isY(values[f.key]) ? (f.penalty ?? -5) : 0);
  for (const f of (cfg.tracking_flags || [])) add(f.key, values[f.key], 0);              // tracking-only, no formula
  for (const f of ((cfg.quality_score || {}).fields || [])) add(f.key, values[f.key], isY(values[f.key]) ? 1 : 0);
  if (cfg.call_outcome) add(cfg.call_outcome.key, values[cfg.call_outcome.key], out.call_outcome_score ?? 0);
  await supabaseAdmin.from('qa_review_scores').delete().eq('review_id', reviewId);
  if (rows.length) {
    const { error } = await supabaseAdmin.from('qa_review_scores').insert(rows);
    if (error) logger.warn('QA', `scores insert: ${error.message}`);
  }
}

// engine outputs → qa_reviews column patch (sheet model). total/max kept
// populated (final or quality as %, max 100) so /qa/reports stays meaningful.
function sheetComputedCols(cfg, values, out) {
  return {
    total_score: out.final_score ?? out.quality_score ?? 0, max_score: 100,
    passed: out.passed,                                       // null for Closer (no pass/fail in the sheet)
    base_score: out.base_score, autofail_result: out.autofail_result,
    total_penalty: out.total_penalty, final_score: out.final_score,
    quality_score: out.quality_score,
    call_outcome: cfg.call_outcome ? (values[cfg.call_outcome.key] ?? null) : null,
    call_outcome_score: out.call_outcome_score,
  };
}

// ── submit a review ───────────────────────────────────────────────────────────
// Two scorecard models: sheet_v2 (WaveTech replication — body carries values{}
// keyed by field) and legacy weighted (body carries scores[]).
router.post('/reviews', asyncHandler(async (req, res) => {
  if (!(await can(req, 'submit_qa_review'))) return res.status(403).json({ error: 'Forbidden' });
  const { assignment_id, scores, overall_notes } = req.body || {};
  const values = (req.body && req.body.values && typeof req.body.values === 'object') ? req.body.values : null;
  if (!assignment_id || (!Array.isArray(scores) && !values)) {
    return res.status(400).json({ error: 'assignment_id and scores[] (legacy) or values{} (sheet) are required' });
  }

  const { data: a } = await supabaseAdmin.from('qa_assignments')
    .select('id, company_id, method, subject_role, transfer_id, sale_id').eq('id', assignment_id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(a.company_id)) return res.status(403).json({ error: 'Forbidden' });

  const scorecard = await resolveScorecard(a.company_id, a.method);
  if (!scorecard) return res.status(400).json({ error: 'No active scorecard for this method' });

  // ── sheet_v2 path (WaveTech) — formula engine is the single source of truth ─
  if (isSheetConfig(scorecard.criteria)) {
    const cfg = scorecard.criteria;
    const vals = values || {};
    const out = computeSheetReview(cfg, vals);
    const subjectUserId = await resolveSubjectUser(a);
    const reviewRow = {
      assignment_id: a.id, company_id: a.company_id, method: a.method, subject_role: a.subject_role,
      subject_user_id: subjectUserId, reviewer_id: req.user.id, scorecard_id: scorecard.id,
      ...sheetComputedCols(cfg, vals, out),
      meta: (req.body.meta && typeof req.body.meta === 'object') ? req.body.meta : {},
      overall_notes: (overall_notes || '').slice(0, 4000) || null,
      status: 'submitted',
    };
    const { data: review, error: rErr } = await supabaseAdmin.from('qa_reviews')
      .upsert(reviewRow, { onConflict: 'assignment_id' }).select().single();
    if (rErr) return res.status(500).json({ error: rErr.message });
    await replaceSheetScores(review.id, cfg, vals, out);
    await supabaseAdmin.from('qa_assignments').update({ status: 'scored' }).eq('id', a.id);
    const label = out.final_score != null
      ? `${out.passed ? 'Pass' : 'FAIL'} — Final ${out.final_score}`
      : (out.quality_score != null ? `Quality ${out.quality_score}%` : `Auto-Fail: ${out.autofail_result}`);
    await notifyReviewed(a, subjectUserId, req.user.id,
      `QA review: ${label}`,
      `${a.method.toUpperCase()} review completed${overall_notes ? ' — see notes' : ''}.`,
      { review_id: review.id, assignment_id: a.id, passed: out.passed, final_score: out.final_score, quality_score: out.quality_score });
    return res.json({ review, computed: out });
  }

  // ── legacy weighted path (unchanged behavior) ───────────────────────────────
  if (!Array.isArray(scores)) return res.status(400).json({ error: 'scores[] required for this scorecard' });
  const criteria = Array.isArray(scorecard.criteria) ? scorecard.criteria : [];

  // total + max + auto-fail. Points are clamped to [0, criterion.max_points].
  let total = 0, max = 0, autoFailed = false;
  const cleanScores = [];
  for (const c of criteria) {
    const maxPts = Number.isFinite(+c.max_points) ? +c.max_points : 0;
    max += maxPts;
    const submitted = scores.find(s => s.criterion_key === c.key);
    const pts = Math.max(0, Math.min(maxPts, Number.isFinite(+submitted?.points) ? +submitted.points : 0));
    total += pts;
    if (c.auto_fail && pts <= 0) autoFailed = true;
    cleanScores.push({ criterion_key: c.key, points: pts, raw_value: String(submitted?.points ?? ''), note: (submitted?.note || '').slice(0, 1000) || null });
  }
  const pct = max > 0 ? (total / max) * 100 : 0;
  const passed = !autoFailed && pct >= (Number.isFinite(+scorecard.pass_threshold) ? +scorecard.pass_threshold : 80);
  const subjectUserId = await resolveSubjectUser(a);

  const reviewRow = {
    assignment_id: a.id, company_id: a.company_id, method: a.method, subject_role: a.subject_role,
    subject_user_id: subjectUserId, reviewer_id: req.user.id, scorecard_id: scorecard.id,
    total_score: total, max_score: max, passed, overall_notes: (overall_notes || '').slice(0, 4000) || null,
    status: 'submitted',
  };
  const { data: review, error: rErr } = await supabaseAdmin.from('qa_reviews')
    .upsert(reviewRow, { onConflict: 'assignment_id' }).select().single();
  if (rErr) return res.status(500).json({ error: rErr.message });

  await supabaseAdmin.from('qa_review_scores').delete().eq('review_id', review.id);
  if (cleanScores.length) {
    const { error: sErr } = await supabaseAdmin.from('qa_review_scores').insert(cleanScores.map(s => ({ ...s, review_id: review.id })));
    if (sErr) logger.warn('QA', `scores insert: ${sErr.message}`);
  }
  await supabaseAdmin.from('qa_assignments').update({ status: 'scored' }).eq('id', a.id);
  await notifyReviewed(a, subjectUserId, req.user.id,
    `QA review: ${passed ? 'Passed' : 'Needs attention'} (${Math.round(pct)}%)`,
    `${a.method.toUpperCase()} review completed${overall_notes ? ' — see notes' : ''}.`,
    { review_id: review.id, assignment_id: a.id, passed, score_pct: Math.round(pct) });

  res.json({ review, passed, total_score: total, max_score: max, score_pct: Math.round(pct) });
}));

// ── load a review (with raw values + its scorecard) for the edit screen ───────
router.get('/reviews/by-assignment/:assignmentId', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  const { data: review } = await supabaseAdmin.from('qa_reviews').select('*').eq('assignment_id', req.params.assignmentId).maybeSingle();
  if (!review) return res.status(404).json({ error: 'No review for this assignment yet' });
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(review.company_id)) return res.status(403).json({ error: 'Forbidden' });
  const [scoresRes, cardRes] = await Promise.all([
    supabaseAdmin.from('qa_review_scores').select('criterion_key, raw_value, points, note').eq('review_id', review.id),
    review.scorecard_id
      ? supabaseAdmin.from('qa_scorecards').select('*').eq('id', review.scorecard_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  res.json({ review, scores: scoresRes.data || [], scorecard: cardRes.data || null });
}));

// ── edit / override a review (audited) ────────────────────────────────────────
// qa_agent: own review only, and only while status='submitted'.
// qa_manager (override_qa_review) / superadmin: ANY review, any status; may also
// change status ('finalized' locks it for the agent). Every change appends a
// {who, when, override, changes:{field:{from,to}}} entry to edit_history.
router.put('/reviews/:id', asyncHandler(async (req, res) => {
  const { data: review } = await supabaseAdmin.from('qa_reviews').select('*').eq('id', req.params.id).maybeSingle();
  if (!review) return res.status(404).json({ error: 'Review not found' });
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(review.company_id)) return res.status(403).json({ error: 'Forbidden' });

  const superadmin = await isSuperAdmin(req.user.id);
  const canOverride = superadmin || await hasPermission(req.user.id, req.user.company_id, 'override_qa_review');
  const isOwn = review.reviewer_id === req.user.id;
  const canEdit = canOverride || (isOwn && review.status === 'submitted' && await can(req, 'submit_qa_review'));
  if (!canEdit) {
    return res.status(403).json({
      error: isOwn && review.status !== 'submitted'
        ? 'This review is finalized — only a QA manager can change it.'
        : 'You can only edit your own reviews while they are still submitted.',
    });
  }

  const changes = {};
  const patch = {};
  const values = (req.body && req.body.values && typeof req.body.values === 'object') ? req.body.values : null;
  let sheet = null;

  if (values) {
    const { data: sc } = await supabaseAdmin.from('qa_scorecards').select('*').eq('id', review.scorecard_id).maybeSingle();
    if (!sc || !isSheetConfig(sc.criteria)) return res.status(400).json({ error: 'Editing is only supported for sheet-model scorecards' });
    const cfg = sc.criteria;
    const { data: prevScores } = await supabaseAdmin.from('qa_review_scores').select('criterion_key, raw_value').eq('review_id', review.id);
    const prev = Object.fromEntries((prevScores || []).map(r => [r.criterion_key, r.raw_value]));
    for (const k of new Set([...Object.keys(prev), ...Object.keys(values)])) {
      const from = prev[k] ?? null;
      const to = (values[k] == null || values[k] === '') ? null : String(values[k]);
      if (String(from ?? '') !== String(to ?? '')) changes[k] = { from, to };
    }
    const out = computeSheetReview(cfg, values);
    Object.assign(patch, sheetComputedCols(cfg, values, out));
    sheet = { cfg, out, values };
  }
  if (req.body.overall_notes !== undefined) {
    const to = String(req.body.overall_notes || '').slice(0, 4000) || null;
    if (to !== review.overall_notes) { changes.overall_notes = { from: review.overall_notes, to }; patch.overall_notes = to; }
  }
  if (req.body.meta !== undefined && req.body.meta && typeof req.body.meta === 'object') {
    if (JSON.stringify(req.body.meta) !== JSON.stringify(review.meta || {})) {
      changes.meta = { from: review.meta || {}, to: req.body.meta };
      patch.meta = req.body.meta;
    }
  }
  if (req.body.status !== undefined && req.body.status !== review.status) {
    if (!canOverride) return res.status(403).json({ error: 'Only a QA manager can change review status' });
    if (!['submitted', 'finalized', 'disputed', 'void'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
    changes.status = { from: review.status, to: req.body.status };
    patch.status = req.body.status;
    if (req.body.status === 'finalized') { patch.finalized_at = new Date().toISOString(); patch.finalized_by = req.user.id; }
  }

  if (!Object.keys(changes).length) return res.json({ review, changed: false });

  const hist = Array.isArray(review.edit_history) ? review.edit_history : [];
  patch.edit_history = [...hist, {
    edited_at: new Date().toISOString(), by: req.user.id, role: req.user.role,
    override: !isOwn, changes,
  }];

  const { data: updated, error } = await supabaseAdmin.from('qa_reviews').update(patch).eq('id', review.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (sheet) await replaceSheetScores(review.id, sheet.cfg, sheet.values, sheet.out);
  res.json({ review: updated, changed: true, computed: sheet ? sheet.out : null });
}));

// ── scorecards CRUD ───────────────────────────────────────────────────────────
router.get('/scorecards', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  let q = supabaseAdmin.from('qa_scorecards').select('*').order('created_at', { ascending: false });
  if (req.query.method) q = q.eq('method', req.query.method);
  // company scorecards for the requested company + global templates (company_id null)
  if (req.query.company_id) q = q.or(`company_id.eq.${req.query.company_id},company_id.is.null`);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ scorecards: data || [] });
}));

router.post('/scorecards', asyncHandler(async (req, res) => {
  if (!(await can(req, 'manage_qa_config'))) return res.status(403).json({ error: 'Forbidden' });
  const { company_id, method, name, criteria, pass_threshold } = req.body || {};
  if (!['tra', 'rcm'].includes(method) || !name) return res.status(400).json({ error: 'method (tra|rcm) and name are required' });
  const row = {
    company_id: company_id || null, method, name: String(name).slice(0, 200),
    criteria: Array.isArray(criteria) ? criteria : [],
    pass_threshold: Number.isFinite(+pass_threshold) ? +pass_threshold : 80,
    created_by: req.user.id,
  };
  const { data, error } = await supabaseAdmin.from('qa_scorecards').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ scorecard: data });
}));

router.put('/scorecards/:id', asyncHandler(async (req, res) => {
  if (!(await can(req, 'manage_qa_config'))) return res.status(403).json({ error: 'Forbidden' });
  const patch = { updated_at: new Date().toISOString() };
  for (const k of ['name', 'pass_threshold', 'is_active', 'criteria']) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
  const { data, error } = await supabaseAdmin.from('qa_scorecards').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ scorecard: data });
}));

router.delete('/scorecards/:id', asyncHandler(async (req, res) => {
  if (!(await can(req, 'manage_qa_config'))) return res.status(403).json({ error: 'Forbidden' });
  // soft-off (keeps historical reviews' scorecard_id valid)
  const { error } = await supabaseAdmin.from('qa_scorecards').update({ is_active: false }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// ── reports (bounded aggregate; convert to RPC/matview if volume grows) ────────
router.get('/reports', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_reports'))) return res.status(403).json({ error: 'Forbidden' });
  let q = supabaseAdmin.from('qa_reviews')
    .select('id, company_id, method, subject_role, subject_user_id, reviewer_id, total_score, max_score, passed, created_at')
    .order('created_at', { ascending: false }).limit(5000);
  const allowed = await allowedCompanyIds(req);
  if (allowed) { if (!allowed.length) return res.json({ summary: {}, by_agent: [] }); q = q.in('company_id', allowed); }
  if (req.query.company_id) q = q.eq('company_id', req.query.company_id);
  if (req.query.method)     q = q.eq('method', req.query.method);
  if (req.query.date_from)  q = q.gte('created_at', req.query.date_from);
  if (req.query.date_to)    q = q.lte('created_at', `${req.query.date_to}T23:59:59.999Z`);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const rows = data || [];
  const pct = r => (r.max_score > 0 ? (r.total_score / r.max_score) * 100 : 0);
  const summary = {
    reviews: rows.length,
    passed: rows.filter(r => r.passed).length,
    pass_rate: rows.length ? Math.round((rows.filter(r => r.passed).length / rows.length) * 100) : 0,
    avg_score: rows.length ? Math.round(rows.reduce((s, r) => s + pct(r), 0) / rows.length) : 0,
  };
  const agg = {};
  for (const r of rows) {
    const k = r.subject_user_id || 'unknown';
    (agg[k] ||= { subject_user_id: r.subject_user_id, reviews: 0, passed: 0, sumPct: 0 });
    agg[k].reviews++; if (r.passed) agg[k].passed++; agg[k].sumPct += pct(r);
  }
  const subjectIds = Object.values(agg).map(a => a.subject_user_id).filter(Boolean);
  let names = {};
  if (subjectIds.length) {
    const { data: up } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', subjectIds);
    names = Object.fromEntries((up || []).map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim()]));
  }
  const by_agent = Object.values(agg).map(a => ({
    subject_user_id: a.subject_user_id, name: a.subject_user_id ? (names[a.subject_user_id] || 'Unknown') : 'Unknown',
    reviews: a.reviews, passed: a.passed,
    pass_rate: a.reviews ? Math.round((a.passed / a.reviews) * 100) : 0,
    avg_score: a.reviews ? Math.round(a.sumPct / a.reviews) : 0,
  })).sort((x, y) => y.reviews - x.reviews);
  res.json({ summary, by_agent });
}));

// ── config (per-company qa.* overrides) ───────────────────────────────────────
const QA_KEYS = ['qa.methods', 'qa.rcm.covers', 'qa.rcm.sample', 'qa.tra.population', 'qa.scorecard.tra', 'qa.scorecard.rcm'];
router.get('/config', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  const companyId = req.query.company_id || req.user.company_id;
  const out = {};
  for (const k of QA_KEYS) out[k] = await getConfig(companyId, k, null);
  res.json({ company_id: companyId, config: out });
}));
router.put('/config', asyncHandler(async (req, res) => {
  if (!(await can(req, 'manage_qa_config'))) return res.status(403).json({ error: 'Forbidden' });
  const { company_id, key, value } = req.body || {};
  if (!company_id || !QA_KEYS.includes(key)) return res.status(400).json({ error: 'company_id and a valid qa.* key are required' });
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(company_id)) return res.status(403).json({ error: 'Forbidden' });
  await setConfig(`company:${company_id}`, key, value, req.user.id);

  // Turning a method ON should fill the queue immediately — no waiting for the
  // hourly job. Materialize right away for the methods now enabled.
  let materialized = null;
  if (key === 'qa.methods' && Array.isArray(value) && value.length) {
    try { materialized = await materializeCompany(company_id, value); } catch (e) { logger.warn('QA', `auto-materialize: ${e.message}`); }
  }
  res.json({ ok: true, key, value, materialized });
}));

// ── on-demand "Pull calls now" — run materialization for a company immediately
// (TRA full coverage + RCM sample), instead of waiting for the hourly job. ──────
router.post('/materialize', asyncHandler(async (req, res) => {
  if (!(await can(req, 'manage_qa_config'))) return res.status(403).json({ error: 'Forbidden' });
  const companyId = req.body?.company_id || req.user.company_id;
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(companyId)) return res.status(403).json({ error: 'Forbidden' });
  const methods = await getConfig(companyId, 'qa.methods', []);
  if (!Array.isArray(methods) || !methods.length) {
    return res.status(400).json({ error: 'QA is not enabled for this company — turn on TRA and/or RCM first.', code: 'QA_OFF' });
  }
  const result = await materializeCompany(companyId, methods);
  res.json({ ok: true, ...result });
}));

module.exports = router;
