const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const notifications = require('../utils/notificationService');

const router = express.Router();

const MANAGER_ROLES = ['superadmin', 'readonly_admin', 'company_admin', 'manager', 'operations_manager', 'closer_manager'];

// ============================================================================
// GET /transfers
// ============================================================================
router.get('/', asyncHandler(async (req, res) => {
  const userId    = req.user.id;
  const companyId = req.query.company_id || req.user.company_id;
  const userRole  = req.user.role;
  const { status, page = 1, limit = 50, search, date_from, date_to } = req.query;

  let query = supabaseAdmin
    .from('transfers')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  // Transfers are stored under the fronter's company_id.
  // Closers/closer_managers are in a different (closer) company — don't filter by company_id for them.
  const isCloserSide = userRole === 'closer' || userRole === 'closer_manager';
  if (!isCloserSide && companyId) query = query.eq('company_id', companyId);

  switch (userRole) {
    case 'fronter':
      query = query.eq('created_by', userId);
      break;
    case 'closer':
      // Only see transfers assigned to this closer
      query = query.eq('assigned_closer_id', userId);
      break;
    case 'closer_manager': {
      // See transfers assigned to any closer in their company
      const { data: companyUsers } = await supabaseAdmin
        .from('user_company_roles')
        .select('user_id')
        .eq('company_id', companyId)
        .eq('is_active', true);
      const closerIds = (companyUsers || []).map(u => u.user_id);
      if (closerIds.length === 0) {
        return res.json({ transfers: [], total: 0, page: parseInt(page), limit: parseInt(limit) });
      }
      query = query.in('assigned_closer_id', closerIds);
      break;
    }
    // fronter_manager, operations_manager, superadmin, company_admin — see all transfers for company
  }

  if (status)    query = query.eq('status', status);
  if (date_from) query = query.gte('created_at', date_from + 'T00:00:00');
  if (date_to)   query = query.lte('created_at', date_to   + 'T23:59:59');

  if (search) {
    query = query.or(
      `form_data->>'customer_name'.ilike.%${search}%,form_data->>'customer_phone'.ilike.%${search}%`
    );
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  query = query.range(offset, offset + parseInt(limit) - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Enrich with creator names via separate query (user_profiles.user_id = auth user id)
  const creatorIds = [...new Set((data || []).map(t => t.created_by).filter(Boolean))];
  let profileMap = {};
  if (creatorIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, first_name, last_name')
      .in('user_id', creatorIds);
    (profiles || []).forEach(p => { profileMap[p.user_id] = p; });
  }

  const transfers = (data || []).map(t => ({
    ...t,
    user_profiles: profileMap[t.created_by] || null,
  }));

  res.json({ transfers, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
}));

// ============================================================================
// GET /transfers/closers — list available closers for a fronter company
// Uses company_links: finds all closer companies linked to the fronter's company,
// then returns closers from all of them (with company_name for display).
// ============================================================================
router.get('/closers', asyncHandler(async (req, res) => {
  const companyId = req.query.company_id || req.user.company_id;

  logger.info('[closers] companyId=%s userCompanyId=%s queryCompanyId=%s role=%s userId=%s',
    companyId, req.user.company_id, req.query.company_id, req.user.role, req.user.id);

  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  // Step 1: get linked closer company IDs (no FK join — avoids constraint-name issues)
  const { data: links, error: linkErr } = await supabaseAdmin
    .from('company_links')
    .select('closer_company_id')
    .eq('fronter_company_id', companyId);

  logger.info('[closers] company_links query for fronter_company_id=%s → rows=%d err=%s',
    companyId, links?.length ?? 0, linkErr?.message ?? 'none');

  if (linkErr) return res.status(500).json({ error: linkErr.message });
  if (!links || links.length === 0) return res.json({ closers: [], _debug: { companyId, links: [] } });

  const closerCompanyIds = links.map(l => l.closer_company_id);
  logger.info('[closers] closerCompanyIds=%j', closerCompanyIds);

  // Step 2: fetch company names separately
  const { data: companies } = await supabaseAdmin
    .from('companies')
    .select('id, name')
    .in('id', closerCompanyIds);

  const companyNameMap = {};
  (companies || []).forEach(c => { companyNameMap[c.id] = c.name; });

  // Step 3: get active users in those companies (no user_profiles join — no FK in schema cache)
  const { data, error } = await supabaseAdmin
    .from('user_company_roles')
    .select('user_id, company_id, custom_roles (level, name)')
    .in('company_id', closerCompanyIds)
    .eq('is_active', true);

  logger.info('[closers] user_company_roles rows=%d err=%s', data?.length ?? 0, error?.message ?? 'none');
  if (data) {
    data.forEach(r => logger.info('[closers] user=%s company=%s role_level=%s role_name=%s',
      r.user_id, r.company_id, r.custom_roles?.level, r.custom_roles?.name));
  }

  if (error) return res.status(500).json({ error: error.message });

  // Step 4: fetch profiles separately (user_profiles.user_id = auth user id, not user_profiles.id)
  const userIds = [...new Set((data || []).map(r => r.user_id).filter(Boolean))];
  let profileMap = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, first_name, last_name')
      .in('user_id', userIds);
    (profiles || []).forEach(p => { profileMap[p.user_id] = p; });
  }

  // Accept any role whose level contains 'closer' (case-insensitive)
  const closers = (data || [])
    .filter(r => (r.custom_roles?.level || '').toLowerCase().includes('closer'))
    .map(r => ({
      id:           r.user_id,
      first_name:   profileMap[r.user_id]?.first_name || '',
      last_name:    profileMap[r.user_id]?.last_name  || '',
      role_name:    r.custom_roles?.name              || 'Closer',
      company_name: companyNameMap[r.company_id]      || '',
    }));

  logger.info('[closers] final closers count=%d', closers.length);
  res.json({ closers, _debug: { companyId, closerCompanyIds, rawCount: data?.length ?? 0 } });
}));

// ============================================================================
// POST /transfers — fronter creates + directly assigns to a closer
// ============================================================================
router.post('/', [
  body('form_data').isObject().withMessage('form_data required'),
  body('assigned_closer_id').isUUID().withMessage('assigned_closer_id (UUID) required'),
  body('company_id').isUUID().optional(),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

  const userId    = req.user.id;
  const companyId = req.body.company_id || req.user.company_id;
  const { form_data, assigned_closer_id } = req.body;

  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const { data: transfer, error } = await supabaseAdmin
    .from('transfers')
    .insert({
      company_id:         companyId,
      created_by:         userId,
      form_data,
      assigned_closer_id,
      assigned_to:        assigned_closer_id, // keep backward compat
      status:             'assigned',         // directly assigned, no pending queue
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Notify closer + floor managers
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const fronterName = authUser?.user?.user_metadata?.first_name || authUser?.user?.email || 'A fronter';

  notifications.onTransferCreated({ transfer, fronterName, closerUserId: assigned_closer_id }).catch(() => {});

  res.status(201).json({ transfer });
}));

// ============================================================================
// POST /transfers/:id/reject — closer rejects a transfer
// ============================================================================
router.post('/:id/reject', [
  body('reason').isString().notEmpty().withMessage('Rejection reason required'),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

  const { id } = req.params;
  const userId  = req.user.id;
  const { reason } = req.body;

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('transfers')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !existing) return res.status(404).json({ error: 'Transfer not found' });

  // Only the assigned closer can reject
  if (existing.assigned_closer_id !== userId) {
    return res.status(403).json({ error: 'Only the assigned closer can reject this transfer' });
  }

  if (!['assigned'].includes(existing.status)) {
    return res.status(400).json({ error: `Cannot reject a transfer with status: ${existing.status}` });
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('transfers')
    .update({
      status:            'rejected',
      rejected_by:       userId,
      rejection_reason:  reason,
      rejected_at:       new Date().toISOString(),
      rejection_count:   (existing.rejection_count || 0) + 1,
      assigned_closer_id: null,
      assigned_to:        null,
      updated_at:        new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  // Notify fronter + managers
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const closerName = authUser?.user?.user_metadata?.first_name || authUser?.user?.email || 'A closer';

  notifications.onTransferRejected({ transfer: existing, closerName, reason }).catch(() => {});

  res.json({ transfer: updated });
}));

// ============================================================================
// PUT /transfers/:id — update transfer (reassign, edit with reason for managers)
// ============================================================================
router.put('/:id', asyncHandler(async (req, res) => {
  const { id }     = req.params;
  const userId     = req.user.id;
  const userRole   = req.user.role;
  const { status, assigned_closer_id, form_data, reason } = req.body;

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('transfers')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !existing) return res.status(404).json({ error: 'Transfer not found' });

  const isCreator  = existing.created_by === userId;
  const isManager  = MANAGER_ROLES.includes(userRole);

  if (!isCreator && !isManager) {
    return res.status(403).json({ error: 'Permission denied' });
  }

  // If manager is editing form_data, reason is required
  if (form_data && isManager && !reason) {
    return res.status(400).json({ error: 'A reason is required when editing transfer data' });
  }

  const updates = { updated_at: new Date().toISOString() };
  if (status) updates.status = status;

  // Reassign to a different closer
  if (assigned_closer_id) {
    updates.assigned_closer_id = assigned_closer_id;
    updates.assigned_to        = assigned_closer_id;
    if (!status) updates.status = 'assigned';
    // Reset rejection state on reassignment
    updates.rejected_by       = null;
    updates.rejection_reason  = null;
    updates.rejected_at       = null;
  }

  // Edit form_data — append to audit trail
  if (form_data) {
    updates.form_data = form_data;
    const historyEntry = {
      editor_id:    userId,
      reason:       reason || 'No reason provided',
      edited_at:    new Date().toISOString(),
    };
    updates.edit_history = supabaseAdmin.rpc ? undefined : existing.edit_history; // will use raw array below
    const currentHistory = Array.isArray(existing.edit_history) ? existing.edit_history : [];
    updates.edit_history = [...currentHistory, historyEntry];
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('transfers')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  // Notify closer when reassigned
  if (assigned_closer_id && assigned_closer_id !== existing.assigned_closer_id) {
    notifications.onTransferCreated({
      transfer: updated,
      fronterName: 'Manager',
      closerUserId: assigned_closer_id,
    }).catch(() => {});
  }

  // Notify fronter when form_data edited by manager
  if (form_data && reason) {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const editorName = authUser?.user?.user_metadata?.first_name || authUser?.user?.email || 'A manager';
    notifications.onTransferEdited({ transfer: { ...updated, _editorId: userId }, editorName, reason }).catch(() => {});
  }

  res.json({ transfer: updated });
}));

// ============================================================================
// DELETE /transfers/:id
// ============================================================================
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id }   = req.params;
  const userId   = req.user.id;
  const userRole = req.user.role;

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('transfers')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !existing) return res.status(404).json({ error: 'Transfer not found' });

  const isCreator = existing.created_by === userId;
  const isManager = MANAGER_ROLES.includes(userRole);

  if (!isCreator && !isManager) return res.status(403).json({ error: 'Permission denied' });

  const { data: linkedSale } = await supabaseAdmin
    .from('sales')
    .select('id')
    .eq('transfer_id', id)
    .single();

  if (linkedSale) return res.status(409).json({ error: 'Cannot delete a transfer linked to a sale' });

  const { error: delErr } = await supabaseAdmin.from('transfers').delete().eq('id', id);
  if (delErr) return res.status(500).json({ error: delErr.message });

  res.json({ message: 'Transfer deleted' });
}));

module.exports = router;
