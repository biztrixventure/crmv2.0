const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { etDateToUtcStart, etDateToUtcEnd } = require('../utils/etUtils');
const notifications = require('../utils/notificationService');
const { escapeOrValue, safeUuid } = require('../utils/searchSanitize');
const { applySort } = require('../utils/sortHelper');
const { titleCaseFormData } = require('../utils/titleCase');
const { expandStateInFormData } = require('../utils/stateMap');

const router = express.Router();

const MANAGER_ROLES = ['superadmin', 'readonly_admin', 'company_admin', 'manager', 'fronter_manager', 'operations_manager', 'closer_manager'];

// ── Fronter-scoped duplicate detection helpers ───────────────────────────────
const PHONE_KEYS = ['cli_number', 'customer_phone', 'Phone', 'phone', 'Mobile', 'PhoneNumber', 'phone_number', 'CellPhone'];
const normPhone = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const phoneFromFD = (fd) => { if (!fd) return ''; for (const k of PHONE_KEYS) if (fd[k]) return fd[k]; return ''; };
// A "completed" sale (the deal closed) — used to decide insert-vs-update.
const COMPLETED_SALE = ['closed_won', 'sold'];

// Resolve a transfer's closer name + latest disposition for duplicate alerts.
// Falls back to friendly text so the message never shows a blank.
async function priorContext(t) {
  let closerName = 'not yet assigned';
  if (t.assigned_closer_id) {
    const { data: cp } = await supabaseAdmin
      .from('user_profiles').select('first_name, last_name').eq('user_id', t.assigned_closer_id).maybeSingle();
    closerName = `${cp?.first_name || ''} ${cp?.last_name || ''}`.trim() || 'a closer';
  }
  const { data: disp } = await supabaseAdmin
    .from('disposition_actions').select('disposition_name').eq('transfer_id', t.id)
    .order('created_at', { ascending: false }).limit(1);
  return { closerName, disposition: disp?.[0]?.disposition_name || 'no disposition' };
}

// Client sort key -> real column / json path. Name columns sort by underlying id.
const TRANSFER_SORT = {
  customer:   'form_data->>customer_name',
  status:     'status',
  created_at: 'created_at',
  fronter:    'created_by',
  closer:     'assigned_closer_id',
};

