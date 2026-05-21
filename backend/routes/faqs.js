const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin, hasPermission } = require('../models/helpers');
const { escapeOrValue } = require('../utils/searchSanitize');

const router = express.Router();

const VALID_AUDIENCE = ['closer', 'fronter', 'both'];

// Which FAQ audiences a viewer may see, derived from their role.
function viewerAudiences(role) {
  if (['fronter', 'fronter_manager'].includes(role)) return ['fronter', 'both'];
  if (['closer', 'closer_manager'].includes(role))   return ['closer', 'both'];
  return ['closer', 'fronter', 'both']; // oversight roles see everything
}

// Which script roles a viewer may see within an FAQ.
function viewerScriptRoles(role) {
  if (['fronter', 'fronter_manager'].includes(role)) return ['fronter', 'both'];
  if (['closer', 'closer_manager'].includes(role))   return ['closer', 'both'];
  return ['closer', 'fronter', 'both'];
}

async function canManage(req) {
  return (await isSuperAdmin(req.user.id))
    || await hasPermission(req.user.id, req.user.company_id, 'manage_faqs');
}

// Validate + normalize an incoming scripts array.
function normalizeScripts(scripts) {
  if (!Array.isArray(scripts)) return [];
  return scripts
    .filter(s => s && typeof s.content === 'string' && s.content.trim())
    .map((s, i) => ({
      label:      (s.label && String(s.label).trim()) || `Script ${i + 1}`,
      content:    String(s.content).trim(),
      role:       VALID_AUDIENCE.includes(s.role) ? s.role : 'both',
      sort_order: i,
    }));
}

async function attachScripts(faqs, { manage, role }) {
  if (!faqs.length) return faqs;
  const ids = faqs.map(f => f.id);
  const { data: scripts } = await supabaseAdmin
    .from('faq_scripts')
    .select('*')
    .in('faq_id', ids)
    .order('sort_order', { ascending: true });

  const allowed = viewerScriptRoles(role);
  const byFaq = {};
  (scripts || []).forEach(s => {
    if (!manage && !allowed.includes(s.role)) return; // role-filter for agents
    (byFaq[s.faq_id] ||= []).push(s);
  });
  return faqs.map(f => ({ ...f, scripts: byFaq[f.id] || [] }));
}

