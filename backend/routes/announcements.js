const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { announcementMatches, resolveTargetUserIds, getAudienceReference } = require('../utils/audienceTargeting');

const router = express.Router();

const VALID_TARGET = ['global', 'role', 'users', 'company'];
const VALID_PRIORITY = ['normal', 'high', 'urgent'];

const superadminOnly = asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin access required' });
  next();
});

const viewerOf = (req) => ({ id: req.user.id, role: req.user.role, company_id: req.user.company_id });

// Insert in-app notification rows for the users an announcement targets
// (reuses the existing notifications table + realtime bell). Global = none.
async function notifyTargets(announcement) {
  const ids = await resolveTargetUserIds(announcement);
  if (!ids.length) return;
  const rows = ids.map(uid => ({
    user_id: uid,
    company_id: null,
    type: 'announcement',
    title: announcement.title,
    message: announcement.body?.slice(0, 280) || '',
    data: { announcement_id: announcement.id, priority: announcement.priority },
    is_read: false,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await supabaseAdmin.from('notifications').insert(rows.slice(i, i + 500)).catch(() => {});
  }
}

// ── GET /announcements/reference — pickers (superadmin) ──────────────────────
router.get('/reference', superadminOnly, asyncHandler(async (req, res) => {
  res.json(await getAudienceReference());
}));

// ── GET /announcements/manage — all announcements + read counts (superadmin) ─
router.get('/manage', superadminOnly, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('announcements').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const ids = (data || []).map(a => a.id);
  const counts = {};
  if (ids.length) {
    const { data: reads } = await supabaseAdmin.from('announcement_reads').select('announcement_id').in('announcement_id', ids);
    (reads || []).forEach(r => { counts[r.announcement_id] = (counts[r.announcement_id] || 0) + 1; });
  }
  res.json({ announcements: (data || []).map(a => ({ ...a, read_count: counts[a.id] || 0 })) });
}));

// ── GET /announcements — announcements visible to the caller + read state ────
router.get('/', asyncHandler(async (req, res) => {
  const viewer = viewerOf(req);
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('announcements').select('*').eq('is_active', true).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const visible = (data || [])
    .filter(a => !a.expires_at || a.expires_at > nowIso)
    .filter(a => announcementMatches(a, viewer));

  let readSet = new Set();
  if (visible.length) {
    const { data: reads } = await supabaseAdmin
      .from('announcement_reads').select('announcement_id').eq('user_id', viewer.id)
      .in('announcement_id', visible.map(a => a.id));
    readSet = new Set((reads || []).map(r => r.announcement_id));
  }
  res.json({ announcements: visible.map(a => ({ ...a, is_read: readSet.has(a.id) })) });
}));

// ── POST /announcements — create (superadmin) ────────────────────────────────
router.post('/', superadminOnly, [
  body('title').trim().notEmpty(),
  body('body').trim().notEmpty(),
  body('target_type').optional().isIn(VALID_TARGET),
  body('priority').optional().isIn(VALID_PRIORITY),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const b = req.body;
  const { data, error } = await supabaseAdmin.from('announcements').insert({
    title: b.title.trim(),
    body: b.body.trim(),
    target_type: VALID_TARGET.includes(b.target_type) ? b.target_type : 'global',
    target_roles: b.target_type === 'role' ? (b.target_roles || []) : null,
    target_user_ids: b.target_type === 'users' ? (b.target_user_ids || []) : null,
    target_company_ids: b.target_type === 'company' ? (b.target_company_ids || []) : null,
    priority: VALID_PRIORITY.includes(b.priority) ? b.priority : 'normal',
    expires_at: b.expires_at || null,
    is_active: b.is_active !== false,
    created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  if (data.is_active) notifyTargets(data).catch(() => {});
  res.status(201).json({ announcement: data });
}));

// ── PUT /announcements/:id — update (superadmin) ─────────────────────────────
router.put('/:id', superadminOnly, asyncHandler(async (req, res) => {
  const b = req.body;
  const updates = { updated_at: new Date().toISOString() };
  ['title', 'body', 'expires_at', 'is_active', 'priority'].forEach(k => { if (b[k] !== undefined) updates[k] = b[k]; });
  if (b.target_type !== undefined) {
    updates.target_type = b.target_type;
    updates.target_roles = b.target_type === 'role' ? (b.target_roles || []) : null;
    updates.target_user_ids = b.target_type === 'users' ? (b.target_user_ids || []) : null;
    updates.target_company_ids = b.target_type === 'company' ? (b.target_company_ids || []) : null;
  }
  const { data, error } = await supabaseAdmin.from('announcements').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json({ announcement: data });
}));

// ── DELETE /announcements/:id (superadmin) ───────────────────────────────────
router.delete('/:id', superadminOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('announcements').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Deleted' });
}));

// ── POST /announcements/:id/read — mark read (any user) ──────────────────────
router.post('/:id/read', asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin
    .from('announcement_reads')
    .upsert({ announcement_id: req.params.id, user_id: req.user.id, read_at: new Date().toISOString() }, { onConflict: 'announcement_id,user_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Marked read' });
}));

module.exports = router;
