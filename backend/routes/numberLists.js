const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireFeature } = require('../utils/featureGate');
const { hasPermission } = require('../models/helpers');
const { escapeOrValue } = require('../utils/searchSanitize');
const { titleCase } = require('../utils/titleCase');

const router = express.Router();
router.use(requireFeature('number_assignment'));

const MANAGER_LEVELS = [
  'superadmin', 'readonly_admin', 'company_admin',
  'fronter_manager', 'closer_manager', 'operations_manager', 'manager',
];
const SUPERADMIN_LEVELS = ['superadmin', 'readonly_admin'];

const isManager    = (role) => MANAGER_LEVELS.includes(role);
const isSuperAdmin = (role) => SUPERADMIN_LEVELS.includes(role);
// Cross-company roles manage number lists for ANY company (they pick the company
// in the UI): superadmin/readonly + compliance (compliance oversees every co).
const CROSS_COMPANY_LEVELS = ['superadmin', 'readonly_admin', 'compliance_manager'];
const isCrossCompany = (role) => CROSS_COMPANY_LEVELS.includes(role);
// Toggleable number-list management: cross-company roles always, else the
// manage_callback_numbers permission (granted to manager roles by migration 134).
const canManage = async (req) =>
  isCrossCompany(req.user.role) || await hasPermission(req.user.id, req.user.company_id, 'manage_callback_numbers');