// ============================================================================
// GET /transfers
// ============================================================================
router.get('/', asyncHandler(async (req, res) => {
  const userId    = req.user.id;
  const companyId = req.query.company_id || req.user.company_id;
  const userRole  = req.user.role;
  const { status, page = 1, limit = 50, search, date_from, date_to, user_id, sort_by, sort_dir } = req.query;

  let query = applySort(
    supabaseAdmin.from('transfers').select('*', { count: 'exact' }),
    sort_by, sort_dir, TRANSFER_SORT, { col: 'created_at', asc: false },
  );

  // Transfers are stored under the fronter's company_id.
  // Closer-side roles are in a different (closer) company — don't filter by company_id for them.
  if (['superadmin', 'readonly_admin'].includes(userRole) && req.query.company_id) {
    // Admin explicitly passed a company — check type to scope correctly
    const { data: co } = await supabaseAdmin
      .from('companies').select('company_type').eq('id', req.query.company_id).single();
    if (co?.company_type === 'fronter') {
      query = query.eq('company_id', req.query.company_id);
    } else {
      // Closer company: transfers don't carry company_id for closer side — filter by assigned_closer_id
      const { data: coUsers } = await supabaseAdmin
        .from('user_company_roles').select('user_id')
        .eq('company_id', req.query.company_id).eq('is_active', true);
      const assignedIds = (coUsers || []).map(u => u.user_id);
      if (assignedIds.length === 0) {
        return res.json({ transfers: [], total: 0, page: parseInt(page), limit: parseInt(limit) });
      }
      query = query.in('assigned_closer_id', assignedIds);
    }
  } else {
    const isCloserSide = userRole === 'closer' || userRole === 'closer_manager' || userRole === 'compliance_manager';
    if (!isCloserSide && companyId) query = query.eq('company_id', companyId);

    switch (userRole) {
      case 'fronter':
        query = query.eq('created_by', userId);
        break;
      case 'closer':
        query = query.eq('assigned_closer_id', userId);
        break;
      case 'closer_manager':
      case 'compliance_manager': {
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
      // fronter_manager, operations_manager, company_admin — see all transfers for company
    }
  }

  // Agent filter: managers can scope to a specific fronter or closer
  const safeUserId = safeUuid(user_id);
  if (safeUserId && MANAGER_ROLES.includes(userRole)) {
    query = query.or(`created_by.eq.${safeUserId},assigned_closer_id.eq.${safeUserId}`);
  }

  if (status)    query = query.eq('status', status);
  if (date_from) query = query.gte('created_at', etDateToUtcStart(date_from));
  if (date_to)   query = query.lte('created_at', etDateToUtcEnd(date_to));

  if (search) {
    const s = escapeOrValue(search);
    // PostgREST JSONB text-extraction notation: ->>key (no SQL quotes around key)
    query = query.or(
      `form_data->>customer_name.ilike.%${s}%,` +
      `form_data->>customer_phone.ilike.%${s}%,` +
      `form_data->>Phone.ilike.%${s}%,` +
      `form_data->>FirstName.ilike.%${s}%`
    );
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  query = query.range(offset, offset + parseInt(limit) - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Enrich with fronter + closer names via single profile query
  const creatorIds = [...new Set((data || []).map(t => t.created_by).filter(Boolean))];
  const closerIds  = [...new Set((data || []).map(t => t.assigned_closer_id).filter(Boolean))];
  const allProfileIds = [...new Set([...creatorIds, ...closerIds])];
  let profileMap = {};
  if (allProfileIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, first_name, last_name')
      .in('user_id', allProfileIds);
    (profiles || []).forEach(p => { profileMap[p.user_id] = p; });
  }

  // Fetch company names + slugs
  const companyIds = [...new Set((data || []).map(t => t.company_id).filter(Boolean))];
  let companyMap = {};
  if (companyIds.length > 0) {
    const { data: companies } = await supabaseAdmin
      .from('companies').select('id, name, slug').in('id', companyIds);
    (companies || []).forEach(c => { companyMap[c.id] = c; });
  }

  // Enrich completed transfers with linked sale data (status, compliance note, reference)
  const transferIds = (data || []).map(t => t.id).filter(Boolean);
  let saleMap = {};
  let latestDispoMap = {};
  if (transferIds.length > 0) {
    const [salesRes, dispoRes] = await Promise.all([
      supabaseAdmin.from('sales')
        .select('id, transfer_id, status, compliance_note, reference_no, closer_id, created_at, closer_disposition')
        .in('transfer_id', transferIds),
      supabaseAdmin.from('disposition_actions')
        .select('transfer_id, disposition_name, color, note, created_at, user_id')
        .in('transfer_id', transferIds)
        .order('created_at', { ascending: false }),
    ]);
    (salesRes.data || []).forEach(s => { saleMap[s.transfer_id] = s; });
    (dispoRes.data || []).forEach(d => {
      if (!latestDispoMap[d.transfer_id]) latestDispoMap[d.transfer_id] = d;
    });

    // Resolve setter names for dispositions
    const dispoSetterIds = [...new Set(Object.values(latestDispoMap).map(d => d.user_id).filter(Boolean))];
    if (dispoSetterIds.length > 0) {
      const { data: setterProfiles } = await supabaseAdmin
        .from('user_profiles').select('user_id, first_name, last_name').in('user_id', dispoSetterIds);
      const setterMap = Object.fromEntries((setterProfiles || []).map(p => [p.user_id, p]));
      Object.values(latestDispoMap).forEach(d => {
        const p = setterMap[d.user_id];
        d.setter_name = p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() || null : null;
      });
    }
  }

  const transfers = (data || []).map(t => {
    const profile = profileMap[t.created_by];
    const closerProfile = profileMap[t.assigned_closer_id];
    const co = companyMap[t.company_id] || {};
    const fronter_name = profile
      ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || null
      : null;
    const sale = saleMap[t.id] || null;
    return {
      ...t,
      user_profiles: profile || null,
      fronter_name: fronter_name || 'Unknown',
      company_name: co.name || null,
      company_slug: co.slug || co.name || null,
      closer: closerProfile ? { first_name: closerProfile.first_name, last_name: closerProfile.last_name } : null,
      sale_id: sale?.id || null,
      sale_status: sale?.status || null,
      sale_compliance_note: sale?.compliance_note || null,
      sale_reference_no: sale?.reference_no || null,
      sale_closer_disposition: sale?.closer_disposition || null,
      latest_disposition: latestDispoMap[t.id] || null,
    };
  });

  res.json({ transfers, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
}));

// ============================================================================
// GET /transfers/closers — list available closers for a fronter company
// Returns closers from ALL active closer companies (no company_links required).
// ============================================================================
router.get('/closers', asyncHandler(async (req, res) => {
  const companyId = req.query.company_id || req.user.company_id;

  logger.info('[closers] companyId=%s userCompanyId=%s queryCompanyId=%s role=%s userId=%s',
    companyId, req.user.company_id, req.query.company_id, req.user.role, req.user.id);

  // Step 1: get ALL active closer companies (no company_links dependency)
  const { data: closerCompanies, error: coErr } = await supabaseAdmin
    .from('companies')
    .select('id, name')
    .eq('company_type', 'closer')
    .eq('is_active', true);

  logger.info('[closers] closer companies found=%d err=%s', closerCompanies?.length ?? 0, coErr?.message ?? 'none');

  if (coErr) return res.status(500).json({ error: coErr.message });
  if (!closerCompanies || closerCompanies.length === 0) return res.json({ closers: [] });

  const closerCompanyIds = closerCompanies.map(c => c.id);
  logger.info('[closers] closerCompanyIds=%j', closerCompanyIds);

  const companyNameMap = Object.fromEntries(closerCompanies.map(c => [c.id, c.name]));

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

  // Only roles with level exactly 'closer' — exclude closer_manager from the dropdown
  const closers = (data || [])
    .filter(r => r.custom_roles?.level === 'closer')
    .map(r => ({
      id:           r.user_id,
      first_name:   profileMap[r.user_id]?.first_name || '',
      last_name:    profileMap[r.user_id]?.last_name  || '',
      role_name:    r.custom_roles?.name              || 'Closer',
      company_name: companyNameMap[r.company_id]      || '',
    }));

  logger.info('[closers] final closers count=%d', closers.length);
  res.json({ closers });
}));

// ============================================================================
// GET /transfers/search-by-phone
// Closer searches for all transfers matching a phone number across all fronter
// companies linked to their closer company. Returns records with company slug
// and fronter name, ordered most-recent first.
// ============================================================================
router.get('/search-by-phone', asyncHandler(async (req, res) => {
  const { phone } = req.query;
  if (!phone || phone.trim().length < 3) {
    return res.status(400).json({ error: 'phone required (min 3 chars)' });
  }

  const userRole  = req.user.role;
  const companyId = req.user.company_id;
  const q         = escapeOrValue(phone.trim());

  // Resolve which fronter companies this closer can see
  let fronterCompanyIds = [];

  if (userRole === 'superadmin' || userRole === 'readonly_admin') {
    // Superadmin sees across all companies
    const { data: allFronters } = await supabaseAdmin
      .from('companies')
      .select('id')
      .eq('company_type', 'fronter')
      .eq('is_active', true);
    fronterCompanyIds = (allFronters || []).map(c => c.id);
  } else {
    // No company_links required — search across all active fronter companies
    const { data: allFronters } = await supabaseAdmin
      .from('companies')
      .select('id')
      .eq('company_type', 'fronter')
      .eq('is_active', true);
    fronterCompanyIds = (allFronters || []).map(c => c.id);
  }

  if (!fronterCompanyIds.length) return res.json({ transfers: [] });

  // PostgREST JSONB text-extraction: ->>key (no SQL quotes). Covers both naming conventions.
  const { data, error } = await supabaseAdmin
    .from('transfers')
    .select('*')
    .in('company_id', fronterCompanyIds)
    .or(`form_data->>customer_phone.ilike.%${q}%,form_data->>Phone.ilike.%${q}%`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  if (!data?.length) return res.json({ transfers: [] });

  // Fetch company names + slugs in one query
  const companyIds = [...new Set(data.map(t => t.company_id).filter(Boolean))];
  const { data: companies } = await supabaseAdmin
    .from('companies')
    .select('id, name, slug')
    .in('id', companyIds);
  const companyMap = Object.fromEntries((companies || []).map(c => [c.id, c]));

  // Fetch fronter profiles in one query
  const creatorIds = [...new Set(data.map(t => t.created_by).filter(Boolean))];
  let profileMap = {};
  if (creatorIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, first_name, last_name')
      .in('user_id', creatorIds);
    (profiles || []).forEach(p => { profileMap[p.user_id] = p; });
  }

  // Fetch existing sales linked directly to these transfers (by transfer_id only).
  // No cross-company phone lookup — each company's transfer is independent even if
  // the same customer has a different product with a different company.
  const tIds = data.map(t => t.id);
  let saleByTransferId = {};
  let latestDispoMapPhone = {};

  if (tIds.length > 0) {
    const [salesRes, dispoRes] = await Promise.all([
      supabaseAdmin.from('sales')
        .select('id, transfer_id, status, compliance_note, reference_no, customer_phone, closer_id, created_at, closer_disposition')
        .in('transfer_id', tIds),
      supabaseAdmin.from('disposition_actions')
        .select('transfer_id, disposition_name, color, note, created_at, user_id')
        .in('transfer_id', tIds)
        .order('created_at', { ascending: false }),
    ]);
    (salesRes.data || []).forEach(s => { saleByTransferId[s.transfer_id] = s; });
    (dispoRes.data || []).forEach(d => {
      if (!latestDispoMapPhone[d.transfer_id]) latestDispoMapPhone[d.transfer_id] = d;
    });

    // Resolve setter names for dispositions + closer names for sales in one batch
    const linkedSales = salesRes.data || [];
    const saleCloserIds = [...new Set(linkedSales.map(s => s.closer_id).filter(Boolean))];
    const dispoSetterIds = [...new Set(Object.values(latestDispoMapPhone).map(d => d.user_id).filter(Boolean))];
    const allNameIds = [...new Set([...saleCloserIds, ...dispoSetterIds])];
    if (allNameIds.length > 0) {
      const { data: nameProfiles } = await supabaseAdmin
        .from('user_profiles').select('user_id, first_name, last_name').in('user_id', allNameIds);
      const nameMap = Object.fromEntries((nameProfiles || []).map(p => [p.user_id, p]));
      Object.values(saleByTransferId).forEach(s => {
        const cp = nameMap[s.closer_id];
        s.closer_name = cp ? `${cp.first_name || ''} ${cp.last_name || ''}`.trim() || null : null;
      });
      Object.values(latestDispoMapPhone).forEach(d => {
        const p = nameMap[d.user_id];
        d.setter_name = p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() || null : null;
      });
    }
  }

  const transfers = data.map(t => {
    const co      = companyMap[t.company_id] || {};
    const profile = profileMap[t.created_by] || {};
    const sale    = saleByTransferId[t.id] || null;
    return {
      ...t,
      company_name: co.name || 'Unknown',
      company_slug: co.slug || co.name || 'Unknown',
      fronter_name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Unknown',
      has_sale: !!sale,
      sale_id: sale?.id || null,
      sale_status: sale?.status || null,
      sale_compliance_note: sale?.compliance_note || null,
      sale_reference_no: sale?.reference_no || null,
      sale_closer_name: sale?.closer_name || null,
      sale_closer_disposition: sale?.closer_disposition || null,
      latest_disposition: latestDispoMapPhone[t.id] || null,
    };
  });

  res.json({ transfers });
}));

// ============================================================================
// GET /transfers/duplicate-check?phone= — STRICTLY this fronter's own history
// Returns: { result: 'transfer' | 'sale' | 'clean', message?, transfer?, sale? }
//   transfer → this fronter already has a transfer for this number (load+update)
//   sale     → this fronter has a COMPLETED sale on this number (warn, new row)
// Scoped to company_id + created_by(=this fronter) + normalized_phone. Never
// references other fronters or companies.
// ============================================================================
router.get('/duplicate-check', asyncHandler(async (req, res) => {
  const userId    = req.user.id;
  const companyId = req.user.company_id;
  const norm      = normPhone(req.query.phone);
  if (!companyId || norm.length < 7) return res.json({ result: 'clean' });

  // Most recent matching transfer decides the case (Case A vs B). created_at is
  // selected in the same indexed lookup — no extra round trip for the date.
  const { data: tfs } = await supabaseAdmin
    .from('transfers')
    .select('id, form_data, status, created_at, assigned_closer_id')
    .eq('company_id', companyId)
    .eq('created_by', userId)
    .eq('normalized_phone', norm)
    .order('created_at', { ascending: false });

  if (!tfs?.length) return res.json({ result: 'clean' });

  // Completed sale tied to one of THIS fronter's transfers for this number?
  const { data: sale } = await supabaseAdmin
    .from('sales')
    .select('id, status, reference_no, created_at')
    .in('transfer_id', tfs.map(t => t.id))
    .in('status', COMPLETED_SALE)
    .order('created_at', { ascending: false })
    .limit(1);

  // Sale rule wins (regardless of Case A/B) → warn, a NEW transfer is created.
  if (sale?.length) {
    return res.json({
      result: 'sale',
      sale: { status: sale[0].status, reference_no: sale[0].reference_no, date: sale[0].created_at },
      message: 'You already have a completed sale on this number. Creating another transfer may cause duplicate effort. You can still proceed, and a new transfer will be created.',
    });
  }

  // Resolve prior closer + disposition for the alert (only on a match).
  const t = tfs[0];
  const { closerName, disposition } = await priorContext(t);
  const dateStr = new Date(t.created_at).toLocaleDateString();
  // 30-day window, server time (UTC instants): <= 30 days = Case A (refresh).
  const withinWindow = (Date.now() - new Date(t.created_at).getTime()) / 86400000 <= 30;

  const base = { id: t.id, form_data: t.form_data, status: t.status, date: t.created_at, closer_name: closerName, disposition };
  if (withinWindow) {
    return res.json({
      result: 'refresh',
      transfer: base,
      message: `You already transferred this number on ${dateStr} to closer ${closerName} with disposition ${disposition}. The previous information has been loaded — please review and update. This will refresh the existing transfer.`,
    });
  }
  return res.json({
    result: 'reengage',
    transfer: base,
    message: `This number was previously transferred on ${dateStr} (more than 30 days ago) to closer ${closerName} with disposition ${disposition}. Since it's been over 30 days, a new transfer will be created. Previous details are loaded for your reference — edit as needed.`,
  });
}));

// ============================================================================
// POST /transfers — fronter creates + directly assigns to a closer
// ============================================================================
router.post('/', [
  body('form_data').isObject().withMessage('form_data required'),
  body('assigned_closer_id').optional({ nullable: true }).isUUID().withMessage('assigned_closer_id must be a UUID'),
  body('company_id').isUUID().optional(),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

  const userId    = req.user.id;
  const companyId = req.user.company_id;
  const { assigned_closer_id } = req.body;
  const form_data = titleCaseFormData(expandStateInFormData(req.body.form_data));

  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const hasCloser = !!assigned_closer_id;
  const norm = normPhone(phoneFromFD(form_data));

  const newRow = {
    company_id:         companyId,
    created_by:         userId,
    last_modified_by:   userId,
    form_data,
    normalized_phone:   norm || null,
    assigned_closer_id: hasCloser ? assigned_closer_id : null,
    assigned_to:        hasCloser ? assigned_closer_id : null,
    status:             hasCloser ? 'assigned' : 'pending',
  };

  // Authoritative duplicate resolution (final check at write time — prevents a
  // race between the debounced input check and submit). STRICTLY this fronter's
  // own records (company_id + created_by + normalized_phone).
  let transfer, action = 'created', managerEvent = null, priorId = null;
  if (norm) {
    const { data: tfs } = await supabaseAdmin
      .from('transfers').select('id, created_at')
      .eq('company_id', companyId).eq('created_by', userId).eq('normalized_phone', norm)
      .order('created_at', { ascending: false });

    if (tfs?.length) {
      priorId = tfs[0].id;
      const { data: completed } = await supabaseAdmin
        .from('sales').select('id').in('transfer_id', tfs.map(t => t.id)).in('status', COMPLETED_SALE).limit(1);

      if (completed?.length) {
        // Sale rule wins (any case) → INSERT a new transfer; never touch the sale-linked one.
        const r = await supabaseAdmin.from('transfers').insert(newRow).select().single();
        if (r.error) return res.status(500).json({ error: r.error.message });
        transfer = r.data; action = 'created_sale_warning'; managerEvent = 'sale_overlap';
      } else {
        // 30-day window, server time (UTC instants): <= 30 days = Case A.
        const withinWindow = (Date.now() - new Date(tfs[0].created_at).getTime()) / 86400000 <= 30;
        if (withinWindow) {
          // Case A: UPDATE the most recent transfer in place — no new row, no count.
          const updates = { form_data, normalized_phone: norm, updated_at: new Date().toISOString(), last_modified_by: userId };
          if (hasCloser) {
            updates.assigned_closer_id = assigned_closer_id;
            updates.assigned_to        = assigned_closer_id;
            updates.status             = 'assigned';
            updates.rejected_by = null; updates.rejection_reason = null; updates.rejected_at = null;
          }
          const r = await supabaseAdmin.from('transfers').update(updates).eq('id', tfs[0].id).select().single();
          if (r.error) return res.status(500).json({ error: r.error.message });
          transfer = r.data; action = 'updated'; managerEvent = 'refresh';
        } else {
          // Case B (>30 days): brand-new transfer (counts); prior record untouched.
          const r = await supabaseAdmin.from('transfers').insert(newRow).select().single();
          if (r.error) return res.status(500).json({ error: r.error.message });
          transfer = r.data; action = 'created_reengaged'; managerEvent = 'reengage';
        }
      }
    }
  }

  if (!transfer) {
    const r = await supabaseAdmin.from('transfers').insert(newRow).select().single();
    if (r.error) return res.status(500).json({ error: r.error.message });
    transfer = r.data;
  }

  if (hasCloser) {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const fronterName = authUser?.user?.user_metadata?.first_name || authUser?.user?.email || 'A fronter';
    notifications.onTransferCreated({ transfer, fronterName, closerUserId: assigned_closer_id }).catch(() => {});
  }

  // Manager-dashboard alert (async, non-blocking) for duplicate-handling events.
  if (managerEvent) {
    notifications.onFronterDuplicateEvent({ kind: managerEvent, companyId, fronterId: userId, phone: norm, priorTransferId: priorId }).catch(() => {});
  }

  res.status(201).json({ transfer, action });
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
  const userId   = req.user.id;
  const userRole = req.user.role;
  const { reason } = req.body;

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('transfers')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !existing) return res.status(404).json({ error: 'Transfer not found' });

  // Only the assigned closer (or a superadmin acting on their behalf) can reject.
  if (existing.assigned_closer_id !== userId && userRole !== 'superadmin') {
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
      last_modified_by:  userId,
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

  // Company scope guard for non-superadmin managers
  if (isManager && userRole !== 'superadmin') {
    const userCompanyId = req.user.company_id;
    const isCloserSide = ['closer_manager', 'compliance_manager'].includes(userRole);
    if (isCloserSide) {
      // Closer-side managers: verify assigned_closer_id belongs to their company
      if (existing.assigned_closer_id) {
        const { data: ucr } = await supabaseAdmin
          .from('user_company_roles')
          .select('user_id')
          .eq('company_id', userCompanyId)
          .eq('user_id', existing.assigned_closer_id)
          .eq('is_active', true)
          .maybeSingle();
        if (!ucr) return res.status(403).json({ error: 'Transfer not within your company scope' });
      }
    } else if (existing.company_id !== userCompanyId) {
      return res.status(403).json({ error: 'Transfer not within your company scope' });
    }
  }

  // If manager is editing form_data, reason is required
  if (form_data && isManager && !reason) {
    return res.status(400).json({ error: 'A reason is required when editing transfer data' });
  }

  const updates = { updated_at: new Date().toISOString(), last_modified_by: userId };
  if (status) updates.status = status;

  // Reassign to a different closer
  if (assigned_closer_id) {
    const { data: closerRoleRow } = await supabaseAdmin
      .from('user_company_roles')
      .select('custom_roles(level)')
      .eq('user_id', assigned_closer_id)
      .eq('is_active', true)
      .maybeSingle();
    if (!closerRoleRow || closerRoleRow.custom_roles?.level !== 'closer') {
      return res.status(400).json({ error: 'Assigned user must have the closer role' });
    }
    updates.assigned_closer_id = assigned_closer_id;
    updates.assigned_to        = assigned_closer_id;
    if (!status) updates.status = 'assigned';
    // Reset rejection state on reassignment
    updates.rejected_by       = null;
    updates.rejection_reason  = null;
    updates.rejected_at       = null;
  }

  // Edit form_data — append to audit trail + keep the dedup key in sync
  if (form_data) {
    const normalized = titleCaseFormData(expandStateInFormData(form_data));
    updates.form_data = normalized;
    updates.normalized_phone = normPhone(phoneFromFD(normalized)) || null;
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

  // Company scope guard for non-superadmin managers (mirrors PUT handler).
  // Prevents a manager in one company from deleting another company's transfer by id.
  if (isManager && !isCreator && userRole !== 'superadmin') {
    const userCompanyId = req.user.company_id;
    const isCloserSide = ['closer_manager', 'compliance_manager'].includes(userRole);
    if (isCloserSide) {
      if (existing.assigned_closer_id) {
        const { data: ucr } = await supabaseAdmin
          .from('user_company_roles')
          .select('user_id')
          .eq('company_id', userCompanyId)
          .eq('user_id', existing.assigned_closer_id)
          .eq('is_active', true)
          .maybeSingle();
        if (!ucr) return res.status(403).json({ error: 'Transfer not within your company scope' });
      } else {
        return res.status(403).json({ error: 'Transfer not within your company scope' });
      }
    } else if (existing.company_id !== userCompanyId) {
      return res.status(403).json({ error: 'Transfer not within your company scope' });
    }
  }

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
