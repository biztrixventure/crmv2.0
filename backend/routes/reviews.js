const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireFeature } = require('../utils/featureGate');
const { hasPermission } = require('../models/helpers');
const { etDateToUtcStart, etDateToUtcEnd } = require('../utils/etUtils');
const { logActivity } = require('../utils/activityLogger');
const router = express.Router();

const MANAGER_ROLES = ['superadmin', 'company_admin', 'operations_manager', 'fronter_manager', 'closer_manager'];

// Fetch all user IDs active in a company — used to scope reviews for closer-side roles.
const getCompanyUserIds = async (companyId) => {
  const { data } = await supabaseAdmin
    .from('user_company_roles').select('user_id')
    .eq('company_id', companyId).eq('is_active', true);
  return (data || []).map(u => u.user_id);
};

const RATINGS      = ['excellent', 'good', 'average', 'below_average', 'bad'];
const DISPOSITIONS = ['sale', 'no_sale', 'callback', 'not_interested', 'hung_up', 'voicemail', 'other'];

// ============================================================================
// POST /reviews/transfer/:id/review — closer submits rating for a transfer
// ============================================================================
router.post('/transfer/:id/review',
  requireFeature('call_reviews'),
  [
  body('rating').isIn(RATINGS),
  body('notes').optional().isString().isLength({ max: 1000 }),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const { id: transferId } = req.params;
  const { rating, notes }  = req.body;
  const closerId           = req.user.id;

  // Verify transfer exists + get company_id (fronter's company)
  const { data: transfer, error: tErr } = await supabaseAdmin
    .from('transfers').select('id, company_id, assigned_closer_id').eq('id', transferId).single();

  if (tErr || !transfer) return res.status(404).json({ error: 'Transfer not found' });
  if (transfer.assigned_closer_id !== closerId) return res.status(403).json({ error: 'Only the assigned closer can review this transfer' });
  // Toggleable per user: submit_call_review (checked against the closer's OWN
  // company, not the transfer's fronter company). Migration 133 grants it to the
  // closer roles, so this only takes effect when a superadmin revokes it.
  if (req.user.role !== 'superadmin' && !(await hasPermission(closerId, req.user.company_id, 'submit_call_review'))) {
    return res.status(403).json({ error: 'You do not have permission to submit call reviews' });
  }

  // Upsert — one review per transfer per closer
  const { data: existing } = await supabaseAdmin
    .from('call_reviews').select('id').eq('transfer_id', transferId).eq('closer_id', closerId).single();

  let result;
  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('call_reviews').update({ rating, notes, created_at: new Date().toISOString() })
      .eq('id', existing.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    result = data;
  } else {
    const { data, error } = await supabaseAdmin
      .from('call_reviews').insert({
        transfer_id: transferId,
        closer_id:   closerId,
        company_id:  transfer.company_id,
        rating,
        notes: notes || null,
      }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    result = data;
  }

  res.status(201).json({ review: result });
}));

// ============================================================================
// POST /reviews/transfer/:id/dispo — closer sets disposition for a transfer
// ============================================================================
router.post('/transfer/:id/dispo',
  requireFeature('call_reviews'),
  [
  body('disposition').isIn(DISPOSITIONS),
  body('notes').optional().isString().isLength({ max: 1000 }),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const { id: transferId }  = req.params;
  const { disposition, notes } = req.body;
  const actorId   = req.user.id;
  const actorRole = req.user.role;

  const { data: transfer, error: tErr } = await supabaseAdmin
    .from('transfers').select('id, company_id, assigned_closer_id, form_data').eq('id', transferId).single();

  if (tErr || !transfer) return res.status(404).json({ error: 'Transfer not found' });

  const isManager = MANAGER_ROLES.includes(actorRole);
  if (!isManager && transfer.assigned_closer_id !== actorId) {
    return res.status(403).json({ error: 'Only the assigned closer or a manager can set disposition' });
  }
  // Toggleable per user: submit_call_dispo (checked against the actor's OWN
  // company). Migration 133 grants it to the closer + manager roles that set
  // dispositions today, so this only bites when a superadmin revokes it.
  if (actorRole !== 'superadmin' && !(await hasPermission(actorId, req.user.company_id, 'submit_call_dispo'))) {
    return res.status(403).json({ error: 'You do not have permission to set call dispositions' });
  }

  // For closers, scope to their own record; for managers, scope to the assigned closer's record (or any)
  const scopedCloserId = isManager && transfer.assigned_closer_id
    ? transfer.assigned_closer_id
    : actorId;

  const { data: existing } = await supabaseAdmin
    .from('call_dispositions').select('id, disposition').eq('transfer_id', transferId).eq('closer_id', scopedCloserId).maybeSingle();

  const prevDisposition = existing?.disposition || null;

  let result;
  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('call_dispositions').update({ disposition, notes, created_at: new Date().toISOString() })
      .eq('id', existing.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    result = data;
  } else {
    const { data, error } = await supabaseAdmin
      .from('call_dispositions').insert({
        transfer_id: transferId,
        closer_id:   scopedCloserId,
        company_id:  transfer.company_id,
        disposition,
        notes: notes || null,
      }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    result = data;
  }

  // Log the activity (fire-and-forget)
  const customerName = transfer.form_data?.customer_name
    || transfer.form_data?.FirstName
    || 'Unknown';
  logActivity({
    companyId:  transfer.company_id,
    userId:     actorId,
    action:     existing ? 'disposition_updated' : 'disposition_set',
    entityType: 'transfer',
    entityId:   transferId,
    oldValue:   prevDisposition ? { disposition: prevDisposition } : null,
    newValue:   { disposition, notes: notes || null },
    metadata:   { customer_name: customerName, actor_role: actorRole, manager_override: isManager },
  });

  res.status(201).json({ disposition: result });
}));