// Enrich rows with fronter + assigned_by names and company names
const enrichWithNames = async (rows, includeCompany = false) => {
  if (!rows.length) return rows;

  const userIds = [...new Set([
    ...rows.map(r => r.fronter_id).filter(Boolean),
    ...rows.map(r => r.assigned_by).filter(Boolean),
  ])];

  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, first_name, last_name')
    .in('user_id', userIds);

  const profileMap = {};
  (profiles || []).forEach(p => {
    profileMap[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';
  });

  let companyMap = {};
  if (includeCompany) {
    const companyIds = [...new Set(rows.map(r => r.company_id).filter(Boolean))];
    if (companyIds.length) {
      const { data: companies } = await supabaseAdmin
        .from('companies')
        .select('id, name, slug')
        .in('id', companyIds);
      (companies || []).forEach(c => { companyMap[c.id] = c.name || c.slug; });
    }
  }

  return rows.map(r => ({
    ...r,
    fronter_name:     profileMap[r.fronter_id]  || 'Unknown',
    assigned_by_name: profileMap[r.assigned_by] || 'Unknown',
    ...(includeCompany ? { company_name: companyMap[r.company_id] || 'Unknown' } : {}),
  }));
};

// ============================================================================
// GET /number-lists
// Fronter: own numbers. Manager: filter by company/fronter/day.
// Superadmin: all companies (unless company_id provided).
// Query params: fronter_id, status, list_name, search, assignment_day, company_id
// ============================================================================
router.get('/', asyncHandler(async (req, res) => {
  const { fronter_id, status, list_name, search, assignment_day } = req.query;
  const companyId = req.query.company_id || req.user.company_id;
  const userId    = req.user.id;
  const userRole  = req.user.role;

  let query = supabaseAdmin
    .from('number_lists')
    .select('*')
    .order('created_at', { ascending: false });

  if (isSuperAdmin(userRole)) {
    // Superadmin: no forced company filter, but can pass one
    if (companyId) query = query.eq('company_id', companyId);
    if (fronter_id) query = query.eq('fronter_id', fronter_id);
  } else if (isManager(userRole)) {
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    query = query.eq('company_id', companyId);
    if (fronter_id) query = query.eq('fronter_id', fronter_id);
  } else {
    query = query.eq('fronter_id', userId);
    if (companyId) query = query.eq('company_id', companyId);
  }

  if (status)         query = query.eq('status', status);
  if (list_name)      query = query.eq('list_name', list_name);
  if (assignment_day) query = query.eq('assignment_day', assignment_day);
  if (search)         { const s = escapeOrValue(search); query = query.or(`phone_number.ilike.%${s}%,customer_name.ilike.%${s}%`); }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const includeCompany = isSuperAdmin(userRole) && !companyId;
  const enriched = await enrichWithNames(data || [], includeCompany);
  res.json({ numbers: enriched, total: enriched.length });
}));

// ============================================================================
// GET /number-lists/summary — superadmin cross-company summary with filters
// ============================================================================
router.get('/summary', asyncHandler(async (req, res) => {
  if (!isCrossCompany(req.user.role)) return res.status(403).json({ error: 'Superadmin access required' });

  const { company_id, fronter_id, status, date_from, date_to, list_name, search } = req.query;

  let query = supabaseAdmin
    .from('number_lists')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  if (company_id)  query = query.eq('company_id', company_id);
  if (fronter_id)  query = query.eq('fronter_id', fronter_id);
  if (status)      query = query.eq('status', status);
  if (list_name)   query = query.eq('list_name', list_name);
  if (date_from)   query = query.gte('assignment_day', date_from);
  if (date_to)     query = query.lte('assignment_day', date_to);
  if (search)      { const s = escapeOrValue(search); query = query.or(`phone_number.ilike.%${s}%,customer_name.ilike.%${s}%`); }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const enriched = await enrichWithNames(data || [], true);

  // Compute aggregate stats
  const total     = enriched.length;
  const byStatus  = {};
  const byCompany = {};
  enriched.forEach(r => {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    if (!byCompany[r.company_id]) byCompany[r.company_id] = { name: r.company_name, total: 0, transferred: 0 };
    byCompany[r.company_id].total++;
    if (r.transfer_id) byCompany[r.company_id].transferred++;
  });

  res.json({
    numbers: enriched,
    total,
    stats: { by_status: byStatus, by_company: Object.values(byCompany) },
  });
}));

// ============================================================================
// GET /number-lists/lists — grouped list summaries for managers / superadmin
// ============================================================================
router.get('/lists', asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage number lists' });

  const companyId = req.query.company_id || req.user.company_id;
  const { fronter_id, assignment_day, status } = req.query;

  if (!isCrossCompany(req.user.role) && !companyId) {
    return res.status(400).json({ error: 'company_id required' });
  }

  // Fetch ALL rows (paginate past the 1000-row cap so big lists are never
  // undercounted), then group by the UNIQUE assignment — list_name + fronter +
  // day. Grouping on list_name ALONE collapsed same-named lists for different
  // fronters/days into one, which hid assignments from the manager.
  const buildBase = () => {
    let q = supabaseAdmin.from('number_lists')
      .select('list_name, fronter_id, status, assignment_day, company_id')
      .order('id', { ascending: true });
    if (companyId) q = q.eq('company_id', companyId);
    if (fronter_id) q = q.eq('fronter_id', fronter_id);
    if (assignment_day) q = q.eq('assignment_day', assignment_day);
    if (status) q = q.eq('status', status);
    return q;
  };
  let all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await buildBase().range(from, from + 999);
    if (error) return res.status(500).json({ error: error.message });
    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
  }

  const grouped = {};
  all.forEach(r => {
    const key = `${r.list_name}${r.fronter_id || ''}${r.assignment_day || ''}`;
    if (!grouped[key]) {
      grouped[key] = {
        key,
        list_name:      r.list_name,
        fronter_id:     r.fronter_id,
        company_id:     r.company_id,
        assignment_day: r.assignment_day,
        total: 0, new: 0, called: 0, completed: 0, callback: 0, skip: 0,
      };
    }
    grouped[key].total++;
    grouped[key][r.status] = (grouped[key][r.status] || 0) + 1;
  });

  const lists = Object.values(grouped);
  const ids = [...new Set(lists.map(l => l.fronter_id).filter(Boolean))];
  if (ids.length) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
    const map = {};
    (profiles || []).forEach(p => { map[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });
    lists.forEach(l => { l.fronter_name = map[l.fronter_id] || 'Unknown'; });
  }

  // Enrich with company names for superadmin
  if (isSuperAdmin(req.user.role) && !companyId) {
    const coIds = [...new Set(lists.map(l => l.company_id).filter(Boolean))];
    if (coIds.length) {
      const { data: cos } = await supabaseAdmin.from('companies').select('id, name, slug').in('id', coIds);
      const coMap = {};
      (cos || []).forEach(c => { coMap[c.id] = c.name || c.slug; });
      lists.forEach(l => { l.company_name = coMap[l.company_id] || 'Unknown'; });
    }
  }

  res.json({ lists });
}));

