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
const { listCandidatesByLeadId, listCandidatesByPhone, listCandidatesForSale, locationForRecording, listDayRecordings, getBoxes, fillLeadStatuses, resolveDispos, leadFieldCustomer } = require('../utils/dialerBoxes');
const { materializeCompany } = require('../utils/qaMaterializer');
const { autoAssignCompany } = require('../utils/qaAutoAssign');
const { WORK_TYPES, workTypeOf, getActiveRules, materializeCloserWork, applyCompanyRules, openCounts } = require('../utils/qaRules');
const { sampleRcmFromDialer } = require('../utils/qaDialerSampler');
const { notifyUsers, getUserIdsByLevel } = require('../utils/notificationService');
const logger = require('../utils/logger');
const axios = require('axios');

const router = express.Router();

// Plain-language label per work-type slot (used in agent-facing messages).
const SLOT_LABELS = { tra: 'TRA · Transfers', rcm: 'RCM · Random', closer_sales: 'Closed Sale', closer_dispo: 'Unclosed Sale' };

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
// Company-scope check for a QA ASSIGNMENT (not a raw company id). QA users are
// scoped to their FRONTER companies, but a closer-leg row (a sale / an unclosed
// transfer) may be STORED under the CLOSER company (the materializer / crm-records
// browser create it there). QA reviews those legs under the fronter company (via
// the transfer link), and the Live feed anchors them there — so accept EITHER the
// stored company OR the linked transfer's (fronter) company. This only ever WIDENS
// access in the intended direction; a tra row (company_id = its transfer's company)
// still passes on the fast path. `allowed === null` = superadmin/view_all → any.
async function assignmentInScope(a, allowed) {
  if (!allowed) return true;
  if (a.company_id && allowed.includes(a.company_id)) return true;
  let transferId = a.transfer_id || null;
  if (!transferId && a.sale_id) {
    const { data: s } = await supabaseAdmin.from('sales').select('transfer_id').eq('id', a.sale_id).maybeSingle();
    transferId = s?.transfer_id || null;
  }
  if (!transferId) return false;
  const { data: t } = await supabaseAdmin.from('transfers').select('company_id').eq('id', transferId).maybeSingle();
  return !!(t?.company_id && allowed.includes(t.company_id));
}
const leadDigits = (code) => { const m = String(code || '').match(/(\d+)\s*$/); return m ? m[1] : null; };

// dialer agent id(s) → the CRM user's real NAME (vicidial_agent_ids mapping).
// Reviewed agents must show as people, not dialer codes like TMC100277.
async function dialerAgentNameMap(agentIds) {
  const want = [...new Set((agentIds || []).filter(Boolean).flatMap(a => [String(a), String(a).toUpperCase()]))];
  if (!want.length) return {};
  const { data: profs } = await supabaseAdmin.from('user_profiles')
    .select('first_name, last_name, vicidial_agent_ids').overlaps('vicidial_agent_ids', want);
  const map = {};
  for (const p of (profs || [])) for (const a of (p.vicidial_agent_ids || [])) {
    const A = String(a).toUpperCase();
    const nm = `${p.first_name || ''} ${p.last_name || ''}`.trim();
    if (nm && !map[A]) map[A] = nm;
  }
  return map;
}

// A QA MANAGER can pull the dialer, see the pool, and assign. A qa_agent cannot —
// they only ever see tasks assigned to them, in their bound method(s).
async function isManager(req) {
  if (await isSuperAdmin(req.user.id)) return true;
  return hasPermission(req.user.id, req.user.company_id, 'assign_qa_tasks');
}
// The method(s) a QA agent is bound to (mig 180). Empty = not set up yet → the
// agent sees nothing until a manager binds them + assigns work.
async function agentMethods(userId) {
  const { data } = await supabaseAdmin.from('qa_agent_methods').select('method').eq('user_id', userId);
  return [...new Set((data || []).map(r => r.method))];
}

// Pull a zip/state/address value out of a dynamic form_data blob by fuzzy key.
// (transfers have NO customer_name column — name/zip/state/address all live in
// form_data: Zip / State / Address / FirstName+LastName / "Full Name".)
function scanFormData(fd, kind) {
  if (!fd || typeof fd !== 'object') return null;
  const pats = {
    zip:     /(^|_)(zip|postal)(_?code)?$/i,
    state:   /(^|_)state$/i,
    address: /(^|_)(address|street|addr)/i,
  }[kind];
  for (const [k, v] of Object.entries(fd)) {
    if (v == null || v === '') continue;
    if (pats.test(k)) return String(v).trim();
  }
  return null;
}
// Customer name from form_data: a full-name field, else First (+Last).
function scanName(fd) {
  if (!fd || typeof fd !== 'object') return null;
  const entries = Object.entries(fd);
  const val = (re) => { for (const [k, v] of entries) if (v != null && v !== '' && re.test(k)) return String(v).trim(); return ''; };
  const full = val(/^(full[\s_]?name|customer[\s_]?name|lead[\s_]?name|client[\s_]?name|name)$/i);
  if (full) return full;
  const nm = [val(/^first[\s_]?name$/i), val(/^last[\s_]?name$/i)].filter(Boolean).join(' ').trim();
  return nm || null;
}

// Resolve customer identity for an assignment: CRM (transfer/sale) FIRST, then a
// best-effort VICIdial lead_field_info fallback. Returns the denormalized columns.
async function resolveCustomer({ companyId, transferId, saleId, phone, boxId, leadId, dialerBudget }) {
  const out = { customer_name: null, customer_phone: phone || null, customer_zip: null, customer_state: null, customer_address: null, sale_meta: null };

  // 1. CRM transfer — by id, else by normalized phone within the company.
  // transfers have no customer_name column → derive it from form_data.
  let t = null;
  if (transferId) {
    const { data } = await supabaseAdmin.from('transfers').select('normalized_phone, form_data').eq('id', transferId).maybeSingle();
    t = data || null;
  } else if (phone) {
    const digits = String(phone).replace(/\D/g, '').slice(-10);
    if (digits) {
      const { data } = await supabaseAdmin.from('transfers')
        .select('normalized_phone, form_data')
        .eq('company_id', companyId).ilike('normalized_phone', `%${digits}`)
        .order('created_at', { ascending: false }).limit(1);
      t = (data && data[0]) || null;
    }
  }
  if (t) {
    out.customer_name = scanName(t.form_data) || out.customer_name;
    out.customer_phone = out.customer_phone || t.normalized_phone || null;
    out.customer_zip = scanFormData(t.form_data, 'zip');
    out.customer_state = scanFormData(t.form_data, 'state');
    out.customer_address = scanFormData(t.form_data, 'address');
  }

  // 2. Linked sale → name/phone + plan/vehicle meta (sales HAS these columns).
  if (saleId) {
    const { data: s } = await supabaseAdmin.from('sales').select('customer_name, customer_phone, customer_address, plan, form_data').eq('id', saleId).maybeSingle();
    if (s) {
      const fd = s.form_data || {};
      out.customer_name = out.customer_name || s.customer_name || scanName(fd);
      out.customer_phone = out.customer_phone || s.customer_phone || null;
      out.customer_zip = out.customer_zip || scanFormData(fd, 'zip');
      out.customer_state = out.customer_state || scanFormData(fd, 'state');
      out.customer_address = out.customer_address || s.customer_address || scanFormData(fd, 'address');
      out.sale_meta = { plan: s.plan || fd.SalePlan || fd.plan || null, vehicle: fd.VIN || [fd.CarYear, fd.CarMake, fd.CarModel].filter(Boolean).join(' ') || null };
    }
  }

  // 3. Dialer fallback (only if CRM gave no name AND we still have budget).
  if (!out.customer_name && leadId && boxId && dialerBudget && dialerBudget.n > 0) {
    dialerBudget.n -= 1;
    const box = getBoxes().find(b => b.id === boxId);
    if (box) {
      const c = await leadFieldCustomer(box, leadId);
      if (c) {
        out.customer_name = out.customer_name || c.customer_name;
        out.customer_phone = out.customer_phone || c.customer_phone;
        out.customer_zip = out.customer_zip || c.customer_zip;
        out.customer_state = out.customer_state || c.customer_state;
        out.customer_address = out.customer_address || c.customer_address;
      }
    }
  }
  return out;
}

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
  if (req.query.subject_role) q = q.eq('subject_role', req.query.subject_role);
  if (req.query.status)       q = q.eq('status', req.query.status);
  if (req.query.date_from)    q = q.gte('created_at', req.query.date_from);
  if (req.query.date_to)      q = q.lte('created_at', `${req.query.date_to}T23:59:59.999Z`);

  // AGENT scoping: a qa_agent only ever sees tasks assigned to THEM. No pool, no
  // cross-agent view. Explicitly-assigned work is ALWAYS visible regardless of
  // method bindings — compliance work rules (mig 186) route tasks straight to a
  // reviewer, and a routed task must never be invisible to its owner.
  const mgr = await isManager(req);
  if (!mgr) {
    q = q.eq('assigned_to', req.user.id);
    if (req.query.method) q = q.eq('method', req.query.method);
  } else {
    // MANAGER filters (pool visibility)
    if (req.query.method)              q = q.eq('method', req.query.method);
    if (req.query.mine === 'true')     q = q.eq('assigned_to', req.user.id);
    if (req.query.unassigned === 'true') q = q.is('assigned_to', null);
  }

  const { data, error, count } = await q;
  if (error) { logger.warn('QA', `queue: ${error.message}`); return res.status(500).json({ error: error.message }); }

  // hydrate display fields from the referenced transfer / sale (batched)
  const tIds = [...new Set((data || []).map(r => r.transfer_id).filter(Boolean))];
  const sIds = [...new Set((data || []).map(r => r.sale_id).filter(Boolean))];
  const [tRes, sRes, aRes] = await Promise.all([
    // transfers have NO customer_name column — pull form_data and derive it.
    tIds.length ? supabaseAdmin.from('transfers').select('id, normalized_phone, form_data, vicidial_vendor_code, created_at, created_by').in('id', tIds) : Promise.resolve({ data: [] }),
    sIds.length ? supabaseAdmin.from('sales').select('id, customer_name, customer_phone, sale_date, closer_id, transfer_id').in('id', sIds) : Promise.resolve({ data: [] }),
    Promise.resolve({ data: [] }),
  ]);
  const tById = Object.fromEntries((tRes.data || []).map(t => [t.id, t]));
  const sById = Object.fromEntries((sRes.data || []).map(s => [s.id, s]));
  // Names for BOTH the assignee AND the REVIEWED subject user — a CRM transfer
  // task grades the fronter (transfers.created_by), a sale grades the closer
  // (sales.closer_id). Resolving these is what stops "Unknown agent".
  const subjectUids = [...new Set([
    ...(tRes.data || []).map(t => t.created_by),
    ...(sRes.data || []).map(s => s.closer_id),
    ...(data || []).map(r => r.assigned_to),
  ].filter(Boolean))];
  let names = {};
  if (subjectUids.length) {
    const { data: up } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', subjectUids);
    names = Object.fromEntries((up || []).map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim()]));
  }
  // attach the SCORE for any already-scored rows (so the Queue shows a scoreboard)
  const aIds = (data || []).map(r => r.id);
  let reviewByAssign = {};
  if (aIds.length) {
    const { data: revs } = await supabaseAdmin.from('qa_reviews')
      .select('assignment_id, final_score, quality_score, passed, autofail_result, status, total_score, max_score').in('assignment_id', aIds);
    reviewByAssign = Object.fromEntries((revs || []).map(r => [r.assignment_id, r]));
  }

  const items = (data || []).map(r => {
    const t = r.transfer_id ? tById[r.transfer_id] : null;
    const s = r.sale_id ? sById[r.sale_id] : null;
    const rec = r.recording_ref || null;
    const rv = reviewByAssign[r.id] || null;
    return {
      ...r,
      // prefer the STORED enrichment (frozen at assign time, incl. day-recording
      // rows with no CRM link); fall back to live transfer/sale hydration.
      customer_name: r.customer_name || (t ? scanName(t.form_data) : null) || s?.customer_name || null,
      customer_phone: r.customer_phone || rec?.phone || t?.normalized_phone || s?.customer_phone || null,
      customer_zip: r.customer_zip || (t ? scanFormData(t.form_data, 'zip') : null) || null,
      customer_state: r.customer_state || (t ? scanFormData(t.form_data, 'state') : null) || null,
      customer_address: r.customer_address || (t ? scanFormData(t.form_data, 'address') : null) || null,
      sale_meta: r.sale_meta || null,
      subject_date: rec?.start_time || t?.created_at || s?.sale_date || r.created_at,
      vendor_code: t?.vicidial_vendor_code || null,
      agent_display: r.subject_agent || null,     // reviewed agent's dialer id/login (raw RCM)
      // reviewed agent's real name: recording name → CRM subject (fronter on a
      // transfer, closer on a sale) → resolved dialer id (below)
      agent_name: rec?.agent_name || (t ? names[t.created_by] : null) || (s ? names[s.closer_id] : null) || null,
      subject_role_user: t?.created_by || s?.closer_id || null,
      // the ONE canonical work type — drives the agent's 4 queue sections
      work_type: workTypeOf(r),
      duration: rec?.duration ?? null,
      assignee_name: r.assigned_to ? (names[r.assigned_to] || null) : null,
      review: rv,   // { final_score, quality_score, passed, autofail_result, status } or null
    };
  });
  // the reviewed agent must show as a PERSON — resolve any dialer id whose name
  // isn't stored on the row (raw RCM samples, older day-recording tasks).
  const unresolved = items.filter(i => !i.agent_name && i.agent_display).map(i => i.agent_display);
  if (unresolved.length) {
    const nm = await dialerAgentNameMap(unresolved);
    for (const i of items) if (!i.agent_name && i.agent_display) i.agent_name = nm[String(i.agent_display).toUpperCase()] || null;
  }
  res.json({ items, total: offset === 0 ? (count || 0) : null, page, limit });
}));

