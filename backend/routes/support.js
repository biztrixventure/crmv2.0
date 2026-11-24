// ============================================================================
// /api/support -- customer retention (migs 355-357).
//
// A SUPPORT AGENT works for named clients. They call that client's customers
// (the cancelled ones and the still-active ones), log every call, schedule
// follow-ups, and mark the customer Saved or Not Saved. They can also TAG a
// closer on a policy, which puts it in that closer's Support Requests.
//
// THE SUPPORT DESK NEVER CHANGES A SALE. There was a compliance approval step
// that reinstated the sale (mig 356); the operator removed it (mig 357). Saved
// is a fact about the retention case and shows in the support reports only --
// the sale's own status is changed the normal way, by whoever does that.
//
// Who may do what, decided here and nowhere else:
//   support_agent      -> policies of THEIR clients (support_agent_clients),
//                         their own cases, calls, tags and stats. No row in
//                         support_agent_clients = they see nothing.
//   compliance_manager -> reads every client and the reports; may set which
//                         clients an agent works.
//   superadmin         -> everything above, and may also work a case.
//   readonly_admin     -> reads the reports (writes are refused by
//                         readonlyGuard at the mount).
//   a tagged closer    -> ONLY /support/tags/mine and /support/tags/:id/done,
//                         and only the tags that name them.
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
const { getConfig, setConfig } = require('../utils/businessConfig');
const { isDesignated } = require('../utils/moduleAccess');

const router = express.Router();

// What a call can end as. The key is stored; the label is what people read;
// `tone` is the row colour in the support lists (support.css .sx-tone-*).
const OUTCOMES = [
  { key: 'agreed',        label: 'Agreed to Stay',      tone: 'green' },
  { key: 'callback',      label: 'Callback Requested',  tone: 'blue' },
  { key: 'spoke',         label: 'Spoke - Undecided',   tone: 'yellow' },
  { key: 'payment_issue', label: 'Payment Issue',       tone: 'orange' },
  { key: 'no_answer',     label: 'No Answer',           tone: 'grey' },
  { key: 'voicemail',     label: 'Left Voicemail',      tone: 'purple' },
  { key: 'refused',       label: 'Refused / Wants Out', tone: 'red' },
  { key: 'wrong_number',  label: 'Wrong Number',        tone: 'brown' },
  { key: 'other',         label: 'Other',               tone: 'none' },
];
const OUTCOME_KEYS = new Set(OUTCOMES.map(o => o.key));
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES.map(o => [o.key, o.label]));

// ── colours ─────────────────────────────────────────────────────────────────
// The support lists are colour-coded and a superadmin picks the colours
// (Support Reports -> Colours). Stored whole in business_config
// 'support.colors' (global); anything missing or malformed falls back to the
// default below, so a half-saved or hand-edited value can never blank a list.
// An outcome may be '' (no colour); a status always has one.
const DEFAULT_COLORS = {
  status: { saved: '#22c55e', open: '#38bdf8', lost: '#e23636' },
  outcomes: {
    agreed: '#8fe6d3', callback: '#b9c2ff', spoke: '#ffe75e', payment_issue: '#ffb561',
    no_answer: '#cdd3da', voicemail: '#deb0f7', refused: '#ff9c9c', wrong_number: '#d8ae88', other: '',
  },
};
const HEX = /^#[0-9a-f]{6}$/;
const cleanColors = (raw) => {
  const out = { status: { ...DEFAULT_COLORS.status }, outcomes: { ...DEFAULT_COLORS.outcomes } };
  const pick = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : null);
  for (const k of Object.keys(out.status)) {
    const v = pick(raw?.status?.[k]);
    if (v && HEX.test(v)) out.status[k] = v;
  }
  for (const k of Object.keys(out.outcomes)) {
    const v = pick(raw?.outcomes?.[k]);
    if (v === '' || (v && HEX.test(v))) out.outcomes[k] = v;
  }
  return out;
};
const loadColors = async () => cleanColors(await getConfig(null, 'support.colors', null));