// ============================================================================
// GET /reviews/qa — the QA-evaluated calls behind the Review section.
//
// WHY THIS EXISTS. The Review section read call_reviews + call_dispositions,
// and both tables are EMPTY in production (0 rows each) while qa_reviews holds
// 1,050 evaluations. The filters were not broken logic -- they were filtering
// nothing, so every combination answered "No call ratings found". The reviewed
// call information lives in the QA tables, so this is where the section has to
// read from.
//
// One row per QA evaluation, carrying what an investigation actually needs: the
// score the reviewer settled on, pass/fail, the method (TRA / RCM), who was
// reviewed and by whom, and the CALL context -- customer, phone, and the
// disposition from the linked transfer.
//
// PHONE SEARCH IS INDEPENDENT of the other filters, by design: "what happened
// on this number" must not come back empty because an agent or date filter was
// still set from the last question. Passing `phone` therefore ignores agent /
// method / result / date, and says so in the response (`phone_search: true`).
// ============================================================================

// qa_assignments.customer_phone is stored as clean 10 digits (1,047 of 1,047
// non-null rows match ^[0-9]{10}$), so normalise input the same way rather than
// trusting whatever punctuation someone pasted. A leading US country code is
// dropped -- 11 digits starting 1 is the same number.
const normalisePhone = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits.length > 10 ? digits.slice(-10) : digits;
};

const QA_SELECT = [
  'id', 'assignment_id', 'company_id', 'method', 'subject_role', 'subject_user_id',
  'reviewer_id', 'total_score', 'max_score', 'final_score', 'base_score',
  'total_penalty', 'quality_score', 'passed', 'autofail_result', 'call_outcome',
  'call_outcome_score', 'status', 'overall_notes', 'created_at', 'finalized_at',
].join(', ');

const ASSIGNMENT_SELECT =
  'qa_assignments!inner(id, method, customer_name, customer_phone, customer_state, ' +
  'transfer_id, sale_id, recording_date, subject_agent, work_type, source)';

