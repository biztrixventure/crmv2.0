// ============================================================================
// /api/support -- customer retention (mig 355-356).
//
// A SUPPORT AGENT works for named clients. They call that client's customers
// (the cancelled ones and the still-active ones), log every call, and when a
// customer agrees to stay they mark the case Saved and send it to compliance.
// Compliance's approval is the ONLY thing that changes the sale: it goes back
// to closed_won with the reinstate columns stamped.
//
// Who may do what, decided here and nowhere else:
//   support_agent      -> policies of THEIR clients (support_agent_clients),
//                         their own cases, calls and stats. No row in
//                         support_agent_clients = they see nothing.
//   compliance_manager -> every client; approve / return; reports; may set
//                         which clients an agent works.
//   superadmin         -> everything above, and may also work a case.
//   readonly_admin     -> read the reports (writes are refused by
//                         readonlyGuard at the mount).
// The role LEVEL is the grant. There is no permission key to forget to seed.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { escapeOrValue, safeUuid } = require('../utils/searchSanitize');
const { excludePostDate } = require('../utils/postDate');
const { etDateToUtcStart, etDateToUtcEnd, todayEt } = require('../utils/etUtils');
const notifications = require('../utils/notificationService');
const logger = require('../utils/logger');

const router = express.Router();

// What a call can end as. The key is stored; the label is what people read.
const OUTCOMES = [
  { key: 'no_answer',     label: 'No Answer' },
  { key: 'voicemail',     label: 'Left Voicemail' },
  { key: 'spoke',         label: 'Spoke - Undecided' },
  { key: 'callback',      label: 'Callback Requested' },
  { key: 'agreed',        label: 'Agreed to Stay' },
  { key: 'payment_issue', label: 'Payment Issue' },
  { key: 'refused',       label: 'Refused / Wants Out' },
  { key: 'wrong_number',  label: 'Wrong Number' },
  { key: 'other',         label: 'Other' },
];
const OUTCOME_KEYS = new Set(OUTCOMES.map(o => o.key));

const CANCELLED = ['cancelled', 'compliance_cancelled'];
const LIVE_CASE = ['open', 'saved', 'pending_approval', 'returned'];

// Columns the policy screen shows. Named, never '*': a new sales column must be
// a decision to show it to a support agent, not an accident.
const SALE_LIST_COLS = 'id, customer_name, customer_phone, client_name, plan, status, sale_date, cancellation_date, cancellation_reason_key, reference_no, policy_number, car_year, car_make, car_model, monthly_payment, down_payment, company_id';
const SALE_DETAIL_COLS = SALE_LIST_COLS + ', customer_phone_2, customer_email, customer_address, car_miles, car_vin, payment_due_note, closer_id, fronter_id, created_at, updated_at, form_data, compliance_note, closer_disposition, is_resell, customer_uuid, superseded_by, reinstated_at, reinstated_by, reinstate_reason, chargeback_date, chargeback_amount, transfer_id';
// The only form_data keys that leave the server.
const FORM_KEYS = ['FirstName', 'LastName', 'Middle', 'Address', 'City', 'State', 'Zip', 'Email', 'PlanDuration', 'Payment_Duration', 'Monthly_Date', 'Condition', 'Age', 'Variant', 'Other_Contact', '2nd_user', 'Miles'];

// ── who is asking ───────────────────────────────────────────────────────────
async function resolveAccess(req) {
  const role = req.user.role;
  const isAgent    = role === 'support_agent';
  const isReviewer = role === 'superadmin' || role === 'compliance_manager';
  const isViewer   = isReviewer || role === 'readonly_admin';
  let clients = null;                       // null = every client
  if (isAgent) {
    const { data } = await supabaseAdmin
      .from('support_agent_clients').select('client_name').eq('user_id', req.user.id);
    clients = (data || []).map(r => r.client_name);
  }
  return {
    role, isAgent, isReviewer, isViewer, clients,
    canWork: isAgent || role === 'superadmin',
    allowed: isAgent || isViewer,
  };
}