// ── CRM records browser (manager) ─────────────────────────────────────────────
// Lists the ACTUAL CRM transfers / sales (not the sampled queue) so a QA manager
// can browse + score any real record. Recordings + scoring reuse the existing
// assignment path: opening a record find-or-creates its qa_assignment (POST
// /crm-records/:kind/:id/open). The day-recordings VICIdial browser is separate.
router.get('/crm-records', asyncHandler(async (req, res) => {
  if (!(await isManager(req))) return res.status(403).json({ error: 'Forbidden' });
  const kind   = req.query.kind === 'sale' ? 'sale' : 'transfer';
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const page   = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const offset = (page - 1) * limit;
  const wantCount = offset === 0 ? 'exact' : undefined;
  const allowed = await allowedCompanyIds(req);
  const phoneQ = String(req.query.search || '').replace(/\D/g, '').slice(-10);

  let items = [], total = 0;
  if (kind === 'transfer') {
    let q = supabaseAdmin.from('transfers')
      .select('id, company_id, normalized_phone, form_data, vicidial_vendor_code, created_at, status, latest_disposition', { count: wantCount })
      .neq('vicidial_pending', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (req.query.company_id) q = q.eq('company_id', req.query.company_id);
    else if (allowed) { if (!allowed.length) return res.json({ items: [], total: 0, page, limit }); q = q.in('company_id', allowed); }
    if (req.query.status) q = q.eq('status', req.query.status);
    if (phoneQ) q = q.ilike('normalized_phone', `%${phoneQ}`);
    const { data, count, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    total = count || 0;
    items = (data || []).map(t => ({
      record_kind: 'transfer', record_id: t.id, company_id: t.company_id,
      customer_name: scanName(t.form_data), customer_phone: t.normalized_phone,
      customer_zip: scanFormData(t.form_data, 'zip'), customer_state: scanFormData(t.form_data, 'state'),
      subject_date: t.created_at, record_status: t.status, disposition: t.latest_disposition,
      vendor_code: t.vicidial_vendor_code,
    }));
  } else {
    let q = supabaseAdmin.from('sales')
      .select('id, company_id, customer_name, customer_phone, sale_date, transfer_id, status, closer_disposition, client_name, plan', { count: wantCount })
      .order('sale_date', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);
    if (req.query.company_id) q = q.eq('company_id', req.query.company_id);
    else if (allowed) { if (!allowed.length) return res.json({ items: [], total: 0, page, limit }); q = q.in('company_id', allowed); }
    if (req.query.status) q = q.eq('status', req.query.status);
    if (phoneQ) q = q.ilike('customer_phone', `%${phoneQ}`);
    const { data, count, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    total = count || 0;
    items = (data || []).map(s => ({
      record_kind: 'sale', record_id: s.id, company_id: s.company_id,
      customer_name: s.customer_name, customer_phone: s.customer_phone,
      subject_date: s.sale_date, record_status: s.status, disposition: s.closer_disposition,
      client_name: s.client_name, plan: s.plan, transfer_id: s.transfer_id,
    }));
  }

  // Attach any existing QA assignment + its review, so the list shows the QA
  // status / score for records already reviewed.
  const method = kind === 'transfer' ? 'tra' : 'rcm';
  const col = kind === 'transfer' ? 'transfer_id' : 'sale_id';
  const ids = items.map(i => i.record_id);
  if (ids.length) {
    const { data: asg } = await supabaseAdmin.from('qa_assignments')
      .select(`id, ${col}, status, assigned_to`).eq('method', method).in(col, ids);
    const asgByRec = Object.fromEntries((asg || []).map(a => [a[col], a]));
    const aIds = (asg || []).map(a => a.id);
    let revByA = {};
    if (aIds.length) {
      const { data: revs } = await supabaseAdmin.from('qa_reviews')
        .select('assignment_id, final_score, quality_score, passed, status, total_score, max_score, autofail_result').in('assignment_id', aIds);
      revByA = Object.fromEntries((revs || []).map(r => [r.assignment_id, r]));
    }
    items = items.map(i => {
      const a = asgByRec[i.record_id] || null;
      return { ...i, assignment_id: a?.id || null, qa_status: a?.status || null, review: a ? (revByA[a.id] || null) : null };
    });
  }
  res.json({ items, total: offset === 0 ? total : null, page, limit });
}));

// Find-or-create the QA assignment for a specific CRM record → returns its id so
// the frontend can score it + resolve recordings via the normal assignment path.
router.post('/crm-records/:kind/:id/open', asyncHandler(async (req, res) => {
  if (!(await isManager(req))) return res.status(403).json({ error: 'Forbidden' });
  const kind   = req.params.kind === 'sale' ? 'sale' : 'transfer';
  const id     = req.params.id;
  const method = kind === 'transfer' ? 'tra' : 'rcm';
  const col    = kind === 'transfer' ? 'transfer_id' : 'sale_id';

  const reselect = () => supabaseAdmin.from('qa_assignments')
    .select('id, company_id, method, subject_role').eq(col, id).eq('method', method).maybeSingle();

  const { data: ex } = await reselect();
  if (ex) return res.json({ assignment_id: ex.id, method: ex.method, subject_role: ex.subject_role, company_id: ex.company_id });

  // company scope from the record itself
  const { data: rec } = await supabaseAdmin.from(kind === 'transfer' ? 'transfers' : 'sales').select('company_id').eq('id', id).maybeSingle();
  if (!rec?.company_id) return res.status(404).json({ error: 'Record not found' });
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(rec.company_id)) return res.status(403).json({ error: 'Forbidden' });

  const cust = await resolveCustomer({ companyId: rec.company_id, transferId: kind === 'transfer' ? id : null, saleId: kind === 'sale' ? id : null });
  const row = {
    company_id: rec.company_id, method, subject_role: kind === 'transfer' ? 'fronter' : 'closer',
    [col]: id, sampled: false, status: 'pending',
    customer_name: cust.customer_name, customer_phone: cust.customer_phone,
    customer_zip: cust.customer_zip, customer_state: cust.customer_state, customer_address: cust.customer_address,
    sale_meta: cust.sale_meta,
  };
  const { data: created, error } = await supabaseAdmin.from('qa_assignments').insert(row).select('id, company_id, method, subject_role').single();
  if (error) {
    // race on the unique (record, method) index → re-select the winner
    const { data: ex2 } = await reselect();
    if (ex2) return res.json({ assignment_id: ex2.id, method: ex2.method, subject_role: ex2.subject_role, company_id: ex2.company_id });
    logger.warn('QA', `crm-open ${kind} ${id}: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
  res.json({ assignment_id: created.id, method: created.method, subject_role: created.subject_role, company_id: created.company_id });
}));

// ── LIVE feed: near-real-time transfers + sales as they land from the dialer ───
// The VICIdial webhooks (routes/vicidial.js) write the transfer / sale rows the
// instant XFER / SALE is punched. This reads those rows back on a short rolling
// window so QA can listen + score right away — NO "load day", NO dialer re-fetch,
// NO materialize. It DELIBERATELY includes vicidial_pending transfers (the fronter
// hasn't completed the form yet): the recording still resolves by vendor_code /
// agent / phone, so QA can hear the call the moment it lands — which is the point.
// Company-scoped to the caller's allowed companies (an agent can't widen scope).
router.get('/live', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  const allowed = await allowedCompanyIds(req);            // null = all companies
  const one = req.query.company_id || null;
  if (one && allowed && !allowed.includes(one)) return res.status(403).json({ error: 'Forbidden' });
  if (allowed && !allowed.length) return res.json({ items: [], server_time: new Date().toISOString() });
  const companyIds = one ? [one] : allowed;               // null → every company (superadmin/view_all)

  const limit = Math.min(parseInt(req.query.limit, 10) || 80, 200);
  const windowMin = Math.min(Math.max(parseInt(req.query.window_min, 10) || 240, 5), 1440);
  const since = (req.query.since && !Number.isNaN(Date.parse(req.query.since)))
    ? new Date(req.query.since).toISOString()
    : new Date(Date.now() - windowMin * 60000).toISOString();

  // Transfers — carry BOTH legs: the fronter/TRA leg (always) and, when the call
  // reached a closer without a sale, the closer/Unclosed leg. vicidial_pending
  // stubs are INCLUDED on purpose (QA can still hear the fronter call).
  let tq = supabaseAdmin.from('transfers')
    .select('id, company_id, normalized_phone, form_data, vicidial_vendor_code, created_at, status, latest_disposition, vicidial_pending, assigned_closer_id, vicidial_dispo, vicidial_dispo_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (companyIds) tq = tq.in('company_id', companyIds);

  // Sales (closer leg) anchored to the FRONTER company via the transfer link — a
  // sale's own company_id is the closer company (1-Vertex). Ordered by insert time
  // ("just punched"), not sale_date. !inner drops standalone (no-transfer) sales.
  let sq = supabaseAdmin.from('sales')
    .select('id, company_id, customer_name, customer_phone, created_at, sale_date, status, closer_disposition, plan, client_name, transfer_id, transfers!inner(company_id)')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (companyIds) sq = sq.in('transfers.company_id', companyIds);

  const [tRes, sRes] = await Promise.all([tq, sq]);
  if (tRes.error) { logger.warn('QA', `live transfers: ${tRes.error.message}`); return res.status(500).json({ error: tRes.error.message }); }
  if (sRes.error) logger.warn('QA', `live sales: ${sRes.error.message}`);
  const transfers = tRes.data || [];
  const sales = sRes.data || [];

  // Which of these transfers already have a SOLD sale? Their closer leg is a Closed
  // Sale (shown as the sale row); the rest that reached a closer are Unclosed.
  const txIds = transfers.map(t => t.id);
  let soldSet = new Set();
  if (txIds.length) {
    const { data: sold } = await supabaseAdmin.from('sales')
      .select('transfer_id').in('transfer_id', txIds).in('status', SOLD_SALE_STATUSES).not('transfer_id', 'is', null);
    soldSet = new Set((sold || []).map(s => s.transfer_id));
  }

  const tBase = (t, work_type, when) => ({
    record_kind: 'transfer', record_id: t.id, company_id: t.company_id, work_type,
    customer_name: scanName(t.form_data), customer_phone: t.normalized_phone,
    customer_zip: scanFormData(t.form_data, 'zip'), customer_state: scanFormData(t.form_data, 'state'),
    subject_date: when, created_at: when,
    record_status: t.status, vendor_code: t.vicidial_vendor_code,
  });
  // TRA — fronter leg, one per transfer (always).
  const tItems = transfers.map(t => ({
    ...tBase(t, 'tra', t.created_at),
    disposition: t.latest_disposition, pending_fronter: !!t.vicidial_pending, has_closer: !!t.assigned_closer_id,
  }));
  // UNCLOSED SALE — the closer leg of a transfer that reached a closer but did NOT
  // sell. Ordered by when the closer dispositioned it (falls back to created_at).
  const uItems = transfers.filter(t => t.assigned_closer_id && !soldSet.has(t.id)).map(t => ({
    ...tBase(t, 'closer_dispo', t.vicidial_dispo_at || t.created_at),
    disposition: t.vicidial_dispo || t.latest_disposition, pending_fronter: false, has_closer: true,
  }));
  // CLOSED SALE — the sale row (closer leg, sold). Anchored to the FRONTER company.
  const sItems = sales.map(s => ({
    record_kind: 'sale', record_id: s.id, work_type: 'closer_sales',
    company_id: (s.transfers && s.transfers.company_id) || s.company_id,
    customer_name: s.customer_name, customer_phone: s.customer_phone,
    subject_date: s.created_at, created_at: s.created_at,
    record_status: s.status, disposition: s.closer_disposition,
    plan: s.plan, client_name: s.client_name, transfer_id: s.transfer_id,
  }));

  let items = [...tItems, ...uItems, ...sItems]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);

  // Attach any existing QA assignment + review + who holds it, so the feed shows
  // reviewed / claimed state live. A transfer carries TWO legs: tra (method 'tra')
  // and closer_dispo (method 'rcm'); a sale is closer_sales (method 'rcm').
  const uniqTxIds   = [...new Set(items.filter(i => i.record_kind === 'transfer').map(i => i.record_id))];
  const uniqSaleIds = [...new Set(items.filter(i => i.record_kind === 'sale').map(i => i.record_id))];
  const [txA, saleA] = await Promise.all([
    uniqTxIds.length ? supabaseAdmin.from('qa_assignments').select('id, transfer_id, method, status, assigned_to').in('transfer_id', uniqTxIds).in('method', ['tra', 'rcm']) : Promise.resolve({ data: [] }),
    uniqSaleIds.length ? supabaseAdmin.from('qa_assignments').select('id, sale_id, status, assigned_to').eq('method', 'rcm').in('sale_id', uniqSaleIds) : Promise.resolve({ data: [] }),
  ]);
  const asgTx = {};   // `${transfer_id}:${method}` → assignment (tra leg vs closer_dispo leg)
  for (const a of (txA.data || [])) asgTx[`${a.transfer_id}:${a.method}`] = a;
  const asgSale = Object.fromEntries((saleA.data || []).map(a => [a.sale_id, a]));

  const allAsg = [...(txA.data || []), ...(saleA.data || [])];
  const aIds = allAsg.map(a => a.id);
  const assigneeUids = [...new Set(allAsg.map(a => a.assigned_to).filter(Boolean))];
  const [revRes, nameRes] = await Promise.all([
    aIds.length ? supabaseAdmin.from('qa_reviews').select('assignment_id, final_score, quality_score, passed, status, total_score, max_score, autofail_result').in('assignment_id', aIds) : Promise.resolve({ data: [] }),
    assigneeUids.length ? supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', assigneeUids) : Promise.resolve({ data: [] }),
  ]);
  const revBy = Object.fromEntries((revRes.data || []).map(r => [r.assignment_id, r]));
  const nameBy = Object.fromEntries((nameRes.data || []).map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || null]));
  const asgFor = (i) => {
    if (i.record_kind === 'sale') return asgSale[i.record_id] || null;
    return asgTx[`${i.record_id}:${i.work_type === 'closer_dispo' ? 'rcm' : 'tra'}`] || null;
  };
  items = items.map(i => {
    const a = asgFor(i);
    return {
      ...i,
      assignment_id: a?.id || null,
      qa_status: a?.status || null,
      assigned_to: a?.assigned_to || null,
      assignee_name: a?.assigned_to ? (nameBy[a.assigned_to] || null) : null,
      mine: a ? a.assigned_to === req.user.id : null,
      review: a ? (revBy[a.id] || null) : null,
    };
  });
  res.json({ items, server_time: new Date().toISOString() });
}));

// Open (find-or-create + CLAIM) a live record for scoring. Unlike the manager-only
// /crm-records/*/open, this is available to any QA user (view_qa_queue): an agent
// SELF-CLAIMS the task (assigned_to = them) so they can listen + score straight
// from the Live feed. If another agent already holds it → 409 (shared pool, first-
// come). A manager opens WITHOUT claiming (so they can still hand it out).
router.post('/live/open', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  const kind = req.body?.kind === 'sale' ? 'sale' : 'transfer';
  const id = req.body?.id;
  if (!id) return res.status(400).json({ error: 'id required' });
  // A transfer has TWO reviewable legs: 'tra' (fronter, method tra) and
  // 'closer_dispo' (closer/unclosed, method rcm). A sale is always closer_sales.
  const wt = kind === 'sale' ? 'closer_sales' : (req.body?.work_type === 'closer_dispo' ? 'closer_dispo' : 'tra');
  const method = wt === 'tra' ? 'tra' : 'rcm';
  const subject_role = wt === 'tra' ? 'fronter' : 'closer';
  const col = kind === 'transfer' ? 'transfer_id' : 'sale_id';
  const mgr = await isManager(req);

  // company scope: transfer → its company; sale → the FRONTER company via transfer.
  let companyId = null;
  if (kind === 'transfer') {
    const { data: rec } = await supabaseAdmin.from('transfers').select('company_id').eq('id', id).maybeSingle();
    companyId = rec?.company_id || null;
  } else {
    const { data: rec } = await supabaseAdmin.from('sales').select('company_id, transfers(company_id)').eq('id', id).maybeSingle();
    companyId = (rec?.transfers && rec.transfers.company_id) || rec?.company_id || null;
  }
  if (!companyId) return res.status(404).json({ error: 'Record not found' });
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(companyId)) return res.status(403).json({ error: 'Forbidden' });

  const reselect = () => supabaseAdmin.from('qa_assignments')
    .select('id, company_id, method, subject_role, assigned_to, status').eq(col, id).eq('method', method).maybeSingle();

  let { data: a } = await reselect();
  if (!a) {
    const cust = await resolveCustomer({ companyId, transferId: kind === 'transfer' ? id : null, saleId: kind === 'sale' ? id : null });
    const row = {
      company_id: companyId, method, subject_role,
      [col]: id, sampled: false, status: 'pending',
      customer_name: cust.customer_name, customer_phone: cust.customer_phone,
      customer_zip: cust.customer_zip, customer_state: cust.customer_state, customer_address: cust.customer_address,
      sale_meta: cust.sale_meta,
    };
    if (!mgr) row.assigned_to = req.user.id;   // agent self-claims on create
    const { data: created, error } = await supabaseAdmin.from('qa_assignments').insert(row).select('id, company_id, method, subject_role, assigned_to, status').single();
    if (error) {
      const { data: a2 } = await reselect();   // race on the unique (record, method) index
      if (!a2) { logger.warn('QA', `live-open ${kind}/${wt} ${id}: ${error.message}`); return res.status(500).json({ error: error.message }); }
      a = a2;
    } else a = created;
  }

  // Existing assignment: an agent claims it if free (atomic guard), else it's taken.
  if (!mgr) {
    if (!a.assigned_to) {
      const { data: claimed } = await supabaseAdmin.from('qa_assignments')
        .update({ assigned_to: req.user.id }).eq('id', a.id).is('assigned_to', null)
        .select('id, company_id, method, subject_role, assigned_to, status').maybeSingle();
      if (claimed) a = claimed;
      else { const { data: a3 } = await reselect(); if (a3) a = a3; }   // lost the claim race
    }
    if (a.assigned_to && a.assigned_to !== req.user.id) {
      const { data: p } = await supabaseAdmin.from('user_profiles').select('first_name, last_name').eq('user_id', a.assigned_to).maybeSingle();
      const nm = p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : null;
      return res.status(409).json({ error: 'claimed', assigned_to: a.assigned_to, reviewer_name: nm || 'another reviewer' });
    }
  }

  res.json({ assignment_id: a.id, method: a.method, subject_role: a.subject_role, company_id: a.company_id, work_type: wt, assigned_to: a.assigned_to || null });
}));

// ── assign an item to a qa_agent ──────────────────────────────────────────────
router.post('/assignments/:id/assign', asyncHandler(async (req, res) => {
  if (!(await can(req, 'assign_qa_tasks'))) return res.status(403).json({ error: 'Forbidden' });
  const assignedTo = req.body?.assigned_to || null;   // null clears back to the pool
  const { data: a } = await supabaseAdmin.from('qa_assignments').select('id, company_id, method, work_type, transfer_id, sale_id, subject_role').eq('id', req.params.id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(a.company_id)) return res.status(403).json({ error: 'Forbidden' });
  // an agent can only be handed a SECTION (work type) they're bound to (mig 180 +
  // 192). Legacy tra/rcm bindings still satisfy the tra/rcm work types since the
  // slot value equals the method there.
  if (assignedTo) {
    const wt = workTypeOf(a);
    const methods = await agentMethods(assignedTo);
    if (!methods.includes(wt) && !methods.includes(a.method)) {
      const label = SLOT_LABELS[wt] || wt.toUpperCase();
      return res.status(400).json({ error: `This agent isn't set up for ${label} — bind that section to them in the Agents panel first.`, code: 'METHOD_UNBOUND' });
    }
  }
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
    .select('id, company_id, method, subject_role, transfer_id, sale_id, status, assigned_to, recording_ref').eq('id', req.params.id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  const allowed = await allowedCompanyIds(req);
  if (!(await assignmentInScope(a, allowed))) return res.status(403).json({ error: 'Forbidden' });
  // an AGENT hears only their own tasks' recordings; managers anything in scope
  if (!(await isManager(req)) && a.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'This call is not assigned to you.' });
  }

  let candidates = [];
  if (a.recording_ref && a.recording_ref.recording_id) {
    // day-recording assignment — the EXACT clip is known. Show it + its grouped
    // parts (all dials of this number by this agent) + any other legs on the lead.
    const rec = a.recording_ref;
    const push = (x) => { if (x && x.recording_id && !candidates.some(c => c.box_id === x.box_id && c.recording_id === x.recording_id)) candidates.push(x); };
    push({ box_id: rec.box_id, start_time: rec.start_time, recording_id: rec.recording_id, lead_id: rec.lead_id, duration: rec.duration, location: rec.location, agent_user: rec.agent_user, phone_matches: true });
    for (const p of (rec.parts || [])) push({ box_id: p.box_id, start_time: p.start_time, recording_id: p.recording_id, lead_id: p.lead_id, duration: p.duration, location: p.location, agent_user: p.agent_user, phone_matches: true });
    const leadIds = [...new Set([rec.lead_id, ...(rec.parts || []).map(p => p.lead_id)].filter(Boolean))];
    for (const lid of leadIds) {
      try { const legs = await listCandidatesByLeadId(lid); for (const l of legs) push(l); } catch { /* keep known clips */ }
    }
    candidates.sort((x, y) => String(x.start_time).localeCompare(String(y.start_time)));
  } else {
    // CRM / materialized assignment. Resolve robustly the same way the client
    // portal does: by the dialer LEAD code AND by the record's AGENT(s) + DATE +
    // PHONE. Most transfers (~77%) carry NO vicidial_vendor_code, so the agent+
    // date+phone path is what actually finds the clips. We gather BOTH the
    // fronter and the closer for the lead, so a sale shows the closer's call and
    // a transfer the fronter's — whoever is dialer-mapped.
    let leadCode = null, phone = null, saleDate = null, createdAt = null, transferId = a.transfer_id || null;
    const userIds = new Set();
    if (a.sale_id) {
      const { data: s } = await supabaseAdmin.from('sales').select('transfer_id, customer_phone, sale_date, closer_id').eq('id', a.sale_id).maybeSingle();
      if (s) { transferId = transferId || s.transfer_id || null; phone = s.customer_phone || null; saleDate = s.sale_date || null; if (s.closer_id) userIds.add(s.closer_id); }
    }
    if (transferId) {
      const { data: t } = await supabaseAdmin.from('transfers').select('vicidial_vendor_code, normalized_phone, created_at, created_by, assigned_closer_id').eq('id', transferId).maybeSingle();
      if (t) { leadCode = t.vicidial_vendor_code || null; phone = phone || t.normalized_phone || null; createdAt = t.created_at || null; if (t.created_by) userIds.add(t.created_by); if (t.assigned_closer_id) userIds.add(t.assigned_closer_id); }
    }
    // dialer agent ids for the fronter + closer on this lead
    let agentIds = [];
    if (userIds.size) {
      const { data: profs } = await supabaseAdmin.from('user_profiles').select('vicidial_agent_ids').in('user_id', [...userIds]);
      agentIds = [...new Set((profs || []).flatMap(p => p.vicidial_agent_ids || []).filter(Boolean))];
    }
    const date = createdAt ? String(createdAt).slice(0, 10) : (saleDate ? String(saleDate).slice(0, 10) : null);
    try {
      candidates = await listCandidatesForSale({ code: leadCode, phone, agentIds, date, dialerAt: createdAt });
    } catch (e) { logger.warn('QA', `candidates resolve: ${e.message}`); }
    // Last resort — pure phone search across boxes (covers legs by an unmapped
    // agent) via the dialer's phone_number_log.
    if (!candidates.length && phone) {
      try { candidates = await listCandidatesByPhone({ phone }); } catch (e) { logger.warn('QA', `candidates phone: ${e.message}`); }
    }
  }
  // first open by the assignee moves it into 'in_review' (progress signal)
  if (a.status === 'pending' && a.assigned_to === req.user.id) {
    await supabaseAdmin.from('qa_assignments').update({ status: 'in_review' }).eq('id', a.id);
  }
  res.json({ assignment_id: a.id, candidates });
}));

// ── recording stream proxy (mirrors compliance/recordings/stream; kept under
// /qa so QA plays are egress-audited and independent of compliance perms) ──────
// Only ever proxy audio from the DIALER infrastructure — never an arbitrary
// user-supplied URL (SSRF). Allowed hosts: the configured boxes + *.i5.tel
// (the recording servers), extendable via QA_STREAM_HOST_SUFFIXES.
// Recording audio is often served from a SEPARATE storage host (a raw IP like
// 37.27.213.10/RECORDINGS/...), not the box API host (*.i5.tel). We learn those
// hosts from URLs the DIALER itself hands back (server-side re-resolve) and trust
// them thereafter, so the client's location= fast-path passes the allowlist too.
const _dialerRecordingHosts = new Set();
function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } }
function noteDialerRecordingUrl(u) { const h = hostOf(u); if (h) _dialerRecordingHosts.add(h); }
function allowedRecordingUrl(u) {
  const h = hostOf(u);
  if (!h) return false;
  if (_dialerRecordingHosts.has(h)) return true;
  for (const b of getBoxes()) { try { if (new URL(b.base).hostname.toLowerCase() === h) return true; } catch { /* bad base */ } }
  const suf = (process.env.QA_STREAM_HOST_SUFFIXES || '.i5.tel').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return suf.some(s => h === s.replace(/^\./, '') || h.endsWith(s.startsWith('.') ? s : '.' + s));
}

