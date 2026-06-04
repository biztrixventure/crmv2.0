const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { etDateToUtcStart, etDateToUtcEnd } = require('../utils/etUtils');
const { escapeOrValue } = require('../utils/searchSanitize');
const { applySort } = require('../utils/sortHelper');

const router = express.Router();

// Client sort key -> real column. Name columns sort by underlying id so an
// agent's records group together across pages.
const SALE_SORT = {
  customer: 'customer_name', status: 'status', created_at: 'created_at',
  sale_date: 'sale_date', reference: 'reference_no', monthly_payment: 'monthly_payment',
  fronter: 'fronter_id', closer: 'closer_id', plan: 'plan',
};
const TRANSFER_SORT = {
  customer: 'form_data->>customer_name', status: 'status', created_at: 'created_at',
  fronter: 'created_by', closer: 'assigned_closer_id',
};
const CALLBACK_SORT = {
  customer: 'customer_name', priority: 'priority_rank', callback_at: 'callback_at',
  created_at: 'created_at', status: 'status', fronter: 'user_id', closer: 'user_id',
};

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
  const { company_id, user_ids, status, date_from, date_to, search, page = 1, limit = 50, sort_by, sort_dir } = req.query;

  let query = applySort(
    supabaseAdmin.from('sales').select('*', { count: 'exact' }),
    sort_by, sort_dir, SALE_SORT, { col: 'created_at', asc: false },
  );

  // If filtering by a fronter company, translate to transfer_id scope
  // (sales are stored under the closer company, not the fronter company).
  if (company_id) {
    const { data: co } = await supabaseAdmin
      .from('companies').select('company_type').eq('id', company_id).single();
    if (co?.company_type === 'fronter') {
      const { data: xfers } = await supabaseAdmin
        .from('transfers').select('id').eq('company_id', company_id);
      const xferIds = (xfers || []).map(t => t.id).filter(Boolean);
      if (xferIds.length === 0) {
        return res.json({ sales: [], total: 0, page: parseInt(page), limit: parseInt(limit) });
      }
      query = query.in('transfer_id', xferIds);
    } else {
      query = query.eq('company_id', company_id);
    }
  }

  if (user_ids) {
    const ids = user_ids.split(',').filter(Boolean);
    if (ids.length) query = query.in('closer_id', ids);
  }
  if (status)    query = query.eq('status', status);
  // Date filter keys on sale_date (the business day the sale happened) so the
  // From/To range matches the UI Sale Date column. A bulk-imported April
  // workbook landed today would otherwise leak into May 1-31 selections
  // because its created_at is the upload day, not the file's date.
  if (date_from) query = query.gte('sale_date', date_from);
  if (date_to)   query = query.lte('sale_date', date_to);
  if (search) { const s = escapeOrValue(search); query = query.or(`customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%,reference_no.ilike.%${s}%`); }

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
  const { company_id, user_ids, closer_id, status, date_from, date_to, search, page = 1, limit = 50, sort_by, sort_dir } = req.query;

  let query = applySort(
    supabaseAdmin.from('transfers').select('*', { count: 'exact' }),
    sort_by, sort_dir, TRANSFER_SORT, { col: 'created_at', asc: false },
  );

  if (company_id) query = query.eq('company_id', company_id);
  if (user_ids) {
    const ids = user_ids.split(',').filter(Boolean);
    if (ids.length) query = query.in('created_by', ids);
  }
  if (closer_id)  query = query.eq('assigned_closer_id', closer_id);
  if (status)    query = query.eq('status', status);
  if (date_from) query = query.gte('created_at', etDateToUtcStart(date_from));
  if (date_to)   query = query.lte('created_at', etDateToUtcEnd(date_to));

  // Free-text search across the customer-identifying columns: typed
  // normalized_phone + the JSONB form_data keys that hold the customer
  // name / phone (same shape transfers.js POST /search uses, so parity with
  // the closer-side phone search). Reference_no isn't on transfers — it
  // lives on linked sales; the linked sale's reference is included via the
  // enrichment step below, but searching there would require a join, so we
  // keep the predicate scoped to transfers itself.
  if (search) {
    const s = escapeOrValue(search);
    query = query.or(
      `normalized_phone.ilike.%${s}%,` +
      `form_data->>customer_name.ilike.%${s}%,` +
      `form_data->>customer_phone.ilike.%${s}%,` +
      `form_data->>Phone.ilike.%${s}%,` +
      `form_data->>FirstName.ilike.%${s}%,` +
      `form_data->>LastName.ilike.%${s}%`
    );
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  query = query.range(offset, offset + parseInt(limit) - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch profiles for both creator and assigned closer in one query
  const allUserIds = [...new Set([
    ...(data || []).map(t => t.created_by).filter(Boolean),
    ...(data || []).map(t => t.assigned_closer_id).filter(Boolean),
  ])];
  const profileMap = allUserIds.length
    ? await (async () => {
        const { data: p } = await supabaseAdmin.from('user_profiles').select('user_id,first_name,last_name').in('user_id', allUserIds);
        const m = {}; (p || []).forEach(x => { m[x.user_id] = x; }); return m;
      })()
    : {};
  const companyMap = await enrichCompanies(data || [], t => t.company_id);

  // Enrich with linked sale data + latest disposition
  const transferIds = (data || []).map(t => t.id).filter(Boolean);
  let saleMap = {};
  let latestDispoMap = {};
  if (transferIds.length > 0) {
    const [salesRes, dispoRes] = await Promise.all([
      supabaseAdmin.from('sales')
        .select('id, transfer_id, status, compliance_note, reference_no')
        .in('transfer_id', transferIds),
      supabaseAdmin.from('disposition_actions')
        .select('transfer_id, disposition_name, color, created_at, user_id, setter_role')
        .in('transfer_id', transferIds)
        .order('created_at', { ascending: false }),
    ]);
    (salesRes.data || []).forEach(s => { saleMap[s.transfer_id] = s; });

    const setterIds = [...new Set((dispoRes.data || []).map(d => d.user_id).filter(Boolean))];
    let setterMap = {};
    if (setterIds.length > 0) {
      const { data: sp } = await supabaseAdmin
        .from('user_profiles').select('user_id, first_name, last_name').in('user_id', setterIds);
      (sp || []).forEach(p => { setterMap[p.user_id] = p; });
    }
    (dispoRes.data || []).forEach(d => {
      if (!latestDispoMap[d.transfer_id]) {
        const p = setterMap[d.user_id];
        latestDispoMap[d.transfer_id] = {
          ...d,
          setter_name: p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() || null : null,
        };
      }
    });
  }

  const enriched = (data || []).map(t => {
    const sale = saleMap[t.id] || null;
    return {
      ...t,
      created_by_name:       profileName(profileMap, t.created_by),
      assigned_closer_name:  profileName(profileMap, t.assigned_closer_id),
      company_name:          companyMap[t.company_id]?.name || null,
      sale_id:               sale?.id || null,
      sale_status:           sale?.status || null,
      sale_compliance_note:  sale?.compliance_note || null,
      sale_reference_no:     sale?.reference_no || null,
      latest_disposition:    latestDispoMap[t.id] || null,
    };
  });

  res.json({ transfers: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
}));

// ── GET /compliance/callbacks ─────────────────────────────────────────────────
// company_type=fronter|closer filters callbacks from companies of that type
router.get('/callbacks', asyncHandler(async (req, res) => {
  const { company_id, user_ids, status, priority, date_from, date_to, created_from, created_to, company_type, search, page = 1, limit = 50, sort_by, sort_dir } = req.query;

  let scopeCompanyIds = null;
  if (company_type) {
    const { data: typeCompanies } = await supabaseAdmin
      .from('companies').select('id').eq('company_type', company_type);
    scopeCompanyIds = (typeCompanies || []).map(c => c.id);
    if (!scopeCompanyIds.length) {
      return res.json({ callbacks: [], total: 0, page: 1, limit: parseInt(limit) });
    }
  }

  let query = applySort(
    supabaseAdmin.from('callbacks').select('*', { count: 'exact' }),
    sort_by, sort_dir, CALLBACK_SORT, { col: 'callback_at', asc: false },
  );

  if (company_id) {
    query = query.eq('company_id', company_id);
  } else if (scopeCompanyIds) {
    query = query.in('company_id', scopeCompanyIds);
  }

  if (user_ids) {
    const ids = user_ids.split(',').filter(Boolean);
    if (ids.length) query = query.in('user_id', ids);
  }
  if (status)       query = query.eq('status', status);
  if (priority)     query = query.eq('priority', priority);
  if (date_from)    query = query.gte('callback_at', etDateToUtcStart(date_from));
  if (date_to)      query = query.lte('callback_at', etDateToUtcEnd(date_to));
  if (created_from) query = query.gte('created_at',  etDateToUtcStart(created_from));
  if (created_to)   query = query.lte('created_at',  etDateToUtcEnd(created_to));
  if (search)     { const s = escapeOrValue(search); query = query.or(`customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%`); }

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
    company_name: companyMap[c.company_id]?.name         || null,
    company_type: companyMap[c.company_id]?.company_type || null,
  }));

  res.json({ callbacks: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
}));

