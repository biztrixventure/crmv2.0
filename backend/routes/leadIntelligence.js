const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin, hasPermission } = require('../models/helpers');

const router = express.Router();

async function checkAccess(userId, companyId) {
  const sa = await isSuperAdmin(userId);
  if (sa) return { allowed: true, superadmin: true };
  const can = await hasPermission(userId, companyId, 'search_sales');
  return { allowed: can, superadmin: false };
}

// Normalize phone: last 10 digits for grouping
const normPhone = (p) => (p || '').replace(/\D/g, '').slice(-10) || null;

// ─── GET /lead-intelligence/search?q= ───────────────────────────────────────
router.get('/search', asyncHandler(async (req, res) => {
  const userId    = req.user.id;
  const companyId = req.user.company_id;
  const q         = (req.query.q || '').trim();

  if (!q || q.length < 2) return res.json({ groups: [] });

  const { allowed, superadmin } = await checkAccess(userId, companyId);
  if (!allowed) return res.status(403).json({ error: 'Permission denied' });

  const scope = (query, col) => superadmin ? query : query.eq(col, companyId);

  // Parallel search across all three tables
  const [tPhone, tName, sRes, cbRes] = await Promise.all([
    // Transfers: search by phone in form_data
    scope(supabaseAdmin.from('transfers')
      .select('id, form_data, company_id, created_at, status')
      .filter('form_data->>customer_phone', 'ilike', `%${q}%`)
      .limit(25), 'company_id'),

    // Transfers: search by name in form_data
    scope(supabaseAdmin.from('transfers')
      .select('id, form_data, company_id, created_at, status')
      .filter('form_data->>customer_name', 'ilike', `%${q}%`)
      .limit(25), 'company_id'),

    // Sales: search by direct columns
    scope(supabaseAdmin.from('sales')
      .select('id, customer_name, customer_phone, customer_phone_2, customer_email, company_id, created_at, status, reference_no, closer_disposition')
      .or(`customer_phone.ilike.%${q}%,customer_phone_2.ilike.%${q}%,customer_name.ilike.%${q}%,customer_email.ilike.%${q}%,reference_no.ilike.%${q}%`)
      .limit(30), 'company_id'),

    // Callbacks: search by direct columns
    scope(supabaseAdmin.from('callbacks')
      .select('id, customer_name, customer_phone, customer_email, company_id, created_at, status, callback_at')
      .or(`customer_phone.ilike.%${q}%,customer_name.ilike.%${q}%,customer_email.ilike.%${q}%`)
      .limit(25), 'company_id'),
  ]);

  // Merge transfers (dedup by id)
  const seenT = new Set();
  const transfers = [];
  for (const res of [tPhone, tName]) {
    for (const t of (res.data || [])) {
      if (!seenT.has(t.id)) { seenT.add(t.id); transfers.push(t); }
    }
  }

  // Group all results by normalized phone (or email, or name as fallback)
  const groups = {};

  const addToGroup = (type, item, phone, email, name) => {
    const key = normPhone(phone) || email || name || item.id;
    if (!groups[key]) {
      groups[key] = {
        key,
        phone:     phone || null,
        email:     email || null,
        name:      name  || null,
        transfers: [],
        sales:     [],
        callbacks: [],
        companies: new Set(),
        last_activity: null,
      };
    }
    const g = groups[key];
    g[type + 's'].push(item);
    if (item.company_id) g.companies.add(item.company_id);
    if (!g.name  && name)  g.name  = name;
    if (!g.phone && phone) g.phone = phone;
    if (!g.email && email) g.email = email;
    const ts = item.updated_at || item.created_at;
    if (ts && (!g.last_activity || ts > g.last_activity)) g.last_activity = ts;
  };

  transfers.forEach(t => {
    const fd   = t.form_data || {};
    const phone = fd.customer_phone || fd.Phone || '';
    const email = fd.customer_email || fd.Email || '';
    const name  = fd.customer_name  || [fd.FirstName, fd.LastName].filter(Boolean).join(' ') || '';
    addToGroup('transfer', t, phone, email, name);
  });

  (sRes.data || []).forEach(s =>
    addToGroup('sale', s, s.customer_phone, s.customer_email, s.customer_name));

  (cbRes.data || []).forEach(c =>
    addToGroup('callback', c, c.customer_phone, c.customer_email, c.customer_name));

  const result = Object.values(groups)
    .map(g => ({ ...g, companies: [...g.companies], total: g.transfers.length + g.sales.length + g.callbacks.length }))
    .sort((a, b) => (b.last_activity || '').localeCompare(a.last_activity || ''));

  res.json({ groups: result });
}));

