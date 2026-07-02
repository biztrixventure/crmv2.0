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
const { isSuperAdmin, getUserCompanies } = require('../models/helpers');
const { CustomerProfileRepository } = require('../models/domain');
const notifications = require('../utils/notificationService');
const { getBatchRules, isDialerRecipient, ruleExclusions, summarize } = require('../utils/batchRules');
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
  // Optional filter chrome (FilterBar). ALL optional — absent → same query as before.
  const search    = String(req.query.q || '').trim();
  const companyId = req.query.company_id || null;
  const dateFrom  = req.query.date_from || null;
  const dateTo    = req.query.date_to || null;

  let query = supabaseAdmin.from('distribution_batches').select('*').eq('status', 'active').order('sent_at', { ascending: false }).limit(300);
  if (sa && req.query.scope === 'all') { /* no owner filter */ }
  else if (box === 'sent') query = query.eq('created_by', req.user.id);
  else query = query.eq('sent_to_user_id', req.user.id);
  if (companyId) query = query.eq('company_id', companyId);
  if (dateFrom)  query = query.gte('sent_at', dateFrom);
  if (dateTo)    query = query.lte('sent_at', `${dateTo}T23:59:59.999Z`);   // inclusive end-of-day
  const { data: rows } = await query;

  let list = rows || [];
  const names = await namesFor(list.flatMap(b => [b.created_by, b.sent_to_user_id]));

  // Free-text search over batch name / sender / recipient names, plus phone via a
  // scoped item lookup — applied in-process over the (<=300) visible batches so no
  // new endpoint is needed. Absent q → this whole block is skipped.
  if (search && list.length) {
    const term = search.toLowerCase();
    const digits = search.replace(/\D/g, '');
    let phoneIds = new Set();
    if (digits.length >= 3) {
      const { data: hits } = await supabaseAdmin.from('distribution_batch_items')
        .select('batch_id').in('batch_id', list.map(b => b.id)).ilike('phone_number', `%${digits}%`);
      (hits || []).forEach(h => phoneIds.add(h.batch_id));
    }
    list = list.filter(b =>
      (b.name || '').toLowerCase().includes(term) ||
      (names[b.created_by] || '').toLowerCase().includes(term) ||
      (names[b.sent_to_user_id] || '').toLowerCase().includes(term) ||
      phoneIds.has(b.id));
  }

  res.json({ batches: list.map(b => ({
    id: b.id, name: b.name, source: b.source, parent_batch_id: b.parent_batch_id,
    created_by: b.created_by, created_by_name: names[b.created_by] || null,
    sent_to_user_id: b.sent_to_user_id, sent_to_name: names[b.sent_to_user_id] || null,
    sent_at: b.sent_at, item_count: b.item_count, company_id: b.company_id,
  })) });
}));

