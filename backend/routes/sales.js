const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { etDateToUtcStart, etDateToUtcEnd } = require('../utils/etUtils');
const notifications = require('../utils/notificationService');
const { hasPermission, isSuperAdmin } = require('../models/helpers');
const { requireFeature } = require('../utils/featureGate');
const { escapeOrValue, safeUuid } = require('../utils/searchSanitize');
const { applySort } = require('../utils/sortHelper');
const { titleCase, titleCaseFormData } = require('../utils/titleCase');
const { expandStateInFormData } = require('../utils/stateMap');
const { stampActor } = require('../utils/auditColumnGuard');
const { getConfig } = require('../utils/businessConfig');

const router = express.Router();

// ============================================================================
// Resell privacy resolver — returns true when the caller should NOT see
// is_resell=true sale rows. Looked up per request because the company config
// can flip on/off independently of the user's role/company.
// ============================================================================
async function shouldHideResellsForUser(userRole, companyId, companyType) {
  if (userRole === 'superadmin' || userRole === 'readonly_admin') return false;
  if (userRole === 'closer' || userRole === 'closer_manager') return false;
  if (userRole === 'compliance_manager') {
    return !!(await getConfig(companyId, 'resell.hide_from_compliance', false));
  }
  if (userRole === 'fronter_manager') {
    return !!(await getConfig(companyId, 'resell.hide_from_fronter_manager', true));
  }
  if (userRole === 'fronter' || companyType === 'fronter') {
    return !!(await getConfig(companyId, 'resell.hide_from_fronter', true));
  }
  return false;
}

// Client sort key -> real column. Name columns sort by underlying user id.
const SALE_SORT = {
  customer:        'customer_name',
  status:          'status',
  created_at:      'created_at',
  sale_date:       'sale_date',
  reference:       'reference_no',
  monthly_payment: 'monthly_payment',
  fronter:         'fronter_id',
  closer:          'closer_id',
  plan:            'plan',
};

// Generate a reference number like "MBH4220SBN"
function generateReferenceNo() {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const num   = '0123456789';
  const r = (s, n) => Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('');
  return r(alpha, 3) + r(num, 4) + r(alpha, 3);
}

// ============================================================================
// GET /sales/search?q=...&company_id=... — Fast full-text sale search
// Requires search_sales permission OR superadmin.
// Uses pg_trgm GIN indexes for sub-10ms partial match on name/phone/ref/vin.
// ============================================================================
router.get('/search', requireFeature('search_sales'), asyncHandler(async (req, res) => {
  const userId    = req.user.id;
  const companyId = req.query.company_id || req.user.company_id;
  const q         = (req.query.q || '').trim();

  if (!q || q.length < 2) return res.json({ sales: [], total: 0 });

  // Permission gate
  const superadmin  = await isSuperAdmin(userId);
  const canSearch   = superadmin || await hasPermission(userId, companyId, 'search_sales');
  if (!canSearch) {
    return res.status(403).json({ error: 'You do not have permission to search sale records' });
  }

  // Build OR filter across all searchable columns using ilike (leverages trgm GIN indexes)
  const s = escapeOrValue(q);
  const filter = [
    `customer_name.ilike.%${s}%`,
    `customer_phone.ilike.%${s}%`,
    `customer_phone_2.ilike.%${s}%`,
    `customer_email.ilike.%${s}%`,
    `reference_no.ilike.%${s}%`,
    `car_vin.ilike.%${s}%`,
    `client_name.ilike.%${s}%`,
  ].join(',');

  let searchQuery = supabaseAdmin
    .from('sales')
    .select('id,customer_name,customer_phone,customer_email,reference_no,car_year,car_make,car_model,car_vin,status,monthly_payment,sale_date,closer_id,fronter_id,plan,client_name,created_at,closer_disposition,charge_at', { count: 'exact' });
  if (companyId) searchQuery = searchQuery.eq('company_id', companyId);
  const { data, error, count } = await searchQuery
    .or(filter)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) return res.status(500).json({ error: error.message });

  logger.info('SEARCH_SALES', `q="${q}", hits=${count}, user=${userId}`);
  res.json({ sales: data || [], total: count || 0 });
}));

// ============================================================================
// GET /sales - List sales (role-based filtering)
// ============================================================================
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const companyId = req.query.company_id || req.user.company_id;
    const userRole = req.user.role;
    const { status, disposition, charge_from, charge_to, search, page = 1, limit = 50, date_from, date_to, user_id, sort_by, sort_dir } = req.query;

    logger.info('GET_SALES', `user=${userId}, role=${userRole}, company=${companyId}`);

    // NOTE: the nested transfer's form_data is intentionally NOT selected — it's
    // a large JSONB the list view never reads (the drawer uses the sale's own
    // form_data), so shipping it per row was pure egress waste. Keep the cheap
    // id/status/created_by in case a caller needs the linkage.
    let query = applySort(
      supabaseAdmin.from('sales').select(`*, transfers(id, status, created_by)`, { count: 'exact' }),
      sort_by, sort_dir, SALE_SORT, { col: 'created_at', asc: false },
    );

    if (['superadmin', 'readonly_admin'].includes(userRole)) {
      // Apply company filter only when admin explicitly passes company_id param
      if (req.query.company_id) {
        const { data: co } = await supabaseAdmin
          .from('companies').select('company_type').eq('id', req.query.company_id).single();
        if (co?.company_type === 'fronter') {
          query = query.eq('company_id', req.query.company_id);
        } else {
          const { data: coUsers } = await supabaseAdmin
            .from('user_company_roles').select('user_id')
            .eq('company_id', req.query.company_id).eq('is_active', true);
          const closerUserIds = (coUsers || []).map(u => u.user_id);
          if (closerUserIds.length > 0) {
            query = query.in('closer_id', closerUserIds);
          } else {
            return res.json({ sales: [], total: 0, page: parseInt(page), limit: parseInt(limit) });
          }
        }
      }
      // else: no filter — global view
    } else if (userRole === 'closer') {
      // Closer: their own sales only, regardless of which company_id the sale has
      query = query.eq('closer_id', userId);
    } else if (companyId) {
      // Detect company type to determine scoping strategy
      const { data: co } = await supabaseAdmin
        .from('companies').select('company_type').eq('id', companyId).single();

      if (co?.company_type === 'fronter') {
        // Fronter-side: sales whose company_id matches the fronter company
        // (sales created from this company's transfers inherit its company_id)
        query = query.eq('company_id', companyId);
        // Resell privacy — hide is_resell=true rows from fronter views per
        // business_config (resell.hide_from_fronter / _manager). Fronters get
        // credit only for the ORIGINAL sale on a lead; subsequent resells
        // belong to the closer's company.
        if (await shouldHideResellsForUser(userRole, companyId, 'fronter')) {
          query = query.eq('is_resell', false);
        }
      } else {
        // Closer-side (closer_manager, ops_manager, company_admin, compliance_manager):
        // scope by closer_id across all users in this company
        const { data: coUsers } = await supabaseAdmin
          .from('user_company_roles').select('user_id')
          .eq('company_id', companyId).eq('is_active', true);
        const closerUserIds = (coUsers || []).map(u => u.user_id);
        if (closerUserIds.length > 0) {
          query = query.in('closer_id', closerUserIds);
        } else {
          return res.json({ sales: [], total: 0, page: parseInt(page), limit: parseInt(limit) });
        }
      }
    }

    // Agent filter: managers can scope to a specific closer
    const isManagerRole = !['closer', 'fronter'].includes(userRole);
    const safeCloserId = safeUuid(user_id);
    if (safeCloserId && isManagerRole) query = query.eq('closer_id', safeCloserId);

    if (status)    query = query.eq('status', status);
    // Disposition tab filter (closer_disposition) — drives the dynamic per-
    // disposition tabs (e.g. "Post Date"). Generic: the frontend resolves which
    // value is the post-date one from the live form-field options and passes it.
    if (disposition) query = query.eq('closer_disposition', disposition);
    // Charge-date window (post-dated sales) — closer + compliance Post Date tabs.
    if (charge_from) query = query.gte('charge_at', charge_from);
    if (charge_to)   query = query.lte('charge_at', charge_to);
    // Date filter keys on sale_date (the business day the sale happened) so the
    // "Today" preset and any custom range match what the UI Date column shows.
    // Bulk-uploaded April sales no longer count as "Today" just because they
    // were inserted today. sale_date is a DATE column → string compare works.
    if (date_from) query = query.gte('sale_date', date_from);
    if (date_to)   query = query.lte('sale_date', date_to);
    if (search) {
      const s = escapeOrValue(search);
      query = query.or(
        `customer_name.ilike.%${s}%,` +
        `customer_phone.ilike.%${s}%,` +
        `reference_no.ilike.%${s}%,` +
        `client_name.ilike.%${s}%`
      );
    }

    const offset = (page - 1) * limit;
    query = query.range(offset, offset + parseInt(limit) - 1);

    const { data, error, count } = await query;

    if (error) {
      logger.error('GET_SALES', 'Query failed', error);
      return res.status(500).json({ error: error.message });
    }

    // Enrich with closer names
    const closerIds = [...new Set((data || []).map(s => s.closer_id).filter(Boolean))];
    let closerProfileMap = {};
    if (closerIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('user_profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', closerIds);
      (profiles || []).forEach(p => { closerProfileMap[p.user_id] = p; });
    }

    const enriched = (data || []).map(s => {
      const profile = closerProfileMap[s.closer_id];
      const closer_name = profile
        ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || null
        : null;
      return { ...s, closer_name: closer_name || 'Unknown' };
    });

    res.json({
      sales: enriched,
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  })
);

