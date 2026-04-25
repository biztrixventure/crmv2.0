const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// Only compliance_manager or superadmin may use these routes
router.use((req, res, next) => {
  const r = req.user.role;
  if (r !== 'compliance_manager' && r !== 'superadmin') {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
});

// ── helpers ───────────────────────────────────────────────────────────────────
function profileName(map, id) {
  const p = map[id];
  return p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() || null : null;
}

async function enrichProfiles(records, userIdFn) {
  const ids = [...new Set(records.map(userIdFn).filter(Boolean))];
  if (!ids.length) return {};
  const { data } = await supabaseAdmin
    .from('user_profiles').select('user_id,first_name,last_name').in('user_id', ids);
  const map = {};
  (data || []).forEach(p => { map[p.user_id] = p; });
  return map;
}

async function enrichCompanies(records, companyIdFn) {
  const ids = [...new Set(records.map(companyIdFn).filter(Boolean))];
  if (!ids.length) return {};
  const { data } = await supabaseAdmin
    .from('companies').select('id,name,company_type').in('id', ids);
  const map = {};
  (data || []).forEach(c => { map[c.id] = c; });
  return map;
}

// ── GET /compliance/companies ─────────────────────────────────────────────────
router.get('/companies', asyncHandler(async (req, res) => {
  const { data: companies, error } = await supabaseAdmin
    .from('companies')
    .select('id, name, company_type, is_active, created_at')
    .order('name');
  if (error) return res.status(500).json({ error: error.message });

  const ids = (companies || []).map(c => c.id);
  if (!ids.length) return res.json({ companies: [], total: 0 });

  const [usersRes, salesRes, pendingRes] = await Promise.all([
    supabaseAdmin.from('user_company_roles').select('company_id').eq('is_active', true).in('company_id', ids),
    supabaseAdmin.from('sales').select('company_id').in('company_id', ids),
    supabaseAdmin.from('sales').select('company_id').eq('status', 'pending_review').in('company_id', ids),
  ]);

  const userCount = {}, saleCount = {}, pendingCount = {};
  (usersRes.data  || []).forEach(u => { userCount[u.company_id]   = (userCount[u.company_id]   || 0) + 1; });
  (salesRes.data  || []).forEach(s => { saleCount[s.company_id]   = (saleCount[s.company_id]   || 0) + 1; });
  (pendingRes.data|| []).forEach(p => { pendingCount[p.company_id] = (pendingCount[p.company_id]|| 0) + 1; });

  const enriched = (companies || []).map(c => ({
    ...c,
    user_count:           userCount[c.id]   || 0,
    sale_count:           saleCount[c.id]   || 0,
    pending_review_count: pendingCount[c.id] || 0,
  }));

  logger.info('COMPLIANCE', `Loaded ${enriched.length} companies`);
  res.json({ companies: enriched, total: enriched.length });
}));

// ── GET /compliance/users ─────────────────────────────────────────────────────
// Returns all users (or filtered by company) for export user-selector.
router.get('/users', asyncHandler(async (req, res) => {
  const { company_id } = req.query;

  let query = supabaseAdmin
    .from('user_company_roles')
    .select('user_id, company_id, custom_roles(level), companies(name)')
    .eq('is_active', true);
  if (company_id) query = query.eq('company_id', company_id);

  const { data: ucr, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const userIds = [...new Set((ucr || []).map(r => r.user_id))];
  const profileMap = {};
  if (userIds.length) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles').select('user_id,first_name,last_name').in('user_id', userIds);
    (profiles || []).forEach(p => { profileMap[p.user_id] = p; });
  }

  // Deduplicate — one entry per user per company
  const seen = new Set();
  const users = (ucr || [])
    .filter(r => { const k = `${r.user_id}:${r.company_id}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(r => ({
      user_id:      r.user_id,
      company_id:   r.company_id,
      company_name: r.companies?.name || null,
      role_level:   r.custom_roles?.level || null,
      full_name:    profileMap[r.user_id]
        ? `${profileMap[r.user_id].first_name || ''} ${profileMap[r.user_id].last_name || ''}`.trim() || 'Unknown'
        : 'Unknown',
    }));

  res.json({ users, total: users.length });
}));

// ── GET /compliance/sales ─────────────────────────────────────────────────────
router.get('/sales', asyncHandler(async (req, res) => {
  const { company_id, user_ids, status, date_from, date_to, search, page = 1, limit = 50 } = req.query;

  let query = supabaseAdmin
    .from('sales')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (company_id) query = query.eq('company_id', company_id);
  if (user_ids) {
    const ids = user_ids.split(',').filter(Boolean);
    if (ids.length) query = query.in('closer_id', ids);
  }
  if (status)    query = query.eq('status', status);
  if (date_from) query = query.gte('created_at', date_from + 'T00:00:00');
  if (date_to)   query = query.lte('created_at', date_to   + 'T23:59:59');
  if (search)    query = query.or(`customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%,reference_no.ilike.%${search}%`);

  const offset = (parseInt(page) - 1) * parseInt(limit);
  query = query.range(offset, offset + parseInt(limit) - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const fronterIds = [...new Set((data || []).map(s => s.fronter_id).filter(Boolean))];
  const [profileMap, companyMap] = await Promise.all([
    enrichProfiles(data || [], s => s.closer_id),
    enrichCompanies(data || [], s => s.company_id),
  ]);
  const fronterProfileMap = {};
  if (fronterIds.length) {
    const { data: fp } = await supabaseAdmin
      .from('user_profiles').select('user_id,first_name,last_name').in('user_id', fronterIds);
    (fp || []).forEach(p => { fronterProfileMap[p.user_id] = p; });
  }

  const enriched = (data || []).map(s => ({
    ...s,
    closer_name:  profileName(profileMap, s.closer_id),
    fronter_name: profileName(fronterProfileMap, s.fronter_id),
    companies:    companyMap[s.company_id] || null,
    user_profiles: profileMap[s.closer_id] || null,
  }));

  res.json({ sales: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
}));

// ── GET /compliance/transfers ─────────────────────────────────────────────────
router.get('/transfers', asyncHandler(async (req, res) => {
  const { company_id, user_ids, status, date_from, date_to, search, page = 1, limit = 50 } = req.query;

  let query = supabaseAdmin
    .from('transfers')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (company_id) query = query.eq('company_id', company_id);
  if (user_ids) {
    const ids = user_ids.split(',').filter(Boolean);
    if (ids.length) query = query.in('created_by', ids);
  }
  if (status)    query = query.eq('status', status);
  if (date_from) query = query.gte('created_at', date_from + 'T00:00:00');
  if (date_to)   query = query.lte('created_at', date_to   + 'T23:59:59');
  // JSONB search omitted — filter by company/date/status instead

  const offset = (parseInt(page) - 1) * parseInt(limit);
  query = query.range(offset, offset + parseInt(limit) - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const [profileMap, companyMap] = await Promise.all([
    enrichProfiles(data || [], t => t.created_by),
    enrichCompanies(data || [], t => t.company_id),
  ]);

  const enriched = (data || []).map(t => ({
    ...t,
    created_by_name: profileName(profileMap, t.created_by),
    company_name:    companyMap[t.company_id]?.name || null,
  }));

  res.json({ transfers: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
}));

// ── GET /compliance/callbacks ─────────────────────────────────────────────────
// company_type=fronter|closer filters callbacks from companies of that type
router.get('/callbacks', asyncHandler(async (req, res) => {
  const { company_id, user_ids, status, date_from, date_to, company_type, page = 1, limit = 50 } = req.query;

  let scopeCompanyIds = null;
  if (company_type) {
    const { data: typeCompanies } = await supabaseAdmin
      .from('companies').select('id').eq('company_type', company_type);
    scopeCompanyIds = (typeCompanies || []).map(c => c.id);
    if (!scopeCompanyIds.length) {
      return res.json({ callbacks: [], total: 0, page: 1, limit: parseInt(limit) });
    }
  }

  let query = supabaseAdmin
    .from('callbacks')
    .select('*', { count: 'exact' })
    .order('callback_at', { ascending: false });

  if (company_id) {
    query = query.eq('company_id', company_id);
  } else if (scopeCompanyIds) {
    query = query.in('company_id', scopeCompanyIds);
  }

  if (user_ids) {
    const ids = user_ids.split(',').filter(Boolean);
    if (ids.length) query = query.in('user_id', ids);
  }
  if (status)    query = query.eq('status', status);
  if (date_from) query = query.gte('callback_at', date_from + 'T00:00:00');
  if (date_to)   query = query.lte('callback_at', date_to   + 'T23:59:59');

  const offset = (parseInt(page) - 1) * parseInt(limit);
  query = query.range(offset, offset + parseInt(limit) - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const [profileMap, companyMap] = await Promise.all([
    enrichProfiles(data || [], c => c.user_id),
    enrichCompanies(data || [], c => c.company_id),
  ]);

  const enriched = (data || []).map(c => ({
    ...c,
    user_name:    profileName(profileMap, c.user_id),
    company_name: companyMap[c.company_id]?.name || null,
  }));

  res.json({ callbacks: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
}));

module.exports = router;