// What the tagged closer answers with. A request cannot be closed without one:
// "done" alone told the support agent nothing about what happened.
const TAG_RESULTS = [
  { key: 'sorted',     label: 'Spoke to customer - sorted' },
  { key: 'still_out',  label: 'Spoke to customer - still wants out' },
  { key: 'no_answer',  label: 'Could not reach the customer' },
  { key: 'other',      label: 'Other' },
];
const TAG_RESULT_LABEL = Object.fromEntries(TAG_RESULTS.map(r => [r.key, r.label]));

const CANCELLED = ['cancelled', 'compliance_cancelled'];
// A case that still holds its customer. `saved` stays held so the agent who
// saved them can log a later check-in call without opening a second case.
const LIVE_CASE = ['open', 'saved'];

// Columns the policy screen shows. Named, never '*': a new sales column must be
// a decision to show it to a support agent, not an accident.
const SALE_BASE_COLS = 'id, customer_name, customer_phone, client_name, plan, status, sale_date, cancellation_date, cancellation_reason_key, reference_no, policy_number, car_year, car_make, car_model, monthly_payment, down_payment, company_id';
// monthly_date = the day the monthly payment is taken. It lives in form_data.
const SALE_LIST_COLS = SALE_BASE_COLS + ', monthly_date:form_data->>Monthly_Date';
const SALE_DETAIL_COLS = SALE_BASE_COLS + ', customer_phone_2, customer_email, customer_address, car_miles, car_vin, payment_due_note, closer_id, fronter_id, created_at, updated_at, form_data, compliance_note, closer_disposition, is_resell, customer_uuid, chargeback_date, chargeback_amount, transfer_id';
// The only form_data keys that leave the server.
const FORM_KEYS = ['FirstName', 'LastName', 'Middle', 'Address', 'City', 'State', 'Zip', 'Email', 'PlanDuration', 'Payment_Duration', 'Monthly_Date', 'Condition', 'Age', 'Variant', 'Other_Contact', '2nd_user', 'Miles'];

// Click-to-sort: the screen sends a column KEY, never a column name. Anything
// not listed here falls back to the list's default order.
const POLICY_SORT = {
  customer: ['customer_name'], phone: ['customer_phone'], client: ['client_name'],
  vehicle: ['car_make', 'car_model', 'car_year'], coverage: ['plan'],
  effective: ['sale_date'], cancelled: ['cancellation_date'], monthly: ['monthly_payment'],
  monthly_date: ['form_data->>Monthly_Date'], policy: ['reference_no'], status: ['status'],
};
const CASE_SORT = {
  customer: ['customer_name'], client: ['client_name'], policy: ['reference_no'],
  status: ['status'], outcome: ['last_outcome'], calls: ['call_count'],
  last_call: ['last_call_at'], follow_up: ['next_follow_up_at'], updated: ['updated_at'],
};
const applySort = (q, map, key, dir, fallback) => {
  const cols = map[key];
  if (!cols) return fallback(q);
  const ascending = dir !== 'desc';
  cols.forEach(c => { q = q.order(c, { ascending, nullsFirst: false }); });
  return q.order('id', { ascending: true });      // stable paging on ties
};

