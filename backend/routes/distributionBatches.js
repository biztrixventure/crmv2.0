// ============================================================================
// /distribution-batches — first-class batch distribution with parent→child
// lineage and cascading soft-delete. Original batches are created from the Data
// Analyzer (see routes/dataAnalyzer.js POST /send-batch); this file handles
// receiving, re-batching (sub-batch = COPY downstream, parent keeps its items),
// the fronter "My Numbers" feed, cascading delete, and lineage.
// Mounted at /api/distribution-batches (authMiddleware). See migration 153.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const notifications = require('../utils/notificationService');
const logger = require('../utils/logger');

const router = express.Router();

// Roles allowed to SEND / sub-batch. Fronters receive but cannot forward
// (ASSUMPTION — flagged; flip by adding 'fronter' here). Recipients can be ANY
// user regardless of role.
const SENDER_ROLES = new Set(['superadmin', 'compliance_manager', 'fronter_manager', 'closer_manager', 'operations_manager', 'company_admin']);
const canSend = (req) => SENDER_ROLES.has(req.user.role);

const digits = (s) => String(s || '').replace(/\D/g, '');
const fullName = (p) => `${p?.first_name || ''} ${p?.last_name || ''}`.trim() || null;

async function namesFor(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', uniq);
  return Object.fromEntries((data || []).map(p => [p.user_id, fullName(p) || '(unnamed)']));
}

// Load a batch + assert the caller may see it (creator, recipient, or superadmin).
async function loadVisibleBatch(req, id) {
  const { data: b } = await supabaseAdmin.from('distribution_batches').select('*').eq('id', id).maybeSingle();
  if (!b) return { error: 404 };
  const sa = await isSuperAdmin(req.user.id);
  if (!sa && b.created_by !== req.user.id && b.sent_to_user_id !== req.user.id) return { error: 403 };
  return { batch: b, sa };
}

// ── recipient picker — search ANY active CRM user ─────────────────────────────
router.get('/recipients', asyncHandler(async (req, res) => {
  if (!canSend(req)) return res.status(403).json({ error: 'Not allowed to send batches' });
  const q = String(req.query.q || '').trim();
  let query = supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').limit(30);
  if (q) query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
  const { data: profs } = await query;
  const ids = (profs || []).map(p => p.user_id);
  // attach primary role + company for the picker labels
  const roleByUser = new Map();
  if (ids.length) {
    const { data: roles } = await supabaseAdmin.from('user_company_roles')
      .select('user_id, company_id, is_active, custom_roles(level), companies(name)')
      .in('user_id', ids).eq('is_active', true);
    (roles || []).forEach(r => { if (!roleByUser.has(r.user_id)) roleByUser.set(r.user_id, { role: r.custom_roles?.level || null, company_id: r.company_id, company_name: r.companies?.name || null }); });
  }
  const users = (profs || []).map(p => ({
    id: p.user_id, name: fullName(p) || '(unnamed)',
    role: roleByUser.get(p.user_id)?.role || null,
    company_id: roleByUser.get(p.user_id)?.company_id || null,
    company_name: roleByUser.get(p.user_id)?.company_name || null,
  })).sort((a, b) => a.name.localeCompare(b.name));
  res.json({ users });
}));

// ── batches: ?box=received (default, sent to me) | sent (created by me);
//    superadmin ?scope=all → every active batch ───────────────────────────────
router.get('/received', asyncHandler(async (req, res) => {
  const sa = await isSuperAdmin(req.user.id);
  const box = req.query.box === 'sent' ? 'sent' : 'received';
  let q = supabaseAdmin.from('distribution_batches').select('*').eq('status', 'active').order('sent_at', { ascending: false }).limit(300);
  if (sa && req.query.scope === 'all') { /* no owner filter */ }
  else if (box === 'sent') q = q.eq('created_by', req.user.id);
  else q = q.eq('sent_to_user_id', req.user.id);
  const { data: rows } = await q;
  const names = await namesFor((rows || []).flatMap(b => [b.created_by, b.sent_to_user_id]));
  res.json({ batches: (rows || []).map(b => ({
    id: b.id, name: b.name, source: b.source, parent_batch_id: b.parent_batch_id,
    created_by: b.created_by, created_by_name: names[b.created_by] || null,
    sent_to_user_id: b.sent_to_user_id, sent_to_name: names[b.sent_to_user_id] || null,
    sent_at: b.sent_at, item_count: b.item_count, company_id: b.company_id,
  })) });
}));

