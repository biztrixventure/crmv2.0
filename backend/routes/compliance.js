const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { etDateToUtcStart, etDateToUtcEnd } = require('../utils/etUtils');
const { escapeOrValue } = require('../utils/searchSanitize');
const { applySort } = require('../utils/sortHelper');
const { onSalesActivityChanged: spiffOnSalesChanged } = require('../utils/spiffMetrics');

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
// Optional ?date_from=&date_to= (YYYY-MM-DD, ET) filters the time-based KPI
// counts to the selected window. Sales + pending are filtered on the business
// SALE DATE (sale_date) — the day the deal happened — to match the All Sales
// tab and the closer's own numbers, NOT created_at (the upload/entry moment).
// Transfers have no sale_date, so they're filtered on created_at. User headcount
// is a live total and not date-bound. Every company is always returned (the
// counts shrink, the list does not) so the company dropdowns elsewhere keep working.
router.get('/companies', asyncHandler(async (req, res) => {
  const { date_from, date_to } = req.query;

  const { data: companies, error } = await supabaseAdmin
    .from('companies')
    .select('id, name, company_type, is_active, created_at')
    .order('name');
  if (error) return res.status(500).json({ error: error.message });

  const ids = (companies || []).map(c => c.id);
  if (!ids.length) return res.json({ companies: [], total: 0 });

  // Sales/pending → filter on sale_date (plain YYYY-MM-DD column, ET business day).
  const bySaleDate = (q) => {
    if (date_from) q = q.gte('sale_date', date_from);
    if (date_to)   q = q.lte('sale_date', date_to);
    return q;
  };
  // Transfers → filter on created_at (no sale_date on transfers).
  const byCreatedAt = (q) => {
    if (date_from) q = q.gte('created_at', etDateToUtcStart(date_from));
    if (date_to)   q = q.lte('created_at', etDateToUtcEnd(date_to));
    return q;
  };

  // One sales scan carries every per-company sales metric the Overview card
  // shows — total, pending, completed (approved), cancelled, and gross value
  // (sum of down payments). Cheaper than separate count round-trips.
  // PostgREST caps a single select at 1000 rows. These KPIs count rows in JS, so
  // a naive select silently truncated to the first 1000 — for "All Time" (10k+
  // transfers) that made high-volume companies undercount or show 0. Page through
  // every row instead.
  const userCount = {}, saleCount = {}, pendingCount = {}, completedCount = {}, cancelledCount = {}, grossValue = {}, transferCount = {};

  // Fast path: one grouped query per table inside the DB (migration 103) — reads
  // ~one row per company instead of paging every sale + transfer. Falls back to
  // the legacy page-everything-and-count-in-JS scan if the RPC isn't present yet.
  const { data: kpis, error: kpiErr } = await supabaseAdmin.rpc('compliance_company_kpis', {
    p_ids:       ids,
    p_sale_from: date_from || null,
    p_sale_to:   date_to   || null,
    p_xfer_from: date_from ? etDateToUtcStart(date_from) : null,
    p_xfer_to:   date_to   ? etDateToUtcEnd(date_to)     : null,
  });

  if (!kpiErr && Array.isArray(kpis)) {
    kpis.forEach(k => {
      userCount[k.company_id]      = Number(k.user_count) || 0;
      saleCount[k.company_id]      = Number(k.sale_count) || 0;
      pendingCount[k.company_id]   = Number(k.pending_review_count) || 0;
      completedCount[k.company_id] = Number(k.completed_count) || 0;
      cancelledCount[k.company_id] = Number(k.cancelled_count) || 0;
      grossValue[k.company_id]     = Number(k.gross_value) || 0;
      transferCount[k.company_id]  = Number(k.transfer_count) || 0;
    });
  } else {
    if (kpiErr) logger.warn('COMPLIANCE', `KPI RPC unavailable, falling back to scan: ${kpiErr.message}`);
    const fetchAll = async (build) => {
      const PAGE = 1000;
      let all = [], from = 0;
      for (;;) {
        const { data, error } = await build().range(from, from + PAGE - 1);
        if (error || !data) break;
        all = all.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return all;
    };
    const [usersData, salesData, transfersData] = await Promise.all([
      fetchAll(() => supabaseAdmin.from('user_company_roles').select('company_id').eq('is_active', true).in('company_id', ids)),
      fetchAll(() => bySaleDate(supabaseAdmin.from('sales').select('company_id, status, down_payment').in('company_id', ids))),
      fetchAll(() => byCreatedAt(supabaseAdmin.from('transfers').select('company_id').in('company_id', ids))),
    ]);
    usersData.forEach(u => { userCount[u.company_id] = (userCount[u.company_id] || 0) + 1; });
    salesData.forEach(s => {
      const c = s.company_id;
      saleCount[c] = (saleCount[c] || 0) + 1;
      if (s.status === 'pending_review')                          pendingCount[c]   = (pendingCount[c]   || 0) + 1;
      if (s.status === 'closed_won' || s.status === 'sold')       completedCount[c] = (completedCount[c] || 0) + 1;
      if (s.status === 'cancelled' || s.status === 'compliance_cancelled') cancelledCount[c] = (cancelledCount[c] || 0) + 1;
      grossValue[c] = (grossValue[c] || 0) + (Number(s.down_payment) || 0);
    });
    transfersData.forEach(t => { transferCount[t.company_id] = (transferCount[t.company_id] || 0) + 1; });
  }

  const enriched = (companies || []).map(c => ({
    ...c,
    user_count:           userCount[c.id]      || 0,
    sale_count:           saleCount[c.id]      || 0,
    pending_review_count: pendingCount[c.id]   || 0,
    completed_count:      completedCount[c.id] || 0,
    cancelled_count:      cancelledCount[c.id] || 0,
    gross_value:          grossValue[c.id]     || 0,
    transfer_count:       transferCount[c.id]  || 0,
  }));

  logger.info('COMPLIANCE', `Loaded ${enriched.length} companies${date_from || date_to ? ` (${date_from || '…'} → ${date_to || '…'})` : ''}`);
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
  const { company_id, user_ids, status, disposition, exclude_post_date, charge_from, charge_to, date_from, date_to, search, page = 1, limit = 50, sort_by, sort_dir } = req.query;

  // Determine the company type up front so sales get scoped correctly. Sales
  // are stored under the CLOSER company; a fronter company owns transfers, not
  // sales, so we scope those by the LINKED transfer's company.
  let companyType = null;
  if (company_id) {
    const { data: co } = await supabaseAdmin
      .from('companies').select('company_type').eq('id', company_id).maybeSingle();
    companyType = co?.company_type || null;
  }

  // For a fronter company, filter via a server-side inner join on the linked
  // transfer (transfers!inner) instead of pulling every transfer id into an
  // .in() clause. A busy fronter has thousands of transfers, and that id list
  // overflowed the request URL — the source of the 500 on this endpoint.
  let query = (companyType === 'fronter')
    ? supabaseAdmin.from('sales').select('*, transfers!inner(company_id)', { count: 'exact' }).eq('transfers.company_id', company_id)
    : supabaseAdmin.from('sales').select('*', { count: 'exact' });

  query = applySort(query, sort_by, sort_dir, SALE_SORT, { col: 'created_at', asc: false });

  if (company_id && companyType !== 'fronter') query = query.eq('company_id', company_id);

  if (user_ids) {
    const ids = user_ids.split(',').filter(Boolean);
    if (ids.length) query = query.in('closer_id', ids);
  }
  if (status)    query = query.eq('status', status);
  // Disposition tab filter (closer_disposition) — drives the dynamic per-
  // disposition tabs (e.g. "Post Date") in compliance.
  if (disposition) {
    query = query.eq('closer_disposition', disposition);
  } else if (exclude_post_date) {
    // All Sales + the review Queue hide un-charged post-date sales. A post-date
    // sale lives ONLY in its Post Date tab until "Charge → Sale" flips
    // closer_disposition to 'sale' (and clears charge_at); only then is it
    // eligible for review/approval. NULL-safe (keeps rows with no/other
    // disposition) and mirrors isPostDateDispo() on the frontend
    // (/post[\s_-]?date|postdate/i ≈ ilike '%post%date%').
    query = query.or('closer_disposition.is.null,closer_disposition.not.ilike.%post%date%');
  }
  // Charge-date window for the Post Date tab.
  if (charge_from) query = query.gte('charge_at', charge_from);
  if (charge_to)   query = query.lte('charge_at', charge_to);
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

  // Pre-compute a fallback: when sales.fronter_id is null (legacy rows
  // created before that column was populated, or bulk-uploaded sales whose
  // file didn't carry a fronter), fall back to the LINKED TRANSFER's
  // created_by — that IS the fronter for the lead by definition. Without
  // this, the SuperAdmin sales table shows "—" for the fronter column on
  // every legacy row.
  const transferIds = [...new Set((data || []).map(s => s.transfer_id).filter(Boolean))];
  const transferCreatedBy = {};
  if (transferIds.length) {
    const { data: tfs } = await supabaseAdmin
      .from('transfers').select('id, created_by').in('id', transferIds);
    (tfs || []).forEach(t => { transferCreatedBy[t.id] = t.created_by; });
  }
  const resolvedFronterId = (s) => s.fronter_id || (s.transfer_id ? transferCreatedBy[s.transfer_id] : null) || null;

  const fronterIds = [...new Set((data || []).map(resolvedFronterId).filter(Boolean))];
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

  const enriched = (data || []).map(row => {
    // Drop the join-only `transfers` embed (present when scoping by a fronter
    // company) so the response shape matches the non-join path exactly.
    const { transfers: _join, ...s } = row;
    const frId = resolvedFronterId(s);
    return {
      ...s,
      // Surface the resolved id too so downstream UIs that link to the
      // fronter's profile don't need to repeat the fallback themselves.
      fronter_id:    s.fronter_id || frId,
      closer_name:   profileName(profileMap, s.closer_id),
      fronter_name:  profileName(fronterProfileMap, frId),
      companies:     companyMap[s.company_id] || null,
      user_profiles: profileMap[s.closer_id] || null,
    };
  });

  // True per-status totals for the WHOLE filtered set (so the stats strip is
  // consistent across pages — page-only counts made "Today" look bigger than
  // "This Month"). One light single-column query, only when no status filter is
  // active (when one is, the `total` above is already that status's true count).
  // Additive + fault-tolerant: any error → omit, UI falls back to page counts.
  // Only on page 1 (filters reset to page 1) — the totals don't change between
  // pages, so paging never re-runs this. null on later pages → UI keeps it.
  let status_counts = null;
  if (!status && parseInt(page) === 1) {
    try {
      let scq = (companyType === 'fronter')
        ? supabaseAdmin.from('sales').select('status, transfers!inner(company_id)').eq('transfers.company_id', company_id)
        : supabaseAdmin.from('sales').select('status');
      if (company_id && companyType !== 'fronter') scq = scq.eq('company_id', company_id);
      if (user_ids) { const ids = user_ids.split(',').filter(Boolean); if (ids.length) scq = scq.in('closer_id', ids); }
      if (disposition) scq = scq.eq('closer_disposition', disposition);
      else if (exclude_post_date) scq = scq.or('closer_disposition.is.null,closer_disposition.not.ilike.%post%date%');
      if (charge_from) scq = scq.gte('charge_at', charge_from);
      if (charge_to)   scq = scq.lte('charge_at', charge_to);
      if (date_from)   scq = scq.gte('sale_date', date_from);
      if (date_to)     scq = scq.lte('sale_date', date_to);
      if (search) { const s = escapeOrValue(search); scq = scq.or(`customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%,reference_no.ilike.%${s}%`); }
      const { data: scRows } = await scq.limit(20000);
      if (scRows) { status_counts = {}; scRows.forEach(r => { status_counts[r.status] = (status_counts[r.status] || 0) + 1; }); }
    } catch { status_counts = null; }
  }

  res.json({ sales: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit), status_counts });
}));

