const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin, hasPermission } = require('../models/helpers');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function checkAccess(userId, companyId) {
  const sa = await isSuperAdmin(userId);
  if (sa) return { allowed: true, superadmin: true };
  const can = await hasPermission(userId, companyId, 'search_sales');
  return { allowed: can, superadmin: false };
}

// Scope: superadmin sees all companies, others see only theirs
const scopeQ = (query, col, companyId, superadmin) =>
  superadmin ? query : query.eq(col, companyId);

// Extract customer fields from transfer form_data — handles FormBuilder key conventions
// FormBuilder defaults to "Phone", "FirstName", "LastName", "Email"
// Some forms use "customer_phone", "customer_name", etc.
const fdPhone = (fd) =>
  fd?.customer_phone || fd?.Phone || fd?.phone || fd?.Mobile || fd?.PhoneNumber || fd?.phone_number || fd?.CellPhone || '';
const fdName = (fd) =>
  fd?.customer_name || [fd?.FirstName, fd?.LastName].filter(Boolean).join(' ') || fd?.FullName || fd?.Name || fd?.name || '';
const fdEmail = (fd) =>
  fd?.customer_email || fd?.Email || fd?.email || fd?.EmailAddress || '';

// Normalized phone for grouping: last 10 digits strips country codes
const normPhone = (p) => (p || '').replace(/\D/g, '').slice(-10) || null;

// OR filter string for JSONB transfer phone/name/email search
// Matches existing pattern from backend/routes/transfers.js
const buildTransferOr = (phone, email, name) => {
  const parts = [];
  if (phone) {
    parts.push(
      `form_data->>customer_phone.ilike.%${phone}%`,
      `form_data->>Phone.ilike.%${phone}%`,
      `form_data->>phone.ilike.%${phone}%`,
    );
  }
  if (email) {
    parts.push(
      `form_data->>customer_email.ilike.%${email}%`,
      `form_data->>Email.ilike.%${email}%`,
    );
  }
  if (name) {
    parts.push(
      `form_data->>customer_name.ilike.%${name}%`,
      `form_data->>FirstName.ilike.%${name}%`,
      `form_data->>LastName.ilike.%${name}%`,
    );
  }
  return parts.join(',');
};

