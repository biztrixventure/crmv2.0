// ============================================================================
// /data-analyzer — superadmin-only multi-field filter against sales.
//
// Filters can target either a typed sales column (customer_name, car_year,
// down_payment, …) or any key inside the sales.form_data JSONB blob. The
// frontend builds the filter list from form_fields so new fields show up
// automatically; here we just dispatch each filter to the right column.
// ============================================================================

const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');

const router = express.Router();

router.use(asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin access required' });
  next();
}));

// Sales columns we know are typed (not JSONB). Filters whose `field` is in
// this set get routed to direct column ops; everything else is treated as a
// form_data JSONB key.
const TYPED_COLS = new Set([
  'customer_name', 'customer_phone', 'customer_phone_2', 'customer_email', 'customer_address',
  'car_year', 'car_make', 'car_model', 'car_miles', 'car_vin',
  'plan', 'down_payment', 'monthly_payment', 'payment_due_note', 'reference_no',
  'client_name', 'status', 'closer_id', 'fronter_id', 'company_id',
  'sale_date', 'created_at', 'closer_disposition', 'compliance_note',
]);

const ALLOWED_OPS = new Set(['eq', 'neq', 'in', 'gte', 'lte', 'between', 'ilike', 'is_null', 'not_is_null']);

// Apply one filter to a PostgREST query. Returns the (possibly-modified) query.
function applyFilter(query, f) {
  if (!f || !f.field || !ALLOWED_OPS.has(f.op)) return query;

  const isTyped  = TYPED_COLS.has(f.field);
  // For JSONB fields, target form_data->>key. PostgREST .filter() accepts that
  // verbatim and applies operator semantics on the text value.
  const col      = isTyped ? f.field : `form_data->>${f.field}`;
  const v        = f.value;

  switch (f.op) {
    case 'eq':         return v == null || v === '' ? query : query.filter(col, 'eq', v);
    case 'neq':        return v == null || v === '' ? query : query.filter(col, 'neq', v);
    case 'ilike':      return v == null || v === '' ? query : query.filter(col, 'ilike', `%${v}%`);
    case 'in': {
      const arr = Array.isArray(v) ? v.filter(x => x !== '' && x != null) : [];
      if (!arr.length) return query;
      // PostgREST `in` syntax: (a,b,c) — quote each so commas-in-values survive.
      const list = arr.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',');
      return query.filter(col, 'in', `(${list})`);
    }
    case 'gte':        return v == null || v === '' ? query : query.filter(col, 'gte', v);
    case 'lte':        return v == null || v === '' ? query : query.filter(col, 'lte', v);
    case 'between': {
      const [lo, hi] = Array.isArray(v) ? v : [];
      let q = query;
      if (lo !== '' && lo != null) q = q.filter(col, 'gte', lo);
      if (hi !== '' && hi != null) q = q.filter(col, 'lte', hi);
      return q;
    }
    case 'is_null':     return query.filter(col, 'is', 'null');
    case 'not_is_null': return query.filter(col, 'not.is', 'null');
    default: return query;
  }
}

router.post('/query', asyncHandler(async (req, res) => {
  const filters = Array.isArray(req.body?.filters) ? req.body.filters : [];
  const page    = Math.max(1, parseInt(req.body?.page  || 1));
  const limit   = Math.min(200, Math.max(1, parseInt(req.body?.limit || 50)));

  let query = supabaseAdmin
    .from('sales')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  for (const f of filters) query = applyFilter(query, f);

  const offset = (page - 1) * limit;
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Enrich with closer/fronter/company names (matches /sales response shape so
  // the frontend can reuse renderers). Cheap — same maps the sales list uses.
  const closerIds  = [...new Set((data || []).map(s => s.closer_id).filter(Boolean))];
  const fronterIds = [...new Set((data || []).map(s => s.fronter_id).filter(Boolean))];
  const allUids    = [...new Set([...closerIds, ...fronterIds])];
  const compIds    = [...new Set((data || []).map(s => s.company_id).filter(Boolean))];

  const [profilesRes, companiesRes] = await Promise.all([
    allUids.length ? supabaseAdmin.from('user_profiles').select('user_id,first_name,last_name').in('user_id', allUids) : { data: [] },
    compIds.length ? supabaseAdmin.from('companies').select('id,name').in('id', compIds)                               : { data: [] },
  ]);
  const profileMap = {}; (profilesRes.data || []).forEach(p => { profileMap[p.user_id] = p; });
  const companyMap = {}; (companiesRes.data || []).forEach(c => { companyMap[c.id]     = c; });

  const sales = (data || []).map(s => ({
    ...s,
    closer_name:  profileMap[s.closer_id]  ? `${profileMap[s.closer_id].first_name  || ''} ${profileMap[s.closer_id].last_name  || ''}`.trim() || null : null,
    fronter_name: profileMap[s.fronter_id] ? `${profileMap[s.fronter_id].first_name || ''} ${profileMap[s.fronter_id].last_name || ''}`.trim() || null : null,
    company_name: companyMap[s.company_id]?.name || null,
  }));

  res.json({ sales, total: count || 0, page, limit });
}));

module.exports = router;
