const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { etDateToUtcStart, etDateToUtcEnd } = require('../utils/etUtils');

const router = express.Router();

const ALLOWED_ROLES = [
  'superadmin', 'readonly_admin', 'compliance_manager',
  'company_admin', 'operations_manager', 'fronter_manager', 'closer_manager',
];

// ============================================================================
// GET /activity-logs
// Returns paginated activity log entries scoped to the caller's company.
// Superadmin/readonly_admin can pass ?company_id= to see any company.
// ============================================================================
router.get('/', asyncHandler(async (req, res) => {
  const { role: userRole, company_id: userCompany } = req.user;
  const { company_id, action, user_id: filterUser, page = 1, limit = 25, date_from, date_to } = req.query;

  if (!ALLOWED_ROLES.includes(userRole)) {
    return res.status(403).json({ error: 'Insufficient permissions to view activity logs' });
  }

  const isGlobalAdmin = userRole === 'superadmin' || userRole === 'readonly_admin';
  const targetCompany = isGlobalAdmin ? (company_id || null) : userCompany;

  let query = supabaseAdmin
    .from('activity_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (targetCompany) query = query.eq('company_id', targetCompany);
  if (action)       query = query.eq('action', action);
  if (filterUser)   query = query.eq('user_id', filterUser);
  if (date_from)    query = query.gte('created_at', etDateToUtcStart(date_from));
  if (date_to)      query = query.lte('created_at', etDateToUtcEnd(date_to));

  const offset = (parseInt(page) - 1) * parseInt(limit);
  query = query.range(offset, offset + parseInt(limit) - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const logs = data || [];

  // Enrich with user profiles
  const userIds = [...new Set(logs.map(l => l.user_id).filter(Boolean))];
  let profileMap = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, first_name, last_name')
      .in('user_id', userIds);
    (profiles || []).forEach(p => { profileMap[p.user_id] = p; });
  }

  const enriched = logs.map(l => ({
    ...l,
    actor: profileMap[l.user_id] || null,
  }));

  res.json({ logs: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
}));

module.exports = router;
