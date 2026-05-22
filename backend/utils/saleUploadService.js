const { supabaseAdmin } = require('../config/database');
const { etWallClockToUtc } = require('./etUtils');
const { normPhone, normName } = require('./uploadService');

// Generate a reference number like the manual flow (sales.js generateReferenceNo).
function generateReferenceNo() {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const num   = '0123456789';
  const r = (s, n) => Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('');
  return r(alpha, 3) + r(num, 4) + r(alpha, 3);
}

// transfer_status / sale_status enum values that exist live (verified against DB).
const SALE_STATUSES = ['open', 'sold', 'cancelled', 'follow_up', 'closed_won', 'closed_lost',
  'pending_review', 'needs_revision', 'compliance_cancelled', 'dispute', 'chargeback'];
// Statuses that represent a completed compliance review (an "outcome").
const REVIEWED = ['closed_won', 'closed_lost', 'needs_revision', 'compliance_cancelled', 'dispute', 'chargeback', 'sold', 'cancelled'];

// Default state when the file carries no compliance/status data: land in the
// compliance queue exactly like a closer submitting a finished sale for review.
const DEFAULT_STATUS = 'pending_review';

const safeStatus = (s) => {
  const v = String(s || '').trim().toLowerCase();
  return SALE_STATUSES.includes(v) ? v : DEFAULT_STATUS;
};

// Fields compared for the update diff, with display label + highlight category.
// status → "approval" (purple); compliance_* → "compliance" (blue); rest yellow.
const DIFF_FIELDS = [
  ['customer_name', 'Customer Name', 'normal'], ['customer_phone', 'Phone', 'normal'],
  ['customer_phone_2', 'Phone 2', 'normal'], ['customer_email', 'Email', 'normal'],
  ['customer_address', 'Address', 'normal'],
  ['car_year', 'Car Year', 'normal'], ['car_make', 'Car Make', 'normal'],
  ['car_model', 'Car Model', 'normal'], ['car_miles', 'Mileage', 'normal'], ['car_vin', 'VIN', 'normal'],
  ['plan', 'Plan', 'normal'], ['down_payment', 'Down Payment', 'normal'],
  ['monthly_payment', 'Monthly Payment', 'normal'], ['payment_due_note', 'Payment Due Note', 'normal'],
  ['reference_no', 'Reference No', 'normal'], ['client_name', 'Client', 'normal'],
  ['sale_date', 'Sale Date', 'normal'], ['closer_disposition', 'Disposition', 'normal'],
  ['status', 'Status (Approval)', 'approval'],
  ['compliance_note', 'Compliance Note', 'compliance'],
];

const cmp = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();

