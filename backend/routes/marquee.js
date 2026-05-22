const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { arrayTargetMatches, getAudienceReference } = require('../utils/audienceTargeting');

const router = express.Router();
const VALID_SPEED = ['slow', 'normal', 'fast'];

const superadminOnly = asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin access required' });
  next();
});

router.get('/reference', superadminOnly, asyncHandler(async (req, res) => res.json(await getAudienceReference())));

// All items (superadmin)
router.get('/manage', superadminOnly, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('marquee_items').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data || [] });
}));

// Active items visible to the caller, within their time window
router.get('/', asyncHandler(async (req, res) => {
  const viewer = { id: req.user.id, role: req.user.role, company_id: req.user.company_id };
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('marquee_items').select('*').eq('is_active', true).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const items = (data || [])
    .filter(m => (!m.starts_at || m.starts_at <= nowIso) && (!m.ends_at || m.ends_at > nowIso))
    .filter(m => arrayTargetMatches(m, viewer));
  res.json({ items });
}));

router.post('/', superadminOnly, [
  body('byline').trim().notEmpty(),
  body('content').trim().notEmpty(),
  body('speed').optional().isIn(VALID_SPEED),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });
  const b = req.body;
  const { data, error } = await supabaseAdmin.from('marquee_items').insert({
    byline: b.byline.trim(),
    content: b.content.trim(),
    speed: VALID_SPEED.includes(b.speed) ? b.speed : 'normal',
    is_active: b.is_active !== false,
    target_company_ids: b.target_company_ids?.length ? b.target_company_ids : null,
    target_roles: b.target_roles?.length ? b.target_roles : null,
    target_user_ids: b.target_user_ids?.length ? b.target_user_ids : null,
    bg_color: b.bg_color || '#1e40af',
    text_color: b.text_color || '#ffffff',
    starts_at: b.starts_at || new Date().toISOString(),
    ends_at: b.ends_at || null,
    created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ item: data });
}));

router.put('/:id', superadminOnly, asyncHandler(async (req, res) => {
  const b = req.body;
  const updates = {};
  ['byline', 'content', 'speed', 'is_active', 'bg_color', 'text_color', 'starts_at', 'ends_at'].forEach(k => { if (b[k] !== undefined) updates[k] = b[k]; });
  ['target_company_ids', 'target_roles', 'target_user_ids'].forEach(k => { if (b[k] !== undefined) updates[k] = b[k]?.length ? b[k] : null; });
  const { data, error } = await supabaseAdmin.from('marquee_items').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json({ item: data });
}));

router.delete('/:id', superadminOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('marquee_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Deleted' });
}));

module.exports = router;