// ============================================================================
// GET /faqs — role-scoped FAQs with role-filtered scripts
// ============================================================================
router.get('/', asyncHandler(async (req, res) => {
  const { q, audience, include_inactive } = req.query;
  const allowed = viewerAudiences(req.user.role);
  const manage  = await canManage(req);

  let query = supabaseAdmin.from('faqs').select('*').order('created_at', { ascending: false });

  if (!(manage && (include_inactive === 'true' || include_inactive === true))) {
    query = query.eq('is_active', true);
  }
  if (audience && allowed.includes(audience)) query = query.eq('audience', audience);
  else query = query.in('audience', allowed);

  if (q && q.trim()) {
    const s = escapeOrValue(q.trim());
    query = query.or(`question.ilike.%${s}%,answer.ilike.%${s}%,keywords.ilike.%${s}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const withScripts = await attachScripts(data || [], { manage, role: req.user.role });
  res.json({ faqs: withScripts });
}));

// ============================================================================
// POST /faqs — create (manage_faqs / superadmin)
// ============================================================================
router.post('/', [
  body('question').trim().notEmpty().withMessage('Question is required'),
  body('answer').trim().notEmpty().withMessage('Answer is required'),
  body('audience').optional().isIn(VALID_AUDIENCE),
  body('keywords').optional({ nullable: true }).isString(),
  body('scripts').optional().isArray(),
], asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage FAQs' });

  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const { question, answer, keywords, audience } = req.body;

  const { data: faq, error } = await supabaseAdmin
    .from('faqs')
    .insert({
      question:   question.trim(),
      answer:     answer.trim(),
      keywords:   keywords?.trim() || null,
      audience:   VALID_AUDIENCE.includes(audience) ? audience : 'both',
      created_by: req.user.id,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const scripts = normalizeScripts(req.body.scripts);
  if (scripts.length) {
    await supabaseAdmin.from('faq_scripts').insert(scripts.map(s => ({ ...s, faq_id: faq.id })));
  }

  const [withScripts] = await attachScripts([faq], { manage: true, role: req.user.role });
  res.status(201).json({ faq: withScripts });
}));

// ============================================================================
// PUT /faqs/:id — update (manage_faqs / superadmin). Replaces scripts if provided.
// ============================================================================
router.put('/:id', [
  body('question').optional().trim().notEmpty(),
  body('answer').optional().trim().notEmpty(),
  body('audience').optional().isIn(VALID_AUDIENCE),
  body('keywords').optional({ nullable: true }).isString(),
  body('is_active').optional().isBoolean(),
  body('scripts').optional().isArray(),
], asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage FAQs' });

  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const { id } = req.params;
  const updates = { updated_at: new Date().toISOString() };
  if (req.body.question  !== undefined) updates.question  = req.body.question.trim();
  if (req.body.answer    !== undefined) updates.answer    = req.body.answer.trim();
  if (req.body.keywords  !== undefined) updates.keywords  = req.body.keywords?.trim() || null;
  if (req.body.audience  !== undefined) updates.audience  = req.body.audience;
  if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;

  const { data: faq, error } = await supabaseAdmin
    .from('faqs').update(updates).eq('id', id).select().single();
  if (error)  return res.status(500).json({ error: error.message });
  if (!faq)   return res.status(404).json({ error: 'FAQ not found' });

  // Replace scripts when an array is supplied (delete-then-insert).
  if (req.body.scripts !== undefined) {
    await supabaseAdmin.from('faq_scripts').delete().eq('faq_id', id);
    const scripts = normalizeScripts(req.body.scripts);
    if (scripts.length) {
      await supabaseAdmin.from('faq_scripts').insert(scripts.map(s => ({ ...s, faq_id: id })));
    }
  }

  const [withScripts] = await attachScripts([faq], { manage: true, role: req.user.role });
  res.json({ faq: withScripts });
}));

// ============================================================================
// DELETE /faqs/:id — permanent delete (scripts cascade)
// ============================================================================
router.delete('/:id', asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage FAQs' });

  const { error } = await supabaseAdmin.from('faqs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'FAQ deleted' });
}));

// ============================================================================
// Per-script endpoints — add / edit / delete a single script on an FAQ.
// (Two-segment paths, so no collision with /:id.)
// ============================================================================

// POST /faqs/:faqId/scripts — append one script
router.post('/:faqId/scripts', [
  body('content').trim().notEmpty().withMessage('Script content is required'),
  body('role').optional().isIn(VALID_AUDIENCE),
  body('label').optional({ nullable: true }).isString(),
], asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage FAQs' });

  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const { faqId } = req.params;
  const { data: faq } = await supabaseAdmin.from('faqs').select('id').eq('id', faqId).single();
  if (!faq) return res.status(404).json({ error: 'FAQ not found' });

  // Next sort_order = current max + 1
  const { data: last } = await supabaseAdmin
    .from('faq_scripts').select('sort_order').eq('faq_id', faqId)
    .order('sort_order', { ascending: false }).limit(1);
  const nextOrder = ((last?.[0]?.sort_order) ?? -1) + 1;

  const { data, error } = await supabaseAdmin
    .from('faq_scripts')
    .insert({
      faq_id:     faqId,
      label:      (req.body.label && req.body.label.trim()) || `Script ${nextOrder + 1}`,
      content:    req.body.content.trim(),
      role:       VALID_AUDIENCE.includes(req.body.role) ? req.body.role : 'both',
      sort_order: nextOrder,
    })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ script: data });
}));

// PUT /faqs/scripts/:scriptId — edit one script
router.put('/scripts/:scriptId', [
  body('content').optional().trim().notEmpty(),
  body('role').optional().isIn(VALID_AUDIENCE),
  body('label').optional({ nullable: true }).isString(),
], asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage FAQs' });

  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const updates = {};
  if (req.body.label   !== undefined) updates.label   = req.body.label?.trim() || null;
  if (req.body.content !== undefined) updates.content = req.body.content.trim();
  if (req.body.role    !== undefined) updates.role    = req.body.role;

  const { data, error } = await supabaseAdmin
    .from('faq_scripts').update(updates).eq('id', req.params.scriptId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Script not found' });
  res.json({ script: data });
}));

// DELETE /faqs/scripts/:scriptId — remove one script
router.delete('/scripts/:scriptId', asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage FAQs' });

  const { error } = await supabaseAdmin.from('faq_scripts').delete().eq('id', req.params.scriptId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Script deleted' });
}));

module.exports = router;