router.get('/qa', asyncHandler(async (req, res) => {
  const userRole = req.user.role;
  const {
    company_id, subject_user_id, method, result, date_from, date_to,
    page = 1, limit = 50,
  } = req.query;
  const phone = normalisePhone(req.query.phone);
  const phoneSearch = phone.length >= 7;   // enough digits to mean something

  const scopeAll = ['compliance_manager', 'superadmin', 'readonly_admin'].includes(userRole);
  const targetCompany = company_id || req.user.company_id || null;

  let q = supabaseAdmin
    .from('qa_reviews')
    .select(`${QA_SELECT}, ${ASSIGNMENT_SELECT}`, { count: 'exact' })
    .order('created_at', { ascending: false });

  // qa_reviews carries its own company_id (the company the reviewed agent was
  // working for), so unlike call_reviews this scopes directly.
  if (!scopeAll) {
    if (!targetCompany) return res.json({ reviews: [], total: 0, page: parseInt(page), limit: parseInt(limit) });
    q = q.eq('company_id', targetCompany);
  } else if (company_id) {
    q = q.eq('company_id', company_id);
  }

  if (phoneSearch) {
    // Filter on the embedded assignment. `!inner` above is what makes this a
    // join filter rather than a no-op.
    q = q.eq('qa_assignments.customer_phone', phone);
  } else {
    if (subject_user_id) q = q.eq('subject_user_id', subject_user_id);
    if (method)          q = q.eq('method', method);
    if (result === 'pass') q = q.eq('passed', true);
    if (result === 'fail') q = q.eq('passed', false);
    if (date_from) q = q.gte('created_at', etDateToUtcStart(date_from));
    if (date_to)   q = q.lte('created_at', etDateToUtcEnd(date_to));
  }

  const lim = Math.min(200, parseInt(limit) || 50);
  const offset = (Math.max(1, parseInt(page)) - 1) * lim;
  q = q.range(offset, offset + lim - 1);

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const rows = data || [];

  // ── enrich: who was reviewed, who reviewed, and the call's disposition ──
  const userIds = [...new Set(rows.flatMap(r => [r.subject_user_id, r.reviewer_id]).filter(Boolean))];
  const transferIds = [...new Set(rows.map(r => r.qa_assignments?.transfer_id).filter(Boolean))];

  const [profRes, xferRes] = await Promise.all([
    userIds.length
      ? supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', userIds)
      : { data: [] },
    transferIds.length
      ? supabaseAdmin.from('transfers')
          .select('id, latest_disposition, vicidial_dispo, status, normalized_phone')
          .in('id', transferIds)
      : { data: [] },
  ]);
  const names = {};
  (profRes.data || []).forEach(p => { names[p.user_id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || null; });
  const xfers = {};
  (xferRes.data || []).forEach(t => { xfers[t.id] = t; });

  // A phone investigation wants the per-criterion breakdown, not just the
  // headline score. Fetched only then -- on a 50-row list it would be hundreds
  // of rows nobody has asked to see.
  const scoresByReview = {};
  if (phoneSearch && rows.length) {
    const { data: sc } = await supabaseAdmin
      .from('qa_review_scores')
      .select('review_id, criterion_key, points, note, raw_value')
      .in('review_id', rows.map(r => r.id));
    (sc || []).forEach(s => {
      (scoresByReview[s.review_id] = scoresByReview[s.review_id] || []).push(s);
    });
  }

  const reviews = rows.map(r => {
    const a = r.qa_assignments || {};
    const t = a.transfer_id ? xfers[a.transfer_id] : null;
    // final_score is the post-penalty number the scorecard settled on;
    // total/max is the pre-penalty raw. Prefer the former, fall back rather
    // than showing nothing for a review that only carries the raw.
    const score = r.final_score != null
      ? Number(r.final_score)
      : (Number(r.max_score) > 0 ? Math.round((Number(r.total_score) / Number(r.max_score)) * 1000) / 10 : null);
    return {
      id: r.id,
      created_at: r.created_at,
      method: r.method,
      subject_role: r.subject_role,
      agent_name: names[r.subject_user_id] || a.subject_agent || 'Unknown',
      subject_user_id: r.subject_user_id,
      reviewer_name: names[r.reviewer_id] || 'Unknown',
      // The rating QA gave, however the scorecard expressed it.
      score,
      max_score: r.max_score != null ? Number(r.max_score) : null,
      passed: r.passed,
      autofail_result: r.autofail_result,
      quality_score: r.quality_score,
      call_outcome: r.call_outcome,
      notes: r.overall_notes,
      status: r.status,
      // Call context.
      customer_name: a.customer_name || null,
      customer_phone: a.customer_phone || t?.normalized_phone || null,
      customer_state: a.customer_state || null,
      recording_date: a.recording_date || null,
      work_type: a.work_type || null,
      transfer_id: a.transfer_id || null,
      sale_id: a.sale_id || null,
      // Disposition: the closer's own if present, else what the dialer reported.
      disposition: t?.latest_disposition || t?.vicidial_dispo || null,
      transfer_status: t?.status || null,
      // Only on a phone investigation.
      criteria: scoresByReview[r.id] || undefined,
    };
  });

  res.json({
    reviews,
    total: count || 0,
    page: parseInt(page),
    limit: lim,
    // So the UI can say "showing every evaluation for this number" rather than
    // leaving someone to wonder why their agent filter appears ignored.
    phone_search: phoneSearch,
    phone: phoneSearch ? phone : null,
  });
}));

// ============================================================================
// GET /reviews — list reviews scoped to company
//   - compliance/superadmin: all companies (or filter by ?company_id=)
//   - others: own company only
// ============================================================================
router.get('/', asyncHandler(async (req, res) => {
  const userRole  = req.user.role;
  const { company_id, rating, page = 1, limit = 50, date_from, date_to, closer_id } = req.query;

  const scopeAll = ['compliance_manager', 'superadmin'].includes(userRole);

  const targetCompany = company_id || req.user.company_id || null;

  let query = supabaseAdmin
    .from('call_reviews')
    .select('id, rating, notes, created_at, transfer_id, company_id, closer_id', { count: 'exact' })
    .order('created_at', { ascending: false });

  // Closer-side roles (closer_manager, compliance_manager) live in a closer company.
  // Reviews are tagged with the FRONTER's company_id (from the transfer), so filtering
  // by company_id would return 0 results. Scope by closer_id for their company's users instead.
  if (!scopeAll && targetCompany && ['closer_manager', 'compliance_manager'].includes(userRole)) {
    const ids = await getCompanyUserIds(targetCompany);
    if (ids.length === 0) return res.json({ reviews: [], total: 0, page: parseInt(page), limit: parseInt(limit) });
    query = query.in('closer_id', ids);
  } else if (!scopeAll && targetCompany) {
    query = query.eq('company_id', targetCompany);
  }

  if (rating)    query = query.eq('rating', rating);
  if (closer_id) query = query.eq('closer_id', closer_id);
  if (date_from) query = query.gte('created_at', etDateToUtcStart(date_from));
  if (date_to)   query = query.lte('created_at', etDateToUtcEnd(date_to));

  const offset = (parseInt(page) - 1) * parseInt(limit);
  query = query.range(offset, offset + parseInt(limit) - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const reviews     = data || [];
  const closerIds   = [...new Set(reviews.map(r => r.closer_id).filter(Boolean))];
  const transferIds = [...new Set(reviews.map(r => r.transfer_id).filter(Boolean))];

  const [profileResult, transferResult] = await Promise.all([
    closerIds.length   > 0 ? supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', closerIds)   : { data: [] },
    transferIds.length > 0 ? supabaseAdmin.from('transfers').select('id, form_data, status, company_id').in('id', transferIds) : { data: [] },
  ]);

  const profileMap  = {};
  (profileResult.data  || []).forEach(p => { profileMap[p.user_id] = p; });
  const transferMap = {};
  (transferResult.data || []).forEach(t => { transferMap[t.id]     = t; });

  const enriched = reviews.map(r => ({
    ...r,
    user_profiles: profileMap[r.closer_id]    || null,
    transfers:     transferMap[r.transfer_id] || null,
  }));

  res.json({ reviews: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
}));

// ============================================================================
// GET /reviews/dispositions — list dispositions scoped to company
// ============================================================================
router.get('/dispositions', asyncHandler(async (req, res) => {
  const userRole  = req.user.role;
  const { company_id, disposition, page = 1, limit = 50, closer_id } = req.query;

  const scopeAll = ['compliance_manager', 'superadmin'].includes(userRole);

  const targetCompany = company_id || req.user.company_id || null;

  let query = supabaseAdmin
    .from('call_dispositions')
    .select('id, disposition, notes, created_at, transfer_id, company_id, closer_id', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (!scopeAll && targetCompany && ['closer_manager', 'compliance_manager'].includes(userRole)) {
    const ids = await getCompanyUserIds(targetCompany);
    if (ids.length === 0) return res.json({ dispositions: [], total: 0, page: parseInt(page), limit: parseInt(limit) });
    query = query.in('closer_id', ids);
  } else if (!scopeAll && targetCompany) {
    query = query.eq('company_id', targetCompany);
  }

  if (disposition) query = query.eq('disposition', disposition);
  if (closer_id)   query = query.eq('closer_id', closer_id);

  const offset = (parseInt(page) - 1) * parseInt(limit);
  query = query.range(offset, offset + parseInt(limit) - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const dispos      = data || [];
  const closerIds   = [...new Set(dispos.map(d => d.closer_id).filter(Boolean))];
  const transferIds = [...new Set(dispos.map(d => d.transfer_id).filter(Boolean))];

  const [profileResult, transferResult] = await Promise.all([
    closerIds.length   > 0 ? supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', closerIds)   : { data: [] },
    transferIds.length > 0 ? supabaseAdmin.from('transfers').select('id, form_data, status').in('id', transferIds)                   : { data: [] },
  ]);

  const profileMap  = {};
  (profileResult.data  || []).forEach(p => { profileMap[p.user_id] = p; });
  const transferMap = {};
  (transferResult.data || []).forEach(t => { transferMap[t.id]     = t; });

  const enriched = dispos.map(d => ({
    ...d,
    user_profiles: profileMap[d.closer_id]    || null,
    transfers:     transferMap[d.transfer_id] || null,
  }));

  res.json({ dispositions: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
}));

module.exports = router;