// ─── GET /lead-intelligence/profile?phone=&email=&name= ─────────────────────
router.get('/profile', asyncHandler(async (req, res) => {
  const userId    = req.user.id;
  const companyId = req.user.company_id;
  const phone     = (req.query.phone || '').trim();
  const email     = (req.query.email || '').trim();
  const name      = (req.query.name  || '').trim();

  if (!phone && !email && !name) return res.status(400).json({ error: 'phone, email, or name required' });

  const { allowed, superadmin } = await checkAccess(userId, companyId);
  if (!allowed) return res.status(403).json({ error: 'Permission denied' });

  const scope = (q, col) => superadmin ? q : q.eq(col, companyId);

  // Build OR filter for transfers (JSONB)
  const tParts = [];
  if (phone) tParts.push(`form_data->>customer_phone.ilike.%${phone}%`);
  if (email) tParts.push(`form_data->>customer_email.ilike.%${email}%`);
  if (name)  tParts.push(`form_data->>customer_name.ilike.%${name}%`);

  // Build OR filter for sales/callbacks (direct columns)
  const sParts = [];
  if (phone) { sParts.push(`customer_phone.ilike.%${phone}%`); sParts.push(`customer_phone_2.ilike.%${phone}%`); }
  if (email) sParts.push(`customer_email.ilike.%${email}%`);
  if (name)  sParts.push(`customer_name.ilike.%${name}%`);

  const cbParts = [];
  if (phone) cbParts.push(`customer_phone.ilike.%${phone}%`);
  if (email) cbParts.push(`customer_email.ilike.%${email}%`);
  if (name)  cbParts.push(`customer_name.ilike.%${name}%`);

  const fetchTransfers = tParts.length > 0
    ? scope(supabaseAdmin.from('transfers').select('*').or(tParts.join(',')).limit(50), 'company_id')
    : { data: [] };

  const [tRes, sRes, cbRes] = await Promise.all([
    fetchTransfers,
    sParts.length > 0
      ? scope(supabaseAdmin.from('sales').select('*').or(sParts.join(',')).limit(50), 'company_id')
      : { data: [] },
    cbParts.length > 0
      ? scope(supabaseAdmin.from('callbacks').select('*').or(cbParts.join(',')).limit(50), 'company_id')
      : { data: [] },
  ]);

  const transfers = tRes.data || [];
  const sales     = sRes.data || [];
  const callbacks = cbRes.data || [];

  // Collect unique user IDs and company IDs
  const userIds = new Set();
  const coIds   = new Set();

  transfers.forEach(t => {
    if (t.created_by)          userIds.add(t.created_by);
    if (t.assigned_closer_id)  userIds.add(t.assigned_closer_id);
    if (t.company_id)          coIds.add(t.company_id);
  });
  sales.forEach(s => {
    if (s.closer_id)    userIds.add(s.closer_id);
    if (s.submitted_by) userIds.add(s.submitted_by);
    if (s.fronter_id)   userIds.add(s.fronter_id);
    if (s.company_id)   coIds.add(s.company_id);
  });
  callbacks.forEach(c => {
    if (c.user_id)    userIds.add(c.user_id);
    if (c.company_id) coIds.add(c.company_id);
  });

  // Fetch profiles and companies
  const [profilesRes, companiesRes] = await Promise.all([
    userIds.size > 0
      ? supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', [...userIds])
      : { data: [] },
    coIds.size > 0
      ? supabaseAdmin.from('companies').select('id, name, slug').in('id', [...coIds])
      : { data: [] },
  ]);

  const profiles = {};
  (profilesRes.data || []).forEach(p => {
    profiles[p.user_id] = { name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown' };
  });

  const companies = {};
  (companiesRes.data || []).forEach(c => { companies[c.id] = c; });

  // Fetch callback audit logs for all callbacks
  const cbIds = callbacks.map(c => c.id);
  const auditData = cbIds.length > 0
    ? (await supabaseAdmin.from('callback_audit_log').select('*').in('callback_id', cbIds).order('created_at', { ascending: true })).data || []
    : [];

  // ─── Timeline ─────────────────────────────────────────────────────────────
  const timeline = [];

  transfers.forEach(t => {
    const fd = t.form_data || {};
    timeline.push({
      id:          `t_create_${t.id}`,
      type:        'transfer',
      action:      'created',
      label:       'Transfer created',
      detail:      `By ${profiles[t.created_by]?.name || 'Unknown'} → ${companies[t.company_id]?.name || 'Unknown'}`,
      actor:       profiles[t.created_by]?.name || 'Unknown',
      company:     companies[t.company_id]?.name || null,
      occurred_at: t.created_at,
      entity_id:   t.id,
      status:      t.status,
    });
    if (t.assigned_closer_id && t.updated_at && t.updated_at !== t.created_at) {
      timeline.push({
        id:          `t_assign_${t.id}`,
        type:        'transfer',
        action:      'assigned',
        label:       'Assigned to closer',
        detail:      `Closer: ${profiles[t.assigned_closer_id]?.name || 'Unknown'}`,
        actor:       profiles[t.assigned_closer_id]?.name || 'Unknown',
        occurred_at: t.updated_at,
        entity_id:   t.id,
      });
    }
  });

  sales.forEach(s => {
    const actor = s.closer_id || s.submitted_by;
    timeline.push({
      id:          `s_create_${s.id}`,
      type:        'sale',
      action:      'created',
      label:       'Sale created',
      detail:      `By ${profiles[actor]?.name || 'Unknown'} · Ref: ${s.reference_no || '–'}`,
      actor:       profiles[actor]?.name || 'Unknown',
      company:     companies[s.company_id]?.name || null,
      occurred_at: s.created_at,
      entity_id:   s.id,
      status:      s.status,
      reference_no: s.reference_no,
    });
    if (Array.isArray(s.edit_history)) {
      s.edit_history.forEach((h, i) => {
        const actionLabel = h.action === 'approved' ? 'Sale approved'
          : h.action === 'returned' ? 'Sale returned for revision'
          : 'Sale updated';
        timeline.push({
          id:          `s_edit_${s.id}_${i}`,
          type:        'sale',
          action:      h.action || 'updated',
          label:       actionLabel,
          detail:      h.note || h.reason || '',
          actor:       h.editor_name || 'Unknown',
          occurred_at: h.edited_at,
          entity_id:   s.id,
          status:      h.new_status,
        });
      });
    }
  });

  callbacks.forEach(c => {
    timeline.push({
      id:          `cb_create_${c.id}`,
      type:        'callback',
      action:      'scheduled',
      label:       'Callback scheduled',
      detail:      `Due: ${c.callback_at ? new Date(c.callback_at).toLocaleString() : '–'}`,
      actor:       profiles[c.user_id]?.name || 'Unknown',
      company:     companies[c.company_id]?.name || null,
      occurred_at: c.created_at,
      entity_id:   c.id,
      status:      c.status,
    });
  });

  auditData.forEach(l => {
    timeline.push({
      id:          `audit_${l.id}`,
      type:        'callback',
      action:      l.action || 'status_change',
      label:       l.action === 'rescheduled' ? 'Callback rescheduled' : 'Call outcome recorded',
      detail:      l.action === 'rescheduled'
        ? `Rescheduled to ${l.new_callback_at ? new Date(l.new_callback_at).toLocaleString() : '–'}`
        : `${l.old_status} → ${l.new_status}${l.notes ? ' · ' + l.notes : ''}`,
      actor:       profiles[l.actor_id]?.name || 'Unknown',
      occurred_at: l.created_at,
      entity_id:   l.callback_id,
    });
  });

  timeline.sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));

  // ─── Graph ────────────────────────────────────────────────────────────────
  const nodes   = [];
  const edges   = [];
  const nodeSet = new Set();

  const addNode = (id, data) => {
    if (nodeSet.has(id)) return;
    nodeSet.add(id);
    nodes.push({ data: { id, ...data } });
  };
  const addEdge = (source, target, label) => {
    const eid = `${source}__${target}__${label}`;
    if (!edges.find(e => e.data.id === eid)) {
      edges.push({ data: { id: eid, source, target, label } });
    }
  };

  const centerId = `lead_${(phone || email || name).replace(/\W/g, '_')}`;
  addNode(centerId, { label: phone || email || name, type: 'lead' });

  transfers.forEach(t => {
    const fd  = t.form_data || {};
    const nid = `transfer_${t.id}`;
    addNode(nid, { label: `Transfer\n${(fd.customer_name || '').slice(0, 18)}`, type: 'transfer', status: t.status });
    addEdge(centerId, nid, 'transfer');
    if (t.created_by && profiles[t.created_by]) {
      const uid = `user_${t.created_by}`;
      addNode(uid, { label: profiles[t.created_by].name, type: 'agent' });
      addEdge(uid, nid, 'created by');
    }
    if (t.company_id && companies[t.company_id]) {
      const coid = `company_${t.company_id}`;
      addNode(coid, { label: companies[t.company_id].name || companies[t.company_id].slug, type: 'company' });
      addEdge(nid, coid, 'belongs to');
    }
  });

  sales.forEach(s => {
    const nid = `sale_${s.id}`;
    addNode(nid, { label: `Sale\nRef: ${s.reference_no || s.id.slice(0, 6)}`, type: 'sale', status: s.status });
    addEdge(centerId, nid, 'sale');
    const actor = s.closer_id || s.submitted_by;
    if (actor && profiles[actor]) {
      const uid = `user_${actor}`;
      addNode(uid, { label: profiles[actor].name, type: 'agent' });
      addEdge(uid, nid, 'submitted by');
    }
    if (s.company_id && companies[s.company_id]) {
      const coid = `company_${s.company_id}`;
      addNode(coid, { label: companies[s.company_id].name || companies[s.company_id].slug, type: 'company' });
      addEdge(nid, coid, 'belongs to');
    }
    // Link transfer → sale
    if (s.transfer_id && nodeSet.has(`transfer_${s.transfer_id}`)) {
      addEdge(`transfer_${s.transfer_id}`, nid, 'converted to');
    }
  });

  callbacks.forEach(c => {
    const nid = `callback_${c.id}`;
    addNode(nid, { label: `Callback\n${c.status}`, type: 'callback', status: c.status });
    addEdge(centerId, nid, 'callback');
    if (c.user_id && profiles[c.user_id]) {
      const uid = `user_${c.user_id}`;
      addNode(uid, { label: profiles[c.user_id].name, type: 'agent' });
      addEdge(uid, nid, 'owned by');
    }
    if (c.company_id && companies[c.company_id]) {
      const coid = `company_${c.company_id}`;
      addNode(coid, { label: companies[c.company_id].name || companies[c.company_id].slug, type: 'company' });
      addEdge(nid, coid, 'belongs to');
    }
  });

  // ─── Insights ─────────────────────────────────────────────────────────────
  const converted    = sales.filter(s => ['closed_won', 'sold'].includes(s.status)).length;
  const convRate     = sales.length > 0 ? Math.round((converted / sales.length) * 100) : 0;
  const allDates     = [...transfers, ...sales, ...callbacks].map(e => e.updated_at || e.created_at).filter(Boolean);
  const lastActivity = allDates.sort().at(-1) || null;

  const flags = [];
  if (transfers.length + sales.length + callbacks.length > 20)
    flags.push({ type: 'warning', msg: 'High activity volume on this lead' });
  if (coIds.size > 2)
    flags.push({ type: 'info', msg: `Appears in ${coIds.size} companies` });
  if (userIds.size > 4)
    flags.push({ type: 'warning', msg: `Handled by ${userIds.size} different agents` });
  const openSales = sales.filter(s => s.status === 'open').length;
  if (openSales > 1)
    flags.push({ type: 'warning', msg: `${openSales} open/pending sales on this number` });
  const totalEdits = sales.reduce((acc, s) => acc + (Array.isArray(s.edit_history) ? s.edit_history.length : 0), 0);
  if (totalEdits > 5)
    flags.push({ type: 'warning', msg: `${totalEdits} edit events across sale records` });

  res.json({
    phone, email, name,
    transfers, sales, callbacks,
    profiles, companies,
    timeline,
    graph:    { nodes, edges },
    insights: {
      total_transfers: transfers.length,
      total_sales:     sales.length,
      total_callbacks: callbacks.length,
      total_contacts:  transfers.length + callbacks.length,
      converted,
      conv_rate:       convRate,
      companies_count: coIds.size,
      agents_count:    userIds.size,
      last_activity:   lastActivity,
    },
    flags,
  });
}));

module.exports = router;