router.get('/recordings/stream', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  const ref = { box_id: req.query.box_id, lead_id: req.query.lead_id, recording_id: req.query.recording_id };
  // Server re-resolve returns the URL straight from the authenticated dialer API
  // — trusted, so we register its host and skip the client-facing allowlist.
  const reresolve = async () => { const u = await locationForRecording(ref); if (u) noteDialerRecordingUrl(u); return u; };
  // Client-supplied location is only trusted when it passes the allowlist (SSRF
  // guard); otherwise re-resolve server-side from the dialer.
  let url = (req.query.location && /^https?:\/\//.test(req.query.location) && allowedRecordingUrl(req.query.location))
    ? req.query.location : await reresolve();
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

// ── on-demand transcription (self-hosted faster-whisper worker) ───────────────
// A reviewer clicks "Transcribe" on a specific recording leg → we resolve the
// audio (same as the stream proxy), fetch the bytes, hand them to the whisper
// worker, and CACHE the text keyed by the recording identity so repeat opens are
// instant. Audio is never stored — only the transcript text. Gated by the
// qa.transcription flag (default OFF) + a configured worker URL.
const recKey = (q) => `${q.box_id || ''}:${q.recording_id || ''}`;

// Per-user transcription access. Transcription is OFF for everyone by default;
// a superadmin / compliance manager enables it per user (global allowlist in
// business_config → qa.transcription_users). Superadmin is always allowed.
const TRANSCRIBE_USERS_KEY = 'qa.transcription_users';
async function transcribeAllowed(userId) {
  if (await isSuperAdmin(userId)) return true;
  const list = await getConfig(null, TRANSCRIBE_USERS_KEY, []);
  return Array.isArray(list) && list.includes(userId);
}

// GET cached transcript for a recording (drives "show if already transcribed").
router.get('/recordings/transcript', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  const { data } = await supabaseAdmin.from('qa_transcripts')
    .select('*').eq('recording_key', recKey(req.query)).maybeSingle();
  res.json({ transcript: data || null });
}));

// POST transcribe ONE recording leg (cache-first).
router.post('/recordings/transcribe', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });

  // Per-user access (default OFF). Superadmin / compliance enables it per user
  // in QA config → Transcription access. Superadmin is always allowed.
  if (!(await transcribeAllowed(req.user.id))) return res.status(403).json({ error: 'Transcription is not enabled for your account. Ask compliance to enable it.' });
  const workerUrl = (process.env.WHISPER_WORKER_URL || '').replace(/\/$/, '');
  if (!workerUrl) return res.status(503).json({ error: 'Transcription worker is not configured.' });

  const { box_id, lead_id, recording_id, location } = req.body || {};
  if (!recording_id && !location) return res.status(400).json({ error: 'recording_id or location required' });
  const key = recKey({ box_id, recording_id });

  // Cache-first: never re-transcribe a clip we already have.
  const { data: cached } = await supabaseAdmin.from('qa_transcripts').select('*').eq('recording_key', key).maybeSingle();
  if (cached) return res.json({ cached: true, transcript: cached });

  // Resolve the audio URL (same path — and same host allowlist — as the stream
  // proxy). Client location must pass the allowlist; a server re-resolve from the
  // dialer is trusted (and its host remembered for the stream fast-path).
  let url;
  if (location && /^https?:\/\//.test(location) && allowedRecordingUrl(location)) url = location;
  else { url = await locationForRecording({ box_id, lead_id, recording_id }); if (url) noteDialerRecordingUrl(url); }
  if (!url) return res.status(404).json({ error: 'Recording not found' });

  // Fetch the audio bytes (proxied from the dialer; not stored).
  let audio;
  try {
    const up = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000, validateStatus: s => s >= 200 && s < 400 });
    audio = Buffer.from(up.data);
  } catch (e) { logger.warn('QA', `transcribe fetch audio: ${e.message}`); return res.status(502).json({ error: 'Could not load the recording audio.' }); }
  if (!audio?.length) return res.status(502).json({ error: 'Recording audio was empty.' });

  // Hand the bytes to the whisper worker.
  let result;
  try {
    const fd = new FormData();
    fd.append('audio', new Blob([audio], { type: 'audio/mpeg' }), 'recording.mp3');
    const r = await axios.post(`${workerUrl}/transcribe`, fd, {
      headers: { Authorization: `Bearer ${process.env.WHISPER_TOKEN || ''}` },
      timeout: 300000, maxBodyLength: Infinity, maxContentLength: Infinity,
    });
    result = r.data || {};
  } catch (e) {
    logger.error('QA', `transcribe worker: ${e.response?.data?.detail || e.message}`);
    return res.status(502).json({ error: 'Transcription failed — the worker did not respond.' });
  }

  // Cache the TEXT (audio discarded). Upsert so a race just no-ops the 2nd write.
  const row = {
    recording_key: key, box_id: box_id || null, recording_id: recording_id || null, lead_id: lead_id || null,
    language: result.language || null, duration: result.duration ?? null,
    text: result.text || '', segments: Array.isArray(result.segments) ? result.segments : null,
    created_by: req.user.id,
  };
  const { data: saved, error: sErr } = await supabaseAdmin.from('qa_transcripts')
    .upsert(row, { onConflict: 'recording_key' }).select().single();
  if (sErr) { logger.warn('QA', `transcribe save: ${sErr.message}`); return res.json({ cached: false, transcript: row }); }
  res.json({ cached: false, transcript: saved });
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

// Map dialer agent ids → the CRM company that agent belongs to. Used to route a
// day-recording (identified only by its dialer agent_user) to the right company
// when assigning across "All my companies". An agent id resolves to its owner's
// active company; if the owner is in several companies, the first one WITHIN the
// caller's allowed set wins (so a manager can never route a call into a company
// they can't touch). Returns { AGENT_ID_UPPER → company_id }.
async function companiesForAgentIds(agentUsers, allowed) {
  const wanted = [...new Set((agentUsers || []).filter(Boolean).map(a => String(a).toUpperCase()))];
  if (!wanted.length) return {};
  const { data: profs } = await supabaseAdmin.from('user_profiles')
    .select('user_id, vicidial_agent_ids').overlaps('vicidial_agent_ids', wanted);
  const uidByAgent = {};
  for (const p of (profs || [])) for (const a of (p.vicidial_agent_ids || [])) {
    const A = String(a).toUpperCase();
    if (wanted.includes(A) && !uidByAgent[A]) uidByAgent[A] = p.user_id;
  }
  const uids = [...new Set(Object.values(uidByAgent))];
  if (!uids.length) return {};
  const { data: ucr } = await supabaseAdmin.from('user_company_roles')
    .select('user_id, company_id').in('user_id', uids).eq('is_active', true);
  const companyByUid = {};
  for (const r of (ucr || [])) {
    if (allowed && !allowed.includes(r.company_id)) continue;   // never outside the caller's scope
    if (!companyByUid[r.user_id]) companyByUid[r.user_id] = r.company_id;
  }
  const out = {};
  for (const [A, uid] of Object.entries(uidByAgent)) if (companyByUid[uid]) out[A] = companyByUid[uid];
  return out;
}
function foldAgents(profs) {
  const ids = new Set(); const nameByAgent = {};
  for (const p of profs || []) for (const a of (p.vicidial_agent_ids || [])) {
    const A = String(a).toUpperCase(); if (!A) continue;
    ids.add(A); nameByAgent[A] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || A;
  }
  return { ids: [...ids], nameByAgent };
}

// Resolve the day-recording agent set for a request (company scope, or all with
// the right permission). Returns {ids, nameByAgent} or { error, status }.
async function resolveDayAgents(req) {
  if (req.query.scope === 'all') {
    if (!(await isSuperAdmin(req.user.id)) && !(await hasPermission(req.user.id, req.user.company_id, 'view_all_qa_reviews'))) {
      return { error: 'Not allowed to load recordings across all companies', status: 403 };
    }
    return await allAgentIds();
  }
  const companyId = req.query.company_id || req.user.company_id;
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(companyId)) return { error: 'Forbidden', status: 403 };
  return await agentIdsForCompany(companyId);
}

// Day-recording cache lifetime (ms). Compliance sets qa.day_cache_days per
// company (default 2); a fetched dialer day is kept and re-served that long
// without re-hitting the dialer. Clamp 1..14 days.
async function dayCacheTtl(companyId) {
  const raw = Number(await getConfig(companyId, 'qa.day_cache_days', 2));
  const days = Number.isFinite(raw) ? Math.min(14, Math.max(1, Math.round(raw))) : 2;
  return days * 86400000;
}

// Disposition map (box|lead → code) for a set of recordings — per-lead
// lead_field_info (cross-box), fully filled. Used by the synchronous path.
async function buildDispoMap(rows) {
  const pairs = rows.filter(r => r.lead_id).map(r => ({ boxId: r.box_id, leadId: r.lead_id }));
  try { return await fillLeadStatuses(pairs); } catch (e) { logger.warn('QA', `dispo fill: ${e.message}`); return new Map(); }
}

// ── dispositions only (progressive / polled load) ────────────────────────────
// GET /qa/day-dispositions?date=&scope=&company_id= — resolves a BUDGET of leads
// per call and returns { dispos, dispo_counts, remaining, done }. The frontend
// loads recordings first (instant), then polls this until done, merging each
// batch — so a full company's day fills in progressively, never timing out.
router.get('/day-dispositions', asyncHandler(async (req, res) => {
  if (!(await isManager(req))) return res.status(403).json({ error: 'Forbidden' });
  const date = String(req.query.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date=YYYY-MM-DD is required' });
  const agentRes = await resolveDayAgents(req);
  if (agentRes.error) return res.status(agentRes.status || 400).json({ error: agentRes.error });
  if (!agentRes.ids.length) return res.json({ date, dispos: {}, dispo_counts: {}, remaining: 0, done: true });

  const ttlMs = await dayCacheTtl(req.query.company_id || req.user.company_id);
  const rows = await listDayRecordings({ date, agentIds: agentRes.ids, ttlMs });   // cached N days
  const pairs = rows.filter(r => r.lead_id).map(r => ({ boxId: r.box_id, leadId: r.lead_id }));
  const { map, remaining, total } = await resolveDispos(pairs, { budget: 900 });

  const dispos = {}; const dispo_counts = {};
  for (const r of rows) {
    if (!r.lead_id) continue;
    const d = map.get(`${r.box_id}|${r.lead_id}`);
    if (d) { dispos[`${r.box_id}|${r.recording_id}`] = d; dispo_counts[d] = (dispo_counts[d] || 0) + 1; }
  }
  res.json({ date, dispos, dispo_counts, total, remaining, done: remaining === 0 });
}));

// ── whole-day recording browser ──────────────────────────────────────────────
// GET /qa/day-recordings?date=YYYY-MM-DD&scope=company|all&company_id=&search=
// &dispo=0 skips the (slow) disposition enrichment for a fast first paint.
router.get('/day-recordings', asyncHandler(async (req, res) => {
  if (!(await isManager(req))) return res.status(403).json({ error: 'Forbidden' });
  const date = String(req.query.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date=YYYY-MM-DD is required' });

  const agentRes = await resolveDayAgents(req);
  if (agentRes.error) return res.status(agentRes.status || 400).json({ error: agentRes.error });
  const { ids, nameByAgent } = agentRes;
  if (!ids.length) return res.json({ date, agents: 0, total: 0, recordings: [], note: 'No dialer agent ids mapped for this company.' });

  const ttlMs = await dayCacheTtl(req.query.company_id || req.user.company_id);
  const rows = await listDayRecordings({ date, agentIds: ids, ttlMs });
  // These locations come from the dialer — trust their hosts so the agent's play
  // (client-supplied location=) passes the SSRF allowlist without a re-resolve.
  for (const r of rows) if (r.location) noteDialerRecordingUrl(r.location);
  const cls = await classifyTransferred(rows, req.query.company_id || req.user.company_id, date);

  // Disposition enrichment (bulk + per-lead fill). Skipped with ?dispo=0 so the
  // frontend can paint recordings instantly and fetch dispositions separately
  // via GET /qa/day-dispositions (progressive load — no long blocking spinner).
  const dispoMap = req.query.dispo === '0' ? new Map() : await buildDispoMap(rows);
  const dispoOf = (r) => r.lead_id ? (dispoMap.get(`${r.box_id}|${r.lead_id}`) || null) : null;

  // transferred = a real transfer for this LEAD: CRM lead-match OR dialer XFER dispo.
  const transferredOf = (r) => {
    const c = cls.get(r.box_id + '|' + r.recording_id) || {};
    return c.transferred || isXferDispo(dispoOf(r));
  };

  const search = String(req.query.search || '').replace(/\D/g, '');
  const filtered = search ? rows.filter(r => (r.phone || '').includes(search) || String(r.lead_id || '').includes(search)) : rows;
  // dispo counts (over ALL rows, for the filter dropdown)
  const dispoCounts = {};
  for (const r of rows) { const d = dispoOf(r); if (d) dispoCounts[d] = (dispoCounts[d] || 0) + 1; }
  // transferred count = DISTINCT transferred leads (a transfer has 2 recording
  // legs + redials; count the transfer once, not every recording of it).
  const transferredLeads = new Set();
  for (const r of rows) if (transferredOf(r) && r.lead_id) transferredLeads.add(`${r.box_id}|${r.lead_id}`);
  res.json({
    date, agents: ids.length, total: rows.length, shown: filtered.length,
    transferred_count: transferredLeads.size,           // distinct transferred leads (≈ dialer XFER count)
    transferred_recordings: rows.filter(transferredOf).length,   // recordings tagged (legs+redials) — for context
    dispo_counts: dispoCounts,
    recordings: filtered.map(r => {
      const c = cls.get(r.box_id + '|' + r.recording_id) || {};
      return { ...r, agent_name: nameByAgent[String(r.agent_user || '').toUpperCase()] || null, transferred: transferredOf(r), transfer_id: c.transfer_id || null, dispo: dispoOf(r) };
    }),
  });
}));

// FULL dialer disposition set — so EVERY recording shows its real status (not
// just outcomes). Empty statuses cost a fast miss (~0.6s), so a broad superset is
// cheap. Superadmin can trim/add custom codes per company via 'qa.dispo.statuses'.
const DEFAULT_DISPO_STATUSES = [
  // human / outcome
  'SALE', 'XFER', 'TRANSFER', 'XFERA', 'CALLBK', 'CB', 'CBHOLD', 'NI', 'NINTERESTED', 'NOTINT',
  'DNQ', 'DEC', 'DECISION', 'LVM', 'AM', 'MSG', 'WN', 'WRONGNUM', 'LANG', 'QCFAIL', 'QC',
  'NOSALE', 'PITCHED', 'SUCCESS', 'DISPO', 'DNC', 'DNCL', 'DC', 'DISC', 'HANGUP',
  // no-contact / system (INCLUDED now so nothing shows blank)
  'A', 'AA', 'AB', 'AL', 'ADC', 'AFTHRS', 'B', 'DAIR', 'DROP', 'PDROP', 'XDROP',
  'N', 'NA', 'NANQUE', 'PU', 'PM', 'LB', 'TIMEOT', 'MAXCAL', 'NEW', 'NP', 'QUEUE',
  'INCALL', 'RQXFER', 'IVRXFR', 'CXHNGP', 'ERI',
];

// Tag each day-recording as Transferred (→ TRA) or not (→ RCM), FREE: match its
// (box, lead_id) or (phone, ~date) against this company's transfers — no extra
// dialer calls. lead_id+box avoids same-number-different-cluster false hits;
// phone is the strong fallback when a transfer's vendor code is missing/messy.
async function classifyTransferred(rows, companyId, date) {
  const out = new Map();
  if (!rows.length) return out;
  const prefixToBox = Object.fromEntries((getBoxes() || []).map(b => [String(b.prefix || '').toUpperCase(), b.id]));
  const from = new Date(date + 'T00:00:00Z'); from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(date + 'T00:00:00Z'); to.setUTCDate(to.getUTCDate() + 2);
  const { data: transfers } = await supabaseAdmin.from('transfers')
    .select('id, vicidial_vendor_code, normalized_phone, created_at')
    .eq('company_id', companyId)
    .gte('created_at', from.toISOString()).lt('created_at', to.toISOString())
    .limit(20000);
  const byBoxLead = new Map();   // `${boxId}|${leadId}` -> transfer id
  const byPhone = new Map();     // last10 -> transfer id
  for (const t of transfers || []) {
    const m = String(t.vicidial_vendor_code || '').match(/^([A-Za-z]+)(\d+)$/);
    if (m) { const box = prefixToBox[m[1].toUpperCase()]; if (box) byBoxLead.set(`${box}|${m[2]}`, t.id); }
    const ph = String(t.normalized_phone || '').replace(/\D/g, ''); if (ph.length >= 10) byPhone.set(ph.slice(-10), t.id);
  }
  for (const r of rows) {
    const key = r.box_id + '|' + r.recording_id;
    const leadHit = r.lead_id ? byBoxLead.get(`${r.box_id}|${r.lead_id}`) : null;
    const phoneHit = r.phone ? byPhone.get(String(r.phone).replace(/\D/g, '').slice(-10)) : null;
    // `transferred` = LEAD-based only (a real transfer for THIS lead). phone is
    // kept ONLY as a weak transfer_id link for assignment — NOT as the badge, so
    // redials to a once-transferred number don't inflate the transferred count.
    out.set(key, { transferred: !!leadHit, transfer_id: leadHit || phoneHit || null });
  }
  return out;
}
const isXferDispo = (d) => { const s = String(d || '').toUpperCase(); return s === 'XFER' || s === 'TRANSFER' || s === 'XFERA'; };

// ── QA agents in a company (for the manager's assign dropdown) ───────────────
// Two-step (no cross-table embed — user_company_roles has no FK to user_profiles,
// which silently returned an empty list before).
router.get('/agents', asyncHandler(async (req, res) => {
  if (!(await can(req, 'assign_qa_tasks'))) return res.status(403).json({ error: 'Forbidden' });
  const allowed = await allowedCompanyIds(req);
  const scopeAll = req.query.company_id === '__all__';
  let rolesQ = supabaseAdmin.from('user_company_roles')
    .select('user_id, custom_roles(level)').eq('is_active', true);
  if (scopeAll) {
    // every QA agent across the companies this manager may touch (for
    // "All my companies" cross-company assignment).
    if (allowed) { if (!allowed.length) return res.json({ agents: [] }); rolesQ = rolesQ.in('company_id', allowed); }
  } else {
    const companyId = req.query.company_id || req.user.company_id;
    if (allowed && !allowed.includes(companyId)) return res.status(403).json({ error: 'Forbidden' });
    rolesQ = rolesQ.eq('company_id', companyId);
  }
  const { data: roles, error } = await rolesQ;
  if (error) { logger.warn('QA', `agents roles: ${error.message}`); return res.status(500).json({ error: error.message }); }
  // custom_roles may embed as object or array depending on cardinality
  const levelOf = (cr) => Array.isArray(cr) ? cr[0]?.level : cr?.level;
  const qaRows = (roles || []).filter(r => ['qa_agent', 'qa_manager'].includes(levelOf(r.custom_roles)));
  const ids = [...new Set(qaRows.map(r => r.user_id))];
  if (!ids.length) return res.json({ agents: [] });
  const { data: profs } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
  const nameById = Object.fromEntries((profs || []).map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim()]));
  const roleById = Object.fromEntries(qaRows.map(r => [r.user_id, levelOf(r.custom_roles)]));
  // undone (pending + in_review) count per agent IN THIS company — drives the
  // manager's per-agent workload + "clear undone" control.
  const undone = {};
  if (!scopeAll) {
    const companyId = req.query.company_id || req.user.company_id;
    const { data: open } = await supabaseAdmin.from('qa_assignments')
      .select('assigned_to').eq('company_id', companyId).in('status', ['pending', 'in_review']).in('assigned_to', ids);
    for (const r of (open || [])) if (r.assigned_to) undone[r.assigned_to] = (undone[r.assigned_to] || 0) + 1;
  }
  const agents = ids.map(id => ({ id, name: nameById[id] || id, role: roleById[id], undone: undone[id] || 0 }));
  res.json({ agents });
}));

