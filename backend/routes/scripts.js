const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin, hasPermission } = require('../models/helpers');
const { escapeOrValue } = require('../utils/searchSanitize');

const router = express.Router();

const VALID_AUDIENCE = ['closer', 'fronter', 'both'];

// Which script audiences a viewer may see, derived from their role.
function viewerAudiences(role) {
  if (['fronter', 'fronter_manager'].includes(role)) return ['fronter', 'both'];
  if (['closer', 'closer_manager'].includes(role))   return ['closer', 'both'];
  return ['closer', 'fronter', 'both'];
}

// Scripts reuse the manage_faqs permission (same knowledge-base authority).
async function canManage(req) {
  return (await isSuperAdmin(req.user.id))
    || await hasPermission(req.user.id, req.user.company_id, 'manage_faqs');
}

// ============================================================================
// GET /scripts — role-scoped, searchable call scripts
// ============================================================================
router.get('/', asyncHandler(async (req, res) => {
  const { q, audience, include_inactive } = req.query;
  const allowed = viewerAudiences(req.user.role);
  const manage  = await canManage(req);

  let query = supabaseAdmin.from('scripts').select('*').order('created_at', { ascending: false });

  if (!(manage && (include_inactive === 'true' || include_inactive === true))) {
    query = query.eq('is_active', true);
  }
  if (audience && allowed.includes(audience)) query = query.eq('audience', audience);
  else query = query.in('audience', allowed);

  if (q && q.trim()) {
    const s = escapeOrValue(q.trim());
    query = query.or(`title.ilike.%${s}%,content.ilike.%${s}%,keywords.ilike.%${s}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ scripts: data || [] });
}));

// ============================================================================
// POST /scripts — create (manage_faqs / superadmin)
// ============================================================================
router.post('/', [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('content').trim().notEmpty().withMessage('Script content is required'),
  body('audience').optional().isIn(VALID_AUDIENCE),
  body('keywords').optional({ nullable: true }).isString(),
], asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage scripts' });

  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const { title, content, keywords, audience } = req.body;
  const { data, error } = await supabaseAdmin
    .from('scripts')
    .insert({
      title:      title.trim(),
      content:    content.trim(),
      keywords:   keywords?.trim() || null,
      audience:   VALID_AUDIENCE.includes(audience) ? audience : 'both',
      created_by: req.user.id,
    })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ script: data });
}));

// ============================================================================
// PUT /scripts/:id — update
// ============================================================================
router.put('/:id', [
  body('title').optional().trim().notEmpty(),
  body('content').optional().trim().notEmpty(),
  body('audience').optional().isIn(VALID_AUDIENCE),
  body('keywords').optional({ nullable: true }).isString(),
  body('is_active').optional().isBoolean(),
], asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage scripts' });

  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const updates = { updated_at: new Date().toISOString() };
  if (req.body.title     !== undefined) updates.title     = req.body.title.trim();
  if (req.body.content   !== undefined) updates.content   = req.body.content.trim();
  if (req.body.keywords  !== undefined) updates.keywords  = req.body.keywords?.trim() || null;
  if (req.body.audience  !== undefined) updates.audience  = req.body.audience;
  if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;

  const { data, error } = await supabaseAdmin
    .from('scripts').update(updates).eq('id', req.params.id).select().single();
  if (error)  return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Script not found' });
  res.json({ script: data });
}));

// ============================================================================
// DELETE /scripts/:id
// ============================================================================
router.delete('/:id', asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage scripts' });

  const { error } = await supabaseAdmin.from('scripts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Script deleted' });
}));

module.exports = router;
