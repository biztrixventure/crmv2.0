const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// ============================================================================
// GET /transfers - List transfers (role-based filtering)
// ============================================================================
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const companyId = req.query.company_id || req.user.company_id;
    const userRole = req.user.role;
    const { status, page = 1, limit = 50 } = req.query;

    logger.info('GET_TRANSFERS', `user=${userId}, role=${userRole}, company=${companyId}`);

    let query = supabaseAdmin
      .from('transfers')
      .select(`
        *,
        user_profiles!transfers_created_by_fkey (first_name, last_name)
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    // Company filter
    if (companyId) {
      query = query.eq('company_id', companyId);
    }

    // Role-based filtering
    switch (userRole) {
      case 'fronter':
        // Fronters see only their own created transfers
        query = query.eq('created_by', userId);
        break;
      case 'closer':
        // Closers see only transfers assigned to them
        query = query.eq('assigned_to', userId);
        break;
      // Managers, company_admin, superadmin see all company transfers (no extra filter)
    }

    // Status filter
    if (status) {
      query = query.eq('status', status);
    }

    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      logger.error('GET_TRANSFERS', 'Query failed', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({
      transfers: data || [],
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  })
);

// ============================================================================
// POST /transfers - Create a new transfer (fronters/managers)
// ============================================================================
router.post(
  '/',
  [
    body('form_data').isObject().withMessage('Form data is required'),
    body('company_id').isUUID().optional(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const companyId = req.body.company_id || req.user.company_id;
    const { form_data } = req.body;

    logger.info('CREATE_TRANSFER', `user=${userId}, company=${companyId}`);

    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const { data: transfer, error } = await supabaseAdmin
      .from('transfers')
      .insert({
        company_id: companyId,
        created_by: userId,
        form_data,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      logger.error('CREATE_TRANSFER', 'Insert failed', error);
      return res.status(500).json({ error: error.message });
    }

    logger.success('CREATE_TRANSFER', `Transfer created: ${transfer.id}`);
    res.status(201).json({ transfer });
  })
);

// ============================================================================
// PUT /transfers/:id - Update transfer (status, assignment)
// ============================================================================
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    const { status, assigned_to, form_data } = req.body;

    logger.info('UPDATE_TRANSFER', `id=${id}, user=${userId}, role=${userRole}`);

    // Fetch existing transfer
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('transfers')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: 'Transfer not found' });
    }

    // Permission check
    const isCreator = existing.created_by === userId;
    const isAssignee = existing.assigned_to === userId;
    const isManager = ['superadmin', 'readonly_admin', 'company_admin', 'manager', 'operations_manager', 'operations'].includes(userRole);

    if (!isCreator && !isAssignee && !isManager) {
      return res.status(403).json({ error: 'You do not have permission to update this transfer' });
    }

    // Validate status transitions
    const validTransitions = {
      pending: ['assigned', 'cancelled'],
      assigned: ['completed', 'cancelled', 'pending'],
      completed: [], // Final state
      cancelled: ['pending'], // Can be reopened
    };

    if (status && !validTransitions[existing.status]?.includes(status)) {
      return res.status(400).json({
        error: `Invalid status transition: ${existing.status} → ${status}`,
        allowed: validTransitions[existing.status],
      });
    }

    // Build update
    const updates = { updated_at: new Date().toISOString() };
    if (status) updates.status = status;
    if (assigned_to) updates.assigned_to = assigned_to;
    if (form_data) updates.form_data = form_data;

    // Auto-set status to 'assigned' when assigning a closer
    if (assigned_to && !status && existing.status === 'pending') {
      updates.status = 'assigned';
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('transfers')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      logger.error('UPDATE_TRANSFER', 'Update failed', updateError);
      return res.status(500).json({ error: updateError.message });
    }

    logger.success('UPDATE_TRANSFER', `Transfer updated: ${id}`);
    res.json({ transfer: updated });
  })
);

module.exports = router;
