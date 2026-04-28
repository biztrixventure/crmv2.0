const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireFeature } = require('../utils/featureGate');

const router = express.Router();
router.use(requireFeature('number_assignment'));

const MANAGER_LEVELS = [
  'superadmin', 'readonly_admin', 'company_admin',
  'fronter_manager', 'closer_manager', 'operations_manager', 'manager',
];

const isManager = (role) => MANAGER_LEVELS.includes(role);

// Helper: enrich rows with fronter names
const enrichWithNames = async (rows) => {
  if (!rows.length) return rows;
  const ids = [...new Set([...rows.map(r => r.fronter_id), ...rows.map(r => r.assigned_by)])];
  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, first_name, last_name')
    .in('user_id', ids);
  const map = {};
  (profiles || []).forEach(p => {
    map[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';
  });
  return rows.map(r => ({
    ...r,
    fronter_name:     map[r.fronter_id]    || 'Unknown',
    assigned_by_name: map[r.assigned_by]   || 'Unknown',
  }));
};

// ============================================================================
// GET /number-lists
// Fronter: own numbers. Manager: filter by fronter_id or all company.
// Query params: fronter_id, status, list_name
// ============================================================================
router.get('/', asyncHandler(async (req, res) => {
  const { fronter_id, status, list_name, search } = req.query;
  const companyId = req.query.company_id || req.user.company_id;
  const userId    = req.user.id;
  const userRole  = req.user.role;

  let query = supabaseAdmin
    .from('number_lists')
    .select('*')
    .order('created_at', { ascending: false });

  if (isManager(userRole)) {
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    query = query.eq('company_id', companyId);
    if (fronter_id) query = query.eq('fronter_id', fronter_id);
  } else {
    // Fronter: only their own numbers
    query = query.eq('fronter_id', userId);
    if (companyId) query = query.eq('company_id', companyId);
  }

  if (status)    query = query.eq('status', status);
  if (list_name) query = query.eq('list_name', list_name);
  if (search)    query = query.or(`phone_number.ilike.%${search}%,customer_name.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const enriched = await enrichWithNames(data || []);
  res.json({ numbers: enriched, total: enriched.length });
}));

// ============================================================================
// GET /number-lists/lists — distinct list names for a company (managers)
// ============================================================================
router.get('/lists', asyncHandler(async (req, res) => {
  const companyId = req.query.company_id || req.user.company_id;
  if (!isManager(req.user.role)) return res.status(403).json({ error: 'Managers only' });
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const { data, error } = await supabaseAdmin
    .from('number_lists')
    .select('list_name, fronter_id, status, id')
    .eq('company_id', companyId)
    .order('list_name');

  if (error) return res.status(500).json({ error: error.message });

  // Group by list_name
  const grouped = {};
  (data || []).forEach(r => {
    if (!grouped[r.list_name]) grouped[r.list_name] = { list_name: r.list_name, fronter_id: r.fronter_id, total: 0, new: 0, called: 0, completed: 0 };
    grouped[r.list_name].total++;
    grouped[r.list_name][r.status] = (grouped[r.list_name][r.status] || 0) + 1;
  });

  const lists = Object.values(grouped);
  // Enrich with fronter names
  const ids = [...new Set(lists.map(l => l.fronter_id).filter(Boolean))];
  if (ids.length) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
    const map = {};
    (profiles || []).forEach(p => { map[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });
    lists.forEach(l => { l.fronter_name = map[l.fronter_id] || 'Unknown'; });
  }

  res.json({ lists });
}));

// ============================================================================
// GET /number-lists/fronters — fronters in company (for manager dropdown)
// ============================================================================
router.get('/fronters', asyncHandler(async (req, res) => {
  if (!isManager(req.user.role)) return res.status(403).json({ error: 'Managers only' });
  const companyId = req.query.company_id || req.user.company_id;
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const { data: roleRows, error } = await supabaseAdmin
    .from('user_company_roles')
    .select('user_id, custom_roles!inner(level)')
    .eq('company_id', companyId)
    .eq('is_active', true);

  if (error) return res.status(500).json({ error: error.message });

  const fronterIds = (roleRows || [])
    .filter(r => r.custom_roles?.level === 'fronter')
    .map(r => r.user_id);

  if (!fronterIds.length) return res.json({ fronters: [] });

  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, first_name, last_name')
    .in('user_id', fronterIds);

  const profileMap = {};
  (profiles || []).forEach(p => {
    profileMap[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';
  });

  const fronters = fronterIds.map(id => ({ id, name: profileMap[id] || 'Unknown' }));

  res.json({ fronters });
}));

// ============================================================================
// POST /number-lists/bulk — bulk assign numbers to a fronter (managers only)
// Body: { fronter_id, list_name, numbers: [{phone_number, customer_name?, notes?}] }
// ============================================================================
router.post('/bulk', [
  body('fronter_id').isUUID().withMessage('fronter_id required'),
  body('list_name').trim().notEmpty().withMessage('list_name required'),
  body('numbers').isArray({ min: 1 }).withMessage('numbers array required'),
], asyncHandler(async (req, res) => {
  if (!isManager(req.user.role)) return res.status(403).json({ error: 'Managers only' });

  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const { fronter_id, list_name, numbers } = req.body;
  const companyId = req.body.company_id || req.user.company_id;
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const rows = numbers
    .filter(n => n.phone_number?.toString().trim())
    .map(n => ({
      company_id:    companyId,
      fronter_id,
      assigned_by:   req.user.id,
      phone_number:  n.phone_number.toString().trim(),
      customer_name: n.customer_name?.toString().trim() || null,
      notes:         n.notes?.toString().trim() || null,
      list_name:     list_name.trim(),
      status:        'new',
    }));

  if (!rows.length) return res.status(400).json({ error: 'No valid phone numbers provided' });

  const { data, error } = await supabaseAdmin.from('number_lists').insert(rows).select();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ inserted: data.length, numbers: data });
}));

// ============================================================================
// PUT /number-lists/:id — update status / notes
// Fronter: own numbers. Manager: any in company.
// ============================================================================
router.put('/:id', [
  body('status').optional().isIn(['new', 'called', 'callback', 'completed', 'skip']),
  body('notes').optional().isString(),
], asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  const updates = { updated_at: new Date().toISOString() };
  if (status !== undefined) updates.status = status;
  if (notes  !== undefined) updates.notes  = notes;

  let query = supabaseAdmin.from('number_lists').update(updates).eq('id', id);

  // Fronter can only update own numbers
  if (!isManager(req.user.role)) {
    query = query.eq('fronter_id', req.user.id);
  } else {
    const companyId = req.user.company_id;
    if (companyId) query = query.eq('company_id', companyId);
  }

  const { data, error } = await query.select().single();
  if (error) return res.status(400).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Not found or no access' });

  res.json({ number: data });
}));

// ============================================================================
// DELETE /number-lists/batch — delete by list_name or array of ids (managers)
// Body: { list_name } OR { ids: [uuid, ...] }
// ============================================================================
router.delete('/batch', asyncHandler(async (req, res) => {
  if (!isManager(req.user.role)) return res.status(403).json({ error: 'Managers only' });

  const companyId = req.user.company_id || req.body.company_id;
  const { list_name, ids } = req.body;

  if (!list_name && (!ids || !ids.length)) {
    return res.status(400).json({ error: 'list_name or ids required' });
  }

  let query = supabaseAdmin.from('number_lists').delete();
  if (companyId) query = query.eq('company_id', companyId);

  if (list_name) {
    query = query.eq('list_name', list_name);
  } else {
    query = query.in('id', ids);
  }

  const { error } = await query;
  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: 'Deleted' });
}));

module.exports = router;
