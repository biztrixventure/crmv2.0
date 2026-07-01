// ============================================================================
// /note-shortcodes — predefined "/code → text" notes for the fronter PIP notes
// field. SERVER-SIDE + company-scoped (unlike chat's localStorage templates).
// Anyone authed READS their company's set (+ global); managers/superadmin CRUD.
// Mounted at /api/note-shortcodes (authMiddleware). See migration 155.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');

const router = express.Router();

// Who may curate the shortcode list (per the ask: superadmin + fronter_manager;
// plus the fronter-side manager tier). Flip by editing this set.
const MANAGER_ROLES = new Set(['superadmin', 'fronter_manager', 'operations_manager', 'company_admin']);
const canManage = (req) => MANAGER_ROLES.has(req.user.role);

// GET — my PERSONAL + my company + global rows, each tagged with its tier
// ('mine'|'company'|'global'). NOT deduped server-side: the PIP dedups
// personal-wins for the autocomplete, while the manager UI wants the raw
// company/global rows. One call so callers don't round-trip twice.
router.get('/', asyncHandler(async (req, res) => {
  const me = req.user.id;
  const companyId = req.query.company_id || req.user.company_id || null;
  const orParts = [`owner_user_id.eq.${me}`];
  orParts.push(companyId
    ? `and(owner_user_id.is.null,or(company_id.is.null,company_id.eq.${companyId}))`
    : `and(owner_user_id.is.null,company_id.is.null)`);
  const { data, error } = await supabaseAdmin.from('note_shortcodes')
    .select('*').or(orParts.join(',')).order('sort_order', { ascending: true }).order('code', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  const tierOf = (r) => (r.owner_user_id ? 'mine' : (r.company_id ? 'company' : 'global'));
  res.json({ shortcodes: (data || []).map(r => ({ ...r, tier: tierOf(r) })) });
}));

// ── PERSONAL shortcodes — ANY authed user, OWN rows only ──────────────────────
// POST /mine upserts by (owner, code) so re-adding a code overwrites the text.
router.post('/mine', asyncHandler(async (req, res) => {
  const me = req.user.id;
  const code = String(req.body.code || '').trim().replace(/^\/+/, '').toLowerCase().slice(0, 40);
  const text = String(req.body.text || '').trim().slice(0, 2000);
  if (!code || !text) return res.status(400).json({ error: 'code and text are required' });
  const { data: existing } = await supabaseAdmin.from('note_shortcodes').select('id').eq('owner_user_id', me).eq('code', code).maybeSingle();
  let row, error;
  if (existing) ({ data: row, error } = await supabaseAdmin.from('note_shortcodes').update({ text, updated_at: new Date().toISOString() }).eq('id', existing.id).select().single());
  else ({ data: row, error } = await supabaseAdmin.from('note_shortcodes').insert({ owner_user_id: me, company_id: null, code, text, created_by: me }).select().single());
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ shortcode: { ...row, tier: 'mine' } });
}));

router.put('/mine/:id', asyncHandler(async (req, res) => {
  const me = req.user.id;
  const { data: existing } = await supabaseAdmin.from('note_shortcodes').select('owner_user_id').eq('id', req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.owner_user_id !== me) return res.status(403).json({ error: 'Not your shortcut' });
  const patch = { updated_at: new Date().toISOString() };
  if (req.body.code !== undefined) patch.code = String(req.body.code).trim().replace(/^\/+/, '').toLowerCase().slice(0, 40);
  if (req.body.text !== undefined) patch.text = String(req.body.text).trim().slice(0, 2000);
  const { data, error } = await supabaseAdmin.from('note_shortcodes').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'You already have that code' : error.message });
  res.json({ shortcode: { ...data, tier: 'mine' } });
}));

router.delete('/mine/:id', asyncHandler(async (req, res) => {
  const me = req.user.id;
  const { data: existing } = await supabaseAdmin.from('note_shortcodes').select('owner_user_id').eq('id', req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.owner_user_id !== me) return res.status(403).json({ error: 'Not your shortcut' });
  const { error } = await supabaseAdmin.from('note_shortcodes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// POST — create (superadmin may target a company or global; managers → their company)
router.post('/', asyncHandler(async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Not allowed' });
  const code = String(req.body.code || '').trim().replace(/^\/+/, '').toLowerCase().slice(0, 40);
  const text = String(req.body.text || '').trim().slice(0, 2000);
  if (!code || !text) return res.status(400).json({ error: 'code and text are required' });
  const sa = await isSuperAdmin(req.user.id);
  const company_id = sa ? (req.body.company_id || null) : (req.user.company_id || null);
  const row = { company_id, code, text, sort_order: Number.isFinite(+req.body.sort_order) ? +req.body.sort_order : 0, created_by: req.user.id };
  const { data, error } = await supabaseAdmin.from('note_shortcodes').insert(row).select().single();
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'That code already exists for this scope' : error.message });
  res.status(201).json({ shortcode: data });
}));

// PUT — edit code/text/order (scoped: managers can only touch their company's)
router.put('/:id', asyncHandler(async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Not allowed' });
  const { data: existing } = await supabaseAdmin.from('note_shortcodes').select('company_id, owner_user_id').eq('id', req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.owner_user_id) return res.status(403).json({ error: 'Personal shortcut — manage it from the widget' });
  const sa = await isSuperAdmin(req.user.id);
  if (!sa && existing.company_id !== (req.user.company_id || null)) return res.status(403).json({ error: 'Out of scope' });
  const patch = { updated_at: new Date().toISOString() };
  if (req.body.code !== undefined) patch.code = String(req.body.code).trim().replace(/^\/+/, '').toLowerCase().slice(0, 40);
  if (req.body.text !== undefined) patch.text = String(req.body.text).trim().slice(0, 2000);
  if (req.body.sort_order !== undefined && Number.isFinite(+req.body.sort_order)) patch.sort_order = +req.body.sort_order;
  const { data, error } = await supabaseAdmin.from('note_shortcodes').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'That code already exists for this scope' : error.message });
  res.json({ shortcode: data });
}));

// DELETE — scoped like PUT
router.delete('/:id', asyncHandler(async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Not allowed' });
  const { data: existing } = await supabaseAdmin.from('note_shortcodes').select('company_id, owner_user_id').eq('id', req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.owner_user_id) return res.status(403).json({ error: 'Personal shortcut — manage it from the widget' });
  const sa = await isSuperAdmin(req.user.id);
  if (!sa && existing.company_id !== (req.user.company_id || null)) return res.status(403).json({ error: 'Out of scope' });
  const { error } = await supabaseAdmin.from('note_shortcodes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

module.exports = router;