// ── manager assigns raw day-recordings as QA tasks ────────────────────────────
// The ONE distribution path: the QA manager loads a dialer day and hands the
// calls to QA agents. Accepts a WORK TYPE (tra|rcm|closer_sales|closer_dispo)
// and either a single assigned_to OR distribute_equally:true (round-robin the
// calls evenly across all the company's QA agents).
const WT_TO_METHOD = { tra: 'tra', rcm: 'rcm', closer_sales: 'rcm', closer_dispo: 'rcm' };
const WT_TO_ROLE   = { tra: 'fronter', rcm: 'fronter', closer_sales: 'closer', closer_dispo: 'closer' };
router.post('/assignments/from-recordings', asyncHandler(async (req, res) => {
  if (!(await can(req, 'assign_qa_tasks'))) return res.status(403).json({ error: 'Forbidden' });
  const { company_id, assigned_to, date } = req.body || {};
  const distributeEqually = req.body?.distribute_equally === true;
  const recordings = Array.isArray(req.body?.recordings) ? req.body.recordings : [];
  // work_type is the new first-class selector; fall back to legacy `method`.
  const work_type = WORK_TYPES.includes(req.body?.work_type) ? req.body.work_type
    : (['tra', 'rcm'].includes(req.body?.method) ? req.body.method : null);
  if (!work_type || !recordings.length) return res.status(400).json({ error: 'work_type (tra|rcm|closer_sales|closer_dispo) and recordings[] are required' });
  const method = WT_TO_METHOD[work_type];
  const subject_role = WT_TO_ROLE[work_type];
  const wantAll = company_id === '__all__';
  const companyId = wantAll ? null : (company_id || req.user.company_id);
  const allowed = await allowedCompanyIds(req);
  if (!wantAll && allowed && !allowed.includes(companyId)) return res.status(403).json({ error: 'Forbidden' });

  // resolve the target agent(s): equal split across the company's QA agents, or
  // a single agent. (No method-binding gate — Load-Day distribution is the
  // manager's explicit choice.)
  let targetAgents = [];
  if (distributeEqually) {
    if (wantAll) return res.status(400).json({ error: 'Pick one company to distribute equally.' });
    const { data: ucr } = await supabaseAdmin.from('user_company_roles')
      .select('user_id, custom_roles(level)').eq('company_id', companyId).eq('is_active', true);
    targetAgents = [...new Set((ucr || []).filter(r => (Array.isArray(r.custom_roles) ? r.custom_roles[0]?.level : r.custom_roles?.level) === 'qa_agent').map(r => r.user_id))];
    if (!targetAgents.length) return res.status(400).json({ error: 'No QA agents in this company to distribute to. Add a QA Agent first.' });
  } else if (assigned_to) {
    targetAgents = [assigned_to];
  }

  // Cross-company ("All my companies"): route each recording to the company its
  // dialer agent belongs to. Recordings whose agent maps to no allowed company
  // are skipped (reported), never mis-filed.
  let companyByAgent = {};
  if (wantAll) companyByAgent = await companiesForAgentIds(recordings.map(r => r.agent_user), allowed);
  const rowCompany = (r) => wantAll ? (companyByAgent[String(r.agent_user || '').toUpperCase()] || null) : companyId;

  const now = new Date().toISOString();
  const cleanPart = (p) => ({ box_id: p.box_id, recording_id: String(p.recording_id), lead_id: p.lead_id || null, location: p.location || null, start_time: p.start_time || null, duration: p.duration ?? null, agent_user: p.agent_user || null });
  let skippedNoCompany = 0;
  let rr = 0;   // round-robin cursor for equal distribution
  const rows = recordings.filter(r => r && r.box_id && r.recording_id).map(r => ({
    company_id: rowCompany(r), method, subject_role, work_type, source: 'day_recording',
    transfer_id: r.transfer_id || null,
    // recording_ref = the primary clip + its sibling legs/redials (grouped by
    // number+agent) as `parts`, so the reviewer can hear every attempt like the
    // client portal multi-recording expand.
    recording_ref: {
      box_id: r.box_id, recording_id: String(r.recording_id), lead_id: r.lead_id || null,
      location: r.location || null, agent_user: r.agent_user || null, agent_name: r.agent_name || null, start_time: r.start_time || null,
      duration: r.duration ?? null, phone: r.phone || null,
      parts: Array.isArray(r.parts) && r.parts.length > 1 ? r.parts.filter(p => p && p.box_id && p.recording_id).map(cleanPart) : undefined,
    },
    recording_date: date || (r.start_time ? String(r.start_time).slice(0, 10) : null),
    subject_agent: r.agent_user || null,        // the reviewed agent's dialer id/login (name in recording_ref.agent_name)
    // even split across QA agents (round-robin), or the single chosen agent, or pool
    assigned_to: targetAgents.length ? targetAgents[rr++ % targetAgents.length] : null,
    assigned_by: req.user.id, assigned_at: now,
    sampled: method === 'rcm', status: 'pending',
  })).filter(row => {
    if (!row.company_id) { skippedNoCompany++; return false; }   // unresolved company (All mode) → skip, don't misfile
    return true;
  });
  if (!rows.length) return res.status(wantAll ? 200 : 400).json({ ok: true, inserted: 0, skipped: 0, skipped_no_company: skippedNoCompany, error: skippedNoCompany ? 'None of these recordings map to a company you manage (their dialer agents aren\'t mapped). Assign from a specific company instead.' : 'No valid recordings' });

  // ENRICH each row with customer identity — CRM (transfer/sale) first, VICIdial
  // lead_field_info fallback. Bounded so a huge batch stays fast: inline-enrich up
  // to ENRICH_CAP rows (parallel, chunked); the rest render fine via the queue's
  // live form_data hydration and can be persisted later via POST /qa/enrich-existing.
  const ENRICH_CAP = 400;
  const dialerBudget = { n: 60 };
  const enrichOne = async (row) => {
    const rec = row.recording_ref || {};
    Object.assign(row, await resolveCustomer({
      companyId: row.company_id, transferId: row.transfer_id, saleId: row.sale_id || null,
      phone: rec.phone, boxId: rec.box_id, leadId: rec.lead_id, dialerBudget,
    }));
  };
  const toEnrich = rows.slice(0, ENRICH_CAP);
  for (let i = 0; i < toEnrich.length; i += 25) {
    await Promise.all(toEnrich.slice(i, i + 25).map(enrichOne));   // 25-wide, bounded
  }

  // insert; unique (method, box, recording_id) drops any already-assigned ones
  const { data, error } = await supabaseAdmin.from('qa_assignments').insert(rows, { count: 'exact' }).select('id');
  if (error && !/duplicate key|unique/i.test(error.message)) return res.status(500).json({ error: error.message });
  // on partial conflict PostgREST errors the whole batch — retry row-by-row so the
  // non-duplicates still land.
  let inserted = data ? data.length : 0, skipped = 0;
  if (error) {
    inserted = 0;
    for (const row of rows) {
      const { error: e1 } = await supabaseAdmin.from('qa_assignments').insert(row);
      if (e1) skipped++; else inserted++;
    }
  }
  // notify every agent who received work (single or the whole equal-split set)
  if (targetAgents.length && inserted) {
    notifyUsers(targetAgents, {
      companyId: companyId || rows[0]?.company_id, type: 'qa_assignment',
      title: `New ${work_type.toUpperCase().replace('CLOSER_', '')} QA calls assigned`,
      message: 'A QA manager assigned recordings for you to review.',
      data: { work_type, count: inserted },
    }).catch(() => {});
  }
  res.json({ ok: true, inserted, skipped, skipped_no_company: skippedNoCompany, agents: targetAgents.length, distributed: distributeEqually });
}));

// ── CRM-day fetch: the three sections that already live in the CRM ────────────
// TRA (fronter transfer leg), Closed Sale (closer leg), Unclosed Sale (closer
// leg of a transfer that never became a sale). RCM is dialer-only — handled by
// the day-recording browser above. This path is CRM-first: the CRM is the
// authoritative list of the day's calls, and recordings attach to each row (they
// resolve at play time via the candidates endpoint, which already handles the
// cross-box fronter/closer split). Nothing here touches the dialer-driven flow.
//
// A "sale happened" = a linked sale in one of these statuses (a sale CALL took
// place; cancelled = sold then cancelled — still worth reviewing).
const SOLD_SALE_STATUSES = ['closed_won', 'pending_review', 'cancelled'];

function dayBounds(date) {
  const d = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const start = new Date(d + 'T00:00:00.000Z');
  const end = new Date(start.getTime() + 86400000);
  return { start: start.toISOString(), end: end.toISOString(), day: d };
}
const isPastDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < new Date().toISOString().slice(0, 10);

// Build the day's three CRM sections for a company. Rows are shaped for both the
// preview and the assign path (transfer_id/sale_id + subject_role + hints).
async function buildCrmDay(companyId, date) {
  const b = dayBounds(date);
  if (!b) return null;
  const { data: transfers } = await supabaseAdmin.from('transfers')
    .select('id, vicidial_vendor_code, vicidial_agent, normalized_phone, created_at, created_by, assigned_closer_id')
    .eq('company_id', companyId).gte('created_at', b.start).lt('created_at', b.end);
  const tids = (transfers || []).map(t => t.id);
  // Which of the day's transfers already produced a real sale (any sold status).
  // Used only to split TRA into "not yet closed" (Unclosed) — NOT for the Closed
  // section, which is sale-date based below.
  const soldTransferIds = new Set();
  if (tids.length) {
    for (let i = 0; i < tids.length; i += 150) {   // chunk .in() to stay under the URL cap
      const { data } = await supabaseAdmin.from('sales')
        .select('transfer_id').in('transfer_id', tids.slice(i, i + 150)).in('status', SOLD_SALE_STATUSES);
      for (const s of (data || [])) if (s.transfer_id) soldTransferIds.add(s.transfer_id);
    }
  }

  // Closed Sales = sales that CLOSED on the selected day (by sale_date), for THIS
  // company's leads (scoped via the transfer link). This is the "actual sales
  // that day" number — a lead transferred earlier can close today, and a lead
  // transferred today usually closes a day or two later — so this is NOT a subset
  // of TRA and is counted by sale date, matching the CRM's daily sales.
  const { data: closedToday } = await supabaseAdmin.from('sales')
    .select('id, transfer_id, customer_phone, normalized_phone, sale_date, closer_id, status, vicidial_vendor_code, transfers!inner(company_id)')
    .eq('transfers.company_id', companyId).eq('sale_date', b.day).in('status', SOLD_SALE_STATUSES);

  const tra = (transfers || []).map(t => ({ transfer_id: t.id, subject_role: 'fronter', phone: t.normalized_phone, agent: t.vicidial_agent || null, date: b.day, has_code: !!t.vicidial_vendor_code }));
  const closer_sales = (closedToday || []).map(s => ({ sale_id: s.id, transfer_id: s.transfer_id, subject_role: 'closer', phone: s.customer_phone || s.normalized_phone, closer_id: s.closer_id || null, date: b.day, has_code: !!s.vicidial_vendor_code, status: s.status }));
  const closer_dispo = (transfers || []).filter(t => !soldTransferIds.has(t.id))
    .map(t => ({ transfer_id: t.id, subject_role: 'closer', phone: t.normalized_phone, closer_id: t.assigned_closer_id || null, date: b.day, has_code: false }));
  return { day: b.day, tra, closer_sales, closer_dispo };
}

// vicidial agent ids for a set of CRM user ids (the closers' dialer logins).
async function agentIdsForUsers(userIds) {
  const uids = [...new Set((userIds || []).filter(Boolean))];
  if (!uids.length) return { byUser: {}, all: [] };
  const { data: profs } = await supabaseAdmin.from('user_profiles').select('user_id, vicidial_agent_ids').in('user_id', uids);
  const byUser = {}; const all = new Set();
  for (const p of (profs || [])) { const ids = (p.vicidial_agent_ids || []).filter(Boolean).map(a => String(a).toUpperCase()); byUser[p.user_id] = ids; ids.forEach(a => all.add(a)); }
  return { byUser, all: [...all] };
}

// Best-effort lead-id backfill from the fetched dialer day. Matches each CRM row
// missing a lead code by phone; on ambiguity (a phone dialed more than once that
// day) it REQUIRES an agent match (agent+phone) and otherwise SKIPS — never
// writes a possibly-wrong lead id. Writes only-when-empty and logs every write.
//   • tra          → transfers.vicidial_vendor_code (fronter leg), company agents
//   • closer_sales → sales.vicidial_vendor_code (closer leg), the closers' agents
//   • closer_dispo → NOT written (the transfer's code is the fronter leg; the
//                    unclosed closer leg has no CRM home — it resolves live)
async function backfillLeadIds({ companyId, date, items, work_type, closerAgentsByUser, userId }) {
  if (work_type === 'closer_dispo') return 0;
  const table = work_type === 'closer_sales' ? 'sales' : 'transfers';
  const leg = work_type === 'tra' ? 'fronter' : 'closer';
  const need = items.filter(it => !it.has_code && it.phone && (work_type === 'closer_sales' ? it.sale_id : it.transfer_id));
  if (!need.length) return 0;

  // dialer agent ids to fetch the day for
  let agentIds = [];
  if (leg === 'fronter') agentIds = (await agentIdsForCompany(companyId)).ids;
  else agentIds = [...new Set(need.flatMap(it => closerAgentsByUser?.[it.closer_id] || []))];
  if (!agentIds.length) return 0;

  const dayRows = await listDayRecordings({ date, agentIds });
  if (!dayRows.length) return 0;
  const prefixByBox = Object.fromEntries(getBoxes().map(x => [x.id, x.prefix]));
  const byPhone = new Map();
  for (const r of dayRows) { const t = phoneTail(r.phone); if (!t || !r.lead_id) continue; if (!byPhone.has(t)) byPhone.set(t, []); byPhone.get(t).push(r); }

  let n = 0;
  for (const it of need) {
    const tail = phoneTail(it.phone); if (!tail) continue;
    const pool = byPhone.get(tail) || [];
    if (!pool.length) continue;
    let cands = pool, matchedBy = 'phone_date';
    if (pool.length > 1) {
      // ambiguous → disambiguate by agent (agent+phone). tra uses the transfer's
      // fronter agent; closer legs use the closer's own dialer ids.
      const agentSet = new Set((leg === 'fronter'
        ? [it.agent]
        : (closerAgentsByUser?.[it.closer_id] || [])).filter(Boolean).map(a => String(a).toUpperCase()));
      if (!agentSet.size) continue;
      cands = pool.filter(c => agentSet.has(String(c.agent_user || '').toUpperCase()));
      matchedBy = 'agent_phone_date';
      if (cands.length !== 1) continue;   // still ambiguous / none → leave for manual
    }
    const hit = cands[0];
    const prefix = prefixByBox[hit.box_id]; if (!prefix || !hit.lead_id) continue;
    const vendor = `${prefix}${hit.lead_id}`;
    const recId = work_type === 'closer_sales' ? it.sale_id : it.transfer_id;
    // only-when-empty guard at the DB (never overwrite an existing code)
    const { data: wrote } = await supabaseAdmin.from(table)
      .update({ vicidial_vendor_code: vendor, vicidial_agent: hit.agent_user || null })
      .eq('id', recId).is('vicidial_vendor_code', null).select('id');
    if (wrote && wrote.length) {
      n++; it.has_code = true;
      await supabaseAdmin.from('qa_lead_backfill_log').insert({
        record_type: table === 'sales' ? 'sale' : 'transfer', record_id: recId, company_id: companyId,
        leg, box_id: hit.box_id, lead_id: String(hit.lead_id), vendor_code: vendor,
        agent: hit.agent_user || null, phone: it.phone, matched_by: matchedBy, created_by: userId,
      }).catch(() => {});
    }
  }
  return n;
}

// GET /qa/crm-day?company_id=&date=YYYY-MM-DD — preview the day's 3 CRM sections
// with counts + how many are already assigned, so the manager can distribute.
router.get('/crm-day', asyncHandler(async (req, res) => {
  if (!(await isManager(req))) return res.status(403).json({ error: 'Forbidden' });
  const companyId = req.query.company_id || req.user.company_id;
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(companyId)) return res.status(403).json({ error: 'Forbidden' });
  const date = String(req.query.date || '').slice(0, 10);
  if (!dayBounds(date)) return res.status(400).json({ error: 'date=YYYY-MM-DD required' });
  if (!isPastDate(date)) return res.status(400).json({ error: 'Pick a past date — today’s calls are still in progress.' });

  const s = await buildCrmDay(companyId, date);
  // already-assigned counts for the day (recording_date), per work_type
  const assigned = { tra: 0, closer_sales: 0, closer_dispo: 0 };
  const { data: asg } = await supabaseAdmin.from('qa_assignments')
    .select('work_type').eq('company_id', companyId).eq('recording_date', date)
    .in('work_type', ['tra', 'closer_sales', 'closer_dispo']);
  for (const r of (asg || [])) if (assigned[r.work_type] != null) assigned[r.work_type]++;

  const linkable = (rows) => rows.filter(r => r.has_code).length;
  res.json({
    day: s.day,
    sections: {
      tra:          { total: s.tra.length,          linked: linkable(s.tra),          assigned: assigned.tra },
      closer_sales: { total: s.closer_sales.length, linked: linkable(s.closer_sales), assigned: assigned.closer_sales },
      closer_dispo: { total: s.closer_dispo.length, linked: linkable(s.closer_dispo), assigned: assigned.closer_dispo },
    },
  });
}));

