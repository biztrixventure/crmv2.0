const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/database');

const router = express.Router();

/**
 * GET /api/sales
 * List sales based on user role
 * - Closer: their own sales
 * - Managers: their team's sales
 */
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const companyId = req.user.company_id;

  // TODO: Implement role-based filtering
  const { data, error } = await supabaseAdmin
    .from('sales')
    .select('*')
    .eq('company_id', companyId)
    .limit(100);

  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  res.json({ success: true, data });
}));

/**
 * GET /api/sales/:id
 * Get sale details
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.company_id;

  const { data, error } = await supabaseAdmin
    .from('sales')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .single();

  if (error) {
    return res.status(404).json({ success: false, error: 'Sale not found' });
  }

  res.json({ success: true, data });
}));

/**
 * POST /api/sales
 * Create new sale from transfer (Closer only)
 */
router.post('/', asyncHandler(async (req, res) => {
  const { transfer_id } = req.body;
  const userId = req.user.id;
  const companyId = req.user.company_id;

  // TODO: Validate user is Closer role
  // TODO: Validate transfer exists and is assigned to this user
  // TODO: Validate transfer is not already converted to sale

  const { data, error } = await supabaseAdmin
    .from('sales')
    .insert([
      {
        transfer_id,
        company_id: companyId,
        created_by: userId,
        status: 'open',
      },
    ])
    .select()
    .single();

  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  // TODO: Update transfer status to 'completed'

  res.status(201).json({ success: true, data });
}));

/**
 * PUT /api/sales/:id/status
 * Update sale status
 */
router.put('/:id/status', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const companyId = req.user.company_id;

  // TODO: Validate status is valid: open, closed_won, closed_lost
  // TODO: Validate user has permission to update status

  const { data, error } = await supabaseAdmin
    .from('sales')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('company_id', companyId)
    .select()
    .single();

  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  res.json({ success: true, data });
}));

/**
 * DELETE /api/sales/:id
 * Archive/delete sale
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.company_id;

  // TODO: Soft delete or actually delete based on business logic
  const { data, error } = await supabaseAdmin
    .from('sales')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId);

  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  res.json({ success: true, message: 'Sale deleted' });
}));

module.exports = router;