// ── one batch's items ─────────────────────────────────────────────────────────
router.get('/:id/items', asyncHandler(async (req, res) => {
  const { batch, error } = await loadVisibleBatch(req, req.params.id);
  if (error) return res.status(error).json({ error: error === 404 ? 'Batch not found' : 'Not allowed' });
  const { data: items } = await supabaseAdmin.from('distribution_batch_items')
    .select('id, phone_number, lead_id, customer_name, status, notes, created_at')
    .eq('batch_id', batch.id).order('created_at', { ascending: true });
  res.json({ batch: { id: batch.id, name: batch.name, item_count: batch.item_count }, items: items || [] });
}));

// ── sub-batch: COPY selected (or all) items into a NEW child batch ────────────
// Parent keeps its items (fan-out, not move — ASSUMPTION, flagged).
router.post('/:id/sub-batch', asyncHandler(async (req, res) => {
  if (!canSend(req)) return res.status(403).json({ error: 'Not allowed to send batches' });
  const { batch, error } = await loadVisibleBatch(req, req.params.id);
  if (error) return res.status(error).json({ error: error === 404 ? 'Batch not found' : 'Not allowed' });

  const recipientId = req.body.recipient_id;
  if (!recipientId) return res.status(400).json({ error: 'recipient_id is required' });
  const itemIds = Array.isArray(req.body.item_ids) ? req.body.item_ids.filter(Boolean) : null;   // null = all
  const name = String(req.body.name || `${batch.name} → sub-batch`).slice(0, 200);

  // pull the source items to copy
  let sel = supabaseAdmin.from('distribution_batch_items').select('phone_number, lead_id, customer_name').eq('batch_id', batch.id);
  if (itemIds && itemIds.length) sel = sel.in('id', itemIds);
  const { data: srcItems } = await sel;
  if (!srcItems || !srcItems.length) return res.status(400).json({ error: 'No items to send' });

  // recipient's company (for scoping/notifications)
  const { data: rcr } = await supabaseAdmin.from('user_company_roles')
    .select('company_id').eq('user_id', recipientId).eq('is_active', true).order('created_at', { ascending: true }).limit(1).maybeSingle();

  const { data: child, error: bErr } = await supabaseAdmin.from('distribution_batches').insert({
    name, created_by: req.user.id, parent_batch_id: batch.id, source: 'sub_batch',
    sent_to_user_id: recipientId, company_id: rcr?.company_id || batch.company_id || null,
    item_count: srcItems.length,
  }).select().single();
  if (bErr) return res.status(500).json({ error: bErr.message });

  const rows = srcItems.map(s => ({ batch_id: child.id, phone_number: s.phone_number, lead_id: s.lead_id || null, customer_name: s.customer_name || null }));
  const { error: iErr } = await supabaseAdmin.from('distribution_batch_items').insert(rows);
  if (iErr) { await supabaseAdmin.from('distribution_batches').delete().eq('id', child.id); return res.status(500).json({ error: iErr.message }); }

  notifications.notifyUsers([recipientId], {
    type: 'batch_received', title: 'New batch received',
    message: `${req.user.name || 'A manager'} sent you "${name}" (${rows.length} numbers).`,
    companyId: child.company_id, data: { batch_id: child.id, kind: 'distribution_batch' },
    dedupBase: `batch_${child.id}`,
  }).catch(() => {});
  logger.success('DIST_BATCH', `sub-batch ${child.id} (${rows.length} items) ${req.user.id} → ${recipientId}, parent ${batch.id}`);
  res.status(201).json({ batch: child });
}));