// ============================================================================
// GET /number-lists/fronters — fronters in company (for manager dropdown)
// ============================================================================
router.get('/fronters', asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage number lists' });
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

  res.json({ fronters: fronterIds.map(id => ({ id, name: profileMap[id] || 'Unknown' })) });
}));

// ============================================================================
// GET /number-lists/companies — all companies (superadmin only)
// ============================================================================
router.get('/companies', asyncHandler(async (req, res) => {
  if (!isCrossCompany(req.user.role)) return res.status(403).json({ error: 'Superadmin access required' });

  const { data, error } = await supabaseAdmin
    .from('companies')
    .select('id, name, slug, company_type')
    .order('name');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ companies: data || [] });
}));

// ============================================================================
// POST /number-lists/bulk — bulk assign numbers to a fronter (managers only)
// Body: {
//   fronter_id, list_name, assignment_day?,
//   numbers: [{ phone_number, customer_name?, notes?, mapped_data? }]
// }
// ============================================================================
router.post('/bulk', [
  body('fronter_id').isUUID().withMessage('fronter_id required'),
  body('list_name').trim().notEmpty().withMessage('list_name required'),
  body('numbers').isArray({ min: 1 }).withMessage('numbers array required'),
], asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage number lists' });

  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const { fronter_id, list_name, numbers, assignment_day } = req.body;
  const companyId = req.body.company_id || req.user.company_id;
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const rows = numbers
    .filter(n => n.phone_number?.toString().trim())
    .map(n => ({
      company_id:     companyId,
      fronter_id,
      assigned_by:    req.user.id,
      phone_number:   n.phone_number.toString().trim(),
      customer_name:  titleCase(n.customer_name?.toString().trim()) || null,
      notes:          n.notes?.toString().trim() || null,
      list_name:      list_name.trim(),
      status:         'new',
      assignment_day: assignment_day || null,
      mapped_data:    n.mapped_data || {},
    }));

  if (!rows.length) return res.status(400).json({ error: 'No valid phone numbers provided' });

  const { data, error } = await supabaseAdmin.from('number_lists').insert(rows).select();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ inserted: data.length, numbers: data });
}));

// ============================================================================
// PUT /number-lists/reassign — bulk-move a list (list_name + fronter + day) to a
// different fronter and/or day. Managers only. (Declared before /:id so the
// literal path isn't captured by the :id param route.)
// ============================================================================
router.put('/reassign', asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage number lists' });
  const companyId = req.body.company_id || req.user.company_id;
  const { list_name, fronter_id, assignment_day, new_fronter_id, new_assignment_day } = req.body;
  if (!list_name) return res.status(400).json({ error: 'list_name required' });
  if (!new_fronter_id && !new_assignment_day) {
    return res.status(400).json({ error: 'new_fronter_id or new_assignment_day required' });
  }

  const patch = { assigned_by: req.user.id, updated_at: new Date().toISOString() };
  if (new_fronter_id)     patch.fronter_id     = new_fronter_id;
  if (new_assignment_day) patch.assignment_day = new_assignment_day;

  let q = supabaseAdmin.from('number_lists').update(patch).eq('list_name', list_name);
  if (!isCrossCompany(req.user.role) && companyId) q = q.eq('company_id', companyId);
  if (fronter_id)     q = q.eq('fronter_id', fronter_id);
  if (assignment_day) q = q.eq('assignment_day', assignment_day);

  const { data, error } = await q.select('id');
  if (error) return res.status(400).json({ error: error.message });
  res.json({ moved: (data || []).length });
}));

