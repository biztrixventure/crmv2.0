const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// ============================================================================
// GET /sales - List sales (role-based filtering)
// ============================================================================
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const companyId = req.query.company_id || req.user.company_id;
    const userRole = req.user.role;
    const { status, page = 1, limit = 50 } = req.query;

    logger.info('GET_SALES', `user=${userId}, role=${userRole}, company=${companyId}`);

    let query = supabaseAdmin
      .from('sales')
      .select(`
        *,
        transfers (
          id,
          form_data,
          status,
          created_by
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    // Company filter  
    if (companyId) {
      query = query.eq('company_id', companyId);
    }

    // Role-based filtering
    if (userRole === 'closer') {
      // Closers see only their own sales
      query = query.eq('created_by', userId);
    }
    // Managers, company_admin, superadmin see all company sales

    // Status filter
    if (status) {
      query = query.eq('status', status);
    }

    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      logger.error('GET_SALES', 'Query failed', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({
      sales: data || [],
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  })
);

// ============================================================================
// POST /sales - Create sale from a transfer (closers only)
// ============================================================================
router.post(
  '/',
  [
    body('transfer_id').isUUID().withMessage('Valid transfer ID is required'),
    body('company_id').isUUID().optional(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const companyId = req.body.company_id || req.user.company_id;
    const { transfer_id } = req.body;

    logger.info('CREATE_SALE', `user=${userId}, transfer=${transfer_id}`);

    // Verify the transfer exists and is assigned to this user
    const { data: transfer, error: transferError } = await supabaseAdmin
      .from('transfers')
      .select('*')
      .eq('id', transfer_id)
      .single();

    if (transferError || !transfer) {
      return res.status(404).json({ error: 'Transfer not found' });
    }

    // Verify transfer is in correct state
    if (transfer.status !== 'assigned' && transfer.status !== 'completed') {
      return res.status(400).json({
        error: 'Transfer must be in "assigned" or "completed" status to create a sale',
        current_status: transfer.status,
      });
    }

    // Check if sale already exists for this transfer
    const { data: existingSale } = await supabaseAdmin
      .from('sales')
      .select('id')
      .eq('transfer_id', transfer_id)
      .single();

    if (existingSale) {
      return res.status(409).json({ error: 'A sale already exists for this transfer' });
    }

    // Create the sale
    const { data: sale, error: saleError } = await supabaseAdmin
      .from('sales')
      .insert({
        transfer_id,
        created_by: userId,
        company_id: companyId || transfer.company_id,
        status: 'open',
      })
      .select()
      .single();

    if (saleError) {
      logger.error('CREATE_SALE', 'Insert failed', saleError);
      return res.status(500).json({ error: saleError.message });
    }

    // Update transfer status to completed
    await supabaseAdmin
      .from('transfers')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', transfer_id);

    logger.success('CREATE_SALE', `Sale created: ${sale.id} from transfer ${transfer_id}`);
    res.status(201).json({ sale });
  })
);

// ============================================================================
// PUT /sales/:id - Update sale status
// ============================================================================
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    const { status } = req.body;

    logger.info('UPDATE_SALE', `id=${id}, user=${userId}, status=${status}`);

    // Fetch existing sale
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('sales')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    // Permission check
    const isCreator = existing.created_by === userId;
    const isManager = ['superadmin', 'readonly_admin', 'company_admin', 'manager', 'closer_manager'].includes(userRole);

    if (!isCreator && !isManager) {
      return res.status(403).json({ error: 'You do not have permission to update this sale' });
    }

    // Validate status
    const validStatuses = ['open', 'closed_won', 'closed_lost'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
        allowed: validStatuses,
      });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (status) updates.status = status;

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('sales')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      logger.error('UPDATE_SALE', 'Update failed', updateError);
      return res.status(500).json({ error: updateError.message });
    }

    logger.success('UPDATE_SALE', `Sale updated: ${id}, status=${updated.status}`);
    res.json({ sale: updated });
  })
);

module.exports = router;