// ── GET /compliance/callbacks/phone-history ──────────────────────────────────
// All callbacks for a given phone number across all companies + agents.
// Sorted oldest-first so "first" is index 0.
router.get('/callbacks/phone-history', asyncHandler(async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  const { data, error } = await supabaseAdmin
    .from('callbacks')
    .select('*')
    .eq('customer_phone', phone)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const rows = data || [];

  // Enrich user + company in one pass
  const userIds    = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
  const companyIds = [...new Set(rows.map(r => r.company_id).filter(Boolean))];

  const [profileMap, companyMap2] = await Promise.all([
    enrichProfiles(rows, r => r.user_id),
    companyIds.length
      ? supabaseAdmin.from('companies').select('id,name').in('id', companyIds)
          .then(({ data: co }) => Object.fromEntries((co || []).map(c => [c.id, c.name])))
      : Promise.resolve({}),
  ]);

  const enriched = rows.map((r, i) => ({
    ...r,
    agent_name:   profileName(profileMap, r.user_id)  || 'Unknown',
    company_name: companyMap2[r.company_id]            || null,
    is_first:     i === 0,
  }));

  // Stats
  const pending_count  = enriched.filter(r => r.status === 'pending').length;
  const first          = enriched[0] || null;

  res.json({
    phone,
    total:         enriched.length,
    pending_count,
    first_agent:   first?.agent_name   || null,
    first_company: first?.company_name || null,
    first_at:      first?.created_at   || null,
    callbacks:     enriched,
  });
}));

