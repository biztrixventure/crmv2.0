const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const logger = require('../utils/logger');
const { requireFeature } = require('../utils/featureGate');

const router = express.Router();

// Role levels that can see all company callbacks
const MANAGER_LEVELS = [
  'superadmin', 'readonly_admin',
  'company_admin', 'operations_manager',
  'fronter_manager', 'manager',
  'closer_manager', 'compliance_manager',
];

// ============================================================================
// GET /callbacks — list callbacks for current user (or all company if manager)
// ============================================================================
router.get('/', asyncHandler(async (req, res) => {
  const userId    = req.user.id;
  const companyId = req.query.company_id || req.user.company_id;
  const status    = req.query.status;
  const priority  = req.query.priority;
  const search    = req.query.search;
  const user_id   = req.query.user_id; // superadmin: filter by specific agent
  const overdue   = req.query.overdue === 'true'; // pending callbacks past their callback_at
  const date_from = req.query.date_from; // ISO date string e.g. "2025-05-01"
  const date_to   = req.query.date_to;   // ISO date string e.g. "2025-05-07"
  const page      = Math.max(1, parseInt(req.query.page)  || 1);
  const limit     = Math.min(200, parseInt(req.query.limit) || 50);
  const offset    = (page - 1) * limit;

  const superadmin  = await isSuperAdmin(userId);
  const isManager   = superadmin || MANAGER_LEVELS.includes(req.user.role);

  let query = supabaseAdmin
    .from('callbacks')
    .select('*', { count: 'exact' })
    .order('callback_at', { ascending: true });

  if (isManager && companyId) {
    query = query.eq('company_id', companyId);
  } else {
    query = query.eq('user_id', userId);
  }

  // Managers can filter by a specific agent
  if (isManager && user_id) query = query.eq('user_id', user_id);

  if (status)   query = query.eq('status', status);
  if (overdue)  query = query.eq('status', 'pending').lt('callback_at', new Date().toISOString());
  if (priority) query = query.eq('priority', priority);
  if (date_from) query = query.gte('callback_at', date_from);
  if (date_to)   query = query.lte('callback_at', date_to + 'T23:59:59.999Z');
  if (search) {
    // Resolve agent names → user_ids so we can OR on user_id
    let agentUserIds = [];
    if (isManager) {
      const { data: matchedProfiles } = await supabaseAdmin
        .from('user_profiles')
        .select('user_id')
        .or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
      agentUserIds = (matchedProfiles || []).map(p => p.user_id);
    }
    const orParts = [
      `customer_name.ilike.%${search}%`,
      `customer_phone.ilike.%${search}%`,
      `customer_email.ilike.%${search}%`,
      `notes.ilike.%${search}%`,
    ];
    if (agentUserIds.length > 0) orParts.push(`user_id.in.(${agentUserIds.join(',')})`);
    query = query.or(orParts.join(','));
  }

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
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

  res.json({ callbacks, total: count || 0, page, limit });
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
  requireFeature('callbacks'),
  [
    body('customer_name').trim().notEmpty().withMessage('customer_name required'),
    body('callback_at').isISO8601().withMessage('callback_at must be ISO8601 datetime'),
    body('customer_phone').optional().trim(),
    body('customer_email').optional({ checkFalsy: true }).isEmail(),
    body('notes').optional().trim(),
    body('source').optional().isIn(['manual', 'transfer', 'sale']),
    body('source_id').optional().isUUID(),
    body('priority').optional().isIn(['High', 'Medium', 'Low']),
    body('customer_timezone').optional().trim(),
    body('customer_state').optional().trim(),
    body('customer_city').optional().trim(),
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
        user_id:           userId,
        company_id:        companyId,
        customer_name:     req.body.customer_name,
        customer_phone:    req.body.customer_phone    || null,
        customer_email:    req.body.customer_email    || null,
        notes:             req.body.notes             || null,
        callback_at:       req.body.callback_at,
        priority:          req.body.priority          || 'Medium',
        status:            'pending',
        source:            req.body.source            || 'manual',
        source_id:         req.body.source_id         || null,
        notified:          false,
        user_timezone:     req.body.user_timezone      || null,
        customer_timezone: req.body.customer_timezone  || null,
        customer_state:    req.body.customer_state     || null,
        customer_city:     req.body.customer_city      || null,
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
    body('status').optional().isIn(['pending', 'completed', 'cancelled', 'no_answer', 'answering_machine']),
    body('callback_at').optional().isISO8601(),
    body('notes').optional().trim(),
    body('customer_name').optional().trim(),
    body('customer_phone').optional().trim(),
    body('priority').optional().isIn(['High', 'Medium', 'Low']),
  ],
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const allowed = ['status', 'notes', 'callback_at', 'customer_name', 'customer_phone', 'customer_email', 'priority'];
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

    // Fetch current record to capture old values for audit log
    const { data: current } = await supabaseAdmin
      .from('callbacks')
      .select('status, callback_at, customer_name, customer_phone, company_id')
      .match(condition)
      .single();

    const { data, error } = await supabaseAdmin
      .from('callbacks')
      .update(updates)
      .match(condition)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'Callback not found or no access' });

    if (current) {
      const auditBase = {
        callback_id:             id,
        company_id:              current.company_id,
        actor_id:                userId,
        notes:                   updates.notes || null,
        customer_name_snapshot:  current.customer_name,
        customer_phone_snapshot: current.customer_phone || null,
      };

      // Log status change
      if (updates.status && updates.status !== current.status) {
        supabaseAdmin.from('callback_audit_log').insert({
          ...auditBase,
          action:     'status_change',
          old_status: current.status,
          new_status: updates.status,
        }).then(() => {}).catch(() => {});
      }

      // Log reschedule (callback_at changed, but status not changing to terminal)
      if (updates.callback_at && updates.callback_at !== current.callback_at) {
        supabaseAdmin.from('callback_audit_log').insert({
          ...auditBase,
          action:          'rescheduled',
          old_status:      current.status,
          new_status:      updates.status || current.status,
          old_callback_at: current.callback_at,
          new_callback_at: updates.callback_at,
        }).then(() => {}).catch(() => {});
      }
    }

    res.json({ callback: data });
  })
);