// ============================================================================
// POST /sales - Create sale (closer fills full sale details)
// ============================================================================
router.post(
  '/',
  [
    body('company_id').isUUID().optional(),
    body('transfer_id').isUUID().optional(),
    // Customer info
    body('customer_name').trim().notEmpty().withMessage('Customer name is required'),
    body('customer_phone').trim().notEmpty().withMessage('Phone number is required'),
    body('customer_phone_2').trim().optional(),
    body('customer_email').trim().optional({ nullable: true, checkFalsy: true }),
    body('customer_address').trim().optional(),
    // Vehicle info
    body('car_year').isInt({ min: 1900, max: 2100 }).optional({ nullable: true, checkFalsy: true }),
    body('car_make').trim().optional(),
    body('car_model').trim().optional(),
    body('car_miles').isInt({ min: 0 }).optional({ nullable: true, checkFalsy: true }),
    body('car_vin').trim().optional(),
    // Deal info
    body('plan').trim().optional(),
    body('down_payment').isFloat({ min: 0 }).optional({ nullable: true, checkFalsy: true }),
    body('monthly_payment').isFloat({ min: 0 }).optional({ nullable: true, checkFalsy: true }),
    body('payment_due_note').trim().optional(),
    body('reference_no').trim().optional(),
    body('client_name').trim().optional(),
    body('fronter_id').isUUID().optional({ nullable: true, checkFalsy: true }),
    body('sale_date').isISO8601().optional({ nullable: true, checkFalsy: true }),
    body('status').isIn(['open', 'sold', 'cancelled', 'follow_up', 'closed_won', 'closed_lost']).optional(),
    body('form_data').isObject().optional(),
    body('closer_disposition').trim().optional(),
    // Multi-car: extra vehicles for the same customer/transfer. Each becomes its
    // own sale row sharing the customer columns but with its own car + deal fields.
    body('additional_cars').isArray().optional(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    // company_id comes from the TRANSFER (fronter company) if linked,
    // otherwise from the closer's own company (for direct sales)
    let companyId = req.body.company_id || req.user.company_id;

    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    logger.info('CREATE_SALE', `user=${userId}, company=${companyId}`);

    const {
      transfer_id,
      customer_name, customer_phone, customer_phone_2, customer_email, customer_address,
      car_year, car_make, car_model, car_miles, car_vin,
      plan, down_payment, monthly_payment, payment_due_note,
      reference_no, client_name, fronter_id,
      sale_date, status, form_data, closer_disposition, charge_at,
      additional_cars,
    } = req.body;

    // If linked to a transfer, validate it. Multiple sales may now share one
    // transfer (one per vehicle), so the previous one-sale-per-transfer guard
    // is gone.
    if (transfer_id) {
      const { data: transfer, error: tErr } = await supabaseAdmin
        .from('transfers').select('*').eq('id', transfer_id).single();
      if (tErr || !transfer) return res.status(404).json({ error: 'Transfer not found' });

      // Sale inherits the FRONTER company's company_id so it appears in their records
      if (transfer.company_id) companyId = transfer.company_id;

      // Auto-complete the transfer; if unassigned, claim it for the closer
      const transferUpdates = await stampActor('transfers', { status: 'completed', updated_at: new Date().toISOString() }, userId);
      if (!transfer.assigned_closer_id) {
        transferUpdates.assigned_closer_id = userId;
        transferUpdates.assigned_to        = userId;
      }
      await supabaseAdmin.from('transfers').update(transferUpdates).eq('id', transfer_id);
    }

    const saleDate = sale_date || new Date().toISOString().split('T')[0];

    // G16 manual parity — reference_no collision check on create. If the
    // closer typed (or pasted) a ref that's already in use anywhere in
    // the system, reject up-front with a precise message rather than
    // bouncing off the mig 077 unique index with a generic 23505.
    const refsToCheck = [reference_no, ...(Array.isArray(additional_cars) ? additional_cars.map(c => c.reference_no) : [])]
      .map(r => String(r || '').trim()).filter(Boolean);
    if (refsToCheck.length) {
      const { data: collisions } = await supabaseAdmin
        .from('sales').select('id, reference_no, customer_name, sale_date')
        .in('reference_no', refsToCheck);
      if (collisions?.length) {
        return res.status(409).json({
          error: `Reference No "${collisions[0].reference_no}" already exists on sale ${collisions[0].id.slice(0,8)} (${collisions[0].customer_name || '—'} · ${collisions[0].sale_date || '—'}). Pick a different one.`,
          collisions: collisions.map(c => ({ id: c.id, reference_no: c.reference_no, customer_name: c.customer_name, sale_date: c.sale_date })),
          code: 'REF_COLLISION',
        });
      }
    }

    // Scenario 6 manual parity — dup-fingerprint detection. A closer
    // re-keying the same deal on the same transfer (same VIN OR same
    // car_year+make+model, same client_name, same sale_date) almost
    // always means a double-submit. Block instead of inserting a near-
    // identical row that audit will have to clean up later.
    if (transfer_id && customer_phone) {
      const carVin   = car_vin ? String(car_vin).toUpperCase() : null;
      const ymmKey   = (car_year && car_make && car_model)
        ? `${car_year}|${String(car_make).toLowerCase()}|${String(car_model).toLowerCase()}` : null;
      const clientNorm = String(client_name || '').trim().toLowerCase();
      if ((carVin || ymmKey) && clientNorm && saleDate) {
        const { data: priorOnTransfer } = await supabaseAdmin
          .from('sales').select('id, reference_no, car_vin, car_year, car_make, car_model, client_name, sale_date, status')
          .eq('transfer_id', transfer_id);
        const dup = (priorOnTransfer || []).find(s => {
          const sVin = (s.car_vin || '').toUpperCase();
          const sYmm = (s.car_year && s.car_make && s.car_model)
            ? `${s.car_year}|${String(s.car_make).toLowerCase()}|${String(s.car_model).toLowerCase()}` : null;
          const sameCar = (carVin && sVin && carVin === sVin) || (ymmKey && sYmm && ymmKey === sYmm);
          const sameClient = String(s.client_name || '').trim().toLowerCase() === clientNorm;
          const sameDate   = String(s.sale_date || '').slice(0,10) === String(saleDate).slice(0,10);
          return sameCar && sameClient && sameDate;
        });
        if (dup) {
          return res.status(409).json({
            error: `A sale with the same vehicle + client + sale_date already exists on this transfer (ref ${dup.reference_no || dup.id.slice(0,8)}, status ${dup.status}). If this is a renewal or resell, open the Resell flow on that sale instead.`,
            duplicate_sale_id: dup.id,
            code: 'DUP_FINGERPRINT',
          });
        }
      }
    }

    // G22 — vehicle eligibility for the primary car + every additional car.
    const { enforceOrAttach: enforceEligibility } = require('../utils/vehicleEligibility');
    const allCarsForCheck = [
      { plan, car_year, car_make, car_miles },
      ...(Array.isArray(additional_cars) ? additional_cars.map(c => ({ plan: c.plan || plan, car_year: c.car_year, car_make: c.car_make, car_miles: c.car_miles })) : []),
    ];
    for (const car of allCarsForCheck) {
      if (!car.plan) continue;
      const enf = await enforceEligibility(car, companyId);
      if (!enf.ok) return res.status(enf.status).json(enf.payload);
    }

    // Default status — config-driven via compliance.default_new_sale_status.
    // 'open' lets closer iterate; 'pending_review' auto-submits.
    const defaultStatus = await getConfig(companyId, 'compliance.default_new_sale_status', 'open');

    // Shared customer/identity columns — identical across every car for this sale.
    const sharedCols = await stampActor('sales', {
      transfer_id: transfer_id || null,
      created_by:  userId,
      closer_id:   userId,
      company_id:  companyId,
      status:      status || defaultStatus,
      customer_name:    titleCase(customer_name),
      customer_phone,
      customer_phone_2: customer_phone_2 || null,
      // Empty email coerced to the shared sentinel so downstream consumers
      // never see NULL/'' for a column they treat as searchable.
      customer_email:   (customer_email && String(customer_email).trim()) ? customer_email : 'no@email.com',
      customer_address: customer_address || null,
      client_name: titleCase(client_name) || null,
      fronter_id:  fronter_id  || null,
      sale_date:   saleDate,
      // Scheduled charge for a post-dated sale (null for normal sales).
      charge_at:   charge_at || null,
    }, userId);

    // Build the per-vehicle portion of a sale row from a car payload.
    const buildCarRow = (car) => ({
      ...sharedCols,
      car_year:  car.car_year  || null,
      car_make:  car.car_make  || null,
      car_model: car.car_model || null,
      car_miles: car.car_miles || null,
      car_vin:   car.car_vin ? String(car.car_vin).toUpperCase() : null,
      plan:             car.plan             || null,
      down_payment:     car.down_payment     || null,
      monthly_payment:  car.monthly_payment  || null,
      payment_due_note: car.payment_due_note || null,
      reference_no:     car.reference_no     || generateReferenceNo(),
      form_data:        titleCaseFormData(expandStateInFormData(car.form_data || form_data)) || null,
      closer_disposition: car.closer_disposition || null,
    });

    // First car comes from the top-level body; the rest from additional_cars.
    const carPayloads = [
      { car_year, car_make, car_model, car_miles, car_vin,
        plan, down_payment, monthly_payment, payment_due_note,
        reference_no, form_data, closer_disposition },
      ...(Array.isArray(additional_cars) ? additional_cars : []),
    ];

    const rows = carPayloads.map(buildCarRow);

    const { data: createdSales, error: saleError } = await supabaseAdmin
      .from('sales')
      .insert(rows)
      .select();

    if (saleError || !createdSales?.length) {
      logger.error('CREATE_SALE', 'Insert failed', saleError);
      return res.status(500).json({ error: saleError?.message || 'Failed to create sale' });
    }

    const primarySale = createdSales[0];
    logger.success('CREATE_SALE', `${createdSales.length} sale(s) created for transfer=${transfer_id || 'none'} primary=${primarySale.id}`);

    // Auto-log "Sent to Compliance" disposition once on the linked transfer
    // (await — the query builder has no .catch; never throw on a logging failure).
    if (transfer_id) {
      try {
        await supabaseAdmin.from('disposition_actions').insert({
          transfer_id,
          company_id:       companyId,
          user_id:          userId,
          disposition_name: 'Sent to Compliance',
          color:            '#f59e0b',
          note:             closer_disposition ? `Disposition: ${closer_disposition}` : 'Sale submitted to compliance',
          setter_role:      req.user.role || null,
        });
      } catch (err) { logger.error('DISPO_AUTO', 'sale create dispo log failed', err); }
    }

    res.status(201).json({
      sale: primarySale,
      sales: createdSales,
      count: createdSales.length,
    });
  })
);