// ── GET /compliance/callback-numbers ─────────────────────────────────────────
router.get('/callback-numbers', asyncHandler(async (req, res) => {
  const { company_id, status, search, page = 1, limit = 50 } = req.query;

  let query = supabaseAdmin
    .from('callback_numbers')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (company_id) query = query.eq('company_id', company_id);
  if (status)     query = query.eq('status', status);
  if (search)     { const s = escapeOrValue(search); query = query.or(`phone_number.ilike.%${s}%,customer_name.ilike.%${s}%`); }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  query = query.range(offset, offset + parseInt(limit) - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  if (!data?.length) return res.json({ numbers: [], total: 0, page: parseInt(page), limit: parseInt(limit) });

  // Owner profiles
  const ownerIds = [...new Set(data.map(n => n.owner_id).filter(Boolean))];
  const profileMap = {};
  if (ownerIds.length) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles').select('user_id,first_name,last_name').in('user_id', ownerIds);
    (profiles || []).forEach(p => { profileMap[p.user_id] = p; });
  }

  const companyMap = await enrichCompanies(data, n => n.company_id);

  // Attempt counts per number (single bulk query)
  const numberIds = data.map(n => n.id);
  const { data: attemptRows } = await supabaseAdmin
    .from('callback_number_attempts')
    .select('callback_number_id, outcome')
    .in('callback_number_id', numberIds)
    .order('attempted_at', { ascending: false });

  const attemptMap = {};
  (attemptRows || []).forEach(a => {
    if (!attemptMap[a.callback_number_id]) {
      attemptMap[a.callback_number_id] = { count: 0, last_outcome: a.outcome };
    }
    attemptMap[a.callback_number_id].count++;
  });

  // Claim counts
  const { data: claimRows } = await supabaseAdmin
    .from('callback_number_claims')
    .select('callback_number_id')
    .in('callback_number_id', numberIds);
  const claimMap = {};
  (claimRows || []).forEach(c => { claimMap[c.callback_number_id] = (claimMap[c.callback_number_id] || 0) + 1; });

  const numbers = data.map(n => ({
    ...n,
    owner_name:    profileName(profileMap, n.owner_id),
    company_name:  companyMap[n.company_id]?.name || null,
    attempt_count: attemptMap[n.id]?.count || 0,
    last_outcome:  attemptMap[n.id]?.last_outcome || null,
    owner_count:   claimMap[n.id] || 0,
  }));

  res.json({ numbers, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
}));

// ── GET /compliance/callback-numbers/:id ──────────────────────────────────────
router.get('/callback-numbers/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [numberRes, claimsRes, attemptsRes, historyRes] = await Promise.all([
    supabaseAdmin.from('callback_numbers').select('*').eq('id', id).single(),
    supabaseAdmin.from('callback_number_claims')
      .select('*').eq('callback_number_id', id).order('owned_from', { ascending: false }),
    supabaseAdmin.from('callback_number_attempts')
      .select('*').eq('callback_number_id', id).order('attempted_at', { ascending: false }),
    supabaseAdmin.from('callback_number_history')
      .select('*').eq('callback_number_id', id).order('created_at', { ascending: false }),
  ]);

  if (numberRes.error || !numberRes.data) return res.status(404).json({ error: 'Number not found' });

  const number   = numberRes.data;
  const claims   = claimsRes.data   || [];
  const attempts = attemptsRes.data || [];
  const history  = historyRes.data  || [];

  // Bulk enrich all user IDs in one query
  const allUserIds = [...new Set([
    number.owner_id,
    ...claims.map(c => c.owner_id),
    ...attempts.map(a => a.caller_id),
    ...history.map(h => h.actor_id),
  ].filter(Boolean))];

  const profileMap = {};
  if (allUserIds.length) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles').select('user_id,first_name,last_name').in('user_id', allUserIds);
    (profiles || []).forEach(p => { profileMap[p.user_id] = p; });
  }

  // Linked transfer
  let transfer = null;
  if (number.source === 'transfer' && number.source_id) {
    const { data: tr } = await supabaseAdmin
      .from('transfers').select('id,form_data,status,created_at').eq('id', number.source_id).single();
    transfer = tr || null;
  }

  const companyMap = await enrichCompanies([number], n => n.company_id);

  res.json({
    number: {
      ...number,
      owner_name:   profileName(profileMap, number.owner_id),
      company_name: companyMap[number.company_id]?.name || null,
    },
    claims: claims.map(c => ({
      ...c,
      owner_name: profileName(profileMap, c.owner_id) || 'Unknown',
    })),
    attempts: attempts.map(a => ({
      ...a,
      caller_name: profileName(profileMap, a.caller_id) || 'Unknown',
    })),
    history: history.map(h => ({
      ...h,
      actor_name: h.actor_id ? (profileName(profileMap, h.actor_id) || 'Unknown') : 'System',
    })),
    transfer,
  });
}));

