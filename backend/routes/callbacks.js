const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const logger = require('../utils/logger');

const router = express.Router();

// Role levels that can see all company callbacks
const MANAGER_LEVELS = ['superadmin', 'readonly_admin', 'company_admin', 'manager', 'closer_manager', 'operations_manager'];

// ============================================================================
// GET /callbacks — list callbacks for current user (or all company if manager)
// ============================================================================
router.get('/', asyncHandler(async (req, res) => {
  const userId    = req.user.id;
  const companyId = req.query.company_id || req.user.company_id;
  const status    = req.query.status; // optional filter

  const superadmin  = await isSuperAdmin(userId);
  const isManager   = superadmin || MANAGER_LEVELS.includes(req.user.role);

  let query = supabaseAdmin
    .from('callbacks')
    .select('*')
    .order('callback_at', { ascending: true });

  if (isManager && companyId) {
    query = query.eq('company_id', companyId);
  } else {
    query = query.eq('user_id', userId);
  }

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const callbacks = data || [];

  // Enrich with user display name (managers see whose callback it is)
  if (isManager && callbacks.length > 0) {
    const userIds = [...new Set(callbacks.map(c => c.user_id))];
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, first_name, last_name')
      .in('user_id', userIds);
    const profileMap = {};
    (profiles || []).forEach(p => {
      profileMap[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';
    });
    callbacks.forEach(c => { c.user_name = profileMap[c.user_id] || 'Unknown'; });
  }

  res.json({ callbacks });
}));

// ============================================================================
// GET /callbacks/:id — get single callback by id
// ============================================================================
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const superadmin = await isSuperAdmin(userId);
  const isManager  = superadmin || MANAGER_LEVELS.includes(req.user.role);

  const condition = isManager ? { id } : { id, user_id: userId };

  const { data, error } = await supabaseAdmin
    .from('callbacks')
    .select('*')
    .match(condition)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Callback not found or no access' });

  res.json({ callback: data });
}));

// ============================================================================
// POST /callbacks — create a callback
// ============================================================================
router.post('/',
  [
    body('customer_name').trim().notEmpty().withMessage('customer_name required'),
    body('callback_at').isISO8601().withMessage('callback_at must be ISO8601 datetime'),
    body('customer_phone').optional().trim(),
    body('customer_email').optional().isEmail(),
    body('notes').optional().trim(),
    body('source').optional().isIn(['manual', 'transfer', 'sale']),
    body('source_id').optional().isUUID(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const userId    = req.user.id;
    const companyId = req.body.company_id || req.user.company_id;

    if (!companyId) return res.status(400).json({ error: 'company_id required' });

    const { data, error } = await supabaseAdmin
      .from('callbacks')
      .insert({
        user_id:        userId,
        company_id:     companyId,
        customer_name:  req.body.customer_name,
        customer_phone: req.body.customer_phone || null,
        customer_email: req.body.customer_email || null,
        notes:          req.body.notes          || null,
        callback_at:    req.body.callback_at,
        status:         'pending',
        source:         req.body.source  || 'manual',
        source_id:      req.body.source_id || null,
        notified:       false,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    logger.info('CALLBACKS', `Created callback for ${data.customer_name} at ${data.callback_at}`, { userId });
    res.status(201).json({ callback: data });
  })
);

// ============================================================================
// PUT /callbacks/:id — update (status, notes, reschedule)
// ============================================================================
router.put('/:id',
  [
    body('status').optional().isIn(['pending', 'completed', 'cancelled', 'no_answer']),
    body('callback_at').optional().isISO8601(),
    body('notes').optional().trim(),
    body('customer_name').optional().trim(),
    body('customer_phone').optional().trim(),
  ],
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const allowed = ['status', 'notes', 'callback_at', 'customer_name', 'customer_phone', 'customer_email'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    // When rescheduling, reset notified so push fires again
    if (updates.callback_at) updates.notified = false;
    updates.updated_at = new Date().toISOString();

    // Only owner or manager can update
    const superadmin = await isSuperAdmin(userId);
    const condition  = superadmin ? { id } : { id, user_id: userId };

    const { data, error } = await supabaseAdmin
      .from('callbacks')
      .update(updates)
      .match(condition)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'Callback not found or no access' });

    res.json({ callback: data });
  })
);

// ============================================================================
// DELETE /callbacks/:id
// ============================================================================
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const superadmin = await isSuperAdmin(userId);
  const condition  = superadmin ? { id } : { id, user_id: userId };

  const { error } = await supabaseAdmin.from('callbacks').delete().match(condition);
  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: 'Callback deleted' });
}));

module.exports = router;