// ============================================================================
// GET /sales/compliance — compliance_manager sees sales for their own company
// NOTE: must be defined BEFORE /:id to prevent 'compliance' being caught as an id
// ============================================================================
router.get('/compliance', asyncHandler(async (req, res) => {
  const userId   = req.user.id;
  const userRole = req.user.role;
  const companyId = req.user.company_id;

  if (userRole !== 'compliance_manager' && userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { status, search, date_from, date_to, page = 1, limit = 50 } = req.query;

  let query = supabaseAdmin
    .from('sales')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  // Superadmin sees everything. Compliance_manager scopes by closer_id IN [company users]
  // because sales from the fronter pipeline now carry the fronter company's company_id,
  // not the closer company's — so company_id filtering would miss them.
  if (userRole === 'compliance_manager' && companyId) {
    const { data: coUsers } = await supabaseAdmin
      .from('user_company_roles').select('user_id')
      .eq('company_id', companyId).eq('is_active', true);
    const closerUserIds = (coUsers || []).map(u => u.user_id);
    if (closerUserIds.length > 0) {
      query = query.in('closer_id', closerUserIds);
    } else {
      return res.json({ sales: [], total: 0, page: parseInt(page), limit: parseInt(limit) });
    }
  }
  // superadmin: no filter

  if (status)     query = query.eq('status', status);
  // Same sale_date semantics as GET /sales — see comment there.
  if (date_from)  query = query.gte('sale_date', date_from);
  if (date_to)    query = query.lte('sale_date', date_to);

  if (search) {
    const s = escapeOrValue(search);
    query = query.or([
      `customer_name.ilike.%${s}%`,
      `customer_phone.ilike.%${s}%`,
      `reference_no.ilike.%${s}%`,
    ].join(','));
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  query = query.range(offset, offset + parseInt(limit) - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Enrich with closer/fronter names and company names
  const closerIds  = [...new Set((data || []).map(s => s.closer_id).filter(Boolean))];
  const fronterIds = [...new Set((data || []).map(s => s.fronter_id).filter(Boolean))];
  const allUids    = [...new Set([...closerIds, ...fronterIds])];
  const compIds    = [...new Set((data || []).map(s => s.company_id).filter(Boolean))];

  let profileMap = {}, companyMap = {};
  const [profilesRes, companiesRes] = await Promise.all([
    allUids.length ? supabaseAdmin.from('user_profiles').select('user_id,first_name,last_name').in('user_id', allUids) : { data: [] },
    compIds.length ? supabaseAdmin.from('companies').select('id,name').in('id', compIds)                               : { data: [] },
  ]);
  (profilesRes.data  || []).forEach(p => { profileMap[p.user_id] = p; });
  (companiesRes.data || []).forEach(c => { companyMap[c.id]       = c; });

  const enriched = (data || []).map(s => ({
    ...s,
    user_profiles: profileMap[s.closer_id]  || null,
    companies:     companyMap[s.company_id] || null,
    closer_name:  profileMap[s.closer_id]  ? `${profileMap[s.closer_id].first_name  || ''} ${profileMap[s.closer_id].last_name  || ''}`.trim() || null : null,
    fronter_name: profileMap[s.fronter_id] ? `${profileMap[s.fronter_id].first_name || ''} ${profileMap[s.fronter_id].last_name || ''}`.trim() || null : null,
  }));

  res.json({ sales: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
}));

// ============================================================================
// GET /sales/:id - Get a single sale
// ============================================================================
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const { data: sale, error } = await supabaseAdmin
      .from('sales')
      .select('*, transfers(id, form_data, created_by)')
      .eq('id', id)
      .single();

    if (error || !sale) return res.status(404).json({ error: 'Sale not found' });

    // Permission: creator, closer, manager, or compliance
    const isOwner = sale.created_by === userId || sale.closer_id === userId;
    const isManager = ['superadmin', 'readonly_admin', 'company_admin', 'manager', 'fronter_manager', 'operations_manager', 'closer_manager', 'compliance_manager'].includes(userRole);
    if (!isOwner && !isManager) return res.status(403).json({ error: 'Access denied' });

    res.json({ sale });
  })
);

// ============================================================================
// PUT /sales/:id - Update sale
// ============================================================================
// ============================================================================
// POST /sales/eligibility-check — closer-side preview of a sale before submit.
// Returns the same eligibility verdict the real POST/PUT would run, but
// never writes anything. Lets the SaleForm warn the closer about an
// ineligible vehicle while they're filling the form, instead of bouncing
// off a 400 after they hit Submit.
// ============================================================================
router.post('/eligibility-check', asyncHandler(async (req, res) => {
  const { plan, car_year, car_make, car_miles, company_id } = req.body || {};
  const { checkEligibility } = require('../utils/vehicleEligibility');
  const resolvedCompany = company_id || req.user.company_id || null;
  const result = await checkEligibility({ plan, car_year, car_make, car_miles }, resolvedCompany);
  res.json({
    ok:       !!(result.ok || result.skipped),
    skipped:  !!result.skipped,
    reason:   result.reason || null,
    field:    result.field  || null,
    value:    result.value  ?? null,
    rule:     result.rule   || null,
    match:    result.match  || null,
  });
}));

// ============================================================================
// GET /sales/customer-history/by-phone/:phone — light summary of prior
// sales tied to this customer (cross-co aware via customer_uuid). Used by
// closers in PhoneSearch + the closer drawer to spot a returning customer
// before they create a duplicate or miss a renewal opportunity. Returns a
// trimmed shape (no PII beyond first name) and is role-scoped exactly like
// the lifetime endpoint.
// ============================================================================
router.get('/customer-history/by-phone/:phone', asyncHandler(async (req, res) => {
  const role = req.user.role;
  const userId = req.user.id;
  const companyId = req.user.company_id;
  const raw = String(req.params.phone || '').replace(/\D/g, '');
  const norm = raw.length === 11 && raw.startsWith('1') ? raw.slice(1) : raw;
  if (!norm || norm.length < 7) return res.status(400).json({ error: 'phone must be at least 7 digits' });

  const { data: anchor } = await supabaseAdmin
    .from('sales').select('customer_uuid').not('customer_uuid', 'is', null)
    .or(`customer_phone.eq.${norm},customer_phone.eq.+1${norm}`)
    .limit(1).maybeSingle();
  if (!anchor?.customer_uuid) return res.json({ customer_uuid: null, history: [], summary: { total: 0, active: 0, cancelled: 0 } });

  let query = supabaseAdmin
    .from('sales')
    .select('id, reference_no, status, sale_date, plan, client_name, company_id, is_resell, cancellation_date, chargeback_amount')
    .eq('customer_uuid', anchor.customer_uuid)
    .order('sale_date', { ascending: false });

  // Same scope rules as /lifetime.
  if (role === 'fronter')         query = query.eq('fronter_id', userId).eq('is_resell', false);
  else if (role === 'fronter_manager') query = (companyId ? query.eq('company_id', companyId).eq('is_resell', false) : query.eq('id', '00000000-0000-0000-0000-000000000000'));
  else if (role === 'closer')     query = query.eq('closer_id', userId);
  else if (role === 'closer_manager') query = (companyId ? query.eq('company_id', companyId) : query.eq('id', '00000000-0000-0000-0000-000000000000'));
  else if (!['compliance_manager', 'superadmin', 'readonly_admin', 'company_admin', 'operations_manager'].includes(role)) {
    return res.status(403).json({ error: 'Not permitted' });
  }

  const { data: history } = await query;
  const rows = history || [];
  const TERMINAL_CANCEL = new Set(['cancelled', 'compliance_cancelled', 'closed_lost', 'chargeback']);
  const summary = {
    total: rows.length,
    active: rows.filter(r => !TERMINAL_CANCEL.has(r.status)).length,
    cancelled: rows.filter(r => TERMINAL_CANCEL.has(r.status)).length,
    chargebacks: rows.filter(r => r.status === 'chargeback').length,
    chargeback_total: rows.reduce((sum, r) => sum + (parseFloat(r.chargeback_amount) || 0), 0),
  };
  res.json({ customer_uuid: anchor.customer_uuid, history: rows, summary });
}));

// ============================================================================
// GET /sales/lifetime/by-phone/:phone — every sale tied to this customer
// across every company (G17 / G27). Resolved by customer_uuid (mig 079) so
// cross-co reports finally have a stable identity to roll up by.
// Permission-scoped identically to the chain endpoint: fronter sees own
// non-resells; closer sees own closer-side; compliance + superadmin see
// everything. Returned rows include company_id so the UI can group by co.
// ============================================================================
router.get('/lifetime/by-phone/:phone', asyncHandler(async (req, res) => {
  const role = req.user.role;
  const userId = req.user.id;
  const companyId = req.user.company_id;
  const raw = String(req.params.phone || '').replace(/\D/g, '');
  // Match the SQL fn app_norm_phone — strip a leading 1 from 11-digit US numbers.
  const norm = raw.length === 11 && raw.startsWith('1') ? raw.slice(1) : raw;
  if (!norm || norm.length < 7) return res.status(400).json({ error: 'phone must be at least 7 digits' });

  // Look up customer_uuid via any existing sale row carrying this phone
  // (cheaper than recomputing the uuidv5 in JS).
  const { data: anchor } = await supabaseAdmin
    .from('sales').select('customer_uuid').not('customer_uuid', 'is', null)
    .or(`customer_phone.eq.${norm},customer_phone.eq.+1${norm}`)
    .limit(1).maybeSingle();
  if (!anchor?.customer_uuid) return res.json({ customer_uuid: null, sales: [], companies: [] });

  let query = supabaseAdmin
    .from('sales')
    .select('id, reference_no, status, sale_date, plan, client_name, monthly_payment, is_resell, cancellation_date, fronter_id, closer_id, customer_name, company_id, transfer_id, original_sale_id, original_fronter_id')
    .eq('customer_uuid', anchor.customer_uuid)
    .order('sale_date', { ascending: true });

  if (role === 'fronter')         query = query.eq('fronter_id', userId).eq('is_resell', false);
  else if (role === 'fronter_manager') query = (companyId ? query.eq('company_id', companyId).eq('is_resell', false) : query.eq('id', '00000000-0000-0000-0000-000000000000'));
  else if (role === 'closer')     query = query.eq('closer_id', userId);
  else if (role === 'closer_manager') query = (companyId ? query.eq('company_id', companyId) : query.eq('id', '00000000-0000-0000-0000-000000000000'));
  else if (!['compliance_manager', 'superadmin', 'readonly_admin', 'company_admin', 'operations_manager'].includes(role)) {
    return res.status(403).json({ error: 'Not permitted' });
  }

  const { data: rows } = await query;
  const companies = [...new Set((rows || []).map(s => s.company_id).filter(Boolean))];
  res.json({ customer_uuid: anchor.customer_uuid, sales: rows || [], companies });
}));

// ============================================================================
// GET /sales/timeline/by-phone/:phone — UNIFIED customer lifetime timeline.
// Merges four sources into one chronologically-sorted feed, all keyed on the
// deterministic customer_uuid (mig 079 on sales, mig 085 on transfers):
//   • transfers            → lead_created
//   • transfer_assignments → lead_assigned / lead_transferred  (mig 086)
//   • policy_events        → sold/approved/cancelled/superseded/… (mig 087/088)
// Role-scoped identically to /lifetime (sales side) and to the transfers list
// route (lead side), so the response never leaks a row the caller couldn't
// already reach. Additive endpoint — nothing else depends on it.
// ============================================================================
const TIMELINE_EVENT_TITLE = {
  sold: 'Policy sold', submitted: 'Submitted for review', approved: 'Approved by compliance',
  returned: 'Returned for revision', cancelled: 'Policy cancelled', reinstated: 'Policy reinstated',
  renewed: 'Renewed', replaced: 'Replaced', resold: 'Resold', superseded: 'Superseded (retired)',
  expired: 'Expired', lost: 'Lost', chargeback: 'Chargeback', charged: 'Post-date charged',
  post_dated: 'Post-dated', dispute: 'Dispute', refunded: 'Refunded', note: 'Note',
};

router.get('/timeline/by-phone/:phone', asyncHandler(async (req, res) => {
  const role = req.user.role;
  const userId = req.user.id;
  const companyId = req.user.company_id;
  const raw = String(req.params.phone || '').replace(/\D/g, '');
  const norm = raw.length === 11 && raw.startsWith('1') ? raw.slice(1) : raw;
  if (!norm || norm.length < 7) return res.status(400).json({ error: 'phone must be at least 7 digits' });

  const FRONT_VIEW = ['fronter', 'fronter_manager'];
  const ALL_VIEW   = ['compliance_manager', 'superadmin', 'readonly_admin', 'company_admin', 'operations_manager'];
  if (!FRONT_VIEW.includes(role) && !ALL_VIEW.includes(role) && !['closer', 'closer_manager'].includes(role)) {
    return res.status(403).json({ error: 'Not permitted' });
  }

  // Resolve customer_uuid from sales first, then transfers (both carry it now).
  let customerUuid = null;
  const { data: sAnchor } = await supabaseAdmin
    .from('sales').select('customer_uuid').not('customer_uuid', 'is', null)
    .or(`customer_phone.eq.${norm},customer_phone.eq.+1${norm}`).limit(1).maybeSingle();
  customerUuid = sAnchor?.customer_uuid || null;
  if (!customerUuid) {
    const { data: tAnchor } = await supabaseAdmin
      .from('transfers').select('customer_uuid').not('customer_uuid', 'is', null)
      .eq('normalized_phone', norm).limit(1).maybeSingle();
    customerUuid = tAnchor?.customer_uuid || null;
  }
  if (!customerUuid) {
    return res.json({ customer_uuid: null, timeline: [], summary: { leads: 0, sales: 0, active: 0, cancelled: 0, superseded: 0, companies: 0 } });
  }

  // ── Sales (policy side) — same scope as /lifetime ──
  let salesQ = supabaseAdmin.from('sales')
    .select('id, reference_no, status, sale_date, created_at, plan, client_name, company_id, is_resell, cancellation_date, superseded_by, transfer_id, car_year, car_make, car_model, car_vin')
    .eq('customer_uuid', customerUuid);
  if (role === 'fronter')              salesQ = salesQ.eq('fronter_id', userId).eq('is_resell', false);
  else if (role === 'fronter_manager') salesQ = companyId ? salesQ.eq('company_id', companyId).eq('is_resell', false) : salesQ.eq('id', '00000000-0000-0000-0000-000000000000');
  else if (role === 'closer')          salesQ = salesQ.eq('closer_id', userId);
  else if (role === 'closer_manager')  salesQ = companyId ? salesQ.eq('company_id', companyId) : salesQ.eq('id', '00000000-0000-0000-0000-000000000000');
  const { data: salesData } = await salesQ;
  const saleRows = salesData || [];
  const saleById = Object.fromEntries(saleRows.map(s => [s.id, s]));
  const saleIds  = saleRows.map(s => s.id);

  // ── Transfers (lead side) — same scope as the transfers list route ──
  let transfers = [];
  {
    let tQ = supabaseAdmin.from('transfers')
      .select('id, status, created_at, company_id, created_by, assigned_closer_id, form_data')
      .eq('customer_uuid', customerUuid);
    if (role === 'fronter')                tQ = tQ.eq('created_by', userId);
    else if (role === 'fronter_manager')   tQ = companyId ? tQ.eq('company_id', companyId) : tQ.eq('id', '00000000-0000-0000-0000-000000000000');
    else if (role === 'closer')            tQ = tQ.eq('assigned_closer_id', userId);
    else if (role === 'closer_manager') {
      const { data: coUsers } = await supabaseAdmin
        .from('user_company_roles').select('user_id').eq('company_id', companyId).eq('is_active', true);
      const ids = (coUsers || []).map(u => u.user_id);
      tQ = ids.length ? tQ.in('assigned_closer_id', ids) : tQ.eq('id', '00000000-0000-0000-0000-000000000000');
    }
    // ALL_VIEW roles: no extra filter — every lead for this customer.
    const { data } = await tQ;
    transfers = data || [];
  }
  const transferIds = transfers.map(t => t.id);

  // ── transfer_assignments (chain hops) ──
  let assignments = [];
  if (transferIds.length) {
    const { data } = await supabaseAdmin.from('transfer_assignments')
      .select('transfer_id, from_closer_id, to_closer_id, assigned_by, assigned_at, source')
      .in('transfer_id', transferIds);
    assignments = data || [];
  }

  // ── policy_events (lifecycle) ──
  let events = [];
  if (saleIds.length) {
    const { data } = await supabaseAdmin.from('policy_events')
      .select('sale_id, event_type, at, actor_id, note, meta')
      .in('sale_id', saleIds);
    events = data || [];
  }

  // ── Resolve actor display names (best-effort) ──
  const actorIds = [...new Set([
    ...transfers.map(t => t.created_by),
    ...assignments.flatMap(a => [a.from_closer_id, a.to_closer_id, a.assigned_by]),
    ...events.map(e => e.actor_id),
  ].filter(Boolean))];
  const nameMap = {};
  if (actorIds.length) {
    const { data: profs } = await supabaseAdmin
      .from('user_profiles').select('user_id, first_name, last_name').in('user_id', actorIds);
    (profs || []).forEach(p => { nameMap[p.user_id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || null; });
  }
  const nm = (id) => (id ? nameMap[id] || null : null);

  // ── Merge ──
  const items = [];
  transfers.forEach(t => {
    const who = t.form_data && (t.form_data.client_name || t.form_data.FirstName || t.form_data.customer_name);
    items.push({ at: t.created_at, kind: 'lead_created', company_id: t.company_id,
      title: 'Lead created', detail: who ? `for ${who}` : null, actor: nm(t.created_by), ref: t.id.slice(0, 8) });
  });
  assignments.forEach(a => {
    if (a.source === 'backfill' && !a.from_closer_id) {
      items.push({ at: a.assigned_at, kind: 'lead_assigned', title: 'Assigned to closer',
        detail: nm(a.to_closer_id) ? `→ ${nm(a.to_closer_id)}` : null, actor: nm(a.assigned_by), ref: a.transfer_id.slice(0, 8) });
    } else {
      items.push({ at: a.assigned_at, kind: 'lead_transferred', title: 'Lead transferred',
        detail: `${nm(a.from_closer_id) || 'unassigned'} → ${nm(a.to_closer_id) || 'unassigned'}`,
        actor: nm(a.assigned_by), ref: a.transfer_id.slice(0, 8) });
    }
  });
  events.forEach(e => {
    const s = saleById[e.sale_id] || {};
    const car = [s.car_year, s.car_make, s.car_model].filter(Boolean).join(' ');
    items.push({ at: e.at, kind: e.event_type, company_id: s.company_id,
      title: TIMELINE_EVENT_TITLE[e.event_type] || e.event_type,
      detail: [s.plan, car].filter(Boolean).join(' · ') || e.note || null,
      actor: nm(e.actor_id), ref: s.reference_no || e.sale_id.slice(0, 8), meta: e.meta || null });
  });

  // Sort by calendar day first, then by lifecycle order within a day. This
  // keeps same-day lead→sold→approved reading logically even though backfilled
  // 'sold' events carry a date-only sale_date (00:00) while leads carry a
  // precise created_at timestamp.
  const KIND_ORDER = {
    lead_created: 0, lead_assigned: 1, lead_transferred: 1,
    sold: 2, renewed: 2, replaced: 2, resold: 2,
    submitted: 3, returned: 4, approved: 5,
    post_dated: 6, charged: 7, reinstated: 7,
    cancelled: 8, superseded: 8, expired: 8, lost: 8, dispute: 8, chargeback: 9, refunded: 9,
  };
  const dayOf = (x) => String(x.at || '').slice(0, 10);
  items.sort((a, b) =>
    dayOf(a).localeCompare(dayOf(b))
    || (KIND_ORDER[a.kind] ?? 50) - (KIND_ORDER[b.kind] ?? 50)
    || (new Date(a.at || 0) - new Date(b.at || 0))
  );

  const TERMINAL = new Set(['cancelled', 'compliance_cancelled', 'closed_lost', 'chargeback']);
  const summary = {
    leads: transfers.length,
    sales: saleRows.length,
    active: saleRows.filter(s => s.status === 'closed_won' && !s.superseded_by).length,
    cancelled: saleRows.filter(s => TERMINAL.has(s.status) || s.cancellation_date).length,
    superseded: saleRows.filter(s => s.superseded_by).length,
    companies: [...new Set(saleRows.map(s => s.company_id).filter(Boolean))].length,
  };
  res.json({ customer_uuid: customerUuid, timeline: items, summary });
}));

// ============================================================================
// GET /sales/:id/chain — resell chain timeline for a sale
// Returns every sale in the lineage: walk original_sale_id back to the root,
// then forward from the root to every descendant. Ordered by sale_date asc
// so the auditor reads it as a customer-lifetime timeline.
//
// G18 — Permission-scoped. Fronter / fronter_manager see only rows in
// their own company AND only non-resell rows (resells are privacy-hidden
// from the fronter view). Closer / closer_manager see closer-side rows
// they own. Compliance + superadmin see everything. The endpoint never
// leaks a sale a caller couldn't already access through the list views.
// ============================================================================
router.get('/:id/chain', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const role = req.user.role;
  const userId = req.user.id;
  const companyId = req.user.company_id;

  const { data: anchor, error: anchorErr } = await supabaseAdmin
    .from('sales').select('id, original_sale_id').eq('id', id).single();
  if (anchorErr || !anchor) return res.status(404).json({ error: 'Sale not found' });
  const rootId = anchor.original_sale_id || anchor.id;

  let query = supabaseAdmin
    .from('sales')
    .select('id, reference_no, status, sale_date, plan, client_name, monthly_payment, is_resell, original_sale_id, cancellation_date, fronter_id, closer_id, customer_name, company_id')
    .or(`id.eq.${rootId},original_sale_id.eq.${rootId}`)
    .order('sale_date', { ascending: true });

  // Role-scope the result so the chain doesn't reveal sales the caller
  // couldn't see through the normal list views.
  if (role === 'fronter') {
    query = query.eq('fronter_id', userId).eq('is_resell', false);
  } else if (role === 'fronter_manager') {
    if (companyId) query = query.eq('company_id', companyId).eq('is_resell', false);
    else query = query.eq('id', '00000000-0000-0000-0000-000000000000');
  } else if (role === 'closer') {
    query = query.eq('closer_id', userId);
  } else if (role === 'closer_manager') {
    if (companyId) query = query.eq('company_id', companyId);
    else query = query.eq('id', '00000000-0000-0000-0000-000000000000');
  } else if (!['compliance_manager', 'superadmin', 'readonly_admin', 'company_admin', 'operations_manager'].includes(role)) {
    // Unknown role → safest is to return only the anchor itself.
    query = query.eq('id', id);
  }

  const { data: chain } = await query;
  res.json({ root_id: rootId, chain: chain || [] });
}));

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    logger.info('UPDATE_SALE', `id=${id}, user=${userId}`);

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('sales').select('*').eq('id', id).single();
    if (fetchError || !existing) return res.status(404).json({ error: 'Sale not found' });

    const isCreator  = existing.created_by === userId || existing.closer_id === userId;
    const isManager  = ['superadmin', 'readonly_admin', 'company_admin', 'manager', 'fronter_manager', 'operations_manager', 'closer_manager'].includes(userRole);
    const isCompliance = userRole === 'compliance_manager' || userRole === 'superadmin';
    // compliance_manager isn't in the isManager list above, so include the
    // isCompliance flag here — otherwise a compliance user editing a sale they
    // didn't create is wrongly 403'd before the compliance-specific paths below.
    if (!isCreator && !isManager && !isCompliance) return res.status(403).json({ error: 'Permission denied' });

    // Company scope: managers can only edit sales in their own company (compliance sees all)
    if (isManager && !isCompliance && existing.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Sale not within your company scope' });
    }

    // Block edits to sales under compliance review (except by compliance/superadmin).
    // Exception: post-dated sales (post-date disposition) stay closer-editable —
    // the closer owns the charge date and the "Charge → Sale" action until they
    // charge it, at which point it enters review like a normal sale.
    const isPostDateSale = /post[\s_-]?date|postdate/i.test(String(existing.closer_disposition || ''));
    if (existing.status === 'pending_review' && !isCompliance && !isPostDateSale) {
      return res.status(403).json({ error: 'This sale is under compliance review and cannot be edited' });
    }

    // Block edits to finalized sales (except by compliance/superadmin)
    if (['closed_won', 'closed_lost'].includes(existing.status) && !isCompliance) {
      return res.status(403).json({ error: 'This sale has been finalized and cannot be edited' });
    }

    // Compliance lock window — sales older than the configured threshold
    // become read-only for non-compliance roles. Audit-safe immutability.
    if (!isCompliance) {
      const lockDays = parseInt(await getConfig(existing.company_id, 'compliance.lock_window_days', 90), 10) || 0;
      if (lockDays > 0) {
        // G12 — anchor the lock on sale_date (the business day the sale
        // happened), falling back to created_at only when the row predates
        // the sale_date column being populated. Anchoring on created_at
        // means a bulk import resets the lock clock on every old row.
        const anchor = existing.sale_date || existing.created_at;
        const ageDays = (Date.now() - new Date(anchor).getTime()) / 86400000;
        if (ageDays > lockDays) {
          return res.status(403).json({
            error: `This sale is older than ${lockDays} days and is locked. Contact compliance for changes.`,
            sale_age_days: Math.floor(ageDays),
            lock_window_days: lockDays,
          });
        }
      }
    }

    const {
      status, customer_name, customer_phone, customer_phone_2, customer_email, customer_address,
      car_year, car_make, car_model, car_miles, car_vin,
      plan, down_payment, monthly_payment, payment_due_note,
      reference_no, client_name, fronter_id, sale_date, form_data, closer_disposition, charge_at,
      cancellation_date, cancellation_reason_key, chargeback_date, chargeback_amount,
    } = req.body;

    // Allowed statuses sourced from business_config — superadmin can enable
    // 'resold', 'expired', 'refunded', or restrict the legacy set per company.
    const fallbackStatuses = ['open', 'sold', 'cancelled', 'follow_up', 'closed_won', 'closed_lost'];
    const validStatuses = (await getConfig(existing.company_id, 'compliance.allowed_statuses', fallbackStatuses)) || fallbackStatuses;
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status', allowed: validStatuses });
    }
    if (status && ['closed_won', 'closed_lost'].includes(status) && !isCompliance) {
      return res.status(400).json({ error: 'This status can only be set through the compliance workflow' });
    }

    // G16 manual parity — reference_no collision check on edit. Before the
    // mig 077 unique index would have caught this at write time with a
    // useless 23505 error message; checking up-front lets us tell the
    // operator exactly which row owns the ref.
    if (reference_no !== undefined && String(reference_no).trim()
        && String(reference_no).trim().toUpperCase() !== String(existing.reference_no || '').trim().toUpperCase()) {
      const { data: collision } = await supabaseAdmin
        .from('sales').select('id, reference_no, customer_name, sale_date, company_id')
        .eq('reference_no', String(reference_no).trim()).neq('id', id).maybeSingle();
      if (collision) {
        return res.status(409).json({
          error: `Reference No "${reference_no}" is already used by another sale (${collision.customer_name || '—'} · ${collision.sale_date || '—'}). Every policy must be globally unique — pick a different one.`,
          collision_sale_id: collision.id,
          code: 'REF_COLLISION',
        });
      }
    }

    // Scenario 2 (manual parity) — client_name change on an active won
    // sale almost always means a NEW deal with a different underwriter.
    // Block the silent overwrite the same way G20 blocks plan changes;
    // the closer should use the Resell flow w/ resell_intent='resell' so
    // the original client is preserved as a historical row.
    if (!isCompliance
        && client_name !== undefined
        && existing.client_name
        && String(client_name).trim()
        && String(client_name).trim().toLowerCase() !== String(existing.client_name).trim().toLowerCase()
        && ['closed_won', 'sold'].includes(existing.status)) {
      return res.status(403).json({
        error: 'Changing the client on an active sale isn\'t allowed — that\'s a different deal with a different underwriter. Open the Resell flow on this sale; the prior client + sale price stay intact as a historical record.',
        existing_client: existing.client_name,
        attempted_client: client_name,
      });
    }

    // G20 — plan-switch guard. Changing the plan on an already-won sale
    // is almost always a closer mistake; the right operation is to RESELL
    // the existing sale w/ resell_intent='renewal' or 'resell'. Block here
    // for closer/manager edits; compliance keeps the override path for
    // post-hoc corrections.
    if (!isCompliance
        && plan !== undefined
        && existing.plan
        && String(plan).trim()
        && String(plan).trim().toLowerCase() !== String(existing.plan).trim().toLowerCase()
        && ['closed_won', 'sold'].includes(existing.status)) {
      return res.status(403).json({
        error: 'Changing the plan on an active sale isn\'t allowed. Open the Resell flow on this sale to record the new plan as a fresh deal — the prior plan + price history stays intact.',
        existing_plan: existing.plan,
        attempted_plan: plan,
      });
    }

    // G24 — compliance lock. Once compliance terminally adjudicates the
    // row, only compliance / superadmin can mutate. Stops a closer from
    // reverting a chargeback or compliance_cancelled mid-window.
    if (existing.compliance_locked_at && !isCompliance) {
      return res.status(403).json({
        error: 'This sale is compliance-locked. Contact compliance for changes.',
        locked_at: existing.compliance_locked_at,
      });
    }

    // G22 — vehicle eligibility. Run when the edit touches any vehicle
    // field OR the plan name. Effective values = incoming OR existing
    // (so a row that was already ineligible isn't suddenly unblockable
    // by a no-op edit). Enforcement mode comes from business_config.
    // Compliance/superadmin are the override authority — they correct records
    // post-hoc and must never be hard-blocked by selling-eligibility (the edit
    // payload always carries car/plan fields, so this would otherwise 400 every
    // compliance edit of a sale whose vehicle/plan the catalog flags).
    const touchesEligibility = (plan !== undefined || car_year !== undefined || car_make !== undefined || car_miles !== undefined);
    if (touchesEligibility && !isCompliance) {
      const { enforceOrAttach } = require('../utils/vehicleEligibility');
      const candidate = {
        plan:      plan      !== undefined ? plan      : existing.plan,
        car_year:  car_year  !== undefined ? car_year  : existing.car_year,
        car_make:  car_make  !== undefined ? car_make  : existing.car_make,
        car_miles: car_miles !== undefined ? car_miles : existing.car_miles,
      };
      const enforcement = await enforceOrAttach(candidate, existing.company_id);
      if (!enforcement.ok) return res.status(enforcement.status).json(enforcement.payload);
      if (enforcement.eligibility_warning) req._eligibility_warning = enforcement.eligibility_warning;
    }

    const updates = await stampActor('sales', { updated_at: new Date().toISOString() }, userId);
    if (status !== undefined)          updates.status           = status;
    if (customer_name !== undefined)   updates.customer_name    = titleCase(customer_name);
    if (customer_phone !== undefined)  updates.customer_phone   = customer_phone;
    if (customer_phone_2 !== undefined) updates.customer_phone_2 = customer_phone_2;
    if (customer_email !== undefined)  updates.customer_email   = customer_email;
    if (customer_address !== undefined) updates.customer_address = customer_address;
    if (car_year !== undefined)        updates.car_year         = car_year;
    if (car_make !== undefined)        updates.car_make         = car_make;
    if (car_model !== undefined)       updates.car_model        = car_model;
    if (car_miles !== undefined)       updates.car_miles        = car_miles;
    if (car_vin !== undefined)         updates.car_vin          = car_vin?.toUpperCase();
    if (plan !== undefined)            updates.plan             = plan;
    if (down_payment !== undefined)    updates.down_payment     = down_payment;
    if (monthly_payment !== undefined) updates.monthly_payment  = monthly_payment;
    if (payment_due_note !== undefined) updates.payment_due_note = payment_due_note;
    if (reference_no !== undefined)    updates.reference_no     = reference_no;
    if (client_name !== undefined)     updates.client_name      = titleCase(client_name);
    if (fronter_id !== undefined)          updates.fronter_id          = fronter_id;
    if (sale_date !== undefined)           updates.sale_date           = sale_date;
    if (form_data !== undefined)           updates.form_data           = titleCaseFormData(expandStateInFormData(form_data));
    if (closer_disposition !== undefined)  updates.closer_disposition  = closer_disposition;
    // Charge date for a post-dated sale. Re-arm the scheduler reminder whenever
    // it changes (clear charge_notified_at) so a moved charge date notifies
    // again; clearing it (null) silences the reminder.
    if (charge_at !== undefined) {
      updates.charge_at = charge_at || null;
      updates.charge_notified_at = null;
    }
    // Cancellation date — only compliance/superadmin can set it directly,
    // and only meaningful when the row transitions into a cancellation-like
    // status. Stored as YYYY-MM-DD (or null to clear).
    if (cancellation_date !== undefined && isCompliance) {
      if (cancellation_date === null || cancellation_date === '') {
        updates.cancellation_date = null;
      } else {
        const m = String(cancellation_date).match(/^(\d{4})-(\d{2})-(\d{2})/);
        const us = String(cancellation_date).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) updates.cancellation_date = m.slice(1).join('-');
        else if (us) updates.cancellation_date = `${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}`;
        else return res.status(400).json({ error: 'cancellation_date must be YYYY-MM-DD or MM/DD/YYYY' });
      }
    }
    // Cancellation reason key — canonical key from the cancellation_reasons
    // catalog. Free text still goes into compliance_note. Compliance-only.
    if (cancellation_reason_key !== undefined && isCompliance) {
      updates.cancellation_reason_key = cancellation_reason_key || null;
    }
    // Chargeback fields — distinct from cancellation_date because the
    // money has already moved by the time a chargeback hits.
    if (chargeback_date !== undefined && isCompliance) {
      if (!chargeback_date) {
        updates.chargeback_date = null;
      } else {
        const m = String(chargeback_date).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) updates.chargeback_date = m.slice(1).join('-');
        else return res.status(400).json({ error: 'chargeback_date must be YYYY-MM-DD' });
      }
    }
    if (chargeback_amount !== undefined && isCompliance) {
      const n = parseFloat(chargeback_amount);
      updates.chargeback_amount = (chargeback_amount === null || chargeback_amount === '') ? null
        : (Number.isFinite(n) ? n : null);
    }

    let { data: updated, error: updateError } = await supabaseAdmin
      .from('sales').update(updates).eq('id', id).select().single();

    // If sales.cancellation_date doesn't exist yet (mig 075 not applied),
    // drop it from the patch and retry once so the rest of the edit still
    // persists. The 42703 code or "cancellation_date does not exist"
    // message both indicate the missing column.
    if (updateError && 'cancellation_date' in updates && (
      updateError.code === '42703' ||
      /cancellation_date/i.test(String(updateError.message || ''))
    )) {
      const { cancellation_date, ...withoutCancel } = updates;
      const r2 = await supabaseAdmin.from('sales').update(withoutCancel).eq('id', id).select().single();
      updated = r2.data; updateError = r2.error;
    }

    if (updateError) {
      logger.error('UPDATE_SALE', 'Update failed', updateError);
      return res.status(500).json({ error: updateError.message });
    }

    logger.success('UPDATE_SALE', `Sale updated: ${id}`);
    res.json({ sale: updated });
  })
);