const gate = (fn) => asyncHandler(async (req, res) => {
  const access = await resolveAccess(req);
  if (!access.allowed) return res.status(403).json({ error: 'Support desk is not open for your role' });
  return fn(req, res, access);
});

// Narrow a sales query to what this caller may see. An agent with no clients
// gets an impossible filter rather than an unfiltered query.
const scopeSales = (q, access) => {
  if (access.clients === null) return q;
  if (!access.clients.length) return q.eq('id', '00000000-0000-0000-0000-000000000000');
  return q.in('client_name', access.clients);
};
const mayTouchSale = (sale, access) =>
  !!sale && (access.clients === null || access.clients.includes(sale.client_name));

async function namesOf(ids) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return {};
  const out = {};
  for (let i = 0; i < uniq.length; i += 100) {
    const { data } = await supabaseAdmin
      .from('user_profiles').select('user_id, first_name, last_name').in('user_id', uniq.slice(i, i + 100));
    (data || []).forEach(p => { out[p.user_id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown'; });
  }
  return out;
}

// Latest case per sale id (live one wins over a closed one).
async function casesForSales(saleIds) {
  const by = {};
  for (let i = 0; i < saleIds.length; i += 100) {
    const { data } = await supabaseAdmin
      .from('retention_cases')
      .select('id, sale_id, agent_id, status, call_count, last_call_at, next_follow_up_at, updated_at')
      .in('sale_id', saleIds.slice(i, i + 100))
      .order('created_at', { ascending: true });
    (data || []).forEach(c => {
      const cur = by[c.sale_id];
      if (!cur || LIVE_CASE.includes(c.status) || !LIVE_CASE.includes(cur.status)) by[c.sale_id] = c;
    });
  }
  return by;
}

// ── GET /support/me ─────────────────────────────────────────────────────────
router.get('/me', gate(async (req, res, access) => {
  res.json({
    role: access.role,
    clients: access.clients,                // null = all clients
    can_work: access.canWork,
    can_review: access.isReviewer,
    can_report: access.isViewer,
    outcomes: OUTCOMES,
  });
}));

// ── GET /support/clients -- every client name on a sale ─────────────────────
router.get('/clients', gate(async (req, res, access) => {
  if (!access.isViewer) return res.json({ clients: access.clients || [] });
  const { data, error } = await supabaseAdmin.from('app_sale_client_names').select('client_name');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ clients: [...new Set((data || []).map(r => r.client_name).filter(Boolean))].sort() });
}));

// ── GET /support/policies -- the work list ──────────────────────────────────
// view = cancelled | active | all.  search = phone digits, or name / reference
// / policy number / VIN.
router.get('/policies', gate(async (req, res, access) => {
  const view   = ['cancelled', 'active', 'all'].includes(req.query.view) ? req.query.view : 'cancelled';
  const page   = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const search = String(req.query.search || '').trim();
  const client = String(req.query.client || '').trim();

  // Un-charged post-dates are reminders, not policies -- never on this desk.
  let q = excludePostDate(scopeSales(
    supabaseAdmin.from('sales').select(SALE_LIST_COLS, { count: 'exact' }), access));
  if (client) q = q.eq('client_name', client);
  if (view === 'cancelled')   q = q.in('status', CANCELLED);
  else if (view === 'active') q = q.eq('status', 'closed_won');
  else                        q = q.in('status', [...CANCELLED, 'closed_won']);

  if (search) {
    const digits = search.replace(/\D/g, '');
    const s = escapeOrValue(search);
    q = (digits.length >= 4 && digits.length === search.replace(/[\s()+.-]/g, '').length)
      ? q.or(`customer_phone.ilike.%${digits}%,customer_phone_2.ilike.%${digits}%`)
      : q.or(`customer_name.ilike.%${s}%,reference_no.ilike.%${s}%,policy_number.ilike.%${s}%,car_vin.ilike.%${s}%`);
  }

  q = view === 'active'
    ? q.order('sale_date', { ascending: false, nullsFirst: false })
    : q.order('cancellation_date', { ascending: false, nullsFirst: false }).order('sale_date', { ascending: false });
  const { data, error, count } = await q.range((page - 1) * limit, page * limit - 1);
  if (error) return res.status(500).json({ error: error.message });

  const rows = data || [];
  const caseBy = await casesForSales(rows.map(r => r.id));
  const names = await namesOf(Object.values(caseBy).map(c => c.agent_id));
  res.json({
    total: count || 0, page, limit,
    policies: rows.map(r => {
      const c = caseBy[r.id];
      return { ...r, case: c ? { ...c, agent_name: names[c.agent_id] || null, mine: c.agent_id === req.user.id } : null };
    }),
  });
}));