// ─── GET /lead-intelligence/search?q= ───────────────────────────────────────
router.get('/search', asyncHandler(async (req, res) => {
  const userId    = req.user.id;
  const companyId = req.user.company_id;
  const q         = (req.query.q || '').trim();

  if (!q || q.length < 2) return res.json({ groups: [] });

  const { allowed, superadmin } = await checkAccess(userId, companyId);
  if (!allowed) return res.status(403).json({ error: 'Permission denied' });

  const sc = (query, col) => scopeQ(query, col, companyId, superadmin);

  // Transfers: search across all FormBuilder phone key conventions
  const tOr = [
    `form_data->>customer_phone.ilike.%${q}%`,
    `form_data->>Phone.ilike.%${q}%`,
    `form_data->>phone.ilike.%${q}%`,
    `form_data->>customer_name.ilike.%${q}%`,
    `form_data->>FirstName.ilike.%${q}%`,
    `form_data->>LastName.ilike.%${q}%`,
    `form_data->>customer_email.ilike.%${q}%`,
    `form_data->>Email.ilike.%${q}%`,
  ].join(',');

  const [tRes, sRes, cbRes] = await Promise.all([
    sc(supabaseAdmin.from('transfers')
      .select('id, form_data, company_id, created_at, status, created_by, assigned_closer_id')
      .or(tOr)
      .limit(30), 'company_id'),

    sc(supabaseAdmin.from('sales')
      .select('id, customer_name, customer_phone, customer_phone_2, customer_email, company_id, created_at, status, reference_no, closer_disposition')
      .or(`customer_phone.ilike.%${q}%,customer_phone_2.ilike.%${q}%,customer_name.ilike.%${q}%,customer_email.ilike.%${q}%,reference_no.ilike.%${q}%`)
      .limit(30), 'company_id'),

    sc(supabaseAdmin.from('callbacks')
      .select('id, customer_name, customer_phone, customer_email, company_id, created_at, status')
      .or(`customer_phone.ilike.%${q}%,customer_name.ilike.%${q}%,customer_email.ilike.%${q}%`)
      .limit(25), 'company_id'),
  ]);

  // Group results by normalized phone (deduplication across companies and record types)
  const groups = {};

  const addToGroup = (type, item, phone, email, name) => {
    const key = normPhone(phone) || email || name || item.id;
    if (!groups[key]) {
      groups[key] = { key, phone: phone || null, email: email || null, name: name || null, transfers: [], sales: [], callbacks: [], companies: new Set(), last_activity: null };
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

  (tRes.data || []).forEach(t => {
    const fd = t.form_data || {};
    addToGroup('transfer', t, fdPhone(fd), fdEmail(fd), fdName(fd));
  });
  (sRes.data || []).forEach(s  => addToGroup('sale',     s,  s.customer_phone,  s.customer_email,  s.customer_name));
  (cbRes.data || []).forEach(c => addToGroup('callback', c,  c.customer_phone,  c.customer_email,  c.customer_name));

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

  const sc = (query, col) => scopeQ(query, col, companyId, superadmin);

  // Build JSONB OR filter for transfers (handles all FormBuilder key conventions)
  const tOr = buildTransferOr(phone, email, name);

  // Sales/callbacks use direct columns
  const sParts = [];
  if (phone) { sParts.push(`customer_phone.ilike.%${phone}%`); sParts.push(`customer_phone_2.ilike.%${phone}%`); }
  if (email)  sParts.push(`customer_email.ilike.%${email}%`);
  if (name)   sParts.push(`customer_name.ilike.%${name}%`);

  const cbParts = [];
  if (phone) cbParts.push(`customer_phone.ilike.%${phone}%`);
  if (email) cbParts.push(`customer_email.ilike.%${email}%`);
  if (name)  cbParts.push(`customer_name.ilike.%${name}%`);

  const [tRes, sRes, cbRes] = await Promise.all([
    tOr
      ? sc(supabaseAdmin.from('transfers').select('*').or(tOr).limit(50), 'company_id')
      : { data: [] },
    sParts.length > 0
      ? sc(supabaseAdmin.from('sales').select('*').or(sParts.join(',')).limit(50), 'company_id')
      : { data: [] },
    cbParts.length > 0
      ? sc(supabaseAdmin.from('callbacks').select('*').or(cbParts.join(',')).limit(50), 'company_id')
      : { data: [] },
  ]);

  const transfers = tRes.data || [];
  const sales     = sRes.data || [];
  const callbacks = cbRes.data || [];

  // ── Step 1: Collect IDs from primary records ───────────────────────────────
  const userIds      = new Set();
  const coIds        = new Set();
  const fronterCoIds = new Set();
  const closerCoIds  = new Set();

  transfers.forEach(t => {
    if (t.created_by)         userIds.add(t.created_by);
    if (t.assigned_closer_id) userIds.add(t.assigned_closer_id);
    if (t.company_id)         { coIds.add(t.company_id); fronterCoIds.add(t.company_id); }
    // Transfer edit_history editors
    if (Array.isArray(t.edit_history)) {
      t.edit_history.forEach(h => { if (h.editor_id) userIds.add(h.editor_id); });
    }
  });
  sales.forEach(s => {
    if (s.closer_id)    userIds.add(s.closer_id);
    if (s.submitted_by) userIds.add(s.submitted_by);
    if (s.fronter_id)   userIds.add(s.fronter_id);
    if (s.company_id)   { coIds.add(s.company_id); closerCoIds.add(s.company_id); }
    // edit_history stores editor_id (UUID) — collect all editors (compliance + managers)
    if (Array.isArray(s.edit_history)) {
      s.edit_history.forEach(h => { if (h.editor_id) userIds.add(h.editor_id); });
    }
  });
  callbacks.forEach(c => {
    if (c.user_id)    userIds.add(c.user_id);
    if (c.company_id) coIds.add(c.company_id);
  });

  // ── Step 2: Fetch secondary data in parallel (audit logs + linked transfers)
  // Must happen before profile fetch so audit actor IDs are captured
  const cbIds       = callbacks.map(c => c.id);
  const transferIds = sales.filter(s => s.transfer_id).map(s => s.transfer_id);

  // All transfer IDs (from both direct transfer matches and sales' linked transfers)
  const allTransferIds = [...new Set([
    ...transfers.map(t => t.id),
    ...transferIds,
  ])];

  const [linkedTransfersRes, auditRes, dispositionRes] = await Promise.all([
    transferIds.length > 0
      ? supabaseAdmin.from('transfers').select('id, company_id, created_by').in('id', transferIds)
      : { data: [] },
    cbIds.length > 0
      ? supabaseAdmin.from('callback_audit_log').select('*').in('callback_id', cbIds).order('created_at', { ascending: true })
      : { data: [] },
    allTransferIds.length > 0
      ? supabaseAdmin.from('disposition_actions').select('*').in('transfer_id', allTransferIds).order('created_at', { ascending: true })
      : { data: [] },
  ]);

  const linkedTransfers   = linkedTransfersRes.data || [];
  const auditData         = auditRes.data || [];
  const dispositionData   = dispositionRes.data || [];

  // Process linked transfers
  linkedTransfers.forEach(t => {
    if (t.company_id) { coIds.add(t.company_id); fronterCoIds.add(t.company_id); }
    if (t.created_by) userIds.add(t.created_by);
  });
  const linkedTransferMap = {};
  linkedTransfers.forEach(t => { linkedTransferMap[t.id] = t; });

  // Collect audit log actor IDs so their names resolve in the timeline
  auditData.forEach(l => { if (l.actor_id) userIds.add(l.actor_id); });

  // Collect disposition action actor IDs
  dispositionData.forEach(d => {
    if (d.user_id)    userIds.add(d.user_id);
    if (d.company_id) coIds.add(d.company_id);
  });

  // ── Step 3: Fetch user roles, profiles, companies ─────────────────────────
  const rolesData = userIds.size > 0
    ? (await supabaseAdmin.from('user_company_roles').select('user_id, company_id').in('user_id', [...userIds])).data || []
    : [];
  const agentCompanyMap = {}; // user_id → Set<company_id>
  rolesData.forEach(r => {
    if (!r.company_id) return;
    if (!agentCompanyMap[r.user_id]) agentCompanyMap[r.user_id] = new Set();
    agentCompanyMap[r.user_id].add(r.company_id);
    coIds.add(r.company_id);
  });

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

  // Closer role wins when a company has both transfer and sale records
  const getCoType = (cid) => {
    if (closerCoIds.has(cid))  return 'closer_company';
    if (fronterCoIds.has(cid)) return 'fronter_company';
    return 'fronter_company'; // callback-only companies default to fronter visual
  };

  const nameOf  = (uid) => profiles[uid]?.name || 'Unknown';
  const compOf  = (cid) => companies[cid]?.name || companies[cid]?.slug || 'Unknown Company';

  // ─── Build timeline (full journey: fronter → closer → compliance → callback) ──

  const timeline = [];

  // 1. Transfers (fronter activity)
  transfers.forEach(t => {
    const fd           = t.form_data || {};
    const customerName = fdName(fd) || 'Lead';
    const fronterName  = nameOf(t.created_by);
    const fronterCo    = compOf(t.company_id);

    timeline.push({
      id:          `t_create_${t.id}`,
      type:        'transfer',
      action:      'created',
      label:       'Lead entered by fronter',
      detail:      `Customer: ${customerName} · Phone: ${fdPhone(fd) || '–'} · Email: ${fdEmail(fd) || '–'}`,
      actor:       fronterName,
      actor_role:  'Fronter',
      company:     fronterCo,
      occurred_at: t.created_at,
      entity_id:   t.id,
      status:      t.status,
    });

    // Transfer assigned to closer
    if (t.assigned_closer_id) {
      const ts = t.updated_at && t.updated_at !== t.created_at ? t.updated_at : null;
      if (ts) {
        timeline.push({
          id:          `t_assign_${t.id}`,
          type:        'transfer',
          action:      'assigned',
          label:       'Transfer sent to closer',
          detail:      `Assigned to closer: ${nameOf(t.assigned_closer_id)}`,
          actor:       fronterName,
          actor_role:  'Fronter',
          company:     fronterCo,
          occurred_at: ts,
          entity_id:   t.id,
        });
      }
    }

    // Transfer edit history (if any edits by fronter manager)
    if (Array.isArray(t.edit_history)) {
      t.edit_history.forEach((h, i) => {
        timeline.push({
          id:          `t_edit_${t.id}_${i}`,
          type:        'transfer',
          action:      'updated',
          label:       'Transfer record edited',
          detail:      h.reason || h.note || 'Record was updated',
          actor:       h.editor_name || nameOf(h.editor_id) || 'Unknown',
          actor_role:  'Manager',
          company:     fronterCo,
          occurred_at: h.edited_at,
          entity_id:   t.id,
        });
      });
    }
  });

  // 2. Sales (closer + compliance activity)
  sales.forEach(s => {
    const closerName = nameOf(s.closer_id || s.submitted_by);
    const closerCo   = compOf(s.company_id);

    // Find associated fronter (via fronter_id or linked transfer)
    let fronterName = null;
    let fronterCo   = null;
    if (s.fronter_id && profiles[s.fronter_id]) {
      fronterName = nameOf(s.fronter_id);
    }
    if (s.transfer_id && linkedTransferMap[s.transfer_id]) {
      const lt = linkedTransferMap[s.transfer_id];
      if (!fronterName) fronterName = nameOf(lt.created_by);
      fronterCo = compOf(lt.company_id);
    }

    // Sale created
    timeline.push({
      id:          `s_create_${s.id}`,
      type:        'sale',
      action:      'created',
      label:       'Sale record created',
      detail:      `Ref: ${s.reference_no || '–'} · Plan: ${s.plan || '–'} · Disposition: ${s.closer_disposition || '–'}${fronterName ? ` · Fronted by: ${fronterName}` : ''}`,
      actor:       closerName,
      actor_role:  'Closer',
      company:     closerCo,
      occurred_at: s.created_at,
      entity_id:   s.id,
      status:      s.status,
      reference_no: s.reference_no,
    });

    // Sale submitted for compliance review
    if (s.submitted_for_review_at) {
      timeline.push({
        id:          `s_submit_${s.id}`,
        type:        'sale',
        action:      'submitted',
        label:       'Submitted for compliance review',
        detail:      `Ref: ${s.reference_no || '–'} submitted by ${closerName}`,
        actor:       closerName,
        actor_role:  'Closer',
        company:     closerCo,
        occurred_at: s.submitted_for_review_at,
        entity_id:   s.id,
        status:      'pending_review',
      });
    }

    // All compliance/edit history events (approved, returned, updated)
    if (Array.isArray(s.edit_history)) {
      s.edit_history.forEach((h, i) => {
        const isApproved      = h.action === 'approved';
        const isReturned      = h.action === 'returned';
        const isComplianceRole = h.role === 'compliance_manager' || isApproved || isReturned;
        const label = isApproved ? 'Compliance approved sale'
          : isReturned  ? 'Sale returned for revision'
          : isComplianceRole ? 'Compliance updated sale'
          : 'Sale record updated';
        // editor_id is the UUID stored by the backend; editor_name is NOT stored
        const actorName = nameOf(h.editor_id);
        timeline.push({
          id:          `s_edit_${s.id}_${i}`,
          type:        'sale',
          action:      h.action || 'updated',
          label,
          detail:      h.note || h.reason || '',
          actor:       actorName,
          actor_role:  isComplianceRole ? 'Compliance' : 'Manager',
          company:     closerCo,
          occurred_at: h.edited_at,
          entity_id:   s.id,
          status:      h.new_status || h.previous_status,
        });
      });
    }
  });

  // 3. Callbacks (agent callback activity)
  callbacks.forEach(c => {
    const agentName = nameOf(c.user_id);
    const agentCo   = compOf(c.company_id);

    timeline.push({
      id:          `cb_create_${c.id}`,
      type:        'callback',
      action:      'scheduled',
      label:       'Callback scheduled',
      detail:      `Scheduled for ${c.callback_at ? new Date(c.callback_at).toLocaleString() : '–'}${c.notes ? ` · Notes: "${c.notes}"` : ''}`,
      actor:       agentName,
      actor_role:  'Agent',
      company:     agentCo,
      occurred_at: c.created_at,
      entity_id:   c.id,
      status:      c.status,
    });
  });

  // 4. Callback audit log events
  auditData.forEach(l => {
    const cb       = callbacks.find(c => c.id === l.callback_id);
    const agentCo  = cb ? compOf(cb.company_id) : null;
    timeline.push({
      id:          `audit_${l.id}`,
      type:        'callback',
      action:      l.action || 'status_change',
      label:       l.action === 'rescheduled' ? 'Callback rescheduled'
        : `Call outcome: ${(l.new_status || '').replace(/_/g, ' ')}`,
      detail:      l.action === 'rescheduled'
        ? `Moved to ${l.new_callback_at ? new Date(l.new_callback_at).toLocaleString() : '–'} (was ${l.old_callback_at ? new Date(l.old_callback_at).toLocaleString() : '–'})`
        : `${l.old_status} → ${l.new_status}${l.notes ? ` · "${l.notes}"` : ''}`,
      actor:       nameOf(l.actor_id),
      actor_role:  'Agent',
      company:     agentCo,
      occurred_at: l.created_at,
      entity_id:   l.callback_id,
    });
  });

  // 5. Disposition actions (call outcomes logged by closers in phone search)
  dispositionData.forEach(d => {
    const agentCo = compOf(d.company_id);
    timeline.push({
      id:          `dispo_${d.id}`,
      type:        'disposition',
      action:      'disposition',
      label:       `Call outcome: ${d.disposition_name}`,
      detail:      d.note ? `Note: "${d.note}"` : '',
      actor:       nameOf(d.user_id),
      actor_role:  'Closer',
      company:     agentCo,
      occurred_at: d.created_at,
      entity_id:   d.transfer_id,
      color:       d.color || '#6b7280',
      disposition_name: d.disposition_name,
    });
  });

  timeline.sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));

  // ─── Build graph (OSINT-style relationship graph) ─────────────────────────

  const nodes   = [];
  const edges   = [];
  const nodeSet = new Set();

  const addNode = (id, data) => {
    if (nodeSet.has(id)) return;
    nodeSet.add(id);
    nodes.push({ data: { id, ...data } });
  };
  const addEdge = (source, target, label) => {
    const eid = `e_${source}__${target}__${label.replace(/\s/g, '_')}`;
    if (!edges.find(e => e.data.id === eid)) {
      edges.push({ data: { id: eid, source, target, label } });
    }
  };

  // Center node: the lead identity
  const displayLabel = phone || email || name;
  const centerId     = `lead_${displayLabel.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  addNode(centerId, {
    label: (transfers[0] ? fdName(transfers[0].form_data) : sales[0]?.customer_name || displayLabel) + '\n' + (phone || ''),
    type: 'lead',
  });

  // Transfer nodes — fronter side records
  transfers.forEach(t => {
    const fd  = t.form_data || {};
    const nid = `transfer_${t.id}`;
    addNode(nid, { label: `Transfer\n${(fdName(fd) || '').slice(0, 16) || t.id.slice(0, 6)}`, type: 'transfer', status: t.status, entity_id: t.id });
    addEdge(centerId, nid, 'transfer');

    if (t.created_by) {
      addNode(`agent_${t.created_by}`, { label: nameOf(t.created_by), type: 'agent', role: 'Fronter' });
      addEdge(`agent_${t.created_by}`, nid, 'created');
    }
    if (t.company_id) {
      addNode(`company_${t.company_id}`, { label: compOf(t.company_id), type: getCoType(t.company_id) });
      addEdge(nid, `company_${t.company_id}`, 'fronter co.');
    }
  });

  // Sale nodes — closer + compliance side records
  sales.forEach(s => {
    const nid = `sale_${s.id}`;
    addNode(nid, { label: `Sale\nRef: ${s.reference_no || s.id.slice(0, 6)}`, type: 'sale', status: s.status, entity_id: s.id });
    addEdge(centerId, nid, 'sale');

    // Link the transfer that originated this sale
    if (s.transfer_id) {
      if (nodeSet.has(`transfer_${s.transfer_id}`)) {
        addEdge(`transfer_${s.transfer_id}`, nid, 'converted to');
      } else if (linkedTransferMap[s.transfer_id]) {
        // Transfer not in our result set — add a minimal node
        const lt = linkedTransferMap[s.transfer_id];
        addNode(`transfer_${s.transfer_id}`, { label: 'Transfer', type: 'transfer' });
        addEdge(centerId, `transfer_${s.transfer_id}`, 'transfer');
        addEdge(`transfer_${s.transfer_id}`, nid, 'converted to');
        if (lt.company_id) {
          addNode(`company_${lt.company_id}`, { label: compOf(lt.company_id), type: getCoType(lt.company_id) });
          addEdge(`transfer_${s.transfer_id}`, `company_${lt.company_id}`, 'fronter co.');
        }
      }
    }

    // Closer agent who created/submitted the sale
    const actorId = s.closer_id || s.submitted_by;
    if (actorId) {
      addNode(`agent_${actorId}`, { label: nameOf(actorId), type: 'agent', role: 'Closer' });
      addEdge(`agent_${actorId}`, nid, 'submitted');
    }

    // Closer company (the company the sale belongs to)
    if (s.company_id) {
      addNode(`company_${s.company_id}`, { label: compOf(s.company_id), type: getCoType(s.company_id) });
      addEdge(nid, `company_${s.company_id}`, 'closer co.');
    }

    // Fronter agent listed on the sale record
    if (s.fronter_id && profiles[s.fronter_id]) {
      addNode(`agent_${s.fronter_id}`, { label: nameOf(s.fronter_id), type: 'agent', role: 'Fronter' });
      addEdge(`agent_${s.fronter_id}`, nid, 'fronted');
    }

    // Compliance/edit history actors — any editor_id in edit_history gets a node.
    // Use agent_${editor_id} as node ID so agentCompanyMap wires the correct company.
    // Compliance role gets 'compliance' type (red pentagon); managers get 'agent' type.
    if (Array.isArray(s.edit_history)) {
      s.edit_history.filter(h => h.editor_id).forEach(h => {
        const nodeId       = `agent_${h.editor_id}`;
        const isCompliance = h.role === 'compliance_manager' || h.action === 'approved' || h.action === 'returned';
        // Only set node type on first encounter (addNode skips duplicates)
        if (!nodeSet.has(nodeId)) {
          addNode(nodeId, { label: nameOf(h.editor_id) || (isCompliance ? 'Compliance' : 'Manager'), type: isCompliance ? 'compliance' : 'agent' });
        }
        const edgeLabel = h.action === 'approved' ? 'approved'
          : h.action === 'returned' ? 'returned'
          : 'reviewed';
        addEdge(nodeId, nid, edgeLabel);
      });
    }
  });

  // Callback nodes — can be from either fronter or closer company
  callbacks.forEach(c => {
    const nid = `callback_${c.id}`;
    addNode(nid, { label: `Callback\n${(c.status || 'pending').replace(/_/g, ' ')}`, type: 'callback', status: c.status, entity_id: c.id });
    addEdge(centerId, nid, 'callback');

    if (c.user_id) {
      addNode(`agent_${c.user_id}`, { label: nameOf(c.user_id), type: 'agent', role: 'Agent' });
      addEdge(`agent_${c.user_id}`, nid, 'scheduled');
    }
    if (c.company_id) {
      // Use getCoType so callback companies get the correct fronter/closer visual type
      addNode(`company_${c.company_id}`, { label: compOf(c.company_id), type: getCoType(c.company_id) });
      addEdge(nid, `company_${c.company_id}`, 'co.');
    }
  });

  // ── "works at" edges from real user_company_roles data ────────────────────
  // Replaces the old record-inferred approach so agents always point to their
  // actual company, not whichever record they happen to have created.
  Object.entries(agentCompanyMap).forEach(([uid, coIdSet]) => {
    const agentNodeId = `agent_${uid}`;
    if (!nodeSet.has(agentNodeId)) return; // only wire up agents already in the graph
    coIdSet.forEach(coId => {
      const coNodeId = `company_${coId}`;
      // Only draw the edge if that company is relevant to this lead's graph
      if (nodeSet.has(coNodeId)) {
        addEdge(agentNodeId, coNodeId, 'works at');
      }
    });
  });

  // ─── Insights ─────────────────────────────────────────────────────────────

  const converted    = sales.filter(s => ['closed_won', 'sold'].includes(s.status)).length;
  const convRate     = sales.length > 0 ? Math.round((converted / sales.length) * 100) : 0;
  const allDates     = [...transfers, ...sales, ...callbacks].map(e => e.updated_at || e.created_at).filter(Boolean);
  const lastActivity = allDates.sort().at(-1) || null;

  // Companies that have actual records for this lead (excludes role-only companies)
  const recordCoIds = new Set([
    ...fronterCoIds,
    ...closerCoIds,
    ...callbacks.map(c => c.company_id).filter(Boolean),
  ]);

  const flags = [];
  if (recordCoIds.size > 1)
    flags.push({ type: 'info', msg: `Number appears in ${recordCoIds.size} companies (${[...recordCoIds].map(id => companies[id]?.name || companies[id]?.slug || id).join(', ')})` });
  if (userIds.size > 4)
    flags.push({ type: 'warning', msg: `Handled by ${userIds.size} different agents across companies` });
  const openSales = sales.filter(s => s.status === 'open').length;
  if (openSales > 1)
    flags.push({ type: 'warning', msg: `${openSales} open/pending sales exist for this number` });
  const totalEdits = sales.reduce((acc, s) => acc + (Array.isArray(s.edit_history) ? s.edit_history.length : 0), 0);
  if (totalEdits > 5)
    flags.push({ type: 'warning', msg: `${totalEdits} edit/compliance events on sale records` });
  if (transfers.length + sales.length + callbacks.length > 20)
    flags.push({ type: 'warning', msg: 'High activity volume — review for duplicates' });

  res.json({
    phone, email, name,
    transfers, sales, callbacks, dispositions: dispositionData,
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
      companies_count: recordCoIds.size,
      agents_count:    userIds.size,
      last_activity:   lastActivity,
    },
    flags,
  });
}));

module.exports = router;