// ── roster: flat, cross-chain "all assigned numbers" (one row per assignment) ──
// Scoped in the RPC (mig 159): superadmin/compliance/readonly see everything;
// managers see their tree (sent/received + descendants) UNION their company's
// fronter batches. Lineage stays on-demand via /:id/lineage.
const ROSTER_ROLES = new Set(['superadmin', 'readonly_admin', 'compliance_manager', 'fronter_manager', 'closer_manager', 'operations_manager', 'company_admin']);
const UNRESTRICTED_ROLES = new Set(['superadmin', 'readonly_admin', 'compliance_manager']);
router.get('/roster', asyncHandler(async (req, res) => {
  if (!ROSTER_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Not allowed' });
  const sa = await isSuperAdmin(req.user.id);
  const unrestricted = sa || UNRESTRICTED_ROLES.has(req.user.role);
  const companyIds = unrestricted ? null : (await getUserCompanies(req.user.id)).map(c => c.id);

  const limit  = Math.min(parseInt(req.query.limit, 10) || 100, 300);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const { data, error } = await supabaseAdmin.rpc('app_batch_roster', {
    p_user: req.user.id,
    p_unrestricted: unrestricted,
    p_company_ids: (companyIds && companyIds.length) ? companyIds : null,
    p_search: (req.query.q || '').trim() || null,
    p_status: req.query.status || null,
    p_company_id: req.query.company_id || null,
    p_date_from: req.query.date_from || null,
    p_date_to: req.query.date_to || null,
    p_limit: limit, p_offset: offset,
  });
  if (error) return res.status(500).json({ error: error.message });

  const rows = data || [];
  // total_count only on page 1 (RPC returns 0 past it) — client keeps it (like Y3).
  const total = offset === 0 ? (rows.length ? Number(rows[0].total_count) : 0) : null;
  const names = await namesFor(rows.flatMap(r => [r.holder_id, r.sender_id]));
  const roster = rows.map(({ total_count, ...r }) => ({
    ...r,
    holder_name: names[r.holder_id] || null,
    sender_name: names[r.sender_id] || null,
  }));
  res.json({ roster, total, limit, offset });
}));

// ── one batch's items ─────────────────────────────────────────────────────────
router.get('/:id/items', asyncHandler(async (req, res) => {
  const { batch, error } = await loadVisibleBatch(req, req.params.id);
  if (error) return res.status(error).json({ error: error === 404 ? 'Batch not found' : 'Not allowed' });
  const { data: items } = await supabaseAdmin.from('distribution_batch_items')
    .select('id, phone_number, lead_id, customer_name, status, notes, exclusion_reason, created_at')
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

  // pull the source items to copy, in the parent's sequence (position, then the
  // legacy created_at order for any pre-158 rows) so the child preserves order.
  let sel = supabaseAdmin.from('distribution_batch_items').select('phone_number, lead_id, customer_name')
    .eq('batch_id', batch.id)
    .order('position', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
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

  // Rule filter — writes 'excluded' rows only when the recipient is a dialer
  // (final hop); upstream managers receive everything.
  const rules = await getBatchRules(child.company_id || null);
  const dialer = await isDialerRecipient(recipientId);
  const exMap = dialer ? await ruleExclusions(srcItems.map(s => s.phone_number), recipientId, child.company_id, rules) : new Map();

  const rows = srcItems.map((s, idx) => {
    const reason = exMap.get(s.phone_number);
    // fresh 1-based position in the child, preserving the parent's order.
    return { batch_id: child.id, position: idx + 1, phone_number: s.phone_number, lead_id: s.lead_id || null, customer_name: s.customer_name || null, ...(reason ? { status: 'excluded', exclusion_reason: reason } : {}) };
  });
  const { error: iErr } = await supabaseAdmin.from('distribution_batch_items').insert(rows);
  if (iErr) { await supabaseAdmin.from('distribution_batches').delete().eq('id', child.id); return res.status(500).json({ error: iErr.message }); }

  notifications.notifyUsers([recipientId], {
    type: 'batch_received', title: 'New batch received',
    message: `${req.user.name || 'A manager'} sent you "${name}" (${rows.length - exMap.size} numbers).`,
    companyId: child.company_id, data: { batch_id: child.id, kind: 'distribution_batch' },
    dedupBase: `batch_${child.id}`,
  }).catch(() => {});
  logger.success('DIST_BATCH', `sub-batch ${child.id} (${rows.length} items, ${exMap.size} excluded) ${req.user.id} → ${recipientId}, parent ${batch.id}`);
  res.status(201).json({ batch: child, excluded_count: exMap.size });
}));

// ── dry-run rule preview for the Create Sub-Batch modal ───────────────────────
router.post('/:id/sub-batch/preview', asyncHandler(async (req, res) => {
  const { batch, error } = await loadVisibleBatch(req, req.params.id);
  if (error) return res.status(error).json({ error: error === 404 ? 'Batch not found' : 'Not allowed' });
  const recipientId = req.body.recipient_id;
  if (!recipientId) return res.status(400).json({ error: 'recipient_id is required' });
  const itemIds = Array.isArray(req.body.item_ids) ? req.body.item_ids.filter(Boolean) : null;
  let sel = supabaseAdmin.from('distribution_batch_items').select('phone_number').eq('batch_id', batch.id).neq('status', 'excluded');
  if (itemIds && itemIds.length) sel = sel.in('id', itemIds);
  const { data: rows } = await sel;
  const phones = [...new Set((rows || []).map(r => r.phone_number).filter(Boolean))];
  const { data: rcr } = await supabaseAdmin.from('user_company_roles').select('company_id').eq('user_id', recipientId).eq('is_active', true).order('created_at', { ascending: true }).limit(1).maybeSingle();
  const rules = await getBatchRules(rcr?.company_id || batch.company_id || null);
  const dialer = await isDialerRecipient(recipientId);
  const exMap = await ruleExclusions(phones, recipientId, rcr?.company_id || batch.company_id, rules);
  res.json({ ...summarize(phones, exMap), recipient_is_dialer: dialer, rules });
}));

// ── multi-recipient split: even (or custom) chunks, sequential or random ──────
// Fisher-Yates shuffle (in place).
function shuffleInPlace(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
// Per-recipient chunk sizes: explicit counts when given (validated by caller),
// else an even split with the remainder handed to the first recipients.
function chunkSizes(n, r, counts) {
  if (Array.isArray(counts) && counts.length === r) return counts.map(c => Math.max(0, parseInt(c, 10) || 0));
  const base = Math.floor(n / r), rem = n % r;
  return Array.from({ length: r }, (_, i) => base + (i < rem ? 1 : 0));
}
// Deal position-ordered `items` to recipients as contiguous chunks (sequential)
// or shuffled chunks (random). Returns [{ recipient_id, items }].
function planSplit(items, recipientIds, mode, counts) {
  const pool = mode === 'random' ? shuffleInPlace([...items]) : [...items];
  const sizes = chunkSizes(pool.length, recipientIds.length, counts);
  const out = []; let idx = 0;
  recipientIds.forEach((rid, i) => { const take = sizes[i] || 0; out.push({ recipient_id: rid, items: pool.slice(idx, idx + take) }); idx += take; });
  return out;
}
// Source items in position order, sliced to an optional [from,to] POSITION range.
async function loadRangeItems(batchId, from, to) {
  const { data } = await supabaseAdmin.from('distribution_batch_items')
    .select('id, phone_number, lead_id, customer_name, position')
    .eq('batch_id', batchId)
    .order('position', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  let items = data || [];
  if (from != null) items = items.filter(it => (it.position ?? 0) >= from);
  if (to   != null) items = items.filter(it => (it.position ?? 0) <= to);
  return items;
}
// Each recipient's primary (first active) company, resolved in one query.
async function recipientCompanies(recipientIds) {
  const { data } = await supabaseAdmin.from('user_company_roles')
    .select('user_id, company_id, created_at').in('user_id', recipientIds).eq('is_active', true)
    .order('created_at', { ascending: true });
  const map = {};
  (data || []).forEach(r => { if (!(r.user_id in map)) map[r.user_id] = r.company_id; });
  return map;
}
function parseSplitBody(body) {
  const recipientIds = Array.isArray(body.recipient_ids) ? [...new Set(body.recipient_ids.filter(Boolean))] : [];
  const mode = body.mode === 'random' ? 'random' : 'sequential';
  const from = (body.from != null && body.from !== '') ? parseInt(body.from, 10) : null;
  const to   = (body.to   != null && body.to   !== '') ? parseInt(body.to, 10)   : null;
  const counts = Array.isArray(body.counts) ? body.counts : null;
  return { recipientIds, mode, from, to, counts };
}

// dry-run: per-recipient chunk sizes + rule-exclusion counts (sizes exact;
// exclusions exact for sequential, an estimate for random since the final
// shuffle differs from this preview's shuffle).
router.post('/:id/split/preview', asyncHandler(async (req, res) => {
  const { batch, error } = await loadVisibleBatch(req, req.params.id);
  if (error) return res.status(error).json({ error: error === 404 ? 'Batch not found' : 'Not allowed' });
  const { recipientIds, mode, from, to, counts } = parseSplitBody(req.body);
  if (!recipientIds.length) return res.status(400).json({ error: 'recipient_ids is required' });
  const items = await loadRangeItems(batch.id, from, to);
  if (!items.length) return res.json({ mode, total: 0, recipients: [] });
  const plan = planSplit(items, recipientIds, mode, counts);
  const cmap = await recipientCompanies(recipientIds);
  const recipients = [];
  for (const part of plan) {
    const companyId = cmap[part.recipient_id] || batch.company_id || null;
    const rules = await getBatchRules(companyId);
    const dialer = await isDialerRecipient(part.recipient_id);
    const exMap = dialer ? await ruleExclusions(part.items.map(x => x.phone_number), part.recipient_id, companyId, rules) : new Map();
    recipients.push({ recipient_id: part.recipient_id, count: part.items.length, excluded: exMap.size, included: part.items.length - exMap.size, recipient_is_dialer: dialer });
  }
  res.json({ mode, total: items.length, recipients });
}));

// Split a range of this batch across many recipients → one child batch each
// (parent_batch_id = source). Runs the rule-filter per recipient. Best-effort
// atomic: if any child fails, all children created in this call are rolled back.
router.post('/:id/split', asyncHandler(async (req, res) => {
  if (!canSend(req)) return res.status(403).json({ error: 'Not allowed to send batches' });
  const { batch, error } = await loadVisibleBatch(req, req.params.id);
  if (error) return res.status(error).json({ error: error === 404 ? 'Batch not found' : 'Not allowed' });
  const { recipientIds, mode, from, to, counts } = parseSplitBody(req.body);
  if (recipientIds.length < 1) return res.status(400).json({ error: 'At least one recipient is required' });

  const items = await loadRangeItems(batch.id, from, to);
  if (!items.length) return res.status(400).json({ error: 'No items in the selected range' });
  if (recipientIds.length > items.length) return res.status(400).json({ error: 'More recipients than numbers in the range' });
  if (counts) {
    const sum = counts.reduce((a, b) => a + (parseInt(b, 10) || 0), 0);
    if (counts.length !== recipientIds.length || sum !== items.length)
      return res.status(400).json({ error: 'counts must have one entry per recipient and sum to the range size' });
  }

  const plan = planSplit(items, recipientIds, mode, counts);
  const cmap = await recipientCompanies(recipientIds);
  const created = [];
  const summary = [];
  try {
    for (const part of plan) {
      if (!part.items.length) continue;   // a 0-count recipient gets no batch
      const companyId = cmap[part.recipient_id] || batch.company_id || null;
      const rules = await getBatchRules(companyId);
      const dialer = await isDialerRecipient(part.recipient_id);
      const exMap = dialer ? await ruleExclusions(part.items.map(x => x.phone_number), part.recipient_id, companyId, rules) : new Map();

      const name = `${batch.name} → split (${mode})`;
      const { data: child, error: bErr } = await supabaseAdmin.from('distribution_batches').insert({
        name, created_by: req.user.id, parent_batch_id: batch.id, source: 'sub_batch',
        sent_to_user_id: part.recipient_id, company_id: companyId, item_count: part.items.length,
      }).select().single();
      if (bErr) throw new Error(bErr.message);
      created.push(child.id);

      const rows = part.items.map((it, idx) => {
        const reason = exMap.get(it.phone_number);
        // sequential → keep the ORIGINAL position (a contiguous slice is self-
        // documenting). random → 1-based DEAL ORDER: the persisted, reproducible
        // audit trail of who got which number in what order (read back with
        // ORDER BY position on the child batch).
        const position = mode === 'random' ? (idx + 1) : (it.position ?? (idx + 1));
        return { batch_id: child.id, position, phone_number: it.phone_number, lead_id: it.lead_id || null, customer_name: it.customer_name || null, ...(reason ? { status: 'excluded', exclusion_reason: reason } : {}) };
      });
      const { error: iErr } = await supabaseAdmin.from('distribution_batch_items').insert(rows);
      if (iErr) throw new Error(iErr.message);

      notifications.notifyUsers([part.recipient_id], {
        type: 'batch_received', title: 'New batch received',
        message: `${req.user.name || 'A manager'} sent you "${name}" (${part.items.length - exMap.size} numbers).`,
        companyId, data: { batch_id: child.id, kind: 'distribution_batch' }, dedupBase: `batch_${child.id}`,
      }).catch(() => {});
      summary.push({ batch_id: child.id, recipient_id: part.recipient_id, item_count: part.items.length, excluded_count: exMap.size });
    }
  } catch (e) {
    if (created.length) await supabaseAdmin.from('distribution_batches').delete().in('id', created);   // rollback
    return res.status(500).json({ error: e.message });
  }
  logger.success('DIST_BATCH', `split ${batch.id} (${mode}) → ${summary.length} recipients, ${items.length} numbers, by ${req.user.id}`);
  res.status(201).json({ mode, total: items.length, children: summary });
}));

// read-only "active rules" for the current user's company (BatchInbox note)
router.get('/rules', asyncHandler(async (req, res) => {
  res.json({ rules: await getBatchRules(req.user.company_id || null) });
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
    .select('id, name, sent_at').eq('sent_to_user_id', req.user.id).eq('status', 'active');
  const ids = (myBatches || []).map(b => b.id);
  if (!ids.length) return res.json({ numbers: [] });
  const nameById = Object.fromEntries((myBatches || []).map(b => [b.id, b.name]));
  const { data: items } = await supabaseAdmin.from('distribution_batch_items')
    .select('id, phone_number, customer_name, status, notes, batch_id, position, lead_id, created_at')
    .in('batch_id', ids).neq('status', 'excluded')   // fronter never sees rule-excluded numbers
    .order('created_at', { ascending: false }).limit(2000);
  // list_name = the batch name so the #Numbers page can group batch items like
  // it groups number_lists; assignment_day null (batches aren't day-scoped).
  res.json({ numbers: (items || []).map(i => ({
    ...i, source: 'batch', list_name: nameById[i.batch_id] || 'Distributed batch', assignment_day: null,
  })) });
}));

// ── number detail: the CUSTOMER behind the number ─────────────────────────────
// Any authenticated holder can look up a number they work. Returns the customer's
// own details — name, phones, email, address, and their vehicle(s) — resolved
// through the customer-identity model. Deliberately NO lead history (no fronter/
// closer/who/when/why): just who the customer is and what they drive.
router.get('/number-detail', asyncHandler(async (req, res) => {
  const phone = String(req.query.phone || '').replace(/\D/g, '');
  if (phone.length < 7) return res.status(400).json({ error: 'A valid phone number is required' });
  const uuid = await CustomerProfileRepository.resolveUuidByPhone(phone);
  if (!uuid) return res.json({ found: false, phone });

  const [{ data: salesR }, { data: transfersR }] = await Promise.all([
    supabaseAdmin.from('sales')
      .select('customer_name, customer_email, customer_address, customer_phone_2, car_year, car_make, car_model, car_vin, sale_date')
      .eq('customer_uuid', uuid).order('sale_date', { ascending: false, nullsFirst: false }).limit(50),
    supabaseAdmin.from('transfers')
      .select('form_data, created_at').eq('customer_uuid', uuid).order('created_at', { ascending: false }).limit(30),
  ]);
  const sales = salesR || [];
  const transfers = transfersR || [];
  if (!sales.length && !transfers.length) return res.json({ found: false, phone });

  const pick = (...vals) => { for (const v of vals) { if (v != null && String(v).trim() !== '') return String(v).trim(); } return null; };
  const topSale = sales[0] || {};
  const fd = (transfers[0] || {}).form_data || {};

  const customer = {
    name:    pick(topSale.customer_name, fd.customer_name, [fd.FirstName, fd.LastName].filter(Boolean).join(' '), fd.Name),
    phone,
    phone_2: pick(topSale.customer_phone_2, fd.Phone2, fd.phone_2, fd.SecondaryPhone),
    email:   pick(topSale.customer_email, fd.Email, fd.email, fd.customer_email),
    address: pick(topSale.customer_address, fd.Address, fd.address, fd.customer_address),
  };

  // distinct vehicles across the customer's sales (+ latest transfer form_data),
  // preferring a row that carries a VIN.
  const vehMap = new Map();
  const addVeh = (year, make, model, vin) => {
    year = pick(year); make = pick(make); model = pick(model); vin = pick(vin);
    if (!year && !make && !model && !vin) return;
    const key = ([year, make, model].filter(Boolean).join(' ').toLowerCase()) || (vin || '').toLowerCase();
    if (!key) return;
    const cur = vehMap.get(key);
    if (!cur) vehMap.set(key, { year, make, model, vin });
    else if (!cur.vin && vin) cur.vin = vin;
  };
  sales.forEach(s => addVeh(s.car_year, s.car_make, s.car_model, s.car_vin));
  addVeh(fd.car_year || fd.Year || fd.vehicle_year, fd.car_make || fd.Make || fd.vehicle_make,
         fd.car_model || fd.Model || fd.vehicle_model, fd.car_vin || fd.VIN || fd.vin);

  res.json({ found: true, phone, customer_uuid: uuid, customer, vehicles: [...vehMap.values()] });
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