// ── GET /support/cases -- retention cases (mine, or everyone's for a reviewer)
// view = mine | followups | saved | pending | returned | approved | lost
router.get('/cases', gate(async (req, res, access) => {
  const view  = String(req.query.view || 'mine');
  const page  = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

  let q = supabaseAdmin.from('retention_cases').select('*', { count: 'exact' });
  if (access.isAgent) q = q.eq('agent_id', req.user.id);
  else if (req.query.agent_id && safeUuid(req.query.agent_id)) q = q.eq('agent_id', req.query.agent_id);

  if (view === 'followups') {
    q = q.in('status', ['open', 'saved', 'returned']).not('next_follow_up_at', 'is', null)
         .order('next_follow_up_at', { ascending: true });
  } else if (view === 'pending') {
    q = q.eq('status', 'pending_approval').order('submitted_at', { ascending: true });
  } else if (['saved', 'returned', 'approved', 'lost', 'open'].includes(view)) {
    q = q.eq('status', view).order('updated_at', { ascending: false });
  } else {
    q = q.in('status', LIVE_CASE).order('updated_at', { ascending: false });
  }
  const { data, error, count } = await q.range((page - 1) * limit, page * limit - 1);
  if (error) return res.status(500).json({ error: error.message });

  const cases = data || [];
  const saleIds = cases.map(c => c.sale_id).filter(Boolean);
  const saleBy = {};
  for (let i = 0; i < saleIds.length; i += 100) {
    const { data: s } = await supabaseAdmin.from('sales').select(SALE_LIST_COLS).in('id', saleIds.slice(i, i + 100));
    (s || []).forEach(x => { saleBy[x.id] = x; });
  }
  const names = await namesOf(cases.flatMap(c => [c.agent_id, c.reviewed_by]));
  res.json({
    total: count || 0, page, limit,
    cases: cases.map(c => ({
      ...c,
      agent_name: names[c.agent_id] || null,
      reviewer_name: names[c.reviewed_by] || null,
      sale: saleBy[c.sale_id] || null,
    })),
  });
}));

