const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin, hasPermission } = require('../models/helpers');
const { escapeOrValue } = require('../utils/searchSanitize');
const { makeCategoryRouter, cleanCategoryIds } = require('../utils/categoryRoutes');

const router = express.Router();

const VALID_AUDIENCE = ['closer', 'fronter', 'both'];

// Which FAQ audiences a viewer may see, derived from their role.
function viewerAudiences(role) {
  if (['fronter', 'fronter_manager'].includes(role)) return ['fronter', 'both'];
  if (['closer', 'closer_manager'].includes(role))   return ['closer', 'both'];
  return ['closer', 'fronter', 'both']; // oversight roles see everything
}

async function canManage(req) {
  return (await isSuperAdmin(req.user.id))
    || await hasPermission(req.user.id, req.user.company_id, 'manage_faqs');
}

// Category CRUD (mounted before /:id so "categories" isn't read as an id).
router.use('/categories', makeCategoryRouter('faq_categories', canManage));

// ============================================================================
// GET /faqs — role-scoped, searchable Q&A
// ============================================================================
router.get('/', asyncHandler(async (req, res) => {
  const { q, audience, include_inactive, category_id } = req.query;
  const allowed = viewerAudiences(req.user.role);
  const manage  = await canManage(req);

  let query = supabaseAdmin.from('faqs').select('*').order('created_at', { ascending: false });

  if (!(manage && (include_inactive === 'true' || include_inactive === true))) {
    query = query.eq('is_active', true);
  }
  if (audience && allowed.includes(audience)) query = query.eq('audience', audience);
  else query = query.in('audience', allowed);

  // Category filter (uuid[] contains the selected category).
  if (category_id && /^[0-9a-f-]{36}$/i.test(category_id)) query = query.contains('category_ids', [category_id]);

  if (q && q.trim()) {
    const s = escapeOrValue(q.trim());
    query = query.or(`question.ilike.%${s}%,answer.ilike.%${s}%,keywords.ilike.%${s}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ faqs: data || [] });
}));

// ============================================================================
// POST /faqs — create (manage_faqs / superadmin)
// ============================================================================
router.post('/', [
  body('question').trim().notEmpty().withMessage('Question is required'),
  body('answer').trim().notEmpty().withMessage('Answer is required'),
  body('audience').optional().isIn(VALID_AUDIENCE),
  body('keywords').optional({ nullable: true }).isString(),
], asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage FAQs' });

  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const { question, answer, keywords, audience } = req.body;
  const categoryIds = cleanCategoryIds(req.body.category_ids);
  const { data, error } = await supabaseAdmin
    .from('faqs')
    .insert({
      question:   question.trim(),
      answer:     answer.trim(),
      keywords:   keywords?.trim() || null,
      audience:   VALID_AUDIENCE.includes(audience) ? audience : 'both',
      category_ids: categoryIds || [],
      created_by: req.user.id,
    })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ faq: data });
}));

// ============================================================================
// PUT /faqs/:id — update (manage_faqs / superadmin)
// ============================================================================
router.put('/:id', [
  body('question').optional().trim().notEmpty(),
  body('answer').optional().trim().notEmpty(),
  body('audience').optional().isIn(VALID_AUDIENCE),
  body('keywords').optional({ nullable: true }).isString(),
  body('is_active').optional().isBoolean(),
], asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage FAQs' });

  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const updates = { updated_at: new Date().toISOString() };
  if (req.body.question  !== undefined) updates.question  = req.body.question.trim();
  if (req.body.answer    !== undefined) updates.answer    = req.body.answer.trim();
  if (req.body.keywords  !== undefined) updates.keywords  = req.body.keywords?.trim() || null;
  if (req.body.audience  !== undefined) updates.audience  = req.body.audience;
  if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;
  const catIds = cleanCategoryIds(req.body.category_ids);
  if (catIds !== undefined) updates.category_ids = catIds;

  const { data, error } = await supabaseAdmin
    .from('faqs').update(updates).eq('id', req.params.id).select().single();
  if (error)  return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'FAQ not found' });
  res.json({ faq: data });
}));

// ============================================================================
// DELETE /faqs/:id
// ============================================================================
router.delete('/:id', asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage FAQs' });

  const { error } = await supabaseAdmin.from('faqs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'FAQ deleted' });
}));

module.exports = router;