// POST /qa/assignments/from-crm { company_id, date, work_type, distribute_equally|assigned_to, backfill }
// Builds the section server-side (authoritative — never trusts a client list) and
// creates CRM-anchored QA tasks, equal-split across the company's QA agents or to
// one agent. Optionally backfills lead ids from the dialer day first.
router.post('/assignments/from-crm', asyncHandler(async (req, res) => {
  if (!(await can(req, 'assign_qa_tasks'))) return res.status(403).json({ error: 'Forbidden' });
  const work_type = req.body?.work_type;
  if (!['tra', 'closer_sales', 'closer_dispo'].includes(work_type)) {
    return res.status(400).json({ error: 'work_type must be tra | closer_sales | closer_dispo (RCM uses the dialer path)' });
  }
  const companyId = req.body?.company_id || req.user.company_id;
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(companyId)) return res.status(403).json({ error: 'Forbidden' });
  const date = String(req.body?.date || '').slice(0, 10);
  if (!dayBounds(date)) return res.status(400).json({ error: 'date=YYYY-MM-DD required' });
  if (!isPastDate(date)) return res.status(400).json({ error: 'Pick a past date — today’s calls are still in progress.' });
  const distributeEqually = req.body?.distribute_equally === true;
  const doBackfill = req.body?.backfill !== false;   // default on

  const s = await buildCrmDay(companyId, date);
  const items = s[work_type] || [];
  if (!items.length) return res.json({ ok: true, inserted: 0, skipped: 0, backfilled: 0, note: 'No records in this section for that day.' });

  // closer legs need the closers' dialer ids (for backfill + subject_agent)
  let closerAgentsByUser = {};
  if (work_type !== 'tra') {
    const { byUser } = await agentIdsForUsers(items.map(it => it.closer_id));
    closerAgentsByUser = byUser;
  }

  let backfilled = 0;
  if (doBackfill) {
    try { backfilled = await backfillLeadIds({ companyId, date, items, work_type, closerAgentsByUser, userId: req.user.id }); }
    catch (e) { logger.warn('QA', `crm-day backfill: ${e.message}`); }
  }

  // resolve target QA agent(s)
  let targetAgents = [];
  if (distributeEqually) {
    const { data: ucr } = await supabaseAdmin.from('user_company_roles')
      .select('user_id, custom_roles(level)').eq('company_id', companyId).eq('is_active', true);
    targetAgents = [...new Set((ucr || []).filter(r => (Array.isArray(r.custom_roles) ? r.custom_roles[0]?.level : r.custom_roles?.level) === 'qa_agent').map(r => r.user_id))];
    if (!targetAgents.length) return res.status(400).json({ error: 'No QA agents in this company to distribute to. Add a QA Agent first.' });
  } else if (req.body?.assigned_to) {
    targetAgents = [req.body.assigned_to];
  }

  const method = WT_TO_METHOD[work_type];
  const subject_role = WT_TO_ROLE[work_type];
  const now = new Date().toISOString();
  let rr = 0;
  const rows = items.map(it => ({
    company_id: companyId, method, subject_role, work_type, source: 'day_recording',
    // closer_sales anchors on the SALE only: it and closer_dispo both map to
    // method 'rcm', so carrying transfer_id on both would collide on the
    // (transfer_id, method) unique index (a transfer's dispo task and its later
    // closed-sale task would clash). sale_id uses its own (sale_id, method)
    // index, and candidate/customer resolution re-derives the transfer from the
    // sale — so dropping transfer_id here loses nothing.
    transfer_id: work_type === 'closer_sales' ? null : (it.transfer_id || null),
    sale_id: it.sale_id || null,
    recording_date: date,
    subject_agent: work_type === 'tra' ? (it.agent || null) : ((closerAgentsByUser[it.closer_id] || [])[0] || null),
    assigned_to: targetAgents.length ? targetAgents[rr++ % targetAgents.length] : null,
    assigned_by: req.user.id, assigned_at: now,
    sampled: false, status: 'pending',
  }));

  // insert FIRST (fast bulk); unique (transfer_id|sale_id, method) drops
  // already-assigned rows. Customer enrichment (dialer lookups for up to 400
  // rows) used to block the response — that's why "Assign" took very long. It
  // now runs in the BACKGROUND after we reply; the queue shows the tasks
  // instantly and customer names fill in a moment later.
  let inserted = 0, skipped = 0;
  const createdRows = [];   // { id, company_id, transfer_id, sale_id }
  const sel = 'id, company_id, transfer_id, sale_id';
  const { data, error } = await supabaseAdmin.from('qa_assignments').insert(rows).select(sel);
  if (error && !/duplicate key|unique/i.test(error.message)) return res.status(500).json({ error: error.message });
  if (!error) { inserted = (data || []).length; createdRows.push(...(data || [])); }
  else {
    for (const row of rows) {
      const { data: one, error: e1 } = await supabaseAdmin.from('qa_assignments').insert(row).select(sel).single();
      if (e1) {
        skipped++;
        if (!/duplicate key|unique/i.test(e1.message)) logger.warn('QA', `from-crm insert failed (${work_type}, transfer ${row.transfer_id || '-'}, sale ${row.sale_id || '-'}): ${e1.message}`);
      } else { inserted++; if (one) createdRows.push(one); }
    }
  }

  if (targetAgents.length && inserted) {
    notifyUsers(targetAgents, {
      companyId, type: 'qa_assignment',
      title: `New ${work_type.toUpperCase().replace('CLOSER_', '')} QA calls assigned`,
      message: 'A QA manager assigned CRM calls for you to review.',
      data: { work_type, count: inserted },
    }).catch(() => {});
  }
  res.json({ ok: true, inserted, skipped, backfilled, agents: targetAgents.length, distributed: distributeEqually, enriching: createdRows.length > 0 });

  // ── background: enrich customer identity (CRM-first, bounded dialer budget) ──
  if (createdRows.length) {
    (async () => {
      const dialerBudget = { n: 60 };
      const todo = createdRows.slice(0, 400);
      for (let i = 0; i < todo.length; i += 25) {
        await Promise.all(todo.slice(i, i + 25).map(async (r) => {
          try {
            const cust = await resolveCustomer({ companyId: r.company_id, transferId: r.transfer_id, saleId: r.sale_id, dialerBudget });
            if (cust && Object.keys(cust).length) await supabaseAdmin.from('qa_assignments').update(cust).eq('id', r.id);
          } catch { /* per-row enrich failure is non-fatal */ }
        }));
      }
    })().catch(e => logger.warn('QA', `from-crm bg-enrich: ${e.message}`));
  }
}));

// resolve the scorecard for a (company, method): company override → global starter
// Resolve the scorecard for a (company, SLOT). `slot` is the WORK TYPE
// (tra | rcm | closer_sales | closer_dispo) — the qa_scorecards.method column is
// now used as a per-work-type slot, so each of the four sections can carry its
// own scorecard. Legacy rows with method 'tra'/'rcm' serve those two slots as
// before; closer_sales / closer_dispo get their own (created when the manager
// brings each section's sheet). Config-key override → company row → global row.
async function resolveScorecard(companyId, slot) {
  const cfgId = await getConfig(companyId, `qa.scorecard.${slot}`, null);
  if (cfgId) {
    const { data } = await supabaseAdmin.from('qa_scorecards').select('*').eq('id', cfgId).eq('is_active', true).maybeSingle();
    if (data) return data;
  }
  const { data: co } = await supabaseAdmin.from('qa_scorecards').select('*')
    .eq('company_id', companyId).eq('method', slot).eq('is_active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (co) return co;
  const { data: g } = await supabaseAdmin.from('qa_scorecards').select('*')
    .is('company_id', null).eq('method', slot).eq('is_active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return g || null;
}

// ── helpers shared by review submit + edit ────────────────────────────────────
// subject: TRA/fronter → transfer.created_by; closer → sale.closer_id / assigned closer
async function resolveSubjectUser(a) {
  if (a.subject_role === 'fronter' && a.transfer_id) {
    const { data: t } = await supabaseAdmin.from('transfers').select('created_by').eq('id', a.transfer_id).maybeSingle();
    if (t?.created_by) return t.created_by;
  }
  if (a.subject_role === 'closer') {
    if (a.sale_id) { const { data: s } = await supabaseAdmin.from('sales').select('closer_id').eq('id', a.sale_id).maybeSingle(); if (s?.closer_id) return s.closer_id; }
    if (a.transfer_id) { const { data: t } = await supabaseAdmin.from('transfers').select('assigned_closer_id').eq('id', a.transfer_id).maybeSingle(); if (t?.assigned_closer_id) return t.assigned_closer_id; }
  }
  // day-recording task: map the dialer agent id → the CRM user who owns it
  const agent = a.subject_agent || a.recording_ref?.agent_user;
  if (agent) {
    const { data: profs } = await supabaseAdmin.from('user_profiles').select('user_id, vicidial_agent_ids').contains('vicidial_agent_ids', [String(agent).toUpperCase()]);
    if (profs && profs.length) return profs[0].user_id;
    const { data: p2 } = await supabaseAdmin.from('user_profiles').select('user_id, vicidial_agent_ids').contains('vicidial_agent_ids', [String(agent)]);
    if (p2 && p2.length) return p2[0].user_id;
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
  if (cfg.manual_status) add(cfg.manual_status.key, values[cfg.manual_status.key], out.passed == null ? 0 : (out.passed ? 1 : 0));
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
    // manual-verdict cards (fronter RCM) have no numeric score → 100/0 by pass/fail
    total_score: out.final_score ?? out.quality_score ?? (cfg.manual_status && out.passed != null ? (out.passed ? 100 : 0) : 0), max_score: 100,
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
    .select('id, company_id, method, work_type, subject_role, transfer_id, sale_id, subject_agent, recording_ref, assigned_to').eq('id', assignment_id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  const allowed = await allowedCompanyIds(req);
  if (!(await assignmentInScope(a, allowed))) return res.status(403).json({ error: 'Forbidden' });
  // an AGENT scores only their own task; managers score anything in scope
  if (!(await isManager(req)) && a.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'This call is not assigned to you.' });
  }

  // scorecard is resolved per WORK TYPE (tra / rcm / closer_sales / closer_dispo)
  const scorecard = await resolveScorecard(a.company_id, workTypeOf(a));
  if (!scorecard) return res.status(400).json({ error: 'No active scorecard for this section yet. Ask a QA manager to set one up in Scorecards & Config.' });

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
    const label = out.manual_status != null
      ? `QA Overall Status: ${out.manual_status}`
      : out.final_score != null
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

// ── completed-reviews grid (the "Google Sheet" view) ─────────────────────────
// One row per SCORED review with its raw per-field values + computed columns +
// call meta, grouped so the client renders a spreadsheet per method. qa_agent
// sees OWN reviews; a manager (view_qa_reports) sees all + can filter by agent.
router.get('/reviews', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  const managerView = (await isSuperAdmin(req.user.id)) || await hasPermission(req.user.id, req.user.company_id, 'view_qa_reports') || await hasPermission(req.user.id, req.user.company_id, 'view_all_qa_reviews');

  let q = supabaseAdmin.from('qa_reviews').select('*').order('created_at', { ascending: false }).limit(2000);
  const allowed = await allowedCompanyIds(req);
  if (allowed) { if (!allowed.length) return res.json({ reviews: [], scorecards: {} }); q = q.in('company_id', allowed); }
  if (req.query.mine === 'true' || !managerView) q = q.eq('reviewer_id', req.user.id);
  if (req.query.company_id)  q = q.eq('company_id', req.query.company_id);
  if (req.query.method)      q = q.eq('method', req.query.method);
  if (req.query.reviewer_id && managerView) q = q.eq('reviewer_id', req.query.reviewer_id);
  // per-AGENT quality file: every review of one reviewed user (CRM subject)
  if (req.query.subject_user_id) q = q.eq('subject_user_id', req.query.subject_user_id);
  if (req.query.date_from)   q = q.gte('created_at', req.query.date_from);
  if (req.query.date_to)     q = q.lte('created_at', `${req.query.date_to}T23:59:59.999Z`);
  const { data: reviews, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  if (!reviews.length) return res.json({ reviews: [], scorecards: {}, manager_view: managerView });

  const rIds = reviews.map(r => r.id);
  const aIds = [...new Set(reviews.map(r => r.assignment_id).filter(Boolean))];
  const scIds = [...new Set(reviews.map(r => r.scorecard_id).filter(Boolean))];
  const userIds = [...new Set([...reviews.map(r => r.reviewer_id), ...reviews.map(r => r.subject_user_id)].filter(Boolean))];

  const [scoreRes, cardRes, assignRes, profRes] = await Promise.all([
    supabaseAdmin.from('qa_review_scores').select('review_id, criterion_key, raw_value, points').in('review_id', rIds),
    scIds.length ? supabaseAdmin.from('qa_scorecards').select('id, name, method, criteria, pass_threshold').in('id', scIds) : Promise.resolve({ data: [] }),
    aIds.length ? supabaseAdmin.from('qa_assignments').select('id, transfer_id, sale_id, recording_ref, subject_agent, recording_date').in('id', aIds) : Promise.resolve({ data: [] }),
    userIds.length ? supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', userIds) : Promise.resolve({ data: [] }),
  ]);
  const scoresByReview = {};
  for (const s of scoreRes.data || []) { (scoresByReview[s.review_id] = scoresByReview[s.review_id] || {})[s.criterion_key] = s.raw_value; }
  const scorecards = Object.fromEntries((cardRes.data || []).map(c => [c.id, c]));
  const assignById = Object.fromEntries((assignRes.data || []).map(a => [a.id, a]));
  const nameById = Object.fromEntries((profRes.data || []).map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.user_id]));

  // hydrate customer/phone from recording_ref → transfer → sale (batched)
  const tIds = [...new Set(Object.values(assignById).map(a => a.transfer_id).filter(Boolean))];
  const sIds = [...new Set(Object.values(assignById).map(a => a.sale_id).filter(Boolean))];
  const [tRes, sRes] = await Promise.all([
    // transfers have NO customer_name column — derive it from form_data.
    tIds.length ? supabaseAdmin.from('transfers').select('id, normalized_phone, form_data, created_at').in('id', tIds) : Promise.resolve({ data: [] }),
    sIds.length ? supabaseAdmin.from('sales').select('id, customer_name, customer_phone, sale_date').in('id', sIds) : Promise.resolve({ data: [] }),
  ]);
  const tById = Object.fromEntries((tRes.data || []).map(t => [t.id, t]));
  const sById = Object.fromEntries((sRes.data || []).map(s => [s.id, s]));

  // reviewed agents must show as PEOPLE — resolve dialer ids → CRM user names
  const dialerNames = await dialerAgentNameMap(Object.values(assignById)
    .flatMap(a => [a.subject_agent, a.recording_ref?.agent_user]).filter(Boolean));

  const out = reviews.map(r => {
    const a = assignById[r.assignment_id] || {};
    const rec = a.recording_ref || null;
    const t = a.transfer_id ? tById[a.transfer_id] : null;
    const s = a.sale_id ? sById[a.sale_id] : null;
    const dialerId = a.subject_agent || rec?.agent_user || null;
    return {
      id: r.id, assignment_id: r.assignment_id, method: r.method, subject_role: r.subject_role,
      scorecard_id: r.scorecard_id, status: r.status, reviewed_at: r.created_at,
      reviewer_id: r.reviewer_id, reviewer_name: nameById[r.reviewer_id] || null,
      subject_user_id: r.subject_user_id, subject_name: nameById[r.subject_user_id] || null,
      agent: (rec?.agent_name) || dialerNames[String(dialerId || '').toUpperCase()] || (r.subject_user_id ? nameById[r.subject_user_id] : null) || dialerId || null,
      customer_name: (t ? scanName(t.form_data) : null) || s?.customer_name || null,
      customer_phone: rec?.phone || t?.normalized_phone || s?.customer_phone || null,
      call_date: a.recording_date || rec?.start_time || t?.created_at || s?.sale_date || null,
      base_score: r.base_score, autofail_result: r.autofail_result, total_penalty: r.total_penalty,
      final_score: r.final_score, quality_score: r.quality_score, passed: r.passed, call_outcome: r.call_outcome,
      values: scoresByReview[r.id] || {},
      overall_notes: r.overall_notes,
    };
  });
  // dialer-label subject filter (day-recording reviews with no CRM subject link) —
  // the label lives on the assignment, so it can only be matched post-hydration.
  let rows = out;
  if (req.query.agent) {
    const a = String(req.query.agent).trim().toLowerCase();
    rows = out.filter(r => String(r.agent || '').trim().toLowerCase() === a);
  }
  res.json({ reviews: rows, scorecards, manager_view: managerView });
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

// The sheet_v2 scoring engine reads the pass line from criteria.pass_threshold,
// but managers set it via the settable pass_threshold COLUMN. Keep them in
// lockstep on every write so a manager's edit actually changes grading (a
// blank/legacy divergence made the threshold field silently do nothing before).
const normThreshold = (pt) => (pt === null || pt === '' || pt === undefined) ? null : (Number.isFinite(+pt) ? +pt : null);
function syncSheetThreshold(criteria, pt) {
  if (criteria && !Array.isArray(criteria) && typeof criteria === 'object' && criteria.model === 'sheet_v2') {
    return { ...criteria, pass_threshold: pt };
  }
  return criteria;
}

router.post('/scorecards', asyncHandler(async (req, res) => {
  if (!(await can(req, 'manage_qa_config'))) return res.status(403).json({ error: 'Forbidden' });
  const { company_id, method, name, criteria, pass_threshold } = req.body || {};
  // `method` is the work-type slot: tra | rcm | closer_sales | closer_dispo
  if (!WORK_TYPES.includes(method) || !name) return res.status(400).json({ error: 'method (tra|rcm|closer_sales|closer_dispo) and name are required' });
  // criteria may be an ARRAY (legacy weighted) or an OBJECT (sheet_v2). Keep whichever.
  let criteriaVal = (Array.isArray(criteria) || (criteria && typeof criteria === 'object')) ? criteria : [];
  const pt = normThreshold(pass_threshold);
  criteriaVal = syncSheetThreshold(criteriaVal, pt);   // sheet_v2 → mirror the column into criteria
  const row = {
    company_id: company_id || null, method, name: String(name).slice(0, 200),
    criteria: criteriaVal,
    pass_threshold: pt,
    created_by: req.user.id,
  };
  const { data, error } = await supabaseAdmin.from('qa_scorecards').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ scorecard: data });
}));

router.put('/scorecards/:id', asyncHandler(async (req, res) => {
  if (!(await can(req, 'manage_qa_config'))) return res.status(403).json({ error: 'Forbidden' });
  const patch = { updated_at: new Date().toISOString() };
  for (const k of ['name', 'is_active']) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
  const hasPt = req.body?.pass_threshold !== undefined;
  const pt = hasPt ? normThreshold(req.body.pass_threshold) : undefined;
  if (hasPt) patch.pass_threshold = pt;
  if (req.body?.criteria !== undefined) {
    // when the threshold is part of the same save, write it INTO the criteria too
    patch.criteria = hasPt ? syncSheetThreshold(req.body.criteria, pt) : req.body.criteria;
  }
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

// ── reports & analytics — built ONLY from scored qa_reviews (the persisted
// records). Returns summary + rollups + chart series (time, buckets, method,
// pass/fail) + the reviewed-agent & reviewer lists for the selectors. ──────────
router.get('/reports', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_reports'))) return res.status(403).json({ error: 'Forbidden' });
  const EMPTY = { summary: { reviews: 0 }, by_agent: [], by_reviewer: [], time_series: [], buckets: [], method_split: { tra: 0, rcm: 0 }, agents: [], reviewers: [] };
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.length) return res.json(EMPTY);
  // Apply filters, then page through EVERY matching review (1000-row chunks) so
  // the KPIs/rollups reflect the whole dataset — not just the most recent 5000
  // (the old .limit(5000) silently capped every number once volume grew).
  const applyFilters = (q) => {
    if (allowed)              q = q.in('company_id', allowed);
    if (req.query.company_id) q = q.eq('company_id', req.query.company_id);
    if (req.query.method)     q = q.eq('method', req.query.method);
    if (req.query.date_from)  q = q.gte('created_at', req.query.date_from);
    if (req.query.date_to)    q = q.lte('created_at', `${req.query.date_to}T23:59:59.999Z`);
    return q;
  };
  let rows = [];
  for (let from = 0; from < 1_000_000; from += 1000) {
    const { data, error } = await applyFilters(
      supabaseAdmin.from('qa_reviews')
        .select('id, company_id, method, subject_role, subject_user_id, reviewer_id, assignment_id, total_score, max_score, final_score, quality_score, passed, created_at')
        .order('created_at', { ascending: false })
    ).range(from, from + 999);
    if (error) return res.status(500).json({ error: error.message });
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  if (!rows.length) return res.json(EMPTY);

  // reviewed-agent identity from the linked assignment (dialer login + real name)
  const aIds = [...new Set(rows.map(r => r.assignment_id).filter(Boolean))];
  let asgById = {};
  if (aIds.length) {
    const { data: asg } = await supabaseAdmin.from('qa_assignments').select('id, subject_agent, subject_user_id, recording_ref').in('id', aIds);
    asgById = Object.fromEntries((asg || []).map(a => [a.id, a]));
  }
  const agentKey = (r) => { const a = asgById[r.assignment_id] || {}; return String(a.subject_agent || r.subject_user_id || 'unknown'); };
  // names for subjects + reviewers
  const userIds = [...new Set([...rows.map(r => r.subject_user_id), ...rows.map(r => r.reviewer_id), ...Object.values(asgById).map(a => a.subject_user_id)].filter(Boolean))];
  let uname = {};
  if (userIds.length) {
    const { data: up } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', userIds);
    uname = Object.fromEntries((up || []).map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim()]));
  }
  const agentName = (r) => { const a = asgById[r.assignment_id] || {}; return (a.recording_ref && a.recording_ref.agent_name) || uname[a.subject_user_id] || uname[r.subject_user_id] || (agentKey(r) === 'unknown' ? 'Unknown' : agentKey(r)); };

  // full reviewed-agent list for the selector (BEFORE applying the agent filter)
  const agentsMap = {};
  for (const r of rows) { const k = agentKey(r); if (!agentsMap[k]) agentsMap[k] = agentName(r); }
  const agents = Object.entries(agentsMap).map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
  const reviewersMap = {};
  for (const r of rows) if (r.reviewer_id) reviewersMap[r.reviewer_id] = uname[r.reviewer_id] || 'Unknown';
  const reviewers = Object.entries(reviewersMap).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  // apply agent / reviewer filters
  if (req.query.agent)    rows = rows.filter(r => agentKey(r) === String(req.query.agent));
  if (req.query.reviewer) rows = rows.filter(r => r.reviewer_id === req.query.reviewer);

  const pct = r => (r.max_score > 0 ? (r.total_score / r.max_score) * 100 : 0);
  const scoreOf = r => (r.final_score != null ? r.final_score : (r.quality_score != null ? r.quality_score : Math.round(pct(r))));
  const decided = rows.filter(r => r.passed === true || r.passed === false);
  const summary = {
    reviews: rows.length,
    passed: rows.filter(r => r.passed === true).length,
    failed: rows.filter(r => r.passed === false).length,
    pass_rate: decided.length ? Math.round((rows.filter(r => r.passed === true).length / decided.length) * 100) : 0,
    avg_score: rows.length ? Math.round(rows.reduce((s, r) => s + pct(r), 0) / rows.length) : 0,
  };

  const roll = (keyFn, nameFn) => {
    const agg = {};
    for (const r of rows) { const k = keyFn(r); (agg[k] ||= { key: k, name: nameFn(r), reviews: 0, passed: 0, decided: 0, sumPct: 0 }); agg[k].reviews++; agg[k].sumPct += pct(r); if (r.passed === true) agg[k].passed++; if (r.passed === true || r.passed === false) agg[k].decided++; }
    return Object.values(agg).map(a => ({ key: a.key, name: a.name, reviews: a.reviews, passed: a.passed, pass_rate: a.decided ? Math.round(a.passed / a.decided * 100) : null, avg_score: a.reviews ? Math.round(a.sumPct / a.reviews) : 0 })).sort((x, y) => y.reviews - x.reviews);
  };
  const by_agent = roll(agentKey, agentName);
  const by_reviewer = roll(r => r.reviewer_id || 'unknown', r => r.reviewer_id ? (uname[r.reviewer_id] || 'Unknown') : 'Unknown').map(x => ({ reviewer_id: x.key === 'unknown' ? null : x.key, name: x.name, reviews: x.reviews, avg_score: x.avg_score, pass_rate: x.pass_rate }));

  const ts = {};
  for (const r of rows) { const d = String(r.created_at).slice(0, 10); (ts[d] ||= { date: d, reviews: 0, sumPct: 0, passed: 0, decided: 0 }); ts[d].reviews++; ts[d].sumPct += pct(r); if (r.passed === true) ts[d].passed++; if (r.passed === true || r.passed === false) ts[d].decided++; }
  const time_series = Object.values(ts).map(d => ({ date: d.date, reviews: d.reviews, avg_score: Math.round(d.sumPct / d.reviews), pass_rate: d.decided ? Math.round(d.passed / d.decided * 100) : null })).sort((a, b) => a.date.localeCompare(b.date));

  const buckets = [{ label: '0–59', min: 0, max: 59, n: 0 }, { label: '60–79', min: 60, max: 79, n: 0 }, { label: '80–89', min: 80, max: 89, n: 0 }, { label: '90–100', min: 90, max: 100, n: 0 }];
  for (const r of rows) { const s = scoreOf(r); const b = buckets.find(b => s >= b.min && s <= b.max); if (b) b.n++; }
  const method_split = { tra: rows.filter(r => r.method === 'tra').length, rcm: rows.filter(r => r.method === 'rcm').length };

  res.json({ summary, by_agent, by_reviewer, time_series, buckets, method_split, agents, reviewers });
}));