// ============================================================================
// Reference — companies (+ their fronters) and closers, for name→id resolution.
// Cached 30s (same rationale as the transfer uploader: many chunks per upload).
// ============================================================================
let _ref = { data: null, at: 0 };
async function getReference({ fresh = false } = {}) {
  if (!fresh && _ref.data && Date.now() - _ref.at < 30000) return _ref.data;

  const { data: companies } = await supabaseAdmin
    .from('companies').select('id, name, company_type').eq('is_active', true).order('name');

  const { data: roles } = await supabaseAdmin
    .from('user_company_roles')
    .select('user_id, company_id, custom_roles(level)')
    .eq('is_active', true);

  const fronterRoles = (roles || []).filter(r => r.custom_roles?.level === 'fronter');
  const closerRoles  = (roles || []).filter(r => r.custom_roles?.level === 'closer');

  const ids = [...new Set([...fronterRoles, ...closerRoles].map(r => r.user_id))];
  const names = {};
  if (ids.length) {
    const { data } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
    (data || []).forEach(p => { names[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });
  }

  const frByCompany = {}, closers = [];
  fronterRoles.forEach(r => { (frByCompany[r.company_id] ||= []).push({ user_id: r.user_id, name: names[r.user_id] || '' }); });
  closerRoles.forEach(r => closers.push({ user_id: r.user_id, name: names[r.user_id] || '', company_id: r.company_id }));

  const data = {
    companies: (companies || []).map(c => ({
      id: c.id, name: c.name, company_type: c.company_type,
      fronters: (frByCompany[c.id] || []).filter(f => f.name),
    })),
    closers: closers.filter(c => c.name),
  };
  _ref = { data, at: Date.now() };
  return data;
}

function buildIndex(ref) {
  const companyByName = new Map();
  const fronterByKey  = new Map();   // companyId|normName -> [users]
  const closerByName  = new Map();   // normName -> [users]
  ref.companies.forEach(co => {
    companyByName.set(normName(co.name), { id: co.id, name: co.name });
    co.fronters.forEach(f => {
      const k = `${co.id}|${normName(f.name)}`;
      (fronterByKey.get(k) || fronterByKey.set(k, []).get(k)).push(f);
    });
  });
  ref.closers.forEach(c => {
    const k = normName(c.name);
    (closerByName.get(k) || closerByName.set(k, []).get(k)).push(c);
  });
  return { companyByName, fronterByKey, closerByName };
}

// Resolve a row's company / fronter / closer names → IDs.
function resolveRow(row, index) {
  const co = index.companyByName.get(normName(row.company_name));
  if (!co) return { ok: false, reason: `Company "${row.company_name}" not found` };

  const fr = index.fronterByKey.get(`${co.id}|${normName(row.fronter_name)}`) || [];
  if (fr.length === 0) return { ok: false, reason: `No fronter "${row.fronter_name}" in ${co.name}` };
  if (fr.length > 1)   return { ok: false, reason: `"${row.fronter_name}" matches multiple fronters in ${co.name}` };

  // Closer is optional; if a name is given it must resolve unambiguously.
  let closer_user_id = null;
  if (String(row.closer_name || '').trim()) {
    const cl = index.closerByName.get(normName(row.closer_name)) || [];
    if (cl.length === 0) return { ok: false, reason: `No closer "${row.closer_name}" found` };
    if (cl.length > 1)   return { ok: false, reason: `"${row.closer_name}" matches multiple closers` };
    closer_user_id = cl[0].user_id;
  }

  return { ok: true, company_id: co.id, company_name: co.name, fronter_user_id: fr[0].user_id, closer_user_id };
}

// Pick the specific existing sale (multi-car aware): reference_no → car_vin →
// year+make+model → single → ambiguous.
function pickExistingSale(row, sales) {
  if (!sales || sales.length === 0) return { match: null };
  if (sales.length === 1) return { match: sales[0] };

  const ref = String(row.reference_no || '').trim().toUpperCase();
  if (ref) { const m = sales.find(s => String(s.reference_no || '').trim().toUpperCase() === ref); if (m) return { match: m }; }

  const vin = String(row.car_vin || '').trim().toUpperCase();
  if (vin) { const m = sales.find(s => String(s.car_vin || '').trim().toUpperCase() === vin); if (m) return { match: m }; }

  const ymm = [row.car_year, row.car_make, row.car_model].map(v => String(v || '').trim().toLowerCase()).join('|');
  if (ymm.replace(/\|/g, '')) {
    const m = sales.find(s => [s.car_year, s.car_make, s.car_model].map(v => String(v || '').trim().toLowerCase()).join('|') === ymm);
    if (m) return { match: m };
  }
  return { ambiguous: true };
}

// Build the diff between an incoming row and an existing sale.
function diffSale(row, sale) {
  const changes = [];
  for (const [key, label, category] of DIFF_FIELDS) {
    // Only consider fields the file actually provided (don't wipe with blanks).
    const incoming = row[key];
    if (incoming === undefined || incoming === null || String(incoming).trim() === '') continue;
    if (!cmp(incoming, sale[key])) {
      changes.push({ field: key, label, category, prev: sale[key] ?? '', next: incoming });
    }
  }
  return changes;
}

// ============================================================================
// Classify a chunk of resolved-or-not rows against the live DB.
// Returns { newSales, updates, skipped, unmatched, ambiguous }.
// ============================================================================
async function classifyChunk(rows) {
  const index = buildIndex(await getReference());

  const resolved = [], unmatched = [];
  for (const row of rows) {
    const r = resolveRow(row, index);
    if (!r.ok) { unmatched.push({ ...row, reason: r.reason }); continue; }
    resolved.push({ ...row, _r: r });
  }

  // ── Transfer match: company_id + fronter(created_by) + normalized phone ──────
  const companyIds = [...new Set(resolved.map(r => r._r.company_id))];
  const fronterIds = [...new Set(resolved.map(r => r._r.fronter_user_id))];
  let xfers = [];
  if (companyIds.length && fronterIds.length) {
    const { data } = await supabaseAdmin
      .from('transfers').select('id, company_id, created_by, form_data')
      .in('company_id', companyIds).in('created_by', fronterIds);
    xfers = data || [];
  }
  const xferKey = (cid, uid, phone) => `${cid}|${uid}|${normPhone(phone)}`;
  const xferByKey = new Map();
  xfers.forEach(t => {
    const fd = t.form_data || {};
    const ph = fd.customer_phone || fd.Phone || fd.phone || fd.cli_number;
    const k = xferKey(t.company_id, t.created_by, ph);
    (xferByKey.get(k) || xferByKey.set(k, []).get(k)).push(t);
  });

  // Existing sales for all candidate transfers, grouped by transfer.
  const matchedTransferIds = [];
  resolved.forEach(r => {
    const m = xferByKey.get(xferKey(r._r.company_id, r._r.fronter_user_id, r.cli_number)) || [];
    r._xfers = m;
    m.forEach(t => matchedTransferIds.push(t.id));
  });
  let salesByTransfer = new Map();
  if (matchedTransferIds.length) {
    const { data: sales } = await supabaseAdmin
      .from('sales').select('*').in('transfer_id', [...new Set(matchedTransferIds)]);
    (sales || []).forEach(s => { (salesByTransfer.get(s.transfer_id) || salesByTransfer.set(s.transfer_id, []).get(s.transfer_id)).push(s); });
  }

  const newSales = [], updates = [], skipped = [], ambiguous = [];
  for (const r of resolved) {
    const base = { ...r, company_id: r._r.company_id, fronter_user_id: r._r.fronter_user_id, closer_user_id: r._r.closer_user_id };
    delete base._r; delete base._xfers;

    if (!r._xfers || r._xfers.length === 0) { unmatched.push({ ...base, reason: `No transfer for ${r.fronter_name} / ${r.company_name} / ${r.cli_number}` }); continue; }
    if (r._xfers.length > 1) { ambiguous.push({ ...base, reason: `${r._xfers.length} transfers match — resolve manually` }); continue; }

    const transfer = r._xfers[0];
    const existing = salesByTransfer.get(transfer.id) || [];
    const pick = pickExistingSale(r, existing);

    if (pick.ambiguous) { ambiguous.push({ ...base, transfer_id: transfer.id, reason: `${existing.length} sales on this transfer — can't tell which to update` }); continue; }

    if (!pick.match) { newSales.push({ ...base, transfer_id: transfer.id }); continue; }

    const changes = diffSale(r, pick.match);
    if (changes.length === 0) {
      skipped.push({ ...base, reason: 'Identical sale already exists' });
    } else {
      updates.push({ ...base, transfer_id: transfer.id, sale_id: pick.match.id, changes });
    }
  }

  return { newSales, updates, skipped, unmatched, ambiguous };
}

// Compliance/submission timestamps to mirror the manual workflow for a status.
function complianceState(status, row) {
  const now = new Date().toISOString();
  if (status === 'pending_review') return { submitted_for_review_at: etWallClockToUtc(row.submitted_for_review_at) || now, compliance_reviewed_at: null };
  if (REVIEWED.includes(status))    return { submitted_for_review_at: etWallClockToUtc(row.submitted_for_review_at) || now, compliance_reviewed_at: etWallClockToUtc(row.compliance_reviewed_at) || now };
  return { submitted_for_review_at: null, compliance_reviewed_at: null }; // open
}

// Build a sales row identical in shape to a manual closer-created sale.
function buildSaleRow(row, batchId) {
  const status = safeStatus(row.status);
  const cs = complianceState(status, row);
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  return {
    transfer_id:        row.transfer_id,
    created_by:         row.closer_user_id,            // manual: created_by = the closer
    closer_id:          row.closer_user_id,
    fronter_id:         row.fronter_user_id,
    company_id:         row.company_id,                // inherited fronter company (like manual)
    status,
    customer_name:      row.customer_name || null,
    customer_phone:     row.customer_phone || row.cli_number || null,
    customer_phone_2:   row.customer_phone_2 || null,
    customer_email:     row.customer_email || null,
    customer_address:   row.customer_address || null,
    car_year:           int(row.car_year),
    car_make:           row.car_make || null,
    car_model:          row.car_model || null,
    car_miles:          int(row.car_miles),
    car_vin:            row.car_vin ? String(row.car_vin).toUpperCase() : null,
    plan:               row.plan || null,
    down_payment:       num(row.down_payment),
    monthly_payment:    num(row.monthly_payment),
    payment_due_note:   row.payment_due_note || null,
    reference_no:       (row.reference_no && String(row.reference_no).trim()) || generateReferenceNo(),
    client_name:        row.client_name || null,
    sale_date:          row.sale_date ? String(row.sale_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    form_data:          row.form_data || null,
    closer_disposition: row.closer_disposition || null,
    compliance_note:    row.compliance_note || null,
    submitted_for_review_at: cs.submitted_for_review_at,
    compliance_reviewed_at:  cs.compliance_reviewed_at,
    upload_batch_id:    batchId,
  };
}

// ============================================================================
// Confirm — insert new sales (tagged with batch) + apply confirmed updates.
// New inserts replicate manual side effects: "Sent to Compliance" disposition
// + transfer auto-complete. Updates append an edit_history entry, untagged.
// ============================================================================
async function confirmUpload({ newRows = [], updateRows = [], batchMeta = {} }, uploaderId) {
  const index = buildIndex(await getReference());

  // Create the batch first so inserted sales can reference it.
  const { data: batch, error: bErr } = await supabaseAdmin
    .from('upload_batches')
    .insert({
      kind: 'sale',
      file_name: batchMeta.file_name || null,
      uploaded_by: uploaderId,
      total_rows: (newRows.length + updateRows.length),
      inserted_count: 0,
      conflict_count: updateRows.length,
    })
    .select().single();
  if (bErr) throw new Error(bErr.message);

  // ── Inserts ────────────────────────────────────────────────────────────────
  let inserted = 0;
  const insertable = [];
  for (const row of newRows) {
    const r = resolveRow(row, index);
    if (!r.ok || !row.transfer_id) continue;
    insertable.push(buildSaleRow({ ...row, company_id: r.company_id, fronter_user_id: r.fronter_user_id, closer_user_id: r.closer_user_id }, batch.id));
  }
  for (let i = 0; i < insertable.length; i += 100) {
    const slice = insertable.slice(i, i + 100);
    const { data, error } = await supabaseAdmin.from('sales').insert(slice).select('id, transfer_id, company_id, closer_id, closer_disposition');
    if (error) throw new Error(error.message);
    inserted += (data || []).length;
    // Mirror manual side effects per inserted sale.
    for (const s of (data || [])) {
      supabaseAdmin.from('disposition_actions').insert({
        transfer_id: s.transfer_id, company_id: s.company_id, user_id: s.closer_id,
        disposition_name: 'Sent to Compliance', color: '#f59e0b',
        note: s.closer_disposition ? `Disposition: ${s.closer_disposition}` : 'Sale submitted to compliance (bulk upload)',
        setter_role: 'closer',
      }).catch(() => {});
      supabaseAdmin.from('transfers').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', s.transfer_id).catch(() => {});
    }
  }

  // ── Updates ──────────────────────────────────────────────────────────────────
  let updated = 0;
  for (const row of updateRows) {
    if (!row.sale_id || !Array.isArray(row.changes) || !row.changes.length) continue;
    const { data: existing } = await supabaseAdmin.from('sales').select('edit_history').eq('id', row.sale_id).single();
    const history = Array.isArray(existing?.edit_history) ? existing.edit_history : [];
    const patch = { updated_at: new Date().toISOString() };
    row.changes.forEach(c => {
      if (['car_year', 'car_miles'].includes(c.field)) patch[c.field] = parseInt(c.next, 10) || null;
      else if (['down_payment', 'monthly_payment'].includes(c.field)) patch[c.field] = parseFloat(c.next) || null;
      else if (c.field === 'car_vin') patch[c.field] = String(c.next).toUpperCase();
      else if (c.field === 'sale_date') patch[c.field] = String(c.next).slice(0, 10);
      else patch[c.field] = c.next;
    });
    patch.edit_history = [...history, {
      editor_id: uploaderId, role: 'bulk_upload', action: 'bulk_update',
      changes: row.changes.map(c => ({ field: c.field, from: c.prev, to: c.next })),
      edited_at: new Date().toISOString(),
    }];
    const { error } = await supabaseAdmin.from('sales').update(patch).eq('id', row.sale_id);
    if (!error) updated++;
  }

  await supabaseAdmin.from('upload_batches').update({ inserted_count: inserted }).eq('id', batch.id);
  return { batch_id: batch.id, inserted, updated };
}

module.exports = { getReference, classifyChunk, confirmUpload, SALE_STATUSES };