// ============================================================================
// POST /sales/:id/submit-review — Closer submits sale for compliance review
// ============================================================================
router.post('/:id/submit-review', asyncHandler(async (req, res) => {
  const userId   = req.user.id;
  const userRole = req.user.role;
  const { id }   = req.params;

  const { data: sale, error } = await supabaseAdmin
    .from('sales').select('*').eq('id', id).single();
  if (error || !sale) return res.status(404).json({ error: 'Sale not found' });

  const isOwner = sale.created_by === userId || sale.closer_id === userId;
  // Superadmin can submit any sale for review on the owner's behalf.
  if (!isOwner && userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Only the sale owner can submit for review' });
  }

  if (!['open', 'needs_revision'].includes(sale.status)) {
    return res.status(400).json({ error: `Cannot submit a sale with status "${sale.status}" for review` });
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('sales')
    .update({
      status: 'pending_review',
      submitted_for_review_at: now,
      submitted_by: userId,
      compliance_note: null,
      updated_at: now,
    })
    .eq('id', id)
    .select()
    .single();

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const submitterName = authUser?.user?.user_metadata?.first_name || authUser?.user?.email || 'A closer';
  notifications.onSaleSubmittedForReview({ sale: updated, submitterName }).catch(() => {});

  logger.success('SUBMIT_REVIEW', `Sale ${id} submitted for review by ${userId}`);
  res.json({ sale: updated });
}));

// ============================================================================
// POST /sales/:id/compliance-approve — Compliance approves sale → closed_won
// ============================================================================
router.post('/:id/compliance-approve', asyncHandler(async (req, res) => {
  const userId   = req.user.id;
  const userRole = req.user.role;
  const { id }   = req.params;

  if (userRole !== 'compliance_manager' && userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Only compliance managers can approve sales' });
  }

  const { data: sale, error } = await supabaseAdmin
    .from('sales').select('*').eq('id', id).single();
  if (error || !sale) return res.status(404).json({ error: 'Sale not found' });

  if (sale.status !== 'pending_review') {
    return res.status(400).json({ error: `Sale must be in "pending_review" status to approve (current: ${sale.status})` });
  }

  const now = new Date().toISOString();
  const currentHistory = Array.isArray(sale.edit_history) ? sale.edit_history : [];
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('sales')
    .update({
      status: 'closed_won',
      compliance_reviewed_by: userId,
      compliance_reviewed_at: now,
      compliance_note: null,
      updated_at: now,
      edit_history: [...currentHistory, {
        editor_id: userId,
        role: 'compliance_manager',
        action: 'approved',
        previous_status: 'pending_review',
        new_status: 'closed_won',
        edited_at: now,
      }],
    })
    .eq('id', id)
    .select()
    .single();

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const reviewerName = authUser?.user?.user_metadata?.first_name || authUser?.user?.email || 'Compliance';
  notifications.onSaleApproved({ sale: updated, reviewerName }).catch(() => {});

  // Auto-log "Approved" disposition on the linked transfer. The Supabase query
  // builder is a thenable with no .catch — await in try/catch so a logging
  // failure never throws and 500s an approval that already succeeded.
  if (sale.transfer_id) {
    try {
      await supabaseAdmin.from('disposition_actions').insert({
        transfer_id:      sale.transfer_id,
        company_id:       sale.company_id,
        user_id:          userId,
        disposition_name: sale.closer_disposition || 'Approved',
        color:            '#22c55e',
        note:             `Approved by compliance (${reviewerName})`,
        setter_role:      userRole,
      });
    } catch (err) { logger.error('DISPO_AUTO', 'approve dispo log failed', err); }
  }

  logger.success('COMPLIANCE_APPROVE', `Sale ${id} approved by ${userId}`);
  res.json({ sale: updated });
}));

// ============================================================================
// POST /sales/:id/compliance-return — Compliance returns sale to closer with note
// ============================================================================
router.post('/:id/compliance-return', [
  body('note').isString().trim().notEmpty().withMessage('A note explaining what needs to change is required').isLength({ max: 2000 }).withMessage('Note must be 2000 characters or fewer'),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

  const userId   = req.user.id;
  const userRole = req.user.role;
  const { id }   = req.params;
  const { note } = req.body;

  if (userRole !== 'compliance_manager' && userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Only compliance managers can return sales' });
  }

  const { data: sale, error } = await supabaseAdmin
    .from('sales').select('*').eq('id', id).single();
  if (error || !sale) return res.status(404).json({ error: 'Sale not found' });

  if (sale.status !== 'pending_review') {
    return res.status(400).json({ error: `Sale must be in "pending_review" status to return (current: ${sale.status})` });
  }

  const now = new Date().toISOString();
  const currentHistory = Array.isArray(sale.edit_history) ? sale.edit_history : [];
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('sales')
    .update({
      status: 'needs_revision',
      compliance_note: note,
      compliance_reviewed_by: userId,
      compliance_reviewed_at: now,
      updated_at: now,
      edit_history: [...currentHistory, {
        editor_id: userId,
        role: 'compliance_manager',
        action: 'returned',
        previous_status: 'pending_review',
        new_status: 'needs_revision',
        note,
        edited_at: now,
      }],
    })
    .eq('id', id)
    .select()
    .single();

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const reviewerName = authUser?.user?.user_metadata?.first_name || authUser?.user?.email || 'Compliance';
  notifications.onSaleReturned({ sale: updated, reviewerName, note }).catch(() => {});

  // Auto-log "Needs Revision" disposition on the linked transfer (await — the
  // query builder has no .catch; swallow logging errors without 500ing the return).
  if (sale.transfer_id) {
    try {
      await supabaseAdmin.from('disposition_actions').insert({
        transfer_id:      sale.transfer_id,
        company_id:       sale.company_id,
        user_id:          userId,
        disposition_name: 'Needs Revision',
        color:            '#ef4444',
        note:             note,
        setter_role:      userRole,
      });
    } catch (err) { logger.error('DISPO_AUTO', 'return dispo log failed', err); }
  }

  logger.success('COMPLIANCE_RETURN', `Sale ${id} returned by ${userId} with note`);
  res.json({ sale: updated });
}));