// ── config (per-company qa.* overrides) ───────────────────────────────────────
// ── dashboard ────────────────────────────────────────────────────────────────
// Role-aware landing stats. A QA agent sees their OWN workload + scoring; a
// manager sees a per-agent breakdown for the company. Pending is live (from
// qa_assignments); "done" + pass/fail + scores are from qa_reviews in the window.
const QA_WT = ['tra', 'rcm', 'closer_sales', 'closer_dispo'];
router.get('/dashboard', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  const managerView = (await isSuperAdmin(req.user.id))
    || await hasPermission(req.user.id, req.user.company_id, 'view_qa_reports')
    || await hasPermission(req.user.id, req.user.company_id, 'assign_qa_tasks')
    || await hasPermission(req.user.id, req.user.company_id, 'manage_qa_config');
  const allowed = await allowedCompanyIds(req);          // null = all (superadmin), [] = none
  const companyFilter = req.query.company_id || null;
  const today = new Date().toISOString().slice(0, 10);
  const to = (req.query.to || today).slice(0, 10);
  const from = (req.query.from || new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10)).slice(0, 10);
  const day = req.query.date ? String(req.query.date).slice(0, 10) : null;   // single "day work done"

  const emptyBy = () => Object.fromEntries(QA_WT.map(k => [k, { pending: 0, done: 0, done_day: 0, day_total: 0, day_pending: 0, day_done: 0, pass: 0, fail: 0, score_sum: 0, score_n: 0 }]));
  const applyCo = (qb) => { if (allowed) qb = qb.in('company_id', allowed); if (companyFilter) qb = qb.eq('company_id', companyFilter); return qb; };
  const dayEnd = (d) => `${d}T23:59:59.999Z`;
  if (allowed && !allowed.length) return res.json({ mode: managerView ? 'manager' : 'agent', me: { id: req.user.id }, range: { from, to, day }, by_method: emptyBy(), totals: { total: 0, pending: 0, done: 0, done_day: 0, day_total: 0, day_pending: 0, day_done: 0, pass: 0, fail: 0, avg_score: null }, daily: [], agents: [] });

  // Live pending backlog (non-scored, not date-bound).
  let pq = applyCo(supabaseAdmin.from('qa_assignments').select('assigned_to, work_type, method').in('status', ['pending', 'in_review'])).limit(20000);
  if (!managerView) pq = pq.eq('assigned_to', req.user.id);
  // Reviews across the 14-day window (trend + range done / pass / score).
  let rq = applyCo(supabaseAdmin.from('qa_reviews').select('reviewer_id, method, passed, final_score, quality_score, total_score, created_at'))
    .gte('created_at', from).lte('created_at', dayEnd(to)).limit(20000);
  if (!managerView) rq = rq.eq('reviewer_id', req.user.id);
  // When a specific day is picked: that day's TASKS (assignments created that day)
  // and that day's DONE (reviews that day) — independent of the 14-day window.
  let daq = Promise.resolve({ data: [] }), drq = Promise.resolve({ data: [] });
  if (day) {
    let x = applyCo(supabaseAdmin.from('qa_assignments').select('assigned_to, work_type, method, status')).gte('created_at', day).lte('created_at', dayEnd(day)).limit(20000);
    if (!managerView) x = x.eq('assigned_to', req.user.id); daq = x;
    let y = applyCo(supabaseAdmin.from('qa_reviews').select('reviewer_id, method, passed, final_score, quality_score, total_score')).gte('created_at', day).lte('created_at', dayEnd(day)).limit(20000);
    if (!managerView) y = y.eq('reviewer_id', req.user.id); drq = y;
  }
  const [{ data: pendings = [] }, { data: reviews = [] }, { data: dayAssigns = [] }, { data: dayReviews = [] }] = await Promise.all([pq, rq, daq, drq]);

  const scoreOf = (r) => { const s = r.final_score ?? r.quality_score ?? r.total_score; return Number.isFinite(+s) ? +s : null; };
  const wtOf = (r) => { const w = (r.work_type || r.method || '').toLowerCase(); return QA_WT.includes(w) ? w : null; };

  // per-user accumulator
  const perUser = new Map();
  const u = (id) => { if (!perUser.has(id)) perUser.set(id, { user_id: id, by_method: emptyBy() }); return perUser.get(id); };
  for (const a of pendings) { const w = wtOf(a); if (w) u(a.assigned_to).by_method[w].pending++; }
  const dailyMap = {};   // date → review count (trend)
  for (const r of reviews) {
    const w = wtOf(r); if (!w) continue; const m = u(r.reviewer_id).by_method[w];
    m.done++; if (r.passed === true) m.pass++; else if (r.passed === false) m.fail++;
    const s = scoreOf(r); if (s != null) { m.score_sum += s; m.score_n++; }
    dailyMap[String(r.created_at).slice(0, 10)] = (dailyMap[String(r.created_at).slice(0, 10)] || 0) + 1;
  }
  for (const a of dayAssigns) { const w = wtOf(a); if (!w) continue; const m = u(a.assigned_to).by_method[w]; m.day_total++; if (a.status === 'scored') m.day_done++; else m.day_pending++; }
  for (const r of dayReviews) { const w = wtOf(r); if (w) u(r.reviewer_id).by_method[w].done_day++; }

  // names + bound methods
  const ids = [...perUser.keys()].filter(Boolean);
  const [{ data: profs = [] }, { data: bind = [] }] = await Promise.all([
    ids.length ? supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids) : Promise.resolve({ data: [] }),
    ids.length ? supabaseAdmin.from('qa_agent_methods').select('user_id, method').in('user_id', ids) : Promise.resolve({ data: [] }),
  ]);
  const nameById = Object.fromEntries(profs.map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Agent']));
  // Dedupe: an agent bound to the same method in >1 company would otherwise
  // produce duplicate method pills on the dashboard card.
  const methodSets = {}; for (const b of bind) (methodSets[b.user_id] = methodSets[b.user_id] || new Set()).add(b.method);
  const methodsById = Object.fromEntries(Object.entries(methodSets).map(([k, s]) => [k, [...s]]));

  const rollup = (byMethod) => {
    const t = { pending: 0, done: 0, done_day: 0, day_total: 0, day_pending: 0, day_done: 0, pass: 0, fail: 0, score_sum: 0, score_n: 0 };
    for (const w of QA_WT) { const m = byMethod[w]; for (const k of Object.keys(t)) t[k] += m[k]; }
    return { total: t.pending + t.done, pending: t.pending, done: t.done, done_day: t.done_day, day_total: t.day_total, day_pending: t.day_pending, day_done: t.day_done, pass: t.pass, fail: t.fail, avg_score: t.score_n ? Math.round((t.score_sum / t.score_n) * 10) / 10 : null };
  };
  const cleanBy = (byMethod) => Object.fromEntries(QA_WT.map(w => { const m = byMethod[w]; return [w, { pending: m.pending, done: m.done, done_day: m.done_day, day_total: m.day_total, day_pending: m.day_pending, day_done: m.day_done, pass: m.pass, fail: m.fail, total: m.pending + m.done, avg_score: m.score_n ? Math.round((m.score_sum / m.score_n) * 10) / 10 : null }]; }));

  // aggregate (whole scope)
  const agg = emptyBy();
  for (const rec of perUser.values()) for (const w of QA_WT) { const s = rec.by_method[w], d = agg[w]; for (const k of Object.keys(d)) d[k] += s[k]; }

  // last-14-day trend
  const daily = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); daily.push({ date: d, done: dailyMap[d] || 0 }); }

  const body = {
    mode: managerView ? 'manager' : 'agent',
    me: { id: req.user.id, name: nameById[req.user.id] || null, methods: methodsById[req.user.id] || [] },
    range: { from, to, day },
    totals: rollup(agg),
    by_method: cleanBy(agg),
    daily,
  };
  if (managerView) {
    body.agents = [...perUser.values()]
      .map(rec => ({ user_id: rec.user_id, name: nameById[rec.user_id] || 'Agent', methods: methodsById[rec.user_id] || [], by_method: cleanBy(rec.by_method), ...rollup(rec.by_method) }))
      .filter(a => a.total > 0 || a.day_total > 0 || a.done_day > 0)
      .sort((a, b) => (day ? (b.day_total - a.day_total) : (b.total - a.total)) || b.total - a.total);
  }
  res.json(body);
}));

const QA_KEYS = ['qa.methods', 'qa.rcm.covers', 'qa.rcm.sample', 'qa.tra.population', 'qa.scorecard.tra', 'qa.scorecard.rcm', 'qa.scorecard.closer_sales', 'qa.scorecard.closer_dispo', 'qa.card_fields', 'qa.retention_days', 'qa.transcription', 'qa.reviewer_cap', 'qa.day_cache_days', 'qa.manager_can_clear'];
router.get('/config', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  const companyId = req.query.company_id || req.user.company_id;
  const out = {};
  for (const k of QA_KEYS) out[k] = await getConfig(companyId, k, null);
  res.json({ company_id: companyId, config: out, can_transcribe: await transcribeAllowed(req.user.id) });
}));

// ── per-user transcription access (superadmin / compliance manages) ───────────
// GET → every CRM user + whether transcription is enabled for them (default OFF).
router.get('/transcription-access', asyncHandler(async (req, res) => {
  if (!(await isSuperAdmin(req.user.id)) && !(await can(req, 'manage_qa_config'))) return res.status(403).json({ error: 'Forbidden' });
  const list = await getConfig(null, TRANSCRIBE_USERS_KEY, []);
  const on = new Set(Array.isArray(list) ? list : []);
  const { data: profs } = await supabaseAdmin.from('user_profiles')
    .select('user_id, first_name, last_name').order('first_name', { ascending: true });
  const users = (profs || [])
    .filter(p => p.user_id)
    .map(p => ({ user_id: p.user_id, name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.user_id.slice(0, 8), enabled: on.has(p.user_id) }));
  res.json({ users });
}));

// PUT { user_id, enabled } → add/remove the user from the transcription allowlist.
router.put('/transcription-access', asyncHandler(async (req, res) => {
  if (!(await isSuperAdmin(req.user.id)) && !(await can(req, 'manage_qa_config'))) return res.status(403).json({ error: 'Forbidden' });
  const { user_id, enabled } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const list = await getConfig(null, TRANSCRIBE_USERS_KEY, []);
  const set = new Set(Array.isArray(list) ? list : []);
  if (enabled) set.add(user_id); else set.delete(user_id);
  await setConfig('global', TRANSCRIBE_USERS_KEY, [...set], req.user.id);
  res.json({ ok: true, user_id, enabled: !!enabled });
}));
router.put('/config', asyncHandler(async (req, res) => {
  if (!(await can(req, 'manage_qa_config'))) return res.status(403).json({ error: 'Forbidden' });
  const { company_id, key, value } = req.body || {};
  if (!company_id || !QA_KEYS.includes(key)) return res.status(400).json({ error: 'company_id and a valid qa.* key are required' });
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(company_id)) return res.status(403).json({ error: 'Forbidden' });
  await setConfig(`company:${company_id}`, key, value, req.user.id);

  // Turning a method ON fills the queue — but materialize pulls calls from the
  // dialer (seconds). Do it in the BACKGROUND so the toggle returns instantly;
  // the queue fills a moment later (or on the next hourly job / "Pull calls now").
  let materializing = false;
  if (key === 'qa.methods' && Array.isArray(value) && value.length) {
    materializing = true;
    materializeCompany(company_id, value).catch(e => logger.warn('QA', `auto-materialize (bg): ${e.message}`));
  }
  res.json({ ok: true, key, value, materializing });
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

// ── clear UNDONE work off QA agents ───────────────────────────────────────────
// Deletes the still-pending / in-review (unscored) tasks for a company — or one
// agent — so a manager can wipe leftover work. DONE (scored) reviews are NEVER
// touched: they stay in Completed. Gated on assign_qa_tasks AND the compliance
// toggle qa.manager_can_clear (superadmin always allowed).
router.post('/clear-undone', asyncHandler(async (req, res) => {
  if (!(await can(req, 'assign_qa_tasks'))) return res.status(403).json({ error: 'Forbidden' });
  const companyId = req.body?.company_id || req.user.company_id;
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(companyId)) return res.status(403).json({ error: 'Forbidden' });
  // compliance must have granted the clear right (superadmin bypasses)
  if (!(await isSuperAdmin(req.user.id))) {
    const can_clear = await getConfig(companyId, 'qa.manager_can_clear', false);
    if (!can_clear) return res.status(403).json({ error: 'Clearing tasks is turned off for QA managers here. Compliance can enable it in the company settings.', code: 'CLEAR_DISABLED' });
  }
  let q = supabaseAdmin.from('qa_assignments').delete()
    .eq('company_id', companyId).in('status', ['pending', 'in_review']);
  if (req.body?.agent_id) q = q.eq('assigned_to', req.body.agent_id);
  // optional: clear only ONE section (tra / rcm / closer_sales / closer_dispo).
  // Match on work_type OR (legacy rows with NULL work_type) the derived method,
  // so pre-work_type tasks still clear under tra/rcm.
  if (WORK_TYPES.includes(req.body?.work_type)) {
    const wt = req.body.work_type;
    q = (wt === 'tra' || wt === 'rcm')
      ? q.or(`work_type.eq.${wt},and(work_type.is.null,method.eq.${wt})`)
      : q.eq('work_type', wt);
  }
  const { data, error } = await q.select('id');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, cleared: (data || []).length });
}));