// ============================================================================
// PUT /number-lists/:id — update status / notes
// ============================================================================
router.put('/:id', [
  body('status').optional().isIn(['new', 'called', 'callback', 'completed', 'skip']),
  body('notes').optional().isString(),
  body('fronter_id').optional().isUUID(),
], asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, notes, fronter_id } = req.body;

  const updates = { updated_at: new Date().toISOString() };
  if (status !== undefined) updates.status = status;
  if (notes  !== undefined) updates.notes  = notes;
  // Reassign ONE number to a different fronter — a manager-only action.
  if (fronter_id !== undefined) {
    if (!(await canManage(req))) return res.status(403).json({ error: 'Only managers can reassign a number' });
    updates.fronter_id = fronter_id;
  }

  let query = supabaseAdmin.from('number_lists').update(updates).eq('id', id);

  if (!(await canManage(req))) {
    query = query.eq('fronter_id', req.user.id);
  } else if (!isCrossCompany(req.user.role)) {
    const companyId = req.user.company_id;
    if (companyId) query = query.eq('company_id', companyId);
  }

  const { data, error } = await query.select().single();
  if (error) return res.status(400).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Not found or no access' });

  res.json({ number: data });
}));

// ============================================================================
// PUT /number-lists/:id/transfer — link a transfer after fronter creates one
// Body: { transfer_id }
// ============================================================================
router.put('/:id/transfer', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { transfer_id } = req.body;
  if (!transfer_id) return res.status(400).json({ error: 'transfer_id required' });

  const updates = {
    transfer_id,
    transferred_at: new Date().toISOString(),
    status:         'completed',
    updated_at:     new Date().toISOString(),
  };

  let query = supabaseAdmin.from('number_lists').update(updates).eq('id', id);

  if (!(await canManage(req))) {
    query = query.eq('fronter_id', req.user.id);
  } else if (!isCrossCompany(req.user.role)) {
    if (req.user.company_id) query = query.eq('company_id', req.user.company_id);
  }

  const { data, error } = await query.select().single();
  if (error) return res.status(400).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Not found or no access' });

  res.json({ number: data });
}));

// ============================================================================
// DELETE /number-lists/batch — delete by list_name or ids (managers only)
// ============================================================================
router.delete('/batch', asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage number lists' });

  const companyId = req.user.company_id || req.body.company_id;
  const { list_name, ids, fronter_id, assignment_day } = req.body;

  if (!list_name && (!ids || !ids.length)) {
    return res.status(400).json({ error: 'list_name or ids required' });
  }

  let query = supabaseAdmin.from('number_lists').delete();

  if (!isCrossCompany(req.user.role) && companyId) query = query.eq('company_id', companyId);

  if (list_name) {
    query = query.eq('list_name', list_name);
    // Scope to the exact assignment so deleting one list never wipes a
    // same-named list for a different fronter or day.
    if (fronter_id)     query = query.eq('fronter_id', fronter_id);
    if (assignment_day) query = query.eq('assignment_day', assignment_day);
  } else {
    query = query.in('id', ids);
  }

  const { error } = await query;
  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: 'Deleted' });
}));

// ============================================================================
// DELETE /number-lists/:id — revoke ONE assigned number (managers only).
// Defined AFTER /batch so '/batch' isn't captured as an :id.
// ============================================================================
router.delete('/:id', asyncHandler(async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'You do not have permission to manage number lists' });
  let query = supabaseAdmin.from('number_lists').delete().eq('id', req.params.id);
  if (!isCrossCompany(req.user.role) && req.user.company_id) query = query.eq('company_id', req.user.company_id);
  const { error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Removed' });
}));

module.exports = router;
