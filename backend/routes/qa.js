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
const { WORK_TYPES, getActiveRules, materializeCloserWork, applyCompanyRules } = require('../utils/qaRules');
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
  // assignee names
  const assignees = [...new Set((data || []).map(r => r.assigned_to).filter(Boolean))];
  let names = {};
  if (assignees.length) {
    const { data: up } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', assignees);
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
      agent_display: r.subject_agent || null,     // reviewed agent's dialer id/login
      agent_name: rec?.agent_name || null,          // …and their real name
      duration: rec?.duration ?? null,
      assignee_name: r.assigned_to ? (names[r.assigned_to] || null) : null,
      review: rv,   // { final_score, quality_score, passed, autofail_result, status } or null
    };
  });
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

// ── assign an item to a qa_agent ──────────────────────────────────────────────
router.post('/assignments/:id/assign', asyncHandler(async (req, res) => {
  if (!(await can(req, 'assign_qa_tasks'))) return res.status(403).json({ error: 'Forbidden' });
  const assignedTo = req.body?.assigned_to || null;   // null clears back to the pool
  const { data: a } = await supabaseAdmin.from('qa_assignments').select('id, company_id, method').eq('id', req.params.id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  const allowed = await allowedCompanyIds(req);
  if (allowed && !allowed.includes(a.company_id)) return res.status(403).json({ error: 'Forbidden' });
  // an agent can only be handed a method they're bound to (mig 180)
  if (assignedTo) {
    const methods = await agentMethods(assignedTo);
    if (!methods.includes(a.method)) {
      return res.status(400).json({ error: `This agent isn't set up for ${a.method.toUpperCase()} — bind that method to them in the Agents panel first.`, code: 'METHOD_UNBOUND' });
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
  if (allowed && !allowed.includes(a.company_id)) return res.status(403).json({ error: 'Forbidden' });

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

// ── on-demand transcription (self-hosted faster-whisper worker) ───────────────
// A reviewer clicks "Transcribe" on a specific recording leg → we resolve the
// audio (same as the stream proxy), fetch the bytes, hand them to the whisper
// worker, and CACHE the text keyed by the recording identity so repeat opens are
// instant. Audio is never stored — only the transcript text. Gated by the
// qa.transcription flag (default OFF) + a configured worker URL.
const recKey = (q) => `${q.box_id || ''}:${q.recording_id || ''}`;

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

  // company override → global → off. Superadmin sets it globally, or a manager
  // per-company via PUT /qa/config.
  const enabled = await getConfig(req.user.company_id, 'qa.transcription', false);
  if (!enabled) return res.status(403).json({ error: 'Transcription is turned off.' });
  const workerUrl = (process.env.WHISPER_WORKER_URL || '').replace(/\/$/, '');
  if (!workerUrl) return res.status(503).json({ error: 'Transcription worker is not configured.' });

  const { box_id, lead_id, recording_id, location } = req.body || {};
  if (!recording_id && !location) return res.status(400).json({ error: 'recording_id or location required' });
  const key = recKey({ box_id, recording_id });

  // Cache-first: never re-transcribe a clip we already have.
  const { data: cached } = await supabaseAdmin.from('qa_transcripts').select('*').eq('recording_key', key).maybeSingle();
  if (cached) return res.json({ cached: true, transcript: cached });

  // Resolve the audio URL (same path as the stream proxy).
  let url = (location && /^https?:\/\//.test(location)) ? location : await locationForRecording({ box_id, lead_id, recording_id });
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

  const rows = await listDayRecordings({ date, agentIds: agentRes.ids });   // cached
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

  const rows = await listDayRecordings({ date, agentIds: ids });
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
  const agents = ids.map(id => ({ id, name: nameById[id] || id, role: roleById[id] }));
  res.json({ agents });
}));

// ── manager assigns raw day-recordings to a qa_agent as TRA/RCM tasks ─────────
router.post('/assignments/from-recordings', asyncHandler(async (req, res) => {
  if (!(await can(req, 'assign_qa_tasks'))) return res.status(403).json({ error: 'Forbidden' });
  const { company_id, assigned_to, method, date } = req.body || {};
  const recordings = Array.isArray(req.body?.recordings) ? req.body.recordings : [];
  const subject_role = ['fronter', 'closer'].includes(req.body?.subject_role) ? req.body.subject_role : 'fronter';
  const wantAll = company_id === '__all__';
  const companyId = wantAll ? null : (company_id || req.user.company_id);
  if (!['tra', 'rcm'].includes(method) || !recordings.length) return res.status(400).json({ error: 'method (tra|rcm) and recordings[] are required' });
  const allowed = await allowedCompanyIds(req);
  if (!wantAll && allowed && !allowed.includes(companyId)) return res.status(403).json({ error: 'Forbidden' });
  // if assigning straight to an agent, they must be bound to this method (mig 180)
  if (assigned_to) {
    const am = await agentMethods(assigned_to);
    if (!am.includes(method)) return res.status(400).json({ error: `This agent isn't set up for ${method.toUpperCase()} — bind that method to them in the Agents panel first.`, code: 'METHOD_UNBOUND' });
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
  const rows = recordings.filter(r => r && r.box_id && r.recording_id).map(r => ({
    company_id: rowCompany(r), method, subject_role, source: 'day_recording',
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
    assigned_to: assigned_to || null, assigned_by: req.user.id, assigned_at: now,
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
  if (assigned_to && inserted) {
    notifyUsers([assigned_to], {
      companyId: companyId || rows[0]?.company_id, type: 'qa_assignment',
      title: `${inserted} ${method.toUpperCase()} call(s) assigned for QA`,
      message: 'A QA manager assigned recordings for you to review.',
      data: { method, count: inserted },
    }).catch(() => {});
  }
  res.json({ ok: true, inserted, skipped, skipped_no_company: skippedNoCompany });
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
    .select('id, company_id, method, subject_role, transfer_id, sale_id, subject_agent, recording_ref').eq('id', assignment_id).maybeSingle();
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

  const out = reviews.map(r => {
    const a = assignById[r.assignment_id] || {};
    const rec = a.recording_ref || null;
    const t = a.transfer_id ? tById[a.transfer_id] : null;
    const s = a.sale_id ? sById[a.sale_id] : null;
    return {
      id: r.id, assignment_id: r.assignment_id, method: r.method, subject_role: r.subject_role,
      scorecard_id: r.scorecard_id, status: r.status, reviewed_at: r.created_at,
      reviewer_id: r.reviewer_id, reviewer_name: nameById[r.reviewer_id] || null,
      subject_user_id: r.subject_user_id, subject_name: nameById[r.subject_user_id] || null,
      agent: (rec?.agent_name) || a.subject_agent || rec?.agent_user || null,
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

router.post('/scorecards', asyncHandler(async (req, res) => {
  if (!(await can(req, 'manage_qa_config'))) return res.status(403).json({ error: 'Forbidden' });
  const { company_id, method, name, criteria, pass_threshold } = req.body || {};
  if (!['tra', 'rcm'].includes(method) || !name) return res.status(400).json({ error: 'method (tra|rcm) and name are required' });
  // criteria may be an ARRAY (legacy weighted) or an OBJECT (sheet_v2). Keep whichever.
  const criteriaVal = (Array.isArray(criteria) || (criteria && typeof criteria === 'object')) ? criteria : [];
  const row = {
    company_id: company_id || null, method, name: String(name).slice(0, 200),
    criteria: criteriaVal,
    pass_threshold: (pass_threshold === null || pass_threshold === '') ? null : (Number.isFinite(+pass_threshold) ? +pass_threshold : 80),
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
const QA_KEYS = ['qa.methods', 'qa.rcm.covers', 'qa.rcm.sample', 'qa.tra.population', 'qa.scorecard.tra', 'qa.scorecard.rcm', 'qa.card_fields', 'qa.retention_days', 'qa.transcription'];
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
  const methods = Array.isArray(req.body?.methods) ? [...new Set(req.body.methods.filter(m => ['tra', 'rcm'].includes(m)))] : [];
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

  // coverage map: company_id → { tra:[names], rcm:[names] }, built once
  const { data: cov } = await supabaseAdmin.from('qa_agent_methods').select('user_id, company_id, method');
  const covUids = [...new Set((cov || []).map(r => r.user_id))];
  let nameById = {};
  if (covUids.length) {
    const { data: profs } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', covUids);
    nameById = Object.fromEntries((profs || []).map(p => [p.user_id, profName(p) || p.user_id.slice(0, 6)]));
  }
  const coverageByCo = {};
  for (const r of (cov || [])) {
    const co = (coverageByCo[r.company_id] ||= { tra: [], rcm: [] });
    if (co[r.method] && !co[r.method].includes(nameById[r.user_id])) co[r.method].push(nameById[r.user_id] || '?');
  }

  const out = [];
  for (const c of (companies || [])) {
    const methods = await getConfig(c.id, 'qa.methods', []);
    const { count } = await supabaseAdmin.from('qa_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', c.id).eq('status', 'pending').is('assigned_to', null);
    out.push({
      id: c.id, name: c.name, company_type: c.company_type,
      methods: Array.isArray(methods) ? methods : [],
      coverage: coverageByCo[c.id] || { tra: [], rcm: [] },
      unassigned: count || 0,
    });
  }
  res.json({ companies: out });
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

// all QA users (managers + agents) across companies, grouped by user
router.get('/admin/users', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const { data: rows } = await supabaseAdmin.from('user_company_roles')
    .select('id, user_id, company_id, is_active, custom_roles(level), companies(name)').eq('is_active', true);
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
    byUser[r.user_id].companies.push({ ucr_id: r.id, company_id: r.company_id, company_name: Array.isArray(r.companies) ? r.companies[0]?.name : r.companies?.name, level, methods: level === 'qa_agent' ? (methodsBy[`${r.user_id}|${r.company_id}`] || []) : null });
  }
  res.json({ users: Object.values(byUser).map(u => ({ ...u, levels: [...u.levels] })) });
}));

// search any user to assign as QA (by name)
router.get('/admin/user-search', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ users: [] });
  const { data: profs } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').limit(500);
  const hits = (profs || []).filter(p => profName(p).toLowerCase().includes(q)).slice(0, 25);
  res.json({ users: hits.map(p => ({ user_id: p.user_id, name: profName(p) })) });
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

// remove a QA assignment (deactivate) — QA roles only
router.delete('/admin/assign/:ucrId', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const { data: row } = await supabaseAdmin.from('user_company_roles').select('id, custom_roles(level)').eq('id', req.params.ucrId).maybeSingle();
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!['qa_manager', 'qa_agent'].includes(lvlOf(row.custom_roles))) return res.status(400).json({ error: 'Not a QA assignment' });
  const { error } = await supabaseAdmin.from('user_company_roles').update({ is_active: false }).eq('id', req.params.ucrId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
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
  res.json({ ok: true, materialized, closer, routed: routed.assigned });
}));

// the company's reviewable people (fronters + closers) for the subject picker
router.get('/admin/company-users', asyncHandler(async (req, res) => {
  if (!(await canAdminQa(req))) return res.status(403).json({ error: 'Forbidden' });
  const companyId = req.query.company_id;
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const { data: rows } = await supabaseAdmin.from('user_company_roles')
    .select('user_id, custom_roles(level)').eq('company_id', companyId).eq('is_active', true);
  const withLevel = (rows || []).map(r => ({ user_id: r.user_id, level: lvlOf(r.custom_roles) }))
    .filter(r => ['fronter', 'closer', 'fronter_manager', 'closer_manager'].includes(r.level));
  const uids = [...new Set(withLevel.map(r => r.user_id))];
  let names = {};
  if (uids.length) {
    const { data: profs } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', uids);
    names = Object.fromEntries((profs || []).map(p => [p.user_id, profName(p) || p.user_id.slice(0, 6)]));
  }
  const seen = new Set();
  const users = withLevel.filter(r => !seen.has(r.user_id) && seen.add(r.user_id))
    .map(r => ({ user_id: r.user_id, name: names[r.user_id] || r.user_id.slice(0, 6), level: r.level }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
const QA_ADMIN_KEYS = ['qa.methods', 'qa.rcm.sample', 'qa.rcm.covers', 'qa.tra.population', 'qa.retention_days', 'qa.card_fields'];
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