// ── per-agent method binding (mig 180) ───────────────────────────────────────
// GET /qa/agent-methods?company_id= — the company's QA agents + their bound
// methods, for the manager's Agents panel.
router.get('/agent-methods', asyncHandler(async (req, res) => {
  if (!(await isManager(req))) return res.status(403).json({ error: 'Forbidden' });
  const companyId = req.query.company_id || req.user.company_id;
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(companyId)) return res.status(403).json({ error: 'Forbidden' });

  const { data: roles } = await supabaseAdmin.from('user_company_roles')
    .select('user_id, custom_roles(level)').eq('company_id', companyId).eq('is_active', true);
  const levelOf = (cr) => Array.isArray(cr) ? cr[0]?.level : cr?.level;
  const agentIds = [...new Set((roles || []).filter(r => levelOf(r.custom_roles) === 'qa_agent').map(r => r.user_id))];
  if (!agentIds.length) return res.json({ agents: [] });

  const [{ data: profs }, { data: binds }] = await Promise.all([
    supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', agentIds),
    supabaseAdmin.from('qa_agent_methods').select('user_id, method').eq('company_id', companyId).in('user_id', agentIds),
  ]);
  const nameById = Object.fromEntries((profs || []).map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim()]));
  const methodsById = {};
  for (const b of (binds || [])) (methodsById[b.user_id] ||= []).push(b.method);
  res.json({ agents: agentIds.map(id => ({ id, name: nameById[id] || id, methods: methodsById[id] || [] })) });
}));

// PUT /qa/agent-methods { user_id, company_id, methods:['tra'|'rcm'] } — replace
// an agent's bound methods (flexible: 0, 1, or 2).
router.put('/agent-methods', asyncHandler(async (req, res) => {
  if (!(await isManager(req))) return res.status(403).json({ error: 'Forbidden' });
  const { user_id, company_id } = req.body || {};
  const companyId = company_id || req.user.company_id;
  const methods = Array.isArray(req.body?.methods) ? [...new Set(req.body.methods.filter(m => WORK_TYPES.includes(m)))] : [];
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(companyId)) return res.status(403).json({ error: 'Forbidden' });

  await supabaseAdmin.from('qa_agent_methods').delete().eq('company_id', companyId).eq('user_id', user_id);
  if (methods.length) {
    const rows = methods.map(m => ({ company_id: companyId, user_id, method: m, created_by: req.user.id }));
    const { error } = await supabaseAdmin.from('qa_agent_methods').insert(rows);
    if (error) return res.status(500).json({ error: error.message });
  }
  res.json({ ok: true, user_id, company_id: companyId, methods });
}));

// GET /qa/assignments/:id/crm-fields — the CRM form fields the fronter/closer
// already entered for THIS call (transfer/sale form_data + a few typed cols), so
// the scorecard can auto-fill any field whose name matches. Authentic source.
router.get('/assignments/:id/crm-fields', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  const { data: a } = await supabaseAdmin.from('qa_assignments')
    .select('id, company_id, transfer_id, sale_id').eq('id', req.params.id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Not found' });
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(a.company_id)) return res.status(403).json({ error: 'Forbidden' });
  let fields = {}, extra = {};
  if (a.sale_id) {
    const { data: s } = await supabaseAdmin.from('sales')
      .select('form_data, customer_name, customer_phone, customer_address, plan, client_name, sale_date, reference_no').eq('id', a.sale_id).maybeSingle();
    if (s) { fields = s.form_data && typeof s.form_data === 'object' ? s.form_data : {}; extra = { customer_name: s.customer_name, customer_phone: s.customer_phone, customer_address: s.customer_address, plan: s.plan, client_name: s.client_name, date: s.sale_date, reference_no: s.reference_no }; }
  } else if (a.transfer_id) {
    const { data: t } = await supabaseAdmin.from('transfers')
      .select('form_data, normalized_phone, created_at, latest_disposition, vicidial_vendor_code').eq('id', a.transfer_id).maybeSingle();
    if (t) { fields = t.form_data && typeof t.form_data === 'object' ? t.form_data : {}; extra = { customer_phone: t.normalized_phone, date: t.created_at, disposition: t.latest_disposition, vendor_code: t.vicidial_vendor_code }; }
  }
  res.json({ fields, extra });
}));

// GET /qa/my-methods — the calling agent's own bound methods (drives their UI).
router.get('/my-methods', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  res.json({ methods: await agentMethods(req.user.id), is_manager: await isManager(req) });
}));

// GET /qa/my-companies — the companies THIS QA user may see. Drives the header
// company selector and scopes every data pull. Superadmin / view_all_qa_reviews
// get every company (all:true); everyone else only the companies they're
// assigned to (allowedCompanyIds). Same source of truth the data endpoints
// enforce, so the dropdown can never offer a company the API would reject.
router.get('/my-companies', asyncHandler(async (req, res) => {
  if (!(await can(req, 'view_qa_queue'))) return res.status(403).json({ error: 'Forbidden' });
  const allowed = await allowedCompanyIds(req);   // null = all companies
  let q = supabaseAdmin.from('companies').select('id, name, company_type').order('name');
  if (allowed) { if (!allowed.length) return res.json({ companies: [], all: false }); q = q.in('id', allowed); }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  // annotate each with QA-on (has methods) + how many calls still await review, so
  // the picker can default to a live company and badge where work is waiting.
  const out = [];
  for (const c of (data || [])) {
    const methods = await getConfig(c.id, 'qa.methods', []);
    const { count } = await supabaseAdmin.from('qa_assignments')
      .select('*', { count: 'exact', head: true }).eq('company_id', c.id).eq('status', 'pending');
    out.push({ id: c.id, name: c.name, company_type: c.company_type, qa_enabled: Array.isArray(methods) && methods.length > 0, pending: count || 0 });
  }
  res.json({ companies: out, all: allowed === null });
}));

// POST /qa/enrich-existing { company_id } — backfill customer fields on pending
// assignments that still have none (CRM-first, dialer fallback). Manager-only.
router.post('/enrich-existing', asyncHandler(async (req, res) => {
  if (!(await isManager(req))) return res.status(403).json({ error: 'Forbidden' });
  const companyId = req.body?.company_id || req.user.company_id;
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(companyId)) return res.status(403).json({ error: 'Forbidden' });

  const { data: rows } = await supabaseAdmin.from('qa_assignments')
    .select('id, transfer_id, sale_id, recording_ref')
    .eq('company_id', companyId).is('customer_name', null).limit(300);
  const dialerBudget = { n: 80 };
  let filled = 0;
  for (const r of (rows || [])) {
    const rec = r.recording_ref || {};
    const c = await resolveCustomer({ companyId, transferId: r.transfer_id, saleId: r.sale_id, phone: rec.phone, boxId: rec.box_id, leadId: rec.lead_id, dialerBudget });
    if (c.customer_name || c.customer_phone || c.customer_zip) {
      await supabaseAdmin.from('qa_assignments').update(c).eq('id', r.id);
      filled++;
    }
  }
  res.json({ ok: true, scanned: (rows || []).length, filled });
}));

// ── QA DEPARTMENT ADMIN — compliance owns QA (mig 181) ───────────────────────
// Gated on manage_qa_department (compliance) or superadmin. QA-SCOPED: only ever
// touches qa_manager / qa_agent roles + qa.* config — never other roles. Uses the
// GLOBAL qa roles (company_id NULL) so one manager/agent covers many companies.
async function canAdminQa(req) {
  if (await isSuperAdmin(req.user.id)) return true;
  return hasPermission(req.user.id, req.user.company_id, 'manage_qa_department');
}
async function globalQaRoleId(level) {
  const { data } = await supabaseAdmin.from('custom_roles').select('id').is('company_id', null).eq('level', level).limit(1).maybeSingle();
  return data?.id || null;
}
const profName = (p) => `${p?.first_name || ''} ${p?.last_name || ''}`.trim();
const lvlOf = (cr) => Array.isArray(cr) ? cr[0]?.level : cr?.level;

// companies + their QA enablement (methods), who COVERS each company's calls
// (qa_agent_methods), and how many tasks are still sitting unassigned — so
// compliance can see routing gaps at a glance and distribute in one click.
router.get('/admin/overview', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const { data: companies } = await supabaseAdmin.from('companies').select('id, name, company_type').order('name');

  // how many QA AGENTS are assigned to each company (for the card note)
  const { data: ucr } = await supabaseAdmin.from('user_company_roles')
    .select('company_id, custom_roles(level)').eq('is_active', true);
  const agentsByCo = {};
  for (const r of (ucr || [])) {
    if ((Array.isArray(r.custom_roles) ? r.custom_roles[0]?.level : r.custom_roles?.level) === 'qa_agent') {
      agentsByCo[r.company_id] = (agentsByCo[r.company_id] || 0) + 1;
    }
  }

  const out = [];
  for (const c of (companies || [])) {
    const methods = await getConfig(c.id, 'qa.methods', []);
    out.push({
      id: c.id, name: c.name, company_type: c.company_type,
      methods: Array.isArray(methods) ? methods : [],
      qa_agents: agentsByCo[c.id] || 0,
    });
  }
  res.json({ companies: out });
}));

// Force-pull a fresh RCM random sample of YESTERDAY's raw dialer calls, live
// from the dialer (bypasses the once-per-day guard), then route it. This is the
// "Pull RCM now" button — proves the pipeline live and tells you exactly why if
// nothing comes (no mapped users / no calls that day / all calls were CRM).
router.post('/admin/sample-rcm', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const { company_id } = req.body || {};
  if (!company_id) return res.status(400).json({ error: 'company_id required' });
  // optional specific day (YYYY-MM-DD) — else yesterday. Can't be today (the day
  // isn't complete) or the future.
  let date = typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : null;
  const todayStr = new Date().toISOString().slice(0, 10);
  if (date && date >= todayStr) return res.status(400).json({ error: 'Pick a completed past day (not today or the future).' });
  const methods = await getConfig(company_id, 'qa.methods', []);
  if (!Array.isArray(methods) || !methods.includes('rcm')) return res.status(400).json({ error: 'RCM is not enabled for this company — turn it on first.' });
  const covers = await getConfig(company_id, 'qa.rcm.covers', ['fronter']);
  const sample = await getConfig(company_id, 'qa.rcm.sample', { mode: 'percentage', value: 10, period: 'week' });
  const result = await sampleRcmFromDialer(company_id, { covers, sample, force: true, detail: true, date });
  const routed = await applyCompanyRules(company_id);
  const auto = await autoAssignCompany(company_id);
  res.json({ ok: true, sampled: result.created, day: result.day, reason: result.reason, routed: routed.assigned + auto.assigned });
}));

// Distribute a company's unassigned pending tasks to its covering agents now
// (round-robin). Applies coverage to the existing backlog — new tasks already
// auto-route on materialize. Compliance / superadmin only.
router.post('/admin/auto-assign', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const { company_id } = req.body || {};
  if (!company_id) return res.status(400).json({ error: 'company_id required' });
  const r = await autoAssignCompany(company_id, { assignedBy: req.user.id });
  res.json({ ok: true, ...r });
}));

// All QA users (managers + agents) across companies, grouped by user. Includes
// people whose company access was removed (no active rows) — a QA person never
// disappears from the team list; they just show with no company access, ready
// to be re-added.
router.get('/admin/users', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const { data: rows } = await supabaseAdmin.from('user_company_roles')
    .select('id, user_id, company_id, is_active, custom_roles(level), companies(name)');
  const qaRows = (rows || []).filter(r => ['qa_manager', 'qa_agent'].includes(lvlOf(r.custom_roles)));
  const uids = [...new Set(qaRows.map(r => r.user_id))];
  let names = {};
  if (uids.length) {
    const { data: profs } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', uids);
    names = Object.fromEntries((profs || []).map(p => [p.user_id, profName(p)]));
  }
  // each AGENT's bound review method(s) per company (qa_agent_methods) so
  // compliance can finish setup (assign company + bind TRA/RCM) in one place.
  let methodsBy = {};   // `${user_id}|${company_id}` → ['tra','rcm']
  if (uids.length) {
    const { data: am } = await supabaseAdmin.from('qa_agent_methods').select('user_id, company_id, method').in('user_id', uids);
    for (const m of (am || [])) (methodsBy[`${m.user_id}|${m.company_id}`] ||= []).push(m.method);
  }
  const byUser = {};
  for (const r of qaRows) {
    const level = lvlOf(r.custom_roles);
    (byUser[r.user_id] ||= { user_id: r.user_id, name: names[r.user_id] || r.user_id, levels: new Set(), companies: [] });
    byUser[r.user_id].levels.add(level);
    // only ACTIVE rows count as access; inactive rows just keep the person listed
    if (r.is_active) byUser[r.user_id].companies.push({ ucr_id: r.id, company_id: r.company_id, company_name: Array.isArray(r.companies) ? r.companies[0]?.name : r.companies?.name, level, methods: level === 'qa_agent' ? (methodsBy[`${r.user_id}|${r.company_id}`] || []) : null });
  }
  // each person's current OPEN plate (pending + in_review) — the workload
  // compliance should look at before piling on more.
  const open = await openCounts(uids);
  res.json({ users: Object.values(byUser).map(u => ({ ...u, levels: [...u.levels], open_tasks: open[u.user_id] || 0 })) });
}));

// search QUALITY people only — users holding an active qa_manager/qa_agent role
// (compliance never assigns work to non-QA users; the Super Admin mints QA
// accounts, and they show up here the moment they exist).
router.get('/admin/user-search', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ users: [] });
  const { data: rows } = await supabaseAdmin.from('user_company_roles')
    .select('user_id, custom_roles(level)').eq('is_active', true);
  const levelsByUid = {};
  for (const r of (rows || [])) {
    const l = lvlOf(r.custom_roles);
    if (['qa_manager', 'qa_agent'].includes(l)) (levelsByUid[r.user_id] ||= new Set()).add(l);
  }
  const qaIds = Object.keys(levelsByUid);
  if (!qaIds.length) return res.json({ users: [] });
  const { data: profs } = await supabaseAdmin.from('user_profiles')
    .select('user_id, first_name, last_name').in('user_id', qaIds);
  const hits = (profs || []).filter(p => profName(p).toLowerCase().includes(q)).slice(0, 25);
  res.json({ users: hits.map(p => ({ user_id: p.user_id, name: profName(p), levels: [...(levelsByUid[p.user_id] || [])] })) });
}));

// assign an existing user to a company as a QA role (multi-company = call per co)
router.post('/admin/assign', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const { user_id, company_id, level } = req.body || {};
  if (!user_id || !company_id || !['qa_manager', 'qa_agent'].includes(level)) return res.status(400).json({ error: 'user_id, company_id, level (qa_manager|qa_agent) required' });
  const roleId = await globalQaRoleId(level);
  if (!roleId) return res.status(500).json({ error: 'Global QA role missing — apply migration 181' });
  const { data: existing } = await supabaseAdmin.from('user_company_roles').select('id, custom_roles(level)').eq('user_id', user_id).eq('company_id', company_id);
  const qaExisting = (existing || []).find(r => ['qa_manager', 'qa_agent'].includes(lvlOf(r.custom_roles)));
  if (qaExisting) {
    await supabaseAdmin.from('user_company_roles').update({ role_id: roleId, is_active: true }).eq('id', qaExisting.id);
    return res.json({ ok: true, ucr_id: qaExisting.id, updated: true });
  }
  const { data, error } = await supabaseAdmin.from('user_company_roles').insert({ user_id, company_id, role_id: roleId, assigned_by: req.user.id, is_active: true }).select('id').single();
  if (error) return res.status(500).json({ error: /duplicate|unique/i.test(error.message) ? 'That user already has a role in this company.' : error.message });
  res.json({ ok: true, ucr_id: data.id });
}));

// Remove a QA person's COMPANY ACCESS — a soft deactivate, never a user delete.
// The account stays intact and the person stays in the QA team list (re-add
// anytime reactivates the same row). Business cleanup happens with it:
//   • their routing rules for that company are PAUSED (no new work routes)
//   • their untouched pending tasks there return to the pool (calls don't rot
//     on someone who's off the account; in-progress/scored work is untouched)
router.delete('/admin/assign/:ucrId', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const { data: row } = await supabaseAdmin.from('user_company_roles').select('id, user_id, company_id, custom_roles(level)').eq('id', req.params.ucrId).maybeSingle();
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!['qa_manager', 'qa_agent'].includes(lvlOf(row.custom_roles))) return res.status(400).json({ error: 'Not a QA assignment' });
  const { error } = await supabaseAdmin.from('user_company_roles').update({ is_active: false }).eq('id', req.params.ucrId);
  if (error) return res.status(500).json({ error: error.message });

  let paused_rules = 0, released_tasks = 0;
  try {
    const { data: pr } = await supabaseAdmin.from('qa_routing_rules')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('reviewer_id', row.user_id).eq('company_id', row.company_id).eq('is_active', true).select('id');
    paused_rules = (pr || []).length;
  } catch { /* mig 186 not applied — nothing to pause */ }
  try {
    const { data: rt } = await supabaseAdmin.from('qa_assignments')
      .update({ assigned_to: null })
      .eq('assigned_to', row.user_id).eq('company_id', row.company_id).eq('status', 'pending').select('id');
    released_tasks = (rt || []).length;
  } catch { /* best-effort */ }
  res.json({ ok: true, paused_rules, released_tasks });
}));

// enable/disable QA (methods) for ANY company
router.put('/admin/company-methods', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const { company_id } = req.body || {};
  const methods = Array.isArray(req.body?.methods) ? req.body.methods.filter(m => ['tra', 'rcm'].includes(m)) : [];
  if (!company_id) return res.status(400).json({ error: 'company_id required' });
  await setConfig(`company:${company_id}`, 'qa.methods', methods, req.user.id);
  let materialized = null;
  if (methods.length) { try { materialized = await materializeCompany(company_id, methods); } catch (e) { logger.warn('QA', `admin materialize: ${e.message}`); } }
  res.json({ ok: true, methods, materialized });
}));

// NOTE: QA user CREATION was removed from the compliance surface — the Super
// Admin creates QA users through the normal admin user management. Anyone who
// holds a QA role automatically appears in GET /admin/users above for
// compliance to assign, bind and route.