// ── GET /support/policies/:saleId -- everything on one policy ───────────────
router.get('/policies/:saleId', gate(async (req, res, access) => {
  if (!safeUuid(req.params.saleId)) return res.status(404).json({ error: 'Policy not found' });
  const { data: sale } = await supabaseAdmin
    .from('sales').select(SALE_DETAIL_COLS).eq('id', req.params.saleId).maybeSingle();
  if (!mayTouchSale(sale, access)) return res.status(404).json({ error: 'Policy not found' });

  const [casesRes, callsRes, eventsRes, othersRes, companyRes] = await Promise.all([
    supabaseAdmin.from('retention_cases').select('*').eq('sale_id', sale.id).order('created_at', { ascending: false }),
    supabaseAdmin.from('retention_calls').select('*').eq('sale_id', sale.id).order('called_at', { ascending: false }),
    supabaseAdmin.from('policy_events').select('id, event_type, at, actor_id, note').eq('sale_id', sale.id).order('at', { ascending: false }).limit(100),
    sale.customer_uuid
      ? scopeSales(supabaseAdmin.from('sales').select(SALE_LIST_COLS).eq('customer_uuid', sale.customer_uuid), access)
          .order('sale_date', { ascending: false }).limit(25)
      : Promise.resolve({ data: [sale] }),
    sale.company_id
      ? supabaseAdmin.from('companies').select('name').eq('id', sale.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const cases = casesRes.data || [];
  const calls = callsRes.data || [];
  const events = eventsRes.data || [];
  const names = await namesOf([
    sale.closer_id, sale.fronter_id, sale.reinstated_by,
    ...cases.flatMap(c => [c.agent_id, c.reviewed_by]),
    ...calls.map(c => c.agent_id), ...events.map(e => e.actor_id),
  ]);

  const fd = sale.form_data || {};
  const form = {};
  FORM_KEYS.forEach(k => { if (fd[k] !== undefined && fd[k] !== null && fd[k] !== '') form[k] = fd[k]; });
  const { form_data: _drop, ...saleOut } = sale;

  const live = cases.find(c => LIVE_CASE.includes(c.status)) || null;
  const decorate = (c) => ({ ...c, agent_name: names[c.agent_id] || null, reviewer_name: names[c.reviewed_by] || null });
  res.json({
    policy: {
      ...saleOut,
      form,
      closer_name: names[sale.closer_id] || null,
      fronter_name: names[sale.fronter_id] || null,
      reinstated_by_name: names[sale.reinstated_by] || null,
      company_name: companyRes.data?.name || null,
    },
    case: live ? decorate(live) : null,
    cases: cases.map(decorate),
    calls: calls.map(c => ({ ...c, agent_name: names[c.agent_id] || null })),
    history: events.map(e => ({ ...e, actor_name: names[e.actor_id] || null })),
    other_policies: (othersRes.data || []),
    // Can THIS caller log a call right now, and if not, why.
    work: {
      can: access.canWork && (!live || (live.agent_id === req.user.id && live.status !== 'pending_approval')),
      reason: !access.canWork ? 'view_only'
        : live && live.agent_id !== req.user.id ? 'other_agent'
        : live && live.status === 'pending_approval' ? 'with_compliance' : null,
      held_by: live && live.agent_id !== req.user.id ? (names[live.agent_id] || 'another agent') : null,
    },
  });
}));

// ── POST /support/policies/:saleId/calls -- log one call ────────────────────
// Opens the case on the first call (that is what claims the customer).
router.post('/policies/:saleId/calls', gate(async (req, res, access) => {
  if (!access.canWork) return res.status(403).json({ error: 'Only a support agent can log a call' });
  if (!safeUuid(req.params.saleId)) return res.status(404).json({ error: 'Policy not found' });

  const outcome = String(req.body?.outcome || '');
  const notes   = String(req.body?.notes || '').trim();
  if (!OUTCOME_KEYS.has(outcome)) return res.status(400).json({ error: 'Pick how the call ended' });
  if (notes.length < 3) return res.status(400).json({ error: 'Write what happened on the call' });
  let followUp = null;
  if (req.body?.follow_up_at) {
    const d = new Date(req.body.follow_up_at);
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Follow-up time is not a valid date' });
    followUp = d.toISOString();
  }

  const { data: sale } = await supabaseAdmin
    .from('sales').select('id, client_name, company_id, customer_name, reference_no, policy_number, status, cancellation_date, cancellation_reason_key')
    .eq('id', req.params.saleId).maybeSingle();
  if (!mayTouchSale(sale, access)) return res.status(404).json({ error: 'Policy not found' });

  let { data: live } = await supabaseAdmin
    .from('retention_cases').select('*').eq('sale_id', sale.id).in('status', LIVE_CASE).maybeSingle();

  if (live && live.agent_id !== req.user.id) {
    return res.status(409).json({ error: 'Another support agent is already working this customer', code: 'OTHER_AGENT' });
  }
  if (live && live.status === 'pending_approval') {
    return res.status(409).json({ error: 'This case is with compliance for approval', code: 'WITH_COMPLIANCE' });
  }

  if (!live) {
    const { data: created, error: cErr } = await supabaseAdmin.from('retention_cases').insert({
      sale_id: sale.id, agent_id: req.user.id, client_name: sale.client_name, company_id: sale.company_id,
      customer_name: sale.customer_name, reference_no: sale.policy_number || sale.reference_no,
      status: 'open',
      sale_status_at_open: sale.status,
      cancellation_date_at_open: sale.cancellation_date,
      cancellation_reason_at_open: sale.cancellation_reason_key,
    }).select('*').single();
    // 23505 = the partial unique index: someone opened it between our read and write.
    if (cErr?.code === '23505') return res.status(409).json({ error: 'Another support agent just opened this customer', code: 'OTHER_AGENT' });
    if (cErr) return res.status(500).json({ error: cErr.message });
    live = created;
  }

  const now = new Date().toISOString();
  const { data: call, error: callErr } = await supabaseAdmin.from('retention_calls').insert({
    case_id: live.id, sale_id: sale.id, agent_id: req.user.id,
    outcome, notes, follow_up_at: followUp, called_at: now,
  }).select('*').single();
  if (callErr) return res.status(500).json({ error: callErr.message });

  const { data: updated } = await supabaseAdmin.from('retention_cases').update({
    call_count: (live.call_count || 0) + 1, last_call_at: now,
    next_follow_up_at: followUp, updated_at: now,
  }).eq('id', live.id).select('*').single();

  res.json({ call, case: updated || live });
}));

// Load a case the caller owns (or any case, for superadmin).
async function ownCase(req, res, access) {
  if (!access.canWork) { res.status(403).json({ error: 'Only a support agent can change a case' }); return null; }
  if (!safeUuid(req.params.id)) { res.status(404).json({ error: 'Case not found' }); return null; }
  const { data: c } = await supabaseAdmin.from('retention_cases').select('*').eq('id', req.params.id).maybeSingle();
  if (!c || (access.isAgent && c.agent_id !== req.user.id)) { res.status(404).json({ error: 'Case not found' }); return null; }
  return c;
}

// ── POST /support/cases/:id/status -- saved | lost | open ───────────────────
router.post('/cases/:id/status', gate(async (req, res, access) => {
  const c = await ownCase(req, res, access); if (!c) return;
  const status = String(req.body?.status || '');
  const reason = String(req.body?.reason || '').trim();
  const now = new Date().toISOString();

  if (!['open', 'saved', 'returned'].includes(c.status)) {
    return res.status(409).json({ error: c.status === 'pending_approval' ? 'This case is with compliance for approval' : 'This case is closed' });
  }

  let patch;
  if (status === 'saved') {
    if (!c.call_count) return res.status(400).json({ error: 'Log at least one call before marking the customer saved' });
    if (reason.length < 10) return res.status(400).json({ error: 'Write how the customer was saved (what they agreed to)' });
    patch = { status: 'saved', save_reason: reason, saved_at: now, lost_reason: null };
  } else if (status === 'lost') {
    if (reason.length < 5) return res.status(400).json({ error: 'Write why the customer could not be saved' });
    patch = { status: 'lost', lost_reason: reason, next_follow_up_at: null };
  } else if (status === 'open') {
    if (c.status !== 'saved') return res.status(400).json({ error: 'Only a saved case can be reopened' });
    patch = { status: 'open', saved_at: null };
  } else {
    return res.status(400).json({ error: 'Unknown status' });
  }

  const { data, error } = await supabaseAdmin.from('retention_cases')
    .update({ ...patch, updated_at: now }).eq('id', c.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ case: data });
}));

// ── POST /support/cases/:id/submit -- send a saved case to compliance ───────
router.post('/cases/:id/submit', gate(async (req, res, access) => {
  const c = await ownCase(req, res, access); if (!c) return;
  if (c.status !== 'saved') return res.status(409).json({ error: 'Mark the customer saved first, then send it to compliance' });
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('retention_cases')
    .update({ status: 'pending_approval', submitted_at: now, review_note: null, reviewed_by: null, reviewed_at: null, updated_at: now })
    .eq('id', c.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });

  // Tell compliance. Never let a failed bell undo the submit.
  try {
    const companyId = req.user.company_id;
    const ids = companyId ? await notifications.getUserIdsByLevel(companyId, ['compliance_manager']) : [];
    await notifications.notifyUsers(ids, {
      companyId, type: 'support_case_submitted',
      title: 'Saved customer waiting for approval',
      message: `${c.customer_name || 'A customer'} (${c.client_name || 'client'}) was saved by support and needs your final approval.`,
      data: { case_id: c.id, sale_id: c.sale_id },
    });
  } catch (e) { logger.warn('SUPPORT', `submit notify failed: ${e.message}`); }

  res.json({ case: data });
}));

// ── POST /support/cases/:id/review -- compliance: approve | return ──────────
router.post('/cases/:id/review', gate(async (req, res, access) => {
  if (!access.isReviewer) return res.status(403).json({ error: 'Only compliance can approve a saved customer' });
  if (!safeUuid(req.params.id)) return res.status(404).json({ error: 'Case not found' });
  const decision = String(req.body?.decision || '');
  const note = String(req.body?.note || '').trim();
  if (!['approve', 'return'].includes(decision)) return res.status(400).json({ error: 'Unknown decision' });
  if (decision === 'return' && note.length < 5) return res.status(400).json({ error: 'Tell the agent what is missing' });

  const { data: c } = await supabaseAdmin.from('retention_cases').select('*').eq('id', req.params.id).maybeSingle();
  if (!c) return res.status(404).json({ error: 'Case not found' });
  if (c.status !== 'pending_approval') return res.status(409).json({ error: 'This case is not waiting for approval' });

  const now = new Date().toISOString();
  let reinstated = false;

  if (decision === 'approve' && c.sale_id) {
    const { data: sale } = await supabaseAdmin.from('sales').select('id, status').eq('id', c.sale_id).maybeSingle();
    // Only a cancelled sale has anything to bring back. An active policy that
    // was saved BEFORE it cancelled is approved as a case and left alone.
    if (sale && CANCELLED.includes(sale.status)) {
      const { error: sErr } = await supabaseAdmin.from('sales').update({
        status: 'closed_won',
        cancellation_date: null,
        cancellation_reason_key: null,
        reinstated_at: now,
        reinstated_by: c.agent_id,
        reinstate_reason: c.save_reason,
        last_modified_by: req.user.id,
        updated_at: now,
      }).eq('id', sale.id);
      if (sErr) return res.status(500).json({ error: `Could not reinstate the sale: ${sErr.message}` });
      reinstated = true;
    }
  }

  const { data, error } = await supabaseAdmin.from('retention_cases').update({
    status: decision === 'approve' ? 'approved' : 'returned',
    reviewed_by: req.user.id, reviewed_at: now, review_note: note || null,
    sale_reinstated: reinstated, next_follow_up_at: null, updated_at: now,
  }).eq('id', c.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });

  try {
    await notifications.createNotification({
      userId: c.agent_id, companyId: req.user.company_id || c.company_id,
      type: decision === 'approve' ? 'support_case_approved' : 'support_case_returned',
      title: decision === 'approve' ? 'Saved customer approved' : 'Saved customer sent back',
      message: decision === 'approve'
        ? `${c.customer_name || 'Your customer'} was approved by compliance${reinstated ? ' and the policy is active again' : ''}.`
        : `${c.customer_name || 'Your customer'} was sent back: ${note}`,
      data: { case_id: c.id, sale_id: c.sale_id },
    });
  } catch (e) { logger.warn('SUPPORT', `review notify failed: ${e.message}`); }

  res.json({ case: data, sale_reinstated: reinstated });
}));