// ============================================================================
// POST /sales/:id/compliance — Compliance manager edits sale with mandatory reason
// Only compliance_manager role (in biztrixventure) can call this.
// ============================================================================
router.post('/:id/compliance', [
  body('status').optional().isString(),
  body('reason').isString().notEmpty().withMessage('Reason is required for compliance updates'),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

  const userId   = req.user.id;
  const userRole = req.user.role;

  if (userRole !== 'compliance_manager' && userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Only compliance managers can use this endpoint' });
  }

  const { id } = req.params;
  const { reason, status, cancellation_date, ...otherFields } = req.body;

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('sales').select('*').eq('id', id).single();
  if (fetchErr || !existing) return res.status(404).json({ error: 'Sale not found' });

  const COMPLIANCE_STATUSES = ['cancelled', 'compliance_cancelled', 'dispute', 'chargeback', 'open', 'sold', 'follow_up', 'closed_won', 'closed_lost'];
  const CANCEL_LIKE = new Set(['cancelled', 'compliance_cancelled', 'closed_lost', 'chargeback', 'dispute']);
  // G24 — statuses where compliance is terminally adjudicating the row.
  // We stamp compliance_locked_at on transition so closers can't revert.
  const TERMINAL_LOCK = new Set(['compliance_cancelled', 'chargeback', 'dispute']);

  if (status && !COMPLIANCE_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status', allowed: COMPLIANCE_STATUSES });
  }

  // G28 — when applying a cancel-like status, require a canonical reason key
  // alongside the free-text reason so top-reason reports work. Aligns the
  // single-sale path with the bulk path (which already enforces this).
  const reasonKeyIn = req.body?.cancellation_reason_key;
  if (status && CANCEL_LIKE.has(status) && !String(reasonKeyIn || '').trim()) {
    return res.status(400).json({ error: 'A canonical cancellation_reason_key is required when applying a cancellation status. Pick from the cancellation_reasons catalog.' });
  }

  // Normalize cancellation_date to YYYY-MM-DD (or null). Accepts ISO,
  // M/D/YYYY, MM/DD/YYYY. Bad input → 400 so the operator sees the rule.
  let normCancelDate;
  if (cancellation_date !== undefined && cancellation_date !== null && cancellation_date !== '') {
    const s = String(cancellation_date).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const us  = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (iso) normCancelDate = iso.slice(1).join('-');
    else if (us) normCancelDate = `${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}`;
    else return res.status(400).json({ error: 'cancellation_date must be YYYY-MM-DD or MM/DD/YYYY' });
  } else if (cancellation_date === null || cancellation_date === '') {
    normCancelDate = null;
  }

  // Build update — only allow specific fields for compliance
  const updates = await stampActor('sales', { updated_at: new Date().toISOString() }, userId);
  if (status) updates.status = status;
  // Write cancellation_date when caller sent one OR when status is
  // cancel-like (then default to today if not provided).
  const isCancelLike = status && CANCEL_LIKE.has(status);
  if (normCancelDate !== undefined) {
    updates.cancellation_date = normCancelDate;
  } else if (isCancelLike && !existing.cancellation_date) {
    updates.cancellation_date = new Date().toISOString().slice(0, 10);
  }
  // G28 — canonical reason key (validator above already enforced it for
  // cancel-like statuses; this just persists what was sent).
  if (reasonKeyIn !== undefined) {
    updates.cancellation_reason_key = String(reasonKeyIn || '').trim() || null;
  }
  // G24 — stamp compliance_locked_at on terminal-lock transition; clear
  // it when compliance restores the row to a non-terminal state so a
  // mistaken cancel can be undone without manual SQL.
  if (status && TERMINAL_LOCK.has(status)) {
    updates.compliance_locked_at = new Date().toISOString();
  } else if (status && existing.compliance_locked_at && !TERMINAL_LOCK.has(status)) {
    updates.compliance_locked_at = null;
  }

  // Append audit entry
  const currentHistory = Array.isArray(existing.edit_history) ? existing.edit_history : [];
  updates.edit_history = [...currentHistory, {
    editor_id: userId,
    role:      'compliance_manager',
    reason,
    previous_status:   existing.status,
    new_status:        status || existing.status,
    cancellation_date: updates.cancellation_date ?? null,
    edited_at:         new Date().toISOString(),
  }];

  let { data: updated, error: updateErr } = await supabaseAdmin
    .from('sales').update(updates).eq('id', id).select().single();

  // Survive deployments where mig 075 hasn't landed yet — strip
  // cancellation_date and retry once.
  if (updateErr && 'cancellation_date' in updates && (
    updateErr.code === '42703' ||
    /cancellation_date/i.test(String(updateErr.message || ''))
  )) {
    const { cancellation_date: _, ...withoutCancel } = updates;
    const r2 = await supabaseAdmin.from('sales').update(withoutCancel).eq('id', id).select().single();
    updated = r2.data; updateErr = r2.error;
  }

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  // Notify managers
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const editorName = authUser?.user?.user_metadata?.first_name || authUser?.user?.email || 'Compliance';
  notifications.onComplianceUpdate({ sale: updated, editorName, reason }).catch(() => {});

  res.json({ sale: updated });
}));

