const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/database');

const router = express.Router();

/**
 * GET /api/transfers
 * List transfers based on user role
 * - Fronter: their own transfers
 * - Closer: transfers assigned to them
 * - Managers: their team's transfers
 */
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const companyId = req.user.company_id;

  // TODO: Implement role-based filtering
  const { data, error } = await supabaseAdmin
    .from('transfers')
    .select('*')
    .eq('company_id', companyId)
    .limit(100);

  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  res.json({ success: true, data });
}));

/**
 * GET /api/transfers/:id
 * Get transfer details
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.company_id;

  const { data, error } = await supabaseAdmin
    .from('transfers')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .single();

  if (error) {
    return res.status(404).json({ success: false, error: 'Transfer not found' });
  }

  res.json({ success: true, data });
}));

/**
 * POST /api/transfers
 * Create new transfer (Fronter only)
 */
router.post('/', asyncHandler(async (req, res) => {
  const { form_data } = req.body;
  const userId = req.user.id;
  const companyId = req.user.company_id;

  // TODO: Validate user is Fronter role
  // TODO: Validate form_data against form schema

  const { data, error } = await supabaseAdmin
    .from('transfers')
    .insert([
      {
        company_id: companyId,
        created_by: userId,
        form_data,
        status: 'pending',
      },
    ])
    .select()
    .single();

  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  res.status(201).json({ success: true, data });
}));

/**
 * PUT /api/transfers/:id/assign
 * Assign transfer to closer
 */
router.put('/:id/assign', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { assigned_to } = req.body;
  const companyId = req.user.company_id;

  // TODO: Validate user has permission to assign
  // TODO: Validate assigned_to user exists and is Closer role

  const { data, error } = await supabaseAdmin
    .from('transfers')
    .update({
      assigned_to,
      status: 'assigned',
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
 * PUT /api/transfers/:id/status
 * Update transfer status
 */
router.put('/:id/status', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const companyId = req.user.company_id;

  // TODO: Validate status is valid: pending, assigned, completed, cancelled
  // TODO: Validate user has permission to update status

  const { data, error } = await supabaseAdmin
    .from('transfers')
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
 * DELETE /api/transfers/:id
 * Archive/delete transfer
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.company_id;

  // TODO: Soft delete or actually delete based on business logic
  const { data, error } = await supabaseAdmin
    .from('transfers')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId);

  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  res.json({ success: true, message: 'Transfer deleted' });
}));

module.exports = router;