// ============================================================================
// GET /callbacks/:id/history — full activity timeline for a callback
// ============================================================================
router.get('/:id/history', asyncHandler(async (req, res) => {
  const { id }  = req.params;
  const userId  = req.user.id;

  const superadmin = await isSuperAdmin(userId);
  const isManager  = superadmin || MANAGER_LEVELS.includes(req.user.role);
  const condition  = isManager ? { id } : { id, user_id: userId };

  const { data: cb, error: cbErr } = await supabaseAdmin
    .from('callbacks')
    .select('*')
    .match(condition)
    .single();

  if (cbErr || !cb) return res.status(404).json({ error: 'Callback not found or no access' });

  const { data: logs } = await supabaseAdmin
    .from('callback_audit_log')
    .select('*')
    .eq('callback_id', id)
    .order('created_at', { ascending: true });

  const auditLogs = logs || [];

  // Enrich actor names
  const actorIds = [...new Set([cb.user_id, ...auditLogs.map(l => l.actor_id).filter(Boolean)])];
  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, first_name, last_name')
    .in('user_id', actorIds);
  const nameMap = {};
  (profiles || []).forEach(p => {
    nameMap[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';
  });

  // Build timeline: created event + audit entries
  const timeline = [
    {
      type:         'created',
      action:       'created',
      actor_name:   nameMap[cb.user_id] || 'Unknown',
      occurred_at:  cb.created_at,
      callback_at:  cb.callback_at,
      notes:        cb.notes || null,
    },
    ...auditLogs.map(l => ({
      type:            'audit',
      action:          l.action || 'status_change',
      actor_name:      nameMap[l.actor_id] || 'Unknown',
      occurred_at:     l.created_at,
      old_status:      l.old_status,
      new_status:      l.new_status,
      old_callback_at: l.old_callback_at,
      new_callback_at: l.new_callback_at,
      notes:           l.notes,
    })),
  ];

  res.json({ callback: cb, timeline, agent_name: nameMap[cb.user_id] || 'Unknown' });
}));

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
