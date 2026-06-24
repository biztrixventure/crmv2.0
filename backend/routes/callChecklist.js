/**
 * Call-checklist questions. Closers READ the active list (shown in a floating
 * panel they tick off during a call — ephemeral, never logged). Compliance and
 * superadmin manage the list (create / edit / hide / delete / reorder).
 */
const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');

const router = express.Router();

async function canManage(req) {
  return (await isSuperAdmin(req.user.id)) || req.user.role === 'compliance_manager';
}

// GET /call-checklist — active questions for everyone; managers can pass ?all=1.
router.get('/', asyncHandler(async (req, res) => {
  const manage = await canManage(req);
  let q = supabaseAdmin.from('call_checklist_questions').select('*')
    .order('sort_order', { ascending: true }).order('created_at', { ascending: true });
  if (!(manage && (req.query.all === '1' || req.query.all === 'true'))) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ questions: data || [] });
}));

// POST /call-checklist — create (compliance / superadmin).
router.post('/', [body('text').trim().notEmpty().withMessage('Question text required')], asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage questions' });
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
  const { data, error } = await supabaseAdmin.from('call_checklist_questions').insert({
    text: req.body.text.trim().slice(0, 500),
    sort_order: Number.isFinite(+req.body.sort_order) ? +req.body.sort_order : 0,
    created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ question: data });
}));

// PUT /call-checklist/:id — edit text / toggle active / reorder.
router.put('/:id', asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage questions' });
  const u = { updated_at: new Date().toISOString() };
  if (typeof req.body.text === 'string' && req.body.text.trim()) u.text = req.body.text.trim().slice(0, 500);
  if (typeof req.body.is_active === 'boolean') u.is_active = req.body.is_active;
  if (Number.isFinite(+req.body.sort_order)) u.sort_order = +req.body.sort_order;
  const { data, error } = await supabaseAdmin.from('call_checklist_questions').update(u).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Question not found' });
  res.json({ question: data });
}));

// DELETE /call-checklist/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage questions' });
  const { error } = await supabaseAdmin.from('call_checklist_questions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'deleted' });
}));

module.exports = router;