// ── who is asking ───────────────────────────────────────────────────────────
async function resolveAccess(req) {
  const role = req.user.role;
  const isAgent    = role === 'support_agent';
  // A support MANAGER (mig 358) is a person, not a role: a superadmin switches
  // it on in User Control Center -> Modules and they get the admin view of the
  // desk while keeping the role and shell they already have.
  const isManager  = await isDesignated(req.user.id, 'support');
  const isReviewer = role === 'superadmin' || role === 'compliance_manager' || isManager;
  const isViewer   = isReviewer || role === 'readonly_admin';
  let clients = null;                       // null = every client
  if (isAgent && !isManager) {
    const { data } = await supabaseAdmin
      .from('support_agent_clients').select('client_name').eq('user_id', req.user.id);
    clients = (data || []).map(r => r.client_name);
  }
  return {
    role, isAgent, isManager, isReviewer, isViewer, clients,
    canColors: role === 'superadmin' || isManager,
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

// Latest case per sale id (a live one wins over a closed one).
async function casesForSales(saleIds) {
  const by = {};
  for (let i = 0; i < saleIds.length; i += 100) {
    const { data } = await supabaseAdmin
      .from('retention_cases')
      .select('id, sale_id, agent_id, status, last_outcome, call_count, last_call_at, next_follow_up_at, updated_at')
      .in('sale_id', saleIds.slice(i, i + 100))
      .order('created_at', { ascending: true });
    (data || []).forEach(c => {
      const cur = by[c.sale_id];
      if (!cur || LIVE_CASE.includes(c.status) || !LIVE_CASE.includes(cur.status)) by[c.sale_id] = c;
    });
  }
  return by;
}

// Everyone who can be tagged: active closers of the closer companies.
async function taggableClosers() {
  const { data, error } = await supabaseAdmin
    .from('user_company_roles')
    .select('user_id, company_id, is_active, custom_roles!inner(level), companies!inner(name, company_type)')
    .eq('custom_roles.level', 'closer').eq('companies.company_type', 'closer').eq('is_active', true);
  if (error) throw new Error(error.message);
  const rows = data || [];
  const names = await namesOf(rows.map(r => r.user_id));
  const seen = new Set();
  return rows
    .filter(r => (seen.has(r.user_id) ? false : (seen.add(r.user_id), true)))
    .map(r => ({ user_id: r.user_id, name: names[r.user_id] || 'Unknown', company_id: r.company_id, company: r.companies?.name || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── GET /support/my-access -- may I open the admin view? ────────────────────
// NOT behind gate(): every shell asks this to decide whether to show Support
// Reports, and for most people the answer is simply no. The token cannot
// carry it -- it is a per-person switch (mig 358).
router.get('/my-access', asyncHandler(async (req, res) => {
  res.json({ manager: await isDesignated(req.user.id, 'support') });
}));

// ── GET /support/me ─────────────────────────────────────────────────────────
router.get('/me', gate(async (req, res, access) => {
  res.json({
    role: access.role,
    clients: access.clients,                // null = all clients
    can_work: access.canWork,
    can_assign: access.isReviewer,
    can_report: access.isViewer,
    can_colors: access.canColors,
    manager: access.isManager,
    outcomes: OUTCOMES,
    colors: await loadColors(),
    default_colors: DEFAULT_COLORS,
  });
}));

// ── PUT /support/colors -- superadmin sets the list colours ─────────────────
// { reset: true } goes back to the defaults.
router.put('/colors', gate(async (req, res, access) => {
  if (!access.canColors) return res.status(403).json({ error: 'Only a superadmin or a support manager can change the colours' });
  if (req.body?.reset) {
    // businessConfig refuses to DELETE a global key, so a reset writes the
    // defaults back as the value.
    const defaults = cleanColors(null);
    await setConfig('global', 'support.colors', defaults, req.user.id);
    return res.json({ colors: defaults });
  }
  const bad = [];
  const check = (group, allowEmpty) => Object.entries(req.body?.[group] || {}).forEach(([k, v]) => {
    if (!(k in DEFAULT_COLORS[group])) return;
    const x = String(v ?? '').trim().toLowerCase();
    if (!(HEX.test(x) || (allowEmpty && x === ''))) bad.push(k);
  });
  check('status', false); check('outcomes', true);
  if (bad.length) return res.status(400).json({ error: `Not a colour: ${bad.join(', ')}` });
  const colors = cleanColors(req.body);
  await setConfig('global', 'support.colors', colors, req.user.id);
  res.json({ colors });
}));

// ── GET /support/clients -- every client name on a sale ─────────────────────
router.get('/clients', gate(async (req, res, access) => {
  if (!access.isViewer) return res.json({ clients: access.clients || [] });
  const { data, error } = await supabaseAdmin.from('app_sale_client_names').select('client_name');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ clients: [...new Set((data || []).map(r => r.client_name).filter(Boolean))].sort() });
}));

// ── GET /support/closers -- who can be tagged ───────────────────────────────
router.get('/closers', gate(async (req, res) => {
  res.json({ closers: (await taggableClosers()).map(({ user_id, name, company }) => ({ user_id, name, company })) });
}));

// ── GET /support/policies -- the work list ──────────────────────────────────
// view = cancelled | active | all.  search = phone digits, or name / reference
// / policy number / VIN.  sort = a POLICY_SORT key, dir = asc | desc.
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

  q = applySort(q, POLICY_SORT, String(req.query.sort || ''), String(req.query.dir || ''), (x) => (view === 'active'
    ? x.order('sale_date', { ascending: false, nullsFirst: false }).order('id', { ascending: true })
    : x.order('cancellation_date', { ascending: false, nullsFirst: false }).order('sale_date', { ascending: false }).order('id', { ascending: true })));
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

// ── GET /support/cases -- retention cases (mine, or everyone's for a viewer) ─
// view = mine (in progress) | followups | saved | lost.  sort = a CASE_SORT key.
router.get('/cases', gate(async (req, res, access) => {
  const view  = String(req.query.view || 'mine');
  const page  = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

  let q = supabaseAdmin.from('retention_cases')
    .select('id, sale_id, agent_id, client_name, customer_name, reference_no, status, last_outcome, save_reason, lost_reason, saved_at, call_count, last_call_at, next_follow_up_at, created_at, updated_at', { count: 'exact' });
  if (access.isAgent) q = q.eq('agent_id', req.user.id);
  else if (req.query.agent_id && safeUuid(req.query.agent_id)) q = q.eq('agent_id', req.query.agent_id);

  let fallback;
  if (view === 'followups') {
    q = q.in('status', LIVE_CASE).not('next_follow_up_at', 'is', null);
    fallback = (x) => x.order('next_follow_up_at', { ascending: true }).order('id', { ascending: true });
  } else if (view === 'saved' || view === 'lost') {
    q = q.eq('status', view);
    fallback = (x) => x.order('updated_at', { ascending: false }).order('id', { ascending: true });
  } else {
    q = q.eq('status', 'open');
    fallback = (x) => x.order('updated_at', { ascending: false }).order('id', { ascending: true });
  }
  q = applySort(q, CASE_SORT, String(req.query.sort || ''), String(req.query.dir || ''), fallback);
  const { data, error, count } = await q.range((page - 1) * limit, page * limit - 1);
  if (error) return res.status(500).json({ error: error.message });

  const cases = data || [];
  const saleIds = cases.map(c => c.sale_id).filter(Boolean);
  const saleBy = {};
  for (let i = 0; i < saleIds.length; i += 100) {
    const { data: s } = await supabaseAdmin.from('sales').select(SALE_LIST_COLS).in('id', saleIds.slice(i, i + 100));
    (s || []).forEach(x => { saleBy[x.id] = x; });
  }
  const names = await namesOf(cases.map(c => c.agent_id));
  res.json({
    total: count || 0, page, limit,
    cases: cases.map(c => ({ ...c, agent_name: names[c.agent_id] || null, sale: saleBy[c.sale_id] || null })),
  });
}));

// ── GET /support/policies/:saleId -- everything on one policy ───────────────
router.get('/policies/:saleId', gate(async (req, res, access) => {
  if (!safeUuid(req.params.saleId)) return res.status(404).json({ error: 'Policy not found' });
  const { data: sale } = await supabaseAdmin
    .from('sales').select(SALE_DETAIL_COLS).eq('id', req.params.saleId).maybeSingle();
  if (!mayTouchSale(sale, access)) return res.status(404).json({ error: 'Policy not found' });

  const [casesRes, callsRes, eventsRes, othersRes, companyRes, tagsRes] = await Promise.all([
    supabaseAdmin.from('retention_cases').select('*').eq('sale_id', sale.id).order('created_at', { ascending: false }),
    supabaseAdmin.from('retention_calls').select('*').eq('sale_id', sale.id).order('called_at', { ascending: false }),
    supabaseAdmin.from('policy_events').select('id, event_type, at, actor_id, note').eq('sale_id', sale.id).order('at', { ascending: false }).limit(100),
    sale.customer_uuid
      ? scopeSales(supabaseAdmin.from('sales').select(SALE_LIST_COLS).eq('customer_uuid', sale.customer_uuid), access)
          .order('sale_date', { ascending: false }).limit(25)
      : supabaseAdmin.from('sales').select(SALE_LIST_COLS).eq('id', sale.id),
    sale.company_id
      ? supabaseAdmin.from('companies').select('name').eq('id', sale.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from('retention_tags').select('*').eq('sale_id', sale.id).order('created_at', { ascending: false }),
  ]);

  const cases = casesRes.data || [];
  const calls = callsRes.data || [];
  const events = eventsRes.data || [];
  const tags = tagsRes.data || [];
  const names = await namesOf([
    sale.closer_id, sale.fronter_id,
    ...cases.map(c => c.agent_id), ...calls.map(c => c.agent_id), ...events.map(e => e.actor_id),
    ...tags.flatMap(t => [t.tagged_user_id, t.tagged_by]),
  ]);

  const fd = sale.form_data || {};
  const form = {};
  FORM_KEYS.forEach(k => { if (fd[k] !== undefined && fd[k] !== null && fd[k] !== '') form[k] = fd[k]; });
  const { form_data: _drop, ...saleOut } = sale;

  const live = cases.find(c => LIVE_CASE.includes(c.status)) || null;
  const decorate = (c) => ({ ...c, agent_name: names[c.agent_id] || null });
  res.json({
    policy: {
      ...saleOut,
      form,
      closer_name: names[sale.closer_id] || null,
      fronter_name: names[sale.fronter_id] || null,
      company_name: companyRes.data?.name || null,
    },
    case: live ? decorate(live) : null,
    cases: cases.map(decorate),
    calls: calls.map(c => ({ ...c, agent_name: names[c.agent_id] || null })),
    tags: tags.map(t => ({ ...t, tagged_name: names[t.tagged_user_id] || null, tagged_by_name: names[t.tagged_by] || null })),
    history: events.map(e => ({ ...e, actor_name: names[e.actor_id] || null })),
    other_policies: (othersRes.data || []),
    // Can THIS caller log a call right now, and if not, why.
    work: {
      can: access.canWork && (!live || live.agent_id === req.user.id),
      reason: !access.canWork ? 'view_only' : live && live.agent_id !== req.user.id ? 'other_agent' : null,
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

  // follow_up_notified_at is cleared with every call: a new follow-up time is a
  // new reminder, and no follow-up means there is nothing left to ring for.
  const { data: updated } = await supabaseAdmin.from('retention_cases').update({
    call_count: (live.call_count || 0) + 1, last_call_at: now, last_outcome: outcome,
    next_follow_up_at: followUp, follow_up_notified_at: null, updated_at: now,
  }).eq('id', live.id).select('*').single();

  res.json({ call, case: updated || live });
}));

// ── POST /support/cases/:id/status -- saved | lost | open ───────────────────
// Saved and Not Saved are where a case ends. Neither touches the sale.
router.post('/cases/:id/status', gate(async (req, res, access) => {
  if (!access.canWork) return res.status(403).json({ error: 'Only a support agent can change a case' });
  if (!safeUuid(req.params.id)) return res.status(404).json({ error: 'Case not found' });
  const { data: c } = await supabaseAdmin.from('retention_cases').select('*').eq('id', req.params.id).maybeSingle();
  if (!c || (access.isAgent && c.agent_id !== req.user.id)) return res.status(404).json({ error: 'Case not found' });

  const status = String(req.body?.status || '');
  const reason = String(req.body?.reason || '').trim();
  const now = new Date().toISOString();

  let patch;
  if (status === 'saved') {
    if (c.status !== 'open') return res.status(409).json({ error: 'Only a case in progress can be marked saved' });
    if (!c.call_count) return res.status(400).json({ error: 'Log at least one call before marking the customer saved' });
    if (reason.length < 10) return res.status(400).json({ error: 'Write a note: what the customer agreed to' });
    patch = { status: 'saved', save_reason: reason, saved_at: now, lost_reason: null, next_follow_up_at: null };
  } else if (status === 'lost') {
    if (!LIVE_CASE.includes(c.status)) return res.status(409).json({ error: 'This case is already closed' });
    if (reason.length < 5) return res.status(400).json({ error: 'Write why the customer could not be saved' });
    patch = { status: 'lost', lost_reason: reason, saved_at: null, next_follow_up_at: null };
  } else if (status === 'open') {
    if (c.status === 'open') return res.status(409).json({ error: 'This case is already in progress' });
    patch = { status: 'open', saved_at: null };
  } else {
    return res.status(400).json({ error: 'Unknown status' });
  }

  const { data, error } = await supabaseAdmin.from('retention_cases')
    .update({ ...patch, updated_at: now }).eq('id', c.id).select('*').single();
  // Reopening a Not Saved case while someone else has since started on the
  // customer hits the one-live-case index.
  if (error?.code === '23505') return res.status(409).json({ error: 'Another support agent is working this customer now', code: 'OTHER_AGENT' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ case: data });
}));

// ── POST /support/policies/:saleId/tags -- tag a closer on a policy ─────────
router.post('/policies/:saleId/tags', gate(async (req, res, access) => {
  if (!access.canWork) return res.status(403).json({ error: 'Only a support agent can tag a closer' });
  if (!safeUuid(req.params.saleId)) return res.status(404).json({ error: 'Policy not found' });
  const target = String(req.body?.user_id || '');
  const note = String(req.body?.note || '').trim();
  if (!safeUuid(target)) return res.status(400).json({ error: 'Pick the closer to tag' });
  if (note.length < 3) return res.status(400).json({ error: 'Write what you need the closer to do' });

  const { data: sale } = await supabaseAdmin
    .from('sales').select('id, client_name, customer_name, reference_no, policy_number')
    .eq('id', req.params.saleId).maybeSingle();
  if (!mayTouchSale(sale, access)) return res.status(404).json({ error: 'Policy not found' });

  // The target must really be a closer -- a tag opens this customer's record to
  // whoever is named on it.
  const closer = (await taggableClosers()).find(c => c.user_id === target);
  if (!closer) return res.status(400).json({ error: 'That user is not an active closer' });

  const { data: live } = await supabaseAdmin
    .from('retention_cases').select('id').eq('sale_id', sale.id).in('status', LIVE_CASE).maybeSingle();

  const { data: tag, error } = await supabaseAdmin.from('retention_tags').insert({
    sale_id: sale.id, case_id: live?.id || null, tagged_user_id: target, tagged_by: req.user.id, note,
    client_name: sale.client_name, customer_name: sale.customer_name,
    reference_no: sale.policy_number || sale.reference_no,
  }).select('*').single();
  if (error?.code === '23505') return res.status(409).json({ error: `${closer.name} already has an open tag on this policy`, code: 'ALREADY_TAGGED' });
  if (error) return res.status(500).json({ error: error.message });

  // Bell + push, straight away. A failed notification never undoes the tag --
  // the closer still finds it under Support Requests.
  try {
    const me = (await namesOf([req.user.id]))[req.user.id] || 'Support';
    await notifications.notifyUsers([target], {
      companyId: closer.company_id, type: 'support_tag',
      title: 'Support tagged you on a policy',
      message: `${me}: ${sale.customer_name || 'a customer'}${sale.client_name ? ` (${sale.client_name})` : ''} - ${note}`.slice(0, 400),
      data: { tag_id: tag.id, sale_id: sale.id, tab: 'support_requests' },
    });
  } catch (e) { logger.warn('SUPPORT', `tag notify failed: ${e.message}`); }

  res.json({ tag: { ...tag, tagged_name: closer.name } });
}));

// ── GET /support/tags/mine -- the policies I have been tagged on ────────────
// NOT behind gate(): this is the closer's door. It returns ONLY tags that name
// the caller, with just enough of the sale to act on it.
router.get('/tags/mine', asyncHandler(async (req, res) => {
  const status = ['open', 'done'].includes(req.query.status) ? req.query.status : null;
  let q = supabaseAdmin.from('retention_tags').select('*')
    .eq('tagged_user_id', req.user.id).order('created_at', { ascending: false }).limit(200);
  if (status) q = q.eq('status', status);
  const [{ data, error }, { count: openCount }] = await Promise.all([
    q,
    supabaseAdmin.from('retention_tags').select('id', { count: 'exact', head: true })
      .eq('tagged_user_id', req.user.id).eq('status', 'open'),
  ]);
  if (error) return res.status(500).json({ error: error.message });

  const tags = data || [];
  const saleIds = [...new Set(tags.map(t => t.sale_id).filter(Boolean))];
  const saleBy = {};
  for (let i = 0; i < saleIds.length; i += 100) {
    const { data: s } = await supabaseAdmin.from('sales')
      .select('id, customer_name, customer_phone, customer_phone_2, client_name, plan, status, sale_date, cancellation_date, reference_no, policy_number, car_year, car_make, car_model, monthly_payment, monthly_date:form_data->>Monthly_Date')
      .in('id', saleIds.slice(i, i + 100));
    (s || []).forEach(x => { saleBy[x.id] = x; });
  }
  const names = await namesOf(tags.map(t => t.tagged_by));
  res.json({
    open_count: openCount || 0,
    results: TAG_RESULTS,
    tags: tags.map(t => ({ ...t, tagged_by_name: names[t.tagged_by] || 'Support', sale: saleBy[t.sale_id] || null })),
  });
}));

// ── POST /support/tags/:id/done -- the tagged closer closes it ──────────────
router.post('/tags/:id/done', asyncHandler(async (req, res) => {
  if (!safeUuid(req.params.id)) return res.status(404).json({ error: 'Request not found' });
  const { data: tag } = await supabaseAdmin.from('retention_tags').select('*').eq('id', req.params.id).maybeSingle();
  if (!tag || tag.tagged_user_id !== req.user.id) return res.status(404).json({ error: 'Request not found' });
  if (tag.status === 'done') return res.status(409).json({ error: 'This request is already done' });
  const typed = String(req.body?.note || '').trim();
  const result = String(req.body?.result || '');
  if (!TAG_RESULT_LABEL[result]) return res.status(400).json({ error: 'Pick what happened before closing the request' });
  if (result === 'other' && typed.length < 3) return res.status(400).json({ error: 'Write what happened' });
  // No status column for the result (mig 357 has open | done only), so it leads
  // the note the support agent reads.
  const note = typed ? `${TAG_RESULT_LABEL[result]}: ${typed}` : TAG_RESULT_LABEL[result];

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('retention_tags')
    .update({ status: 'done', closer_note: note || null, done_at: now })
    .eq('id', tag.id).eq('status', 'open').select('*').single();
  if (error) return res.status(500).json({ error: error.message });

  try {
    const me = (await namesOf([req.user.id]))[req.user.id] || 'The closer';
    await notifications.notifyUsers([tag.tagged_by], {
      companyId: req.user.company_id, type: 'support_tag_done',
      title: 'Closer finished your request',
      message: `${me} is done with ${tag.customer_name || 'your customer'}${note ? `: ${note}` : '.'}`.slice(0, 400),
      data: { tag_id: tag.id, sale_id: tag.sale_id },
    });
  } catch (e) { logger.warn('SUPPORT', `tag-done notify failed: ${e.message}`); }

  res.json({ tag: data });
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
  const who = (q, col = 'agent_id') => (onlyAgent ? q.eq(col, onlyAgent) : q);

  const [calls, cases, tags] = await Promise.all([
    pageAll(() => who(supabaseAdmin.from('retention_calls')
      .select('id, case_id, sale_id, agent_id, outcome, notes, follow_up_at, called_at')
      .gte('called_at', from).lte('called_at', to)).order('called_at', { ascending: false })),
    // Every case that MOVED in the window: opened, saved or closed.
    pageAll(() => who(supabaseAdmin.from('retention_cases')
      .select('id, sale_id, agent_id, client_name, customer_name, reference_no, status, created_at, saved_at, call_count, updated_at')
      .or(`created_at.gte."${from}",saved_at.gte."${from}",updated_at.gte."${from}"`))
      .order('updated_at', { ascending: false })),
    pageAll(() => who(supabaseAdmin.from('retention_tags').select('id, tagged_by, status, created_at')
      .gte('created_at', from).lte('created_at', to), 'tagged_by').order('created_at', { ascending: false })),
  ]);

  const fromMs = Date.parse(from), toMs = Date.parse(to);
  const inWin = (t) => { if (!t) return false; const ms = Date.parse(t); return ms >= fromMs && ms <= toMs; };
  const blank = () => ({ calls: 0, customers: 0, opened: 0, saved: 0, lost: 0, in_progress: 0, tags: 0 });
  const by = {};
  const row = (id) => (by[id] = by[id] || { ...blank(), _cust: new Set() });

  calls.forEach(c => { const r = row(c.agent_id); r.calls++; r._cust.add(c.case_id); });
  cases.forEach(c => {
    const r = row(c.agent_id);
    if (inWin(c.created_at)) r.opened++;
    if (c.status === 'saved' && inWin(c.saved_at))   r.saved++;
    if (c.status === 'lost'  && inWin(c.updated_at)) r.lost++;
    if (c.status === 'open') r.in_progress++;
  });
  tags.forEach(t => { row(t.tagged_by).tags++; });

  const names = await namesOf(Object.keys(by));
  const agents = Object.entries(by).map(([id, r]) => {
    const { _cust, ...rest } = r;
    const decided = rest.saved + rest.lost;
    return {
      agent_id: id, name: names[id] || 'Unknown', ...rest, customers: _cust.size,
      save_rate: decided ? Math.round((rest.saved / decided) * 100) : null,
    };
  }).sort((a, b) => b.saved - a.saved || b.calls - a.calls);

  const totals = agents.reduce((t, a) => {
    Object.keys(blank()).forEach(k => { t[k] += a[k] || 0; });
    return t;
  }, blank());
  const decidedAll = totals.saved + totals.lost;
  totals.save_rate = decidedAll ? Math.round((totals.saved / decidedAll) * 100) : null;

  const caseBy = Object.fromEntries(cases.map(c => [c.id, c]));
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
    outcomes: Object.entries(outcomes).map(([key, n]) => ({ key, label: OUTCOME_LABEL[key] || key, count: n }))
      .sort((a, b) => b.count - a.count),
    calls: calls.slice(0, 500).map(c => ({
      ...c,
      outcome_label: OUTCOME_LABEL[c.outcome] || c.outcome,
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
  if (!access.isReviewer) return res.status(403).json({ error: 'Only a superadmin, compliance or a support manager can assign clients' });
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