// ── GET /compliance/callback-audit-log ───────────────────────────────────────
// Full status-change audit trail for callbacks. Supports company/actor/date filters.
router.get('/callback-audit-log', asyncHandler(async (req, res) => {
  const { company_id, actor_id, date_from, date_to, page = 1, limit = 50 } = req.query;
  const lim = Math.min(parseInt(limit) || 50, 500);
  const off = (parseInt(page) - 1) * lim;

  let query = supabaseAdmin
    .from('callback_audit_log')
    .select('*, companies(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(off, off + lim - 1);

  if (company_id) query = query.eq('company_id', company_id);
  if (actor_id)   query = query.eq('actor_id', actor_id);
  if (date_from)  query = query.gte('created_at', etDateToUtcStart(date_from));
  if (date_to)    query = query.lte('created_at', etDateToUtcEnd(date_to));

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Enrich with actor display names
  const actorIds = [...new Set((data || []).map(e => e.actor_id).filter(Boolean))];
  let actorMap = {};
  if (actorIds.length) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, first_name, last_name')
      .in('user_id', actorIds);
    (profiles || []).forEach(p => {
      actorMap[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';
    });
  }

  const entries = (data || []).map(e => ({
    ...e,
    actor_name:   actorMap[e.actor_id] || 'System',
    company_name: e.companies?.name   || null,
    callback_deleted: e.callback_id === null,
  }));

  res.json({ entries, total: count || 0, page: parseInt(page), limit: lim });
}));

// ============================================================================
// Bulk status update — search by reference / policy numbers, preview, apply
//
//   POST /compliance/sales/bulk-search
//     body: { refs: string[] }   (max 500 entries, whitespace-trimmed)
//     resp: { matched: SaleSummary[], unmatched: string[], duplicates: string[] }
//
//   POST /compliance/sales/bulk-status
//     body: { ids: string[], new_status: string, reason?: string }
//     resp: { updated: number, skipped: [{id, reason}], results: [{id, status}] }
//
// Reference matching is exact (case-insensitive). The lookup tries each ref
// against three columns in order: sales.reference_no, sales.form_data->>'SaleReferenceNo',
// and sales.form_data->>'PolicyNumber' (plus snake_case + lowercase variants
// admins commonly use in Form Builder). First hit wins.
//
// The "reason" body field is required when the new_status belongs to a
// cancellation/loss category (cancelled, compliance_cancelled, closed_lost,
// chargeback, dispute) so the compliance team always records *why* a
// cancellation happened. The reason is appended to compliance_note + the
// edit_history audit entry.
// ============================================================================

const POLICY_KEYS = ['PolicyNumber', 'policy_number', 'policy_no', 'PolicyNo'];
const REF_KEYS    = ['SaleReferenceNo', 'sale_reference_no', 'reference_no', 'ReferenceNo'];

// Status keys that require a reason. Catalog-driven would be cleaner but we
// keep it static here so the rule survives even if business_config is
// unreachable; the legacy lifecycle keys cover the cancellation cases.
const CANCEL_LIKE_STATUSES = new Set([
  'cancelled', 'compliance_cancelled', 'closed_lost', 'chargeback', 'dispute',
]);

router.post('/sales/bulk-search', asyncHandler(async (req, res) => {
  const rawRefs = Array.isArray(req.body?.refs) ? req.body.refs : [];
  const refs = [...new Set(rawRefs.map(r => String(r ?? '').trim()).filter(Boolean))];
  if (!refs.length)  return res.status(400).json({ error: 'No reference numbers provided.' });
  if (refs.length > 500) return res.status(400).json({ error: 'Too many references in one batch (max 500). Split the list.' });

  // Track duplicates the caller sent so they see them flagged in the UI.
  const duplicates = [];
  const seen = new Set();
  rawRefs.forEach(r => {
    const k = String(r ?? '').trim();
    if (!k) return;
    if (seen.has(k.toLowerCase())) duplicates.push(k); else seen.add(k.toLowerCase());
  });

  // Build a single query that matches reference_no OR any of the JSON keys.
  // Using `.or()` keeps the query a single round-trip even with N refs +
  // M alternate keys.
  const refLowers = refs.map(r => r.toLowerCase());
  const refUppers = refs.map(r => r.toUpperCase());
  const allVariants = [...new Set([...refs, ...refLowers, ...refUppers])];

  // Direct column match (cheap — uses idx_sales_reference_no).
  const { data: byCol, error: e1 } = await supabaseAdmin
    .from('sales')
    .select('id, reference_no, status, customer_name, customer_phone, sale_date, monthly_payment, company_id, fronter_id, closer_id, plan, form_data, compliance_note, edit_history, transfer_id')
    .in('reference_no', allVariants);
  if (e1) return res.status(500).json({ error: e1.message });

  // JSON-key match for form_data variants. Supabase PostgREST can `.in()` on
  // a JSONB path with the ->> arrow.
  const jsonRows = [];
  for (const k of [...REF_KEYS, ...POLICY_KEYS]) {
    const { data, error } = await supabaseAdmin
      .from('sales')
      .select('id, reference_no, status, customer_name, customer_phone, sale_date, monthly_payment, company_id, fronter_id, closer_id, plan, form_data, compliance_note, edit_history, transfer_id')
      .in(`form_data->>${k}`, allVariants);
    if (error) continue;
    if (data?.length) jsonRows.push(...data);
  }

  // De-duplicate sales (a row may have hit both reference_no and form_data).
  const saleById = new Map();
  [...(byCol || []), ...jsonRows].forEach(r => saleById.set(r.id, r));
  const sales = [...saleById.values()];

  // Hydrate human-readable company / closer / fronter names in one round-trip.
  const companyIds = [...new Set(sales.map(s => s.company_id).filter(Boolean))];
  const userIds    = [...new Set(sales.flatMap(s => [s.fronter_id, s.closer_id]).filter(Boolean))];
  const [{ data: cos }, { data: profiles }] = await Promise.all([
    companyIds.length
      ? supabaseAdmin.from('companies').select('id, name').in('id', companyIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', userIds)
      : Promise.resolve({ data: [] }),
  ]);
  const coName  = Object.fromEntries((cos || []).map(c => [c.id, c.name]));
  const usrName = Object.fromEntries((profiles || []).map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim()]));

  // Resolve which input ref produced each sale (so the UI can show
  // "P-100 → matched", "P-999 → not found"). A sale may match more than one
  // ref (rare); we attribute it to the first match.
  const matchedRefSet = new Set();
  const summaries = sales.map(s => {
    const fdRefs = []
      .concat(...REF_KEYS.map(k => [s.form_data?.[k]]))
      .concat(...POLICY_KEYS.map(k => [s.form_data?.[k]]))
      .map(v => (v == null ? '' : String(v).toLowerCase()));
    const all = new Set([String(s.reference_no || '').toLowerCase(), ...fdRefs].filter(Boolean));
    const matchedRef = refs.find(r => all.has(r.toLowerCase())) || s.reference_no || null;
    if (matchedRef) matchedRefSet.add(matchedRef.toLowerCase());
    return {
      id:              s.id,
      reference_no:    s.reference_no,
      policy_number:   POLICY_KEYS.map(k => s.form_data?.[k]).find(Boolean) || null,
      matched_via:     matchedRef,
      status:          s.status,
      customer_name:   s.customer_name,
      customer_phone:  s.customer_phone,
      sale_date:       s.sale_date,
      monthly_payment: s.monthly_payment,
      plan:            s.plan,
      company_id:      s.company_id,
      company_name:    coName[s.company_id] || null,
      fronter_name:    usrName[s.fronter_id] || null,
      closer_name:     usrName[s.closer_id]  || null,
      compliance_note: s.compliance_note || null,
    };
  });

  const unmatched = refs.filter(r => !matchedRefSet.has(r.toLowerCase()));
  res.json({ matched: summaries, unmatched, duplicates });
}));