// ── QA COMMAND CENTER reporting: who is doing what, when, how much ────────────
const coNameOf = (c) => Array.isArray(c) ? c[0]?.name : c?.name;
const avgOf = (arr) => arr.length ? Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10 : null;
// window helper: ?from=/?to= (YYYY-MM-DD) → ISO bounds; default last `days` days.
function reportWindow(req, days = 30) {
  const to = req.query.to && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)
    ? new Date(`${req.query.to}T23:59:59.999Z`).toISOString() : new Date().toISOString();
  const from = req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
    ? new Date(`${req.query.from}T00:00:00.000Z`).toISOString() : new Date(Date.now() - days * 86400000).toISOString();
  return { from, to };
}
// page through every matching qa_reviews row (chunked) so the numbers reflect
// the whole window, not just the first page.
async function allReviews(build) {
  const rows = [];
  for (let off = 0; off < 500000; off += 1000) {
    const { data, error } = await build().order('created_at', { ascending: false }).range(off, off + 999);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

// GET /qa/admin/team — the reviewer scoreboard: every QA person with their
// company access + roles + methods AND their productivity over the window
// (reviews done, per-day rate, avg score given, pass rate, turnaround, last
// active). This is the "who is doing what / how much" oversight surface.
router.get('/admin/team', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const oneCo = req.query.company_id || null;
  const { from, to } = reportWindow(req, 30);

  // roster (same shape as /admin/users) — QA people, active company access, methods
  const { data: ucrRows } = await supabaseAdmin.from('user_company_roles')
    .select('id, user_id, company_id, is_active, custom_roles(level), companies(name)');
  const qaUcr = (ucrRows || []).filter(r => ['qa_manager', 'qa_agent'].includes(lvlOf(r.custom_roles)));
  const uids = [...new Set(qaUcr.map(r => r.user_id))];
  if (!uids.length) return res.json({ kpis: { qa_people: 0, managers: 0, agents: 0, reviews: 0, active_reviewers: 0, backlog: 0, pass_rate: null }, reviewers: [], window: { from, to } });

  const { data: profs } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', uids);
  const nameBy = Object.fromEntries((profs || []).map(p => [p.user_id, profName(p)]));
  const { data: am } = await supabaseAdmin.from('qa_agent_methods').select('user_id, company_id, method').in('user_id', uids);
  const methodsBy = {};
  for (const m of (am || [])) (methodsBy[`${m.user_id}|${m.company_id}`] ||= []).push(m.method);

  const person = {};
  for (const r of qaUcr) {
    const lvl = lvlOf(r.custom_roles);
    (person[r.user_id] ||= { user_id: r.user_id, name: nameBy[r.user_id] || r.user_id, levels: new Set(), companies: [] });
    person[r.user_id].levels.add(lvl);
    if (r.is_active) person[r.user_id].companies.push({ ucr_id: r.id, company_id: r.company_id, company_name: coNameOf(r.companies), level: lvl, methods: lvl === 'qa_agent' ? (methodsBy[`${r.user_id}|${r.company_id}`] || []) : null });
  }

  // reviews done in the window by these reviewers (optionally one company)
  const reviews = await allReviews(() => {
    let q = supabaseAdmin.from('qa_reviews')
      .select('reviewer_id, company_id, method, assignment_id, final_score, quality_score, passed, created_at')
      .in('reviewer_id', uids).gte('created_at', from).lte('created_at', to);
    if (oneCo) q = q.eq('company_id', oneCo);
    return q;
  });

  // work_type + task-created time per reviewed assignment (for breakdown + turnaround)
  const aids = [...new Set(reviews.map(r => r.assignment_id).filter(Boolean))];
  const wtBy = {}, createdBy = {};
  for (let i = 0; i < aids.length; i += 150) {
    const { data: asg } = await supabaseAdmin.from('qa_assignments')
      .select('id, work_type, method, subject_role, transfer_id, sale_id, created_at').in('id', aids.slice(i, i + 150));
    for (const a of (asg || [])) { wtBy[a.id] = workTypeOf(a); createdBy[a.id] = a.created_at; }
  }

  const dayKey = (ts) => String(ts).slice(0, 10);
  const agg = {};
  for (const rv of reviews) {
    const a = (agg[rv.reviewer_id] ||= { n: 0, by_wt: {}, finals: [], qualities: [], passT: 0, passN: 0, days: new Set(), first: null, last: null, turn: [] });
    a.n++;
    const wt = wtBy[rv.assignment_id] || rv.method;
    a.by_wt[wt] = (a.by_wt[wt] || 0) + 1;
    if (rv.final_score != null) a.finals.push(+rv.final_score);
    if (rv.quality_score != null) a.qualities.push(+rv.quality_score);
    if (rv.passed === true) { a.passT++; a.passN++; } else if (rv.passed === false) a.passN++;
    a.days.add(dayKey(rv.created_at));
    if (!a.first || rv.created_at < a.first) a.first = rv.created_at;
    if (!a.last || rv.created_at > a.last) a.last = rv.created_at;
    const ac = createdBy[rv.assignment_id];
    if (ac) { const mins = (new Date(rv.created_at) - new Date(ac)) / 60000; if (mins >= 0 && mins < 60 * 24 * 60) a.turn.push(mins); }
  }

  const open = await openCounts(uids);
  const reviewers = Object.values(person).map(p => {
    const a = agg[p.user_id] || {};
    const n = a.n || 0, activeDays = a.days ? a.days.size : 0;
    return {
      user_id: p.user_id, name: p.name, levels: [...p.levels], companies: p.companies,
      open_tasks: open[p.user_id] || 0,
      reviews: n, by_work_type: a.by_wt || {},
      avg_final: avgOf(a.finals || []), avg_quality: avgOf(a.qualities || []),
      pass_rate: a.passN ? Math.round((a.passT / a.passN) * 100) : null,
      active_days: activeDays, per_day: activeDays ? Math.round((n / activeDays) * 10) / 10 : 0,
      avg_turnaround_min: (a.turn && a.turn.length) ? Math.round(avgOf(a.turn)) : null,
      first_at: a.first || null, last_at: a.last || null,
    };
  }).sort((x, y) => y.reviews - x.reviews);

  const passVals = reviews.filter(r => r.passed != null);
  const kpis = {
    qa_people: reviewers.length,
    managers: reviewers.filter(r => r.levels.includes('qa_manager')).length,
    agents: reviewers.filter(r => r.levels.includes('qa_agent')).length,
    reviews: reviews.length,
    active_reviewers: new Set(reviews.map(r => r.reviewer_id)).size,
    backlog: Object.values(open).reduce((s, x) => s + x, 0),
    pass_rate: passVals.length ? Math.round((passVals.filter(r => r.passed).length / passVals.length) * 100) : null,
  };
  res.json({ kpis, reviewers, window: { from, to } });
}));

// GET /qa/admin/activity — the "who did what, when" timeline. Every completed
// review newest-first, enriched with reviewer + reviewed-agent + company +
// work-type + result. Filter by company / reviewer / window; paginated.
router.get('/admin/activity', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const oneCo = req.query.company_id || null;
  const reviewerId = req.query.reviewer_id || null;
  const { from, to } = reportWindow(req, 14);
  const limit = Math.min(parseInt(req.query.limit, 10) || 60, 200);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const offset = (page - 1) * limit;

  let q = supabaseAdmin.from('qa_reviews')
    .select('id, reviewer_id, subject_user_id, company_id, method, assignment_id, final_score, quality_score, passed, autofail_result, created_at', { count: offset === 0 ? 'exact' : undefined })
    .gte('created_at', from).lte('created_at', to)
    .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (oneCo) q = q.eq('company_id', oneCo);
  if (reviewerId) q = q.eq('reviewer_id', reviewerId);
  const { data: rows, count, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const uids = [...new Set([...(rows || []).map(r => r.reviewer_id), ...(rows || []).map(r => r.subject_user_id)].filter(Boolean))];
  const { data: profs } = uids.length ? await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', uids) : { data: [] };
  const nameBy = Object.fromEntries((profs || []).map(p => [p.user_id, profName(p)]));
  const coIds = [...new Set((rows || []).map(r => r.company_id).filter(Boolean))];
  const { data: cos } = coIds.length ? await supabaseAdmin.from('companies').select('id, name').in('id', coIds) : { data: [] };
  const coBy = Object.fromEntries((cos || []).map(c => [c.id, c.name]));
  const aids = [...new Set((rows || []).map(r => r.assignment_id).filter(Boolean))];
  const asgBy = {};
  if (aids.length) {
    const { data: asg } = await supabaseAdmin.from('qa_assignments')
      .select('id, work_type, method, subject_role, transfer_id, sale_id, subject_agent').in('id', aids);
    for (const a of (asg || [])) asgBy[a.id] = a;
  }
  const items = (rows || []).map(r => {
    const a = asgBy[r.assignment_id] || {};
    return {
      id: r.id, created_at: r.created_at,
      reviewer_id: r.reviewer_id, reviewer_name: nameBy[r.reviewer_id] || null,
      subject_user_id: r.subject_user_id,
      subject_name: (r.subject_user_id && nameBy[r.subject_user_id]) || a.subject_agent || null,
      company_id: r.company_id, company_name: coBy[r.company_id] || null,
      work_type: a.work_type || workTypeOf(a) || r.method,
      final_score: r.final_score, quality_score: r.quality_score, passed: r.passed, autofail_result: r.autofail_result,
    };
  });
  // any subject still a raw dialer id → resolve to a real name
  const unresolved = items.filter(i => i.subject_name && !nameBy[i.subject_user_id] && /[A-Za-z]*\d{3,}/.test(i.subject_name)).map(i => i.subject_name);
  if (unresolved.length) {
    const nm = await dialerAgentNameMap(unresolved);
    for (const i of items) if (nm[String(i.subject_name).toUpperCase()]) i.subject_name = nm[String(i.subject_name).toUpperCase()];
  }
  res.json({ items, total: offset === 0 ? (count || 0) : null, page, limit, window: { from, to } });
}));

// ── WORK RULES — who listens to what (mig 186) ────────────────────────────────
// A rule = one reviewer × any mix of work types × everyone-or-specific subject
// users × (for closer_dispo) a disposition set. The engine materializes the
// matching calls and routes them to the reviewer automatically.

// list rules (enriched with reviewer + subject names)
router.get('/admin/rules', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  let q = supabaseAdmin.from('qa_routing_rules').select('*').order('created_at', { ascending: false });
  if (req.query.company_id) q = q.eq('company_id', req.query.company_id);
  const { data: rules, error } = await q;
  if (error) return res.status(500).json({ error: /does not exist|relation/i.test(error.message) ? 'Work rules need migration 186 — apply it in the Supabase SQL editor first.' : error.message });
  const uids = [...new Set((rules || []).flatMap(r => [r.reviewer_id, ...(r.subject_user_ids || [])]))].filter(Boolean);
  let names = {};
  if (uids.length) {
    const { data: profs } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', uids);
    names = Object.fromEntries((profs || []).map(p => [p.user_id, profName(p) || p.user_id.slice(0, 6)]));
  }
  const { data: cos } = await supabaseAdmin.from('companies').select('id, name');
  const coName = Object.fromEntries((cos || []).map(c => [c.id, c.name]));
  res.json({
    rules: (rules || []).map(r => ({
      ...r,
      reviewer_name: names[r.reviewer_id] || null,
      subject_names: (r.subject_user_ids || []).map(id => names[id] || id.slice(0, 6)),
      company_name: coName[r.company_id] || null,
    })),
  });
}));

// create a rule
router.post('/admin/rules', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const { company_id, reviewer_id } = req.body || {};
  const work_types = Array.isArray(req.body?.work_types) ? req.body.work_types.filter(t => WORK_TYPES.includes(t)) : [];
  const subject_user_ids = Array.isArray(req.body?.subject_user_ids) ? req.body.subject_user_ids.filter(Boolean) : [];
  const dispositions = Array.isArray(req.body?.dispositions) ? req.body.dispositions.map(d => String(d).trim().toUpperCase()).filter(Boolean) : [];
  if (!company_id || !reviewer_id || !work_types.length) return res.status(400).json({ error: 'company_id, reviewer_id and at least one work type are required' });
  const { data, error } = await supabaseAdmin.from('qa_routing_rules')
    .insert({ company_id, reviewer_id, work_types, subject_user_ids, dispositions, created_by: req.user.id })
    .select().single();
  if (error) return res.status(500).json({ error: /does not exist|relation/i.test(error.message) ? 'Work rules need migration 186 — apply it in the Supabase SQL editor first.' : error.message });
  res.json({ ok: true, rule: data });
}));

// update / toggle a rule
router.put('/admin/rules/:id', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const patch = {};
  if (typeof req.body?.is_active === 'boolean') patch.is_active = req.body.is_active;
  if (Array.isArray(req.body?.work_types)) patch.work_types = req.body.work_types.filter(t => WORK_TYPES.includes(t));
  if (Array.isArray(req.body?.subject_user_ids)) patch.subject_user_ids = req.body.subject_user_ids.filter(Boolean);
  if (Array.isArray(req.body?.dispositions)) patch.dispositions = req.body.dispositions.map(d => String(d).trim().toUpperCase()).filter(Boolean);
  if (req.body?.reviewer_id) patch.reviewer_id = req.body.reviewer_id;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('qa_routing_rules').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, rule: data });
}));

router.delete('/admin/rules/:id', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const { error } = await supabaseAdmin.from('qa_routing_rules').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// run a company's rules NOW: materialize the base pools the rules need (tra/rcm
// via the RPCs, closer work here) and route everything to the rule reviewers.
router.post('/admin/rules/apply', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const { company_id } = req.body || {};
  if (!company_id) return res.status(400).json({ error: 'company_id required' });
  const rules = await getActiveRules(company_id);
  if (!rules.length) return res.status(400).json({ error: 'No active work rules for this company yet — add one first.' });
  const types = new Set(rules.flatMap(r => r.work_types || []));
  const base = ['tra', 'rcm'].filter(t => types.has(t));
  let materialized = { tra: 0, rcm: 0 };
  if (base.length) { try { materialized = await materializeCompany(company_id, base); } catch (e) { logger.warn('QA', `rules apply materialize: ${e.message}`); } }
  const closer = await materializeCloserWork(company_id, rules);
  const routed = await applyCompanyRules(company_id);
  // tell each reviewer what just landed on their plate
  for (const [uid, n] of Object.entries(routed.byReviewer || {})) {
    notifyUsers([uid], {
      companyId: company_id, type: 'qa_assignment',
      title: `${n} QA call(s) routed to you`, message: 'Compliance work rules assigned calls for you to review.',
      data: { count: n },
    }).catch(() => {});
  }
  res.json({ ok: true, materialized, closer, routed: routed.assigned, held: routed.held || 0 });
}));

// The reviewable people for the subject picker. A transfer's TWO legs involve
// people from DIFFERENT companies — the fronter belongs to the fronter company,
// but the closer who received the call belongs to the LINKED closer company
// (e.g. 1-Vertex). So this returns the company's own fronters/closers PLUS the
// closers of every company linked to it via company_links, tagged with where
// they come from — otherwise closer-leg reviews could never target a person.
router.get('/admin/company-users', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const companyId = req.query.company_id;
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const { data: rows } = await supabaseAdmin.from('user_company_roles')
    .select('user_id, company_id, custom_roles(level)').eq('company_id', companyId).eq('is_active', true);
  let withLevel = (rows || []).map(r => ({ user_id: r.user_id, company_id: r.company_id, level: lvlOf(r.custom_roles), linked: false }))
    .filter(r => ['fronter', 'closer', 'fronter_manager', 'closer_manager'].includes(r.level));

  // + the closers of LINKED companies (both link directions)
  const { data: links } = await supabaseAdmin.from('company_links')
    .select('fronter_company_id, closer_company_id')
    .or(`fronter_company_id.eq.${companyId},closer_company_id.eq.${companyId}`);
  const linkedIds = [...new Set((links || []).map(l => l.fronter_company_id === companyId ? l.closer_company_id : l.fronter_company_id).filter(id => id && id !== companyId))];
  let linkedNames = {};
  if (linkedIds.length) {
    const { data: cos } = await supabaseAdmin.from('companies').select('id, name').in('id', linkedIds);
    linkedNames = Object.fromEntries((cos || []).map(c => [c.id, c.name]));
    const { data: lr } = await supabaseAdmin.from('user_company_roles')
      .select('user_id, company_id, custom_roles(level)').in('company_id', linkedIds).eq('is_active', true);
    const linkedClosers = (lr || []).map(r => ({ user_id: r.user_id, company_id: r.company_id, level: lvlOf(r.custom_roles), linked: true }))
      .filter(r => ['closer', 'closer_manager'].includes(r.level));
    withLevel = withLevel.concat(linkedClosers);
  }
  const uids = [...new Set(withLevel.map(r => r.user_id))];
  let names = {}; const hasDialer = {};
  if (uids.length) {
    const { data: profs } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name, vicidial_agent_ids').in('user_id', uids);
    names = Object.fromEntries((profs || []).map(p => [p.user_id, profName(p) || p.user_id.slice(0, 6)]));
    for (const p of (profs || [])) hasDialer[p.user_id] = Array.isArray(p.vicidial_agent_ids) && p.vicidial_agent_ids.length > 0;
  }
  const seen = new Set();
  const users = withLevel.filter(r => !seen.has(r.user_id) && seen.add(r.user_id))
    .map(r => ({
      user_id: r.user_id, name: names[r.user_id] || r.user_id.slice(0, 6), level: r.level,
      // no dialer mapping → their RAW (RCM) calls can't be sampled/attributed
      has_dialer: !!hasDialer[r.user_id],
      linked: !!r.linked, company_name: r.linked ? (linkedNames[r.company_id] || null) : null,
    }))
    .sort((a, b) => (a.linked === b.linked ? a.name.localeCompare(b.name) : a.linked ? 1 : -1));
  res.json({ users });
}));

// the disposition codes seen on this company's closer-landed transfers (for the
// closer_dispo picker) — recent slice is plenty for a picker; free-typing is
// still allowed in the UI.
router.get('/admin/dispositions', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const companyId = req.query.company_id;
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const { data } = await supabaseAdmin.from('transfers')
    .select('latest_disposition').eq('company_id', companyId)
    .not('latest_disposition', 'is', null).not('assigned_closer_id', 'is', null)
    .order('created_at', { ascending: false }).limit(2000);
  const counts = {};
  for (const r of (data || [])) { const d = String(r.latest_disposition || '').trim().toUpperCase(); if (d) counts[d] = (counts[d] || 0) + 1; }
  res.json({ dispositions: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, count: n })) });
}));

// full per-company QA config (compliance controls each company's QA setup —
// methods, RCM sampling, covers, TRA population, retention, card fields).
const QA_ADMIN_KEYS = ['qa.methods', 'qa.rcm.sample', 'qa.rcm.covers', 'qa.tra.population', 'qa.retention_days', 'qa.card_fields', 'qa.reviewer_cap', 'qa.day_cache_days', 'qa.manager_can_clear'];
router.get('/admin/company-config', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const companyId = req.query.company_id;
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const out = {};
  for (const k of QA_ADMIN_KEYS) out[k] = await getConfig(companyId, k, null);
  res.json({ company_id: companyId, config: out });
}));
router.put('/admin/company-config', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const { company_id, key, value } = req.body || {};
  if (!company_id || !QA_ADMIN_KEYS.includes(key)) return res.status(400).json({ error: 'company_id + a valid qa.* key required' });
  await setConfig(`company:${company_id}`, key, value, req.user.id);
  let materialized = null;
  if (key === 'qa.methods' && Array.isArray(value) && value.length) { try { materialized = await materializeCompany(company_id, value); } catch (e) { logger.warn('QA', `admin cfg materialize: ${e.message}`); } }
  res.json({ ok: true, key, value, materialized });
}));

module.exports = router;