// ── cascading soft-delete (this batch + entire descendant subtree) ────────────
router.delete('/:id', asyncHandler(async (req, res) => {
  const { data: b } = await supabaseAdmin.from('distribution_batches').select('id, created_by').eq('id', req.params.id).maybeSingle();
  if (!b) return res.status(404).json({ error: 'Batch not found' });
  const sa = await isSuperAdmin(req.user.id);
  if (!sa && b.created_by !== req.user.id) return res.status(403).json({ error: 'Only the batch creator or a superadmin can delete it' });
  const { data, error } = await supabaseAdmin.rpc('app_delete_batch_cascade', { p_batch_id: b.id, p_deleted_by: req.user.id });
  if (error) return res.status(500).json({ error: error.message });
  logger.success('DIST_BATCH', `cascade-deleted ${b.id} + subtree (${data} batches) by ${req.user.id}`);
  res.json({ ok: true, deleted_batches: data });
}));

// ── lineage: ancestor chain + descendant tree ─────────────────────────────────
router.get('/:id/lineage', asyncHandler(async (req, res) => {
  const { error } = await loadVisibleBatch(req, req.params.id);
  if (error) return res.status(error).json({ error: error === 404 ? 'Batch not found' : 'Not allowed' });
  const [{ data: anc }, { data: desc }] = await Promise.all([
    supabaseAdmin.rpc('app_batch_ancestors', { p_batch_id: req.params.id }),
    supabaseAdmin.rpc('app_batch_descendants', { p_batch_id: req.params.id }),
  ]);
  const names = await namesFor([...(anc || []), ...(desc || [])].flatMap(b => [b.created_by, b.sent_to_user_id]));
  const deco = (b) => ({ ...b, created_by_name: names[b.created_by] || null, sent_to_name: names[b.sent_to_user_id] || null });
  res.json({ ancestors: (anc || []).map(deco), descendants: (desc || []).map(deco) });
}));

// ── fronter "My Numbers" feed — items in active batches sent to me ────────────
router.get('/my-numbers', asyncHandler(async (req, res) => {
  const { data: myBatches } = await supabaseAdmin.from('distribution_batches')
    .select('id').eq('sent_to_user_id', req.user.id).eq('status', 'active');
  const ids = (myBatches || []).map(b => b.id);
  if (!ids.length) return res.json({ numbers: [] });
  const { data: items } = await supabaseAdmin.from('distribution_batch_items')
    .select('id, phone_number, customer_name, status, notes, batch_id')
    .in('batch_id', ids).order('created_at', { ascending: false }).limit(2000);
  res.json({ numbers: (items || []).map(i => ({ ...i, source: 'batch' })) });
}));

// ── item status / notes update (from the PIP widget) ──────────────────────────
router.put('/items/:id', asyncHandler(async (req, res) => {
  const { data: item } = await supabaseAdmin.from('distribution_batch_items').select('id, batch_id').eq('id', req.params.id).maybeSingle();
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const { data: b } = await supabaseAdmin.from('distribution_batches').select('sent_to_user_id, created_by, status').eq('id', item.batch_id).maybeSingle();
  const sa = await isSuperAdmin(req.user.id);
  if (!sa && b?.sent_to_user_id !== req.user.id && b?.created_by !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
  const patch = { updated_at: new Date().toISOString() };
  if (req.body.status && ['new', 'called', 'callback', 'completed', 'skip', 'transferred'].includes(req.body.status)) patch.status = req.body.status;
  if (req.body.notes !== undefined) patch.notes = req.body.notes ? String(req.body.notes).slice(0, 2000) : null;
  const { data, error } = await supabaseAdmin.from('distribution_batch_items').update(patch).eq('id', item.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ item: data });
}));

module.exports = router;
