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
  if (date_from) query = query.gte('created_at', etDateToUtcStart(date_from));
  if (date_to)   query = query.lte('created_at', etDateToUtcEnd(date_to));
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

module.exports = router;