// ── GET /support/reports -- per-agent numbers + the call log ────────────────
// An agent gets their own numbers only. Days are US Eastern, like every report.
router.get('/reports', gate(async (req, res, access) => {
  const today = todayEt();
  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_from || '') ? req.query.date_from : `${today.slice(0, 8)}01`;
  const dateTo   = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_to || '')   ? req.query.date_to   : today;
  const from = etDateToUtcStart(dateFrom), to = etDateToUtcEnd(dateTo);
  const onlyAgent = access.isAgent ? req.user.id
    : (req.query.agent_id && safeUuid(req.query.agent_id) ? req.query.agent_id : null);

  const pageAll = async (build) => {
    const out = [];
    for (let p = 0; p < 30; p++) {
      const { data, error } = await build().range(p * 1000, p * 1000 + 999);
      if (error) throw new Error(error.message);
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out;
  };
  const who = (q) => (onlyAgent ? q.eq('agent_id', onlyAgent) : q);

  const [calls, cases] = await Promise.all([
    pageAll(() => who(supabaseAdmin.from('retention_calls')
      .select('id, case_id, sale_id, agent_id, outcome, notes, follow_up_at, called_at')
      .gte('called_at', from).lte('called_at', to)).order('called_at', { ascending: false })),
    // Every case that MOVED in the window: opened, saved, submitted or reviewed.
    pageAll(() => who(supabaseAdmin.from('retention_cases')
      .select('id, sale_id, agent_id, client_name, customer_name, reference_no, status, created_at, saved_at, submitted_at, reviewed_at, sale_reinstated, call_count, updated_at')
      .or(`created_at.gte."${from}",saved_at.gte."${from}",submitted_at.gte."${from}",reviewed_at.gte."${from}",updated_at.gte."${from}"`))
      .order('updated_at', { ascending: false })),
  ]);

  const fromMs = Date.parse(from), toMs = Date.parse(to);
  const inWin = (t) => { if (!t) return false; const ms = Date.parse(t); return ms >= fromMs && ms <= toMs; };
  const blank = () => ({ calls: 0, customers: 0, opened: 0, saved: 0, submitted: 0, approved: 0, reinstated: 0, returned: 0, lost: 0, pending: 0 });
  const by = {};
  const row = (id) => (by[id] = by[id] || { ...blank(), _cust: new Set() });

  calls.forEach(c => { const r = row(c.agent_id); r.calls++; r._cust.add(c.case_id); });
  cases.forEach(c => {
    const r = row(c.agent_id);
    if (inWin(c.created_at))   r.opened++;
    if (inWin(c.saved_at))     r.saved++;
    if (inWin(c.submitted_at)) r.submitted++;
    if (c.status === 'approved' && inWin(c.reviewed_at)) { r.approved++; if (c.sale_reinstated) r.reinstated++; }
    if (c.status === 'returned' && inWin(c.reviewed_at)) r.returned++;
    if (c.status === 'lost'     && inWin(c.updated_at))  r.lost++;
    if (c.status === 'pending_approval') r.pending++;
  });

  const names = await namesOf(Object.keys(by));
  const agents = Object.entries(by).map(([id, r]) => {
    const { _cust, ...rest } = r;
    const decided = rest.approved + rest.lost;
    return {
      agent_id: id, name: names[id] || 'Unknown', ...rest, customers: _cust.size,
      save_rate: decided ? Math.round((rest.approved / decided) * 100) : null,
    };
  }).sort((a, b) => b.approved - a.approved || b.saved - a.saved || b.calls - a.calls);

  const totals = agents.reduce((t, a) => {
    Object.keys(blank()).forEach(k => { t[k] += a[k] || 0; });
    return t;
  }, blank());

  const caseBy = Object.fromEntries(cases.map(c => [c.id, c]));
  const outcomeLabel = Object.fromEntries(OUTCOMES.map(o => [o.key, o.label]));
  const outcomes = {};
  calls.forEach(c => { outcomes[c.outcome] = (outcomes[c.outcome] || 0) + 1; });

  // The call log needs the customer even when the case itself did not move in
  // the window in a way the .or() above caught.
  const missing = [...new Set(calls.map(c => c.case_id).filter(id => !caseBy[id]))];
  for (let i = 0; i < missing.length; i += 100) {
    const { data } = await supabaseAdmin.from('retention_cases')
      .select('id, client_name, customer_name, reference_no, status').in('id', missing.slice(i, i + 100));
    (data || []).forEach(c => { caseBy[c.id] = c; });
  }

  res.json({
    range: { date_from: dateFrom, date_to: dateTo },
    agents, totals,
    outcomes: Object.entries(outcomes).map(([key, n]) => ({ key, label: outcomeLabel[key] || key, count: n }))
      .sort((a, b) => b.count - a.count),
    calls: calls.slice(0, 500).map(c => ({
      ...c,
      outcome_label: outcomeLabel[c.outcome] || c.outcome,
      agent_name: names[c.agent_id] || null,
      customer_name: caseBy[c.case_id]?.customer_name || null,
      client_name: caseBy[c.case_id]?.client_name || null,
      reference_no: caseBy[c.case_id]?.reference_no || null,
      case_status: caseBy[c.case_id]?.status || null,
    })),
    calls_total: calls.length,
  });
}));