// ============================================================================
// DELETE /sales/:id
// ============================================================================
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    logger.info('DELETE_SALE', `id=${id}, user=${userId}`);

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('sales').select('*').eq('id', id).single();
    if (fetchError || !existing) return res.status(404).json({ error: 'Sale not found' });

    const isCreator = existing.created_by === userId || existing.closer_id === userId;
    const isManager = ['superadmin', 'readonly_admin', 'company_admin', 'manager', 'fronter_manager', 'operations_manager', 'closer_manager', 'compliance_manager'].includes(userRole);
    const isCompliance = userRole === 'compliance_manager' || userRole === 'superadmin';
    if (!isCreator && !isManager) return res.status(403).json({ error: 'Permission denied' });

    // Company scope guard: managers can only delete sales in their own company
    // (compliance + superadmin see all). Mirrors the PUT handler's scope check.
    if (isManager && !isCompliance && !isCreator && existing.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Sale not within your company scope' });
    }

    const { error: deleteError } = await supabaseAdmin.from('sales').delete().eq('id', id);
    if (deleteError) return res.status(500).json({ error: deleteError.message });

    logger.success('DELETE_SALE', `Sale deleted: ${id}`);
    res.json({ message: 'Sale deleted successfully' });
  })
);

// ============================================================================
// POST /sales/:id/resell — resell an existing sale on the same transfer.
// Body: { intent: string, reason?: string }
// Behavior:
//   resell        → old sale.status = compliance_cancelled, new sale = open
//   additional_car→ old sale untouched, new sale = open (different car)
//   renewal       → old sale.status = expired (if not terminal), new sale = open
//   other / *     → treated as 'resell'
// Config gates:
//   resell.enabled_statuses  → old sale's current status must be in this list
//   resell.warning_statuses  → if old status is in this list, reason is required
//   resell.cooldown_days     → minimum gap since the last resell on this sale
//   resell.require_reason_text → reason mandatory regardless of status
//   resell.auto_block_after_chargebacks → block if this customer has been
//                              chargebacked at least N times
// ============================================================================
router.post('/:id/resell', [
  body('intent').isString().trim().notEmpty().withMessage('intent is required'),
  body('reason').optional().isString().trim(),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

  const { id } = req.params;
  const userId   = req.user.id;
  const userRole = req.user.role;
  const intent   = req.body.intent;
  const reason   = (req.body.reason || '').trim();

  // ── Permission: closer (on their own sale), closer manager, superadmin ───
  if (!['closer', 'closer_manager', 'company_admin', 'operations_manager', 'compliance_manager', 'superadmin', 'readonly_admin'].includes(userRole)) {
    return res.status(403).json({ error: 'Resell is restricted to closer-side roles.' });
  }

  // ── Load the source sale ─────────────────────────────────────────────────
  const { data: old, error: fetchErr } = await supabaseAdmin
    .from('sales').select('*').eq('id', id).single();
  if (fetchErr || !old) return res.status(404).json({ error: 'Sale not found' });

  if (userRole === 'closer' && old.closer_id !== userId) {
    return res.status(403).json({ error: 'You can only resell your own sales.' });
  }

  const companyId = old.company_id;

  // ── Config-driven eligibility checks ─────────────────────────────────────
  const enabled = (await getConfig(companyId, 'resell.enabled_statuses', [])) || [];
  const warning = (await getConfig(companyId, 'resell.warning_statuses', [])) || [];
  const cooldownDays = parseInt(await getConfig(companyId, 'resell.cooldown_days', 7), 10) || 0;
  const requireReasonGlobal = !!(await getConfig(companyId, 'resell.require_reason_text', false));
  const autoBlockN  = parseInt(await getConfig(companyId, 'resell.auto_block_after_chargebacks', 2), 10) || 0;

  if (!enabled.includes(old.status)) {
    return res.status(400).json({ error: `Resell not allowed from status "${old.status}". Adjust Business Rules → Resell to enable.` });
  }
  if (requireReasonGlobal && !reason) {
    return res.status(400).json({ error: 'Reason text is required (configured in Business Rules).' });
  }
  if (warning.includes(old.status) && !reason) {
    return res.status(400).json({ error: `Status "${old.status}" requires a written reason for resell.` });
  }

  // Cooldown — block if another resell of this sale happened within N days
  if (cooldownDays > 0) {
    const cutoff = new Date(Date.now() - cooldownDays * 86400000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from('sales').select('id, created_at')
      .eq('original_sale_id', old.id)
      .gte('created_at', cutoff)
      .limit(1);
    if (recent && recent.length) {
      return res.status(429).json({ error: `Cooldown active — last resell of this sale was within ${cooldownDays} day(s). Try again later.` });
    }
  }

  // Auto-block on repeat chargebacks (same customer phone)
  if (autoBlockN > 0 && old.customer_phone) {
    const { count: cbCount } = await supabaseAdmin
      .from('sales').select('id', { count: 'exact', head: true })
      .eq('customer_phone', old.customer_phone)
      .eq('status', 'chargeback');
    if ((cbCount || 0) >= autoBlockN && userRole !== 'superadmin') {
      return res.status(403).json({ error: `Customer is auto-blocked after ${cbCount} chargeback(s). Manager override required.` });
    }
  }

  // ── Build new sale row ──────────────────────────────────────────────────
  // Copy customer + (for resell/renewal) vehicle. additional_car clears
  // vehicle so closer fills fresh. Status starts open so closer can finish
  // entering policy before submitting to compliance.
  const isAdditional = intent === 'additional_car';
  // Initial status — config-driven via compliance.resell_initial_status.
  // Default 'pending_review' shoves the new sale straight to compliance; 'open'
  // lets the closer keep editing before submitting.
  const initialStatus = await getConfig(companyId, 'compliance.resell_initial_status', 'pending_review');
  const newRow = {
    transfer_id:      old.transfer_id,
    company_id:       old.company_id,
    fronter_id:       old.fronter_id,         // audit only; attribution gated by config
    closer_id:        userId,
    created_by:       userId,
    customer_name:    old.customer_name,
    customer_phone:   old.customer_phone,
    customer_phone_2: old.customer_phone_2,
    customer_email:   old.customer_email,
    customer_address: old.customer_address,
    reference_no:     generateReferenceNo(),
    sale_date:        new Date().toISOString().slice(0, 10),
    status:           initialStatus,
    is_resell:        true,
    original_sale_id: old.id,
    resell_intent:    intent,
    resell_reason:    reason || null,
    // G19 — preserve lifetime-customer fronter credit across resells.
    // If the old row was itself a resell, walk its chain; else use its
    // fronter_id as the original. New resell rows always know who first
    // brought this customer, even after re-fronts.
    original_fronter_id: old.original_fronter_id || old.fronter_id || null,
    // vehicle: carry over for resell/renewal, blank for additional_car
    car_year:  isAdditional ? null : old.car_year,
    car_make:  isAdditional ? null : old.car_make,
    car_model: isAdditional ? null : old.car_model,
    car_vin:   isAdditional ? null : old.car_vin,
    car_miles: isAdditional ? null : old.car_miles,
    // policy fields stay blank — closer fills before submit
  };

  const stampedNew = await stampActor('sales', newRow, userId);
  const { data: created, error: insertErr } = await supabaseAdmin
    .from('sales').insert(stampedNew).select().single();
  if (insertErr) {
    logger.error('RESELL', `insert failed: ${insertErr.message}`);
    return res.status(500).json({ error: insertErr.message });
  }

  // ── Flip old sale's status (only when intent semantically replaces) ─────
  let oldStatusNext = null;
  if (intent === 'resell' || intent === 'other') oldStatusNext = 'compliance_cancelled';
  else if (intent === 'renewal' && !['expired', 'compliance_cancelled', 'cancelled'].includes(old.status)) {
    oldStatusNext = 'expired';
  }

  if (oldStatusNext) {
    const history = Array.isArray(old.edit_history) ? old.edit_history : [];
    const patch = {
      status:     oldStatusNext,
      updated_at: new Date().toISOString(),
      edit_history: [...history, {
        editor_id: userId,
        role:      'resell',
        action:    `status:${old.status}→${oldStatusNext}`,
        intent,
        new_sale_id: created.id,
        reason:    reason || null,
        edited_at: new Date().toISOString(),
      }],
    };
    const stampedOld = await stampActor('sales', patch, userId);
    await supabaseAdmin.from('sales').update(stampedOld).eq('id', old.id);
  }

  // ── Disposition log entry (visible in lead intelligence + audit) ────────
  try {
    await supabaseAdmin.from('disposition_actions').insert({
      transfer_id: old.transfer_id,
      company_id:  old.company_id,
      user_id:     userId,
      disposition_name: `Resell: ${intent}`,
      color:       '#6366f1',
      note:        reason ? `Resell intent=${intent}, ref=${created.reference_no}: ${reason}` : `Resell intent=${intent}, new ref=${created.reference_no}`,
      setter_role: 'closer',
    });
  } catch (e) { logger.warn('RESELL', `disposition log failed: ${e.message}`); }

  // Notifications — config-gated fanout (see notificationService.onResellCreated)
  try {
    const { data: closerProfile } = await supabaseAdmin
      .from('user_profiles').select('first_name, last_name').eq('user_id', userId).maybeSingle();
    const closerName = [closerProfile?.first_name, closerProfile?.last_name].filter(Boolean).join(' ') || 'A closer';
    notifications.onResellCreated({ newSale: created, oldSale: old, closerName, intent }).catch(() => {});
  } catch { /* non-critical */ }

  logger.success('RESELL', `sale ${old.id} → new sale ${created.id} (intent=${intent})`);
  res.json({
    ok: true,
    sale: created,
    old_sale: { id: old.id, status: oldStatusNext || old.status },
  });
}));

module.exports = router;