// ── GET /compliance/transfers ─────────────────────────────────────────────────
router.get('/transfers', asyncHandler(async (req, res) => {
  const { company_id, user_ids, closer_id, status, date_from, date_to, search, page = 1, limit = 50, sort_by, sort_dir } = req.query;

  // Compliance reconciliation: by default list from the view that also exposes
  // invisible 'refresh' duplicate attempts (migration 089), so every VICIDIAL
  // transfer attempt is a visible, countable, exportable record. Pass
  // include_duplicates=false to read the bare transfers table instead.
  // Global duplicate-handling switch. When OFF, compliance shows NO duplicate UI
  // at all — no synthetic in-place rows, no pills — even for already-flagged
  // records. Reverts to the plain transfers list.
  const { getConfig } = require('../utils/businessConfig');
  const dedupV = await getConfig(null, 'dedup.enabled', true);
  const dedupEnabled = !(dedupV === false || dedupV === 'false' || dedupV === 0 || dedupV === '0');
  const includeDuplicates = dedupEnabled && req.query.include_duplicates !== 'false';
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // Same filters either way — built against whichever relation we read from.
  // Free-text search hits normalized_phone + the JSONB form_data keys that
  // hold the customer name / phone (parity with the closer-side phone search).
  const buildQuery = (from) => {
    let q = applySort(
      supabaseAdmin.from(from).select('*', { count: 'exact' }),
      sort_by, sort_dir, TRANSFER_SORT, { col: 'created_at', asc: false },
    );
    if (company_id) q = q.eq('company_id', company_id);
    if (user_ids) {
      const ids = user_ids.split(',').filter(Boolean);
      if (ids.length) q = q.in('created_by', ids);
    }
    if (closer_id) q = q.eq('assigned_closer_id', closer_id);
    if (status)    q = q.eq('status', status);
    if (date_from) q = q.gte('created_at', etDateToUtcStart(date_from));
    if (date_to)   q = q.lte('created_at', etDateToUtcEnd(date_to));
    if (search) {
      const s = escapeOrValue(search);
      q = q.or(
        `normalized_phone.ilike.%${s}%,` +
        `form_data->>customer_name.ilike.%${s}%,` +
        `form_data->>customer_phone.ilike.%${s}%,` +
        `form_data->>Phone.ilike.%${s}%,` +
        `form_data->>FirstName.ilike.%${s}%,` +
        `form_data->>LastName.ilike.%${s}%`
      );
    }
    return q.range(offset, offset + parseInt(limit) - 1);
  };

  // Light status-only query (same filters minus status + paging) for the true
  // per-status totals on the stats strip — consistent across pages.
  const buildStatusQuery = (from) => {
    let q = supabaseAdmin.from(from).select('status');
    if (company_id) q = q.eq('company_id', company_id);
    if (user_ids) { const ids = user_ids.split(',').filter(Boolean); if (ids.length) q = q.in('created_by', ids); }
    if (closer_id) q = q.eq('assigned_closer_id', closer_id);
    if (date_from) q = q.gte('created_at', etDateToUtcStart(date_from));
    if (date_to)   q = q.lte('created_at', etDateToUtcEnd(date_to));
    if (search) {
      const s = escapeOrValue(search);
      q = q.or(
        `normalized_phone.ilike.%${s}%,form_data->>customer_name.ilike.%${s}%,` +
        `form_data->>customer_phone.ilike.%${s}%,form_data->>Phone.ilike.%${s}%,` +
        `form_data->>FirstName.ilike.%${s}%,form_data->>LastName.ilike.%${s}%`
      );
    }
    return q.limit(20000);
  };

  let data, error, count;
  if (includeDuplicates) {
    ({ data, error, count } = await buildQuery('v_compliance_transfer_records'));
    // Deploy-safe: if the view is missing (089 not applied yet) fall back to
    // the bare table so the compliance tab never breaks.
    if (error) ({ data, error, count } = await buildQuery('transfers'));
  } else {
    ({ data, error, count } = await buildQuery('transfers'));
  }
  if (error) return res.status(500).json({ error: error.message });

  let status_counts = null;
  if (!status && parseInt(page) === 1) {
    try {
      const src = includeDuplicates ? 'v_compliance_transfer_records' : 'transfers';
      let { data: scRows, error: scErr } = await buildStatusQuery(src);
      if (scErr) ({ data: scRows } = await buildStatusQuery('transfers'));
      if (scRows) { status_counts = {}; scRows.forEach(r => { status_counts[r.status] = (status_counts[r.status] || 0) + 1; }); }
    } catch { status_counts = null; }
  }

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

  // Enrich with linked sale data + latest disposition. Include the refreshed
  // original's id too, so a synthetic 'Duplicate · in-place' row can borrow the
  // disposition of the transfer it merged into (the synthetic row has none of
  // its own — that's why the dispo column was blank on those rows).
  const transferIds = [...new Set([
    ...(data || []).map(t => t.id),
    ...(data || []).map(t => t.refreshed_transfer_id),
  ].filter(Boolean))];
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

  // Duplicate-attempt origin. A transfer is flagged "duplicate" when it's the
  // NEW row a dedup event created — 'reengage' (re-submitted past the dedup
  // window) or 'sale_overlap' (a completed sale already existed on the prior
  // lead). 'refresh' updates an existing row in place, so it isn't a new entry
  // and is intentionally not flagged. Duplicates stay in the normal list so the
  // tab still shows every transfer created (real + duplicate) for easy counting.
  let dupMap = {};
  if (dedupEnabled && transferIds.length > 0) {
    const { data: dedup } = await supabaseAdmin
      .from('transfer_dedup_events')
      .select('transfer_id, prior_transfer_id, event_type, created_at')
      .in('transfer_id', transferIds)
      .in('event_type', ['reengage', 'sale_overlap'])
      .order('created_at', { ascending: false });

    const priorIds = [...new Set((dedup || []).map(d => d.prior_transfer_id).filter(Boolean))];
    let priorMap = {};
    if (priorIds.length) {
      const { data: priors } = await supabaseAdmin
        .from('transfers').select('id, created_at, created_by, status').in('id', priorIds);
      (priors || []).forEach(p => { priorMap[p.id] = p; });
      // Pull in any prior-creator names not already in profileMap.
      const missing = [...new Set((priors || []).map(p => p.created_by).filter(id => id && !profileMap[id]))];
      if (missing.length) {
        const { data: mp } = await supabaseAdmin.from('user_profiles').select('user_id,first_name,last_name').in('user_id', missing);
        (mp || []).forEach(p => { profileMap[p.user_id] = p; });
      }
    }
    (dedup || []).forEach(d => {
      if (dupMap[d.transfer_id]) return;   // keep the most recent event per transfer
      const prior = d.prior_transfer_id ? priorMap[d.prior_transfer_id] : null;
      dupMap[d.transfer_id] = {
        duplicate_reason:      d.event_type,
        duplicate_detected_at: d.created_at,
        original_transfer: prior ? {
          id: prior.id,
          created_at: prior.created_at,
          created_by_name: profileName(profileMap, prior.created_by),
          status: prior.status,
        } : (d.prior_transfer_id ? { id: d.prior_transfer_id } : null),
      };
    });
  }

  // Synthetic 'refresh' duplicate rows (from the view) carry the id of the lead
  // they refreshed in refreshed_transfer_id. Resolve those originals so the
  // modal can show the same "original transfer" context as reengage/sale_overlap.
  let refreshedMap = {};
  const refreshedIds = [...new Set((data || [])
    .filter(t => t.record_type === 'duplicate_refresh' && t.refreshed_transfer_id)
    .map(t => t.refreshed_transfer_id))];
  if (refreshedIds.length) {
    const { data: rts } = await supabaseAdmin
      .from('transfers').select('id, created_at, created_by, status').in('id', refreshedIds);
    (rts || []).forEach(p => { refreshedMap[p.id] = p; });
    const missing = [...new Set((rts || []).map(p => p.created_by).filter(id => id && !profileMap[id]))];
    if (missing.length) {
      const { data: mp } = await supabaseAdmin.from('user_profiles').select('user_id,first_name,last_name').in('user_id', missing);
      (mp || []).forEach(p => { profileMap[p.user_id] = p; });
    }
  }

  // For ANY duplicate row with no closer/disposition of its own — the in-place
  // refresh rows AND a re-transfer flagged against a prior lead (e.g. a customer
  // already sold) — borrow the closer + disposition from that related ORIGINAL
  // transfer, so the record shows who worked it and how instead of a blank row.
  const originalIds = [...new Set([
    ...Object.keys(refreshedMap),
    ...Object.values(dupMap).map(d => d.original_transfer?.id),
  ].filter(Boolean))];
  const borrowDispo = {}, borrowCloser = {};
  if (originalIds.length) {
    const [bd, bt] = await Promise.all([
      supabaseAdmin.from('disposition_actions')
        .select('transfer_id, disposition_name, color, user_id, setter_role, created_at')
        .in('transfer_id', originalIds).order('created_at', { ascending: false }),
      supabaseAdmin.from('transfers').select('id, assigned_closer_id').in('id', originalIds),
    ]);
    const need = [...new Set([
      ...(bd.data || []).map(a => a.user_id),
      ...(bt.data || []).map(t => t.assigned_closer_id),
    ].filter(id => id && !profileMap[id]))];
    if (need.length) {
      const { data: np } = await supabaseAdmin.from('user_profiles').select('user_id,first_name,last_name').in('user_id', need);
      (np || []).forEach(p => { profileMap[p.user_id] = p; });
    }
    (bd.data || []).forEach(a => { if (!borrowDispo[a.transfer_id]) borrowDispo[a.transfer_id] = { ...a, setter_name: profileName(profileMap, a.user_id) }; });
    (bt.data || []).forEach(t => { if (t.assigned_closer_id) borrowCloser[t.id] = t.assigned_closer_id; });
  }

  const enriched = (data || []).map(t => {
    const sale = saleMap[t.id] || null;
    const dup  = dupMap[t.id] || null;
    // A synthetic refresh row IS the duplicate record — flag it directly rather
    // than via dupMap (which only covers reengage / sale_overlap real rows).
    const isRefreshDup = t.record_type === 'duplicate_refresh';
    const refreshed = isRefreshDup && t.refreshed_transfer_id ? refreshedMap[t.refreshed_transfer_id] : null;
    // The related original (refresh target or prior lead) to borrow from.
    const relatedId = t.refreshed_transfer_id || dup?.original_transfer?.id || null;
    const borrowedCloserId = (!t.assigned_closer_id && relatedId) ? borrowCloser[relatedId] : null;
    return {
      ...t,
      created_by_name:       profileName(profileMap, t.created_by),
      assigned_closer_name:  profileName(profileMap, t.assigned_closer_id) || (borrowedCloserId ? profileName(profileMap, borrowedCloserId) : null),
      company_name:          companyMap[t.company_id]?.name || null,
      sale_id:               sale?.id || null,
      sale_status:           sale?.status || null,
      sale_compliance_note:  sale?.compliance_note || null,
      sale_reference_no:     sale?.reference_no || null,
      // A duplicate row has no disposition of its own → fall back to the original
      // transfer it refreshed / duplicates, so the record isn't blank.
      latest_disposition:    latestDispoMap[t.id] || (relatedId ? (latestDispoMap[relatedId] || borrowDispo[relatedId]) : null) || null,
      is_duplicate:          isRefreshDup ? true : !!dup,
      duplicate_reason:      isRefreshDup ? 'refresh' : (dup?.duplicate_reason || null),
      duplicate_detected_at: isRefreshDup ? t.created_at : (dup?.duplicate_detected_at || null),
      original_transfer:     isRefreshDup
        ? (refreshed
            ? { id: refreshed.id, created_at: refreshed.created_at, created_by_name: profileName(profileMap, refreshed.created_by), status: refreshed.status }
            : (t.refreshed_transfer_id ? { id: t.refreshed_transfer_id } : null))
        : (dup?.original_transfer || null),
    };
  });

  res.json({ transfers: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit), status_counts, dedup_enabled: dedupEnabled });
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

  // True per-status totals for the strip (same filters minus status + paging).
  // Page 1 only — totals are page-independent, so paging never re-runs this.
  let status_counts = null;
  if (!status && parseInt(page) === 1) {
    try {
      let scq = supabaseAdmin.from('callbacks').select('status');
      if (company_id) scq = scq.eq('company_id', company_id);
      else if (scopeCompanyIds) scq = scq.in('company_id', scopeCompanyIds);
      if (user_ids) { const ids = user_ids.split(',').filter(Boolean); if (ids.length) scq = scq.in('user_id', ids); }
      if (priority)     scq = scq.eq('priority', priority);
      if (date_from)    scq = scq.gte('callback_at', etDateToUtcStart(date_from));
      if (date_to)      scq = scq.lte('callback_at', etDateToUtcEnd(date_to));
      if (created_from) scq = scq.gte('created_at',  etDateToUtcStart(created_from));
      if (created_to)   scq = scq.lte('created_at',  etDateToUtcEnd(created_to));
      if (search) { const s = escapeOrValue(search); scq = scq.or(`customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%`); }
      const { data: scRows } = await scq.limit(20000);
      if (scRows) { status_counts = {}; scRows.forEach(r => { status_counts[r.status] = (status_counts[r.status] || 0) + 1; }); }
    } catch { status_counts = null; }
  }

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

  res.json({ callbacks: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit), status_counts });
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

// Module-level guard: tracks whether sales.cancellation_date has been seen.
// PostgREST returns code 42703 / message contains "cancellation_date" when
// the column is missing (mig 075 not yet applied). We flip this flag and
// stop selecting/writing the column until the process restarts. Restart
// after applying the migration re-probes on the first read.
let _hasCancellationDate = true;
const looksLikeMissingCancelCol = (e) =>
  e && typeof e === 'object' && (
    e.code === '42703' ||
    /cancellation_date/i.test(String(e.message || '')) ||
    /column.*does not exist/i.test(String(e.message || ''))
  );

// Strip characters that PostgREST .in() and .or() treat as syntax. We never
// permit them inside ref/policy strings (they're not valid identifiers in
// practice) so dropping them is safer than escaping and avoids 400s caused
// by user input like "P-001, P-002" being pasted into a single cell.
const sanitizeRef = (s) => String(s ?? '').replace(/[,()'"\\]/g, '').trim();

// Chunk so a single PostgREST URL never exceeds the safe length (the
// .in() filter and .or() filter both get embedded in the query string).
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

router.post('/sales/bulk-search', asyncHandler(async (req, res) => {
  const rawRefs = Array.isArray(req.body?.refs) ? req.body.refs : [];
  // Sanitize first so duplicate-detection runs on the cleaned-up form.
  const cleaned = rawRefs.map(sanitizeRef).filter(Boolean);
  if (!cleaned.length) return res.status(400).json({ error: 'No reference numbers provided.' });
  if (cleaned.length > 500) return res.status(400).json({ error: 'Too many references in one batch (max 500). Split the list.' });

  const refs = [];
  const duplicates = [];
  const seen = new Set();
  for (const r of cleaned) {
    const k = r.toLowerCase();
    if (seen.has(k)) duplicates.push(r);
    else { seen.add(k); refs.push(r); }
  }

  const SELECT_COLS = _hasCancellationDate
    ? 'id, reference_no, status, customer_name, customer_phone, sale_date, monthly_payment, company_id, fronter_id, closer_id, plan, form_data, compliance_note, edit_history, transfer_id, cancellation_date'
    : 'id, reference_no, status, customer_name, customer_phone, sale_date, monthly_payment, company_id, fronter_id, closer_id, plan, form_data, compliance_note, edit_history, transfer_id';
  const chunks = chunk(refs, 50);
  const saleById = new Map();

  // For each chunk, run TWO targeted reads:
  //  1. reference_no exact match (case-insensitive via .or ilike).
  //  2. form_data JSON-key match across REF_KEYS + POLICY_KEYS.
  // Each chunk wrapped in try/catch so one bad batch doesn't kill the rest.
  for (const batch of chunks) {
    try {
      // Direct column — single .or() with ilike per ref keeps it case-insensitive
      // and uses the trgm index when present.
      const refOr = batch.map(r => `reference_no.ilike.${r}`).join(',');
      if (refOr) {
        const { data, error } = await supabaseAdmin.from('sales').select(SELECT_COLS).or(refOr);
        if (error) {
          if (looksLikeMissingCancelCol(error)) {
            _hasCancellationDate = false;
            // Retry without the column.
            const fallbackCols = 'id, reference_no, status, customer_name, customer_phone, sale_date, monthly_payment, company_id, fronter_id, closer_id, plan, form_data, compliance_note, edit_history, transfer_id';
            const r2 = await supabaseAdmin.from('sales').select(fallbackCols).or(refOr);
            if (r2.error) logger.warn('BULK_SEARCH_REF', r2.error.message);
            (r2.data || []).forEach(r => saleById.set(r.id, r));
          } else {
            logger.warn('BULK_SEARCH_REF', error.message);
          }
        } else {
          (data || []).forEach(r => saleById.set(r.id, r));
        }
      }

      // JSON-key matches — one .or() per JSON key so the query stays in a
      // single URL even at 50 refs × 7 keys.
      for (const key of [...REF_KEYS, ...POLICY_KEYS]) {
        const jsonOr = batch.map(r => `form_data->>${key}.ilike.${r}`).join(',');
        if (!jsonOr) continue;
        const { data, error } = await supabaseAdmin.from('sales').select(SELECT_COLS).or(jsonOr);
        if (error) { logger.warn(`BULK_SEARCH_${key}`, error.message); continue; }
        (data || []).forEach(r => saleById.set(r.id, r));
      }
    } catch (e) {
      logger.error('BULK_SEARCH_CHUNK', `Chunk failed`, e);
    }
  }
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

// Normalize a date input to YYYY-MM-DD. Accepts ISO timestamp, YYYY-MM-DD,
// MM/DD/YYYY, Excel-serial numbers, or empty string. Returns null when the
// input is empty or unparseable so a bad date never silently overwrites.
function normalizeDate(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  // ISO 8601 first (covers YYYY-MM-DD and full timestamp).
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch.slice(1).join('-');
  // M/D/YYYY or MM/DD/YYYY.
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}`;
  // Excel serial — number of days since 1899-12-30.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const ms = (parseFloat(s) - 25569) * 86400 * 1000;
    if (Number.isFinite(ms)) return new Date(ms).toISOString().slice(0, 10);
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

router.post('/sales/bulk-status', asyncHandler(async (req, res) => {
  // Wrap the whole handler in an explicit try/catch and return the actual
  // failure to the client. The default errorHandler buries the message
  // behind "Internal server error" which makes diagnosing field-shape /
  // schema / catalog issues impossible from the browser. This is a
  // compliance-only route (already permission-gated), so leaking the error
  // text to the operator is acceptable + necessary.
  try {
  const userId = req.user.id;
  const role   = req.user.role;
  const body   = req.body || {};

  // The endpoint accepts either:
  //   - { ids: ["uuid", "uuid"], new_status, reason, cancellation_date }
  //   - { updates: [{ id, cancellation_date?, reason? }], new_status, reason, cancellation_date }
  // Per-row fields override the top-level ones. The bulk fields stay as the
  // fallback so the operator can apply the same date/reason to every row
  // without typing it 50 times.
  const new_status          = String(body.new_status || '').trim();
  const bulkReason          = String(body.reason || '').trim();
  const bulkReasonKey       = String(body.cancellation_reason_key || '').trim() || null;
  const bulkCancelDate      = normalizeDate(body.cancellation_date);
  const bulkChargebackDate  = normalizeDate(body.chargeback_date);
  const bulkChargebackAmt   = Number.isFinite(parseFloat(body.chargeback_amount)) ? parseFloat(body.chargeback_amount) : null;
  let updates             = Array.isArray(body.updates) ? body.updates : null;
  if (!updates) {
    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
    updates = ids.map(id => ({ id }));
  }
  updates = updates.filter(u => u && u.id);

  if (!updates.length)       return res.status(400).json({ error: 'No sale ids provided.' });
  if (updates.length > 500)  return res.status(400).json({ error: 'Too many ids in one batch (max 500).' });
  if (!new_status)           return res.status(400).json({ error: 'new_status is required.' });

  const isCancelLike = CANCEL_LIKE_STATUSES.has(new_status);
  if (isCancelLike && !bulkReason && !updates.every(u => String(u.reason || '').trim())) {
    return res.status(400).json({ error: 'A reason is required when applying a cancellation status (either bulk-level or on every row).' });
  }
  if (bulkCancelDate === null && body.cancellation_date) {
    return res.status(400).json({ error: 'The bulk cancellation_date could not be parsed. Use YYYY-MM-DD or MM/DD/YYYY.' });
  }

  const { getConfig } = require('../utils/businessConfig');
  const catalog = await getConfig(null, 'compliance.status_catalog', null);
  // Defensive: filter out null/undefined entries before .map() — a
  // malformed catalog row would otherwise throw "Cannot read properties
  // of null (reading 'enabled')" and 500 the whole request.
  const allowed = Array.isArray(catalog) && catalog.length
    ? new Set(catalog.filter(s => s && s.key && s.enabled !== false).map(s => s.key))
    : new Set(['open','sold','cancelled','follow_up','closed_won','closed_lost','pending_review','needs_revision','compliance_cancelled','chargeback','dispute']);
  if (!allowed.has(new_status)) {
    return res.status(400).json({ error: `"${new_status}" is not an allowed status. Allowed: ${[...allowed].join(', ')}` });
  }

  const ids = updates.map(u => u.id);
  const now = new Date().toISOString();
  // Wider SELECT — we need the prior-state for each affected row so the
  // batch payload can replay it on revert.
  const fetchCols = () => _hasCancellationDate
    ? 'id, status, edit_history, compliance_note, cancellation_date, cancellation_reason_key, chargeback_date, chargeback_amount, compliance_locked_at'
    : 'id, status, edit_history, compliance_note';

  // Chunked SELECT — .in('id', list) embeds every UUID in the URL query
  // string. 500 × ~37 chars + encoding crosses the ~16KB PostgREST URL
  // ceiling and shows up as "TypeError: fetch failed" with no useful
  // .cause. Batch 100 IDs per request — well clear of any proxy limit.
  const rows = [];
  const idChunks = chunk(ids, 100);
  for (const batch of idChunks) {
    let { data, error } = await supabaseAdmin
      .from('sales').select(fetchCols()).in('id', batch);
    if (error && looksLikeMissingCancelCol(error)) {
      _hasCancellationDate = false;
      const r2 = await supabaseAdmin.from('sales').select(fetchCols()).in('id', batch);
      data = r2.data; error = r2.error;
    }
    if (error) return res.status(500).json({ error: error.message, code: error.code || null });
    if (data?.length) rows.push(...data);
  }

  const byId = new Map((rows || []).map(r => [r.id, r]));
  const results = [];
  const skipped = [];
  // Prior-state payload for the batch row — captured BEFORE the patch
  // mutates each sale so the revert flow can replay precisely. We only
  // push entries for rows that actually got updated (no payload for
  // skipped rows).
  const batchPayload = [];

  for (const upd of updates) {
    const sale = byId.get(upd.id);
    if (!sale) { skipped.push({ id: upd.id, reason: 'Not found' }); continue; }

    // Per-row overrides win; bulk values are the fallback.
    const rowReason = String(upd.reason || '').trim() || bulkReason;
    const rowDateRaw = upd.cancellation_date !== undefined && upd.cancellation_date !== null && upd.cancellation_date !== ''
      ? upd.cancellation_date
      : (bulkCancelDate || null);
    const rowDate = rowDateRaw ? normalizeDate(rowDateRaw) : null;
    if (upd.cancellation_date && rowDate === null) {
      skipped.push({ id: upd.id, reason: `Bad cancellation_date "${upd.cancellation_date}"` });
      continue;
    }
    if (isCancelLike && !rowReason) {
      skipped.push({ id: upd.id, reason: 'Reason required for cancellation status' });
      continue;
    }

    const existingCancelDate = sale.cancellation_date ?? null;
    if (sale.status === new_status && (!rowDate || existingCancelDate === rowDate)) {
      skipped.push({ id: sale.id, reason: `Already ${new_status}${rowDate ? ` on ${rowDate}` : ''}` });
      continue;
    }

    const history = Array.isArray(sale.edit_history) ? sale.edit_history : [];
    const noteLine = rowReason
      ? `${now.slice(0,10)} · ${new_status}${rowDate ? ` (eff ${rowDate})` : ''}: ${rowReason}`
      : null;
    const newNote = noteLine
      ? (sale.compliance_note ? `${sale.compliance_note}\n${noteLine}` : noteLine)
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
        reason: rowReason || null,
        cancellation_date: rowDate,
        edited_at: now,
      }],
    };
    // cancellation_date semantics: write it when the status is cancel-like
    // OR when the caller explicitly sent one (so admins can backfill).
    if ((isCancelLike || rowDate) && _hasCancellationDate) patch.cancellation_date = rowDate;
    // Cancellation reason key — per-row override wins, else bulk-level.
    const rowReasonKey = String(upd.cancellation_reason_key || '').trim() || bulkReasonKey;
    if (rowReasonKey) patch.cancellation_reason_key = rowReasonKey;
    // Chargeback fields — only meaningful when status === 'chargeback'.
    if (new_status === 'chargeback') {
      const rowCbDate = normalizeDate(upd.chargeback_date) || bulkChargebackDate || rowDate;
      const rowCbAmt  = Number.isFinite(parseFloat(upd.chargeback_amount)) ? parseFloat(upd.chargeback_amount) : bulkChargebackAmt;
      if (rowCbDate) patch.chargeback_date = rowCbDate;
      if (rowCbAmt !== null && rowCbAmt !== undefined) patch.chargeback_amount = rowCbAmt;
    }
    if (['closed_won', 'closed_lost', 'cancelled', 'compliance_cancelled', 'needs_revision', 'chargeback', 'dispute'].includes(new_status)) {
      patch.compliance_reviewed_by = userId;
      patch.compliance_reviewed_at = now;
    }
    let { error: updateErr } = await supabaseAdmin.from('sales').update(patch).eq('id', sale.id);
    if (updateErr && looksLikeMissingCancelCol(updateErr) && 'cancellation_date' in patch) {
      // Race: column was present at SELECT but missing here (or schema cache
      // stale). Strip it and retry once so the rest of the patch still lands.
      _hasCancellationDate = false;
      const { cancellation_date, ...patchWithout } = patch;
      const r2 = await supabaseAdmin.from('sales').update(patchWithout).eq('id', sale.id);
      updateErr = r2.error;
    }
    if (updateErr) { skipped.push({ id: sale.id, reason: updateErr.message }); continue; }
    results.push({ id: sale.id, previous_status: sale.status, new_status, cancellation_date: _hasCancellationDate ? rowDate : null });
    batchPayload.push({
      sale_id:                          sale.id,
      previous_status:                  sale.status,
      previous_compliance_note:         sale.compliance_note ?? null,
      previous_cancellation_date:       sale.cancellation_date ?? null,
      previous_cancellation_reason_key: sale.cancellation_reason_key ?? null,
      previous_chargeback_date:         sale.chargeback_date ?? null,
      previous_chargeback_amount:       sale.chargeback_amount ?? null,
      previous_compliance_locked_at:    sale.compliance_locked_at ?? null,
    });
  }

  // Create the batch row so the operator can list past operations + revert
  // any of them. Fire-and-forget on failure: a missing batch row never
  // blocks the actual status updates (which already landed).
  let batchId = null;
  if (results.length) {
    try {
      const { data: actor } = await supabaseAdmin.auth.admin.getUserById(userId);
      const actorName = actor?.user?.user_metadata?.first_name
        ? `${actor.user.user_metadata.first_name} ${actor.user.user_metadata.last_name || ''}`.trim()
        : (actor?.user?.email || null);
      const { data: batchRow } = await supabaseAdmin.from('compliance_status_batches').insert({
        created_by:              userId,
        created_by_name:         actorName,
        new_status,
        reason:                  bulkReason || null,
        cancellation_reason_key: bulkReasonKey || null,
        cancellation_date:       bulkCancelDate || null,
        chargeback_date:         bulkChargebackDate || null,
        chargeback_amount:       bulkChargebackAmt || null,
        applied_count:           results.length,
        payload:                 batchPayload,
      }).select('id').single();
      batchId = batchRow?.id || null;
    } catch (e) {
      logger.warn('COMPLIANCE_BULK_STATUS_BATCH', `batch insert failed: ${e.message}`);
    }
  }

  // Sale statuses just changed → bust the SPIFF auto-metric cache so live
  // progress (e.g. revenue / approved-sale counters) reflects this immediately
  // when the SpiffWidget refetches on its sales-realtime tick.
  if (results.length) { try { await spiffOnSalesChanged(); } catch { /* non-critical */ } }

  logger.success('COMPLIANCE_BULK_STATUS', `User ${userId} → ${new_status} on ${results.length} sale(s) · batch ${batchId || '(skipped)'}`);
  res.json({ updated: results.length, results, skipped, batch_id: batchId });
  } catch (e) {
    logger.error('COMPLIANCE_BULK_STATUS', 'Handler threw', e);
    // undici wraps the real failure in e.cause — surface it so "fetch failed"
    // doesn't hide an ECONNREFUSED / EAI_AGAIN / URL-too-long.
    const cause = e?.cause;
    return res.status(500).json({
      error:    e?.message || 'Bulk status update failed',
      code:     e?.code     || cause?.code     || null,
      errno:    cause?.errno || null,
      syscall:  cause?.syscall || null,
      hostname: cause?.hostname || null,
      cause:    cause ? (cause.message || String(cause)) : null,
      where:    e?.stack ? String(e.stack).split('\n').slice(0, 3).join(' | ') : null,
    });
  }
}));

// ============================================================================
// Bulk-status batches — list + revert.
//
//   GET    /compliance/bulk-status/batches            list (last 200, newest first)
//   GET    /compliance/bulk-status/batches/:id        one batch w/ payload
//   DELETE /compliance/bulk-status/batches/:id        revert + mark reverted
//
// Revert replays the prior-state snapshots in the payload back onto each
// sale. Only un-reverted batches can be reverted (idempotency). Audit log
// gets a 'bulk_status_reverted' entry on every affected sale.
// ============================================================================
router.get('/bulk-status/batches', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('compliance_status_batches')
    .select('id, created_by, created_by_name, created_at, new_status, reason, cancellation_reason_key, cancellation_date, chargeback_date, chargeback_amount, applied_count, reverted_at, reverted_by')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ batches: data || [] });
}));

router.get('/bulk-status/batches/:id', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('compliance_status_batches')
    .select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Batch not found' });
  res.json({ batch: data });
}));

router.delete('/bulk-status/batches/:id', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const role = req.user.role;
  // Only superadmin + compliance_manager can revert.
  if (role !== 'superadmin' && role !== 'compliance_manager') {
    return res.status(403).json({ error: 'Only compliance_manager or superadmin can revert a batch.' });
  }

  const { data: batch, error: fetchErr } = await supabaseAdmin
    .from('compliance_status_batches').select('*').eq('id', req.params.id).single();
  if (fetchErr || !batch) return res.status(404).json({ error: 'Batch not found' });
  if (batch.reverted_at)  return res.status(409).json({ error: 'Batch already reverted', reverted_at: batch.reverted_at });

  const payload = Array.isArray(batch.payload) ? batch.payload : [];
  const now = new Date().toISOString();
  const restored = [];
  const skipped = [];

  for (const snap of payload) {
    if (!snap?.sale_id) { skipped.push({ id: null, reason: 'No sale_id in snapshot' }); continue; }
    const { data: current } = await supabaseAdmin
      .from('sales').select('id, status, edit_history').eq('id', snap.sale_id).maybeSingle();
    if (!current) { skipped.push({ id: snap.sale_id, reason: 'Sale no longer exists' }); continue; }

    const history = Array.isArray(current.edit_history) ? current.edit_history : [];
    const revertPatch = {
      status:                  snap.previous_status,
      compliance_note:         snap.previous_compliance_note,
      cancellation_date:       snap.previous_cancellation_date,
      cancellation_reason_key: snap.previous_cancellation_reason_key,
      chargeback_date:         snap.previous_chargeback_date,
      chargeback_amount:       snap.previous_chargeback_amount,
      compliance_locked_at:    snap.previous_compliance_locked_at,
      updated_at:              now,
      edit_history: [...history, {
        editor_id: userId, role,
        action: 'bulk_status_reverted',
        batch_id: batch.id,
        previous_status: current.status,
        new_status: snap.previous_status,
        edited_at: now,
      }],
    };
    let { error: updErr } = await supabaseAdmin.from('sales').update(revertPatch).eq('id', snap.sale_id);
    if (updErr && /cancellation_date|chargeback_date|chargeback_amount|cancellation_reason_key|compliance_locked_at/i.test(String(updErr.message || ''))) {
      // Strip newer columns + retry once for deployments where a column is missing.
      const minimal = { status: snap.previous_status, compliance_note: snap.previous_compliance_note, updated_at: now, edit_history: revertPatch.edit_history };
      const r2 = await supabaseAdmin.from('sales').update(minimal).eq('id', snap.sale_id);
      updErr = r2.error;
    }
    if (updErr) { skipped.push({ id: snap.sale_id, reason: updErr.message }); continue; }
    restored.push(snap.sale_id);
  }

  await supabaseAdmin.from('compliance_status_batches')
    .update({ reverted_at: now, reverted_by: userId })
    .eq('id', batch.id);

  if (restored.length) { try { await spiffOnSalesChanged(); } catch { /* non-critical */ } }

  logger.success('COMPLIANCE_BULK_STATUS_REVERT', `User ${userId} reverted batch ${batch.id} — ${restored.length} restored, ${skipped.length} skipped`);
  res.json({ batch_id: batch.id, restored: restored.length, skipped });
}));

module.exports = router;