// ── GET /support/agents -- every support agent and the clients they work ────
router.get('/agents', gate(async (req, res, access) => {
  if (!access.isViewer) return res.status(403).json({ error: 'Not permitted' });
  const { data: ucr, error } = await supabaseAdmin
    .from('user_company_roles')
    .select('user_id, company_id, is_active, custom_roles!inner(level), companies(name)')
    .eq('custom_roles.level', 'support_agent');
  if (error) return res.status(500).json({ error: error.message });
  const rows = (ucr || []).filter(r => r.is_active);
  const ids = [...new Set(rows.map(r => r.user_id))];
  const [names, clientRows] = await Promise.all([
    namesOf(ids),
    ids.length
      ? supabaseAdmin.from('support_agent_clients').select('user_id, client_name').in('user_id', ids)
      : Promise.resolve({ data: [] }),
  ]);
  const clientsBy = {};
  (clientRows.data || []).forEach(r => { (clientsBy[r.user_id] = clientsBy[r.user_id] || []).push(r.client_name); });
  res.json({
    agents: ids.map(id => ({
      user_id: id, name: names[id] || 'Unknown',
      company: rows.find(r => r.user_id === id)?.companies?.name || null,
      clients: (clientsBy[id] || []).sort(),
    })).sort((a, b) => a.name.localeCompare(b.name)),
  });
}));