router.post('/sales/bulk-status', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const role   = req.user.role;
  const ids        = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
  const new_status = String(req.body?.new_status || '').trim();
  const reason     = String(req.body?.reason || '').trim();

  if (!ids.length)       return res.status(400).json({ error: 'No sale ids provided.' });
  if (ids.length > 500)  return res.status(400).json({ error: 'Too many ids in one batch (max 500).' });
  if (!new_status)       return res.status(400).json({ error: 'new_status is required.' });
  if (CANCEL_LIKE_STATUSES.has(new_status) && !reason) {
    return res.status(400).json({ error: 'A reason is required when applying a cancellation status.' });
  }

  // Validate the status against the live catalog (falls back to legacy
  // allowed_statuses, then the hardcoded lifecycle set used in sales.js).
  const { getConfig } = require('../utils/businessConfig');
  const catalog = await getConfig(null, 'compliance.status_catalog', null);
  const allowed = Array.isArray(catalog) && catalog.length
    ? new Set(catalog.filter(s => s.enabled !== false).map(s => s.key))
    : new Set(['open','sold','cancelled','follow_up','closed_won','closed_lost','pending_review','needs_revision','compliance_cancelled','chargeback','dispute']);
  if (!allowed.has(new_status)) {
    return res.status(400).json({ error: `"${new_status}" is not an allowed status.` });
  }

  const now = new Date().toISOString();
  const { data: rows, error: fetchErr } = await supabaseAdmin
    .from('sales').select('id, status, edit_history, compliance_note').in('id', ids);
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const results = [];
  const skipped = [];
  for (const sale of rows || []) {
    if (sale.status === new_status) {
      skipped.push({ id: sale.id, reason: `Already ${new_status}` });
      continue;
    }
    const history = Array.isArray(sale.edit_history) ? sale.edit_history : [];
    const newNote = reason
      ? (sale.compliance_note ? `${sale.compliance_note}\n${now.slice(0,10)} · ${new_status}: ${reason}` : `${now.slice(0,10)} · ${new_status}: ${reason}`)
      : sale.compliance_note;

    const patch = {
      status: new_status,
      updated_at: now,
      compliance_note: newNote,
      edit_history: [...history, {
        editor_id: userId,
        role,
        action: 'bulk_status_update',
        previous_status: sale.status,
        new_status,
        reason: reason || null,
        edited_at: now,
      }],
    };
    if (['closed_won', 'closed_lost', 'cancelled', 'compliance_cancelled', 'needs_revision'].includes(new_status)) {
      patch.compliance_reviewed_by = userId;
      patch.compliance_reviewed_at = now;
    }
    const { error: updateErr } = await supabaseAdmin.from('sales').update(patch).eq('id', sale.id);
    if (updateErr) { skipped.push({ id: sale.id, reason: updateErr.message }); continue; }
    results.push({ id: sale.id, previous_status: sale.status, new_status });
  }

  // Report sales that were in the request but didn't come back from the DB
  // (deleted or not visible to the caller). Helps the operator reconcile.
  const foundIds = new Set((rows || []).map(r => r.id));
  ids.filter(i => !foundIds.has(i)).forEach(i => skipped.push({ id: i, reason: 'Not found' }));

  logger.success('COMPLIANCE_BULK_STATUS', `User ${userId} → ${new_status} on ${results.length} sale(s)`);
  res.json({ updated: results.length, results, skipped });
}));

module.exports = router;