// ── PUT /support/agents/:userId/clients -- set an agent's clients ───────────
router.put('/agents/:userId/clients', gate(async (req, res, access) => {
  if (!access.isReviewer) return res.status(403).json({ error: 'Only a superadmin or compliance can assign clients' });
  const userId = req.params.userId;
  if (!safeUuid(userId)) return res.status(404).json({ error: 'Agent not found' });
  const wanted = [...new Set((Array.isArray(req.body?.clients) ? req.body.clients : [])
    .map(c => String(c || '').trim()).filter(Boolean))];

  // The target must actually be a support agent -- this table is what opens
  // customer records, so it is never written for anyone else.
  const { data: isAgent } = await supabaseAdmin
    .from('user_company_roles').select('user_id, custom_roles!inner(level)')
    .eq('user_id', userId).eq('is_active', true).eq('custom_roles.level', 'support_agent').limit(1);
  if (!isAgent?.length) return res.status(400).json({ error: 'That user is not a support agent' });

  // Only real client names (the spelling on sales is the one the scope matches).
  const { data: known } = await supabaseAdmin.from('app_sale_client_names').select('client_name');
  const knownSet = new Set((known || []).map(r => r.client_name));
  const bad = wanted.filter(c => !knownSet.has(c));
  if (bad.length) return res.status(400).json({ error: `Unknown client: ${bad.join(', ')}` });

  const { error: delErr } = await supabaseAdmin.from('support_agent_clients').delete().eq('user_id', userId);
  if (delErr) return res.status(500).json({ error: delErr.message });
  if (wanted.length) {
    const { error: insErr } = await supabaseAdmin.from('support_agent_clients')
      .insert(wanted.map(c => ({ user_id: userId, client_name: c, assigned_by: req.user.id })));
    if (insErr) return res.status(500).json({ error: insErr.message });
  }
  logger.info('SUPPORT', `clients for ${userId} set to [${wanted.join(', ')}] by ${req.user.id}`);
  res.json({ user_id: userId, clients: wanted.sort() });
}));

module.exports = router;
