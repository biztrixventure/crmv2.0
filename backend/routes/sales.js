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

const router = express.Router();

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
    .select('id,customer_name,customer_phone,customer_email,reference_no,car_year,car_make,car_model,car_vin,status,monthly_payment,sale_date,closer_id,fronter_id,plan,client_name,created_at', { count: 'exact' });
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
    const { status, search, page = 1, limit = 50, date_from, date_to, user_id, sort_by, sort_dir } = req.query;

    logger.info('GET_SALES', `user=${userId}, role=${userRole}, company=${companyId}`);

    let query = applySort(
      supabaseAdmin.from('sales').select(`*, transfers(id, form_data, status, created_by)`, { count: 'exact' }),
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
    if (date_from) query = query.gte('created_at', etDateToUtcStart(date_from));
    if (date_to)   query = query.lte('created_at', etDateToUtcEnd(date_to));
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
      sale_date, status, form_data, closer_disposition,
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
      const transferUpdates = { status: 'completed', updated_at: new Date().toISOString(), last_modified_by: userId };
      if (!transfer.assigned_closer_id) {
        transferUpdates.assigned_closer_id = userId;
        transferUpdates.assigned_to        = userId;
      }
      await supabaseAdmin.from('transfers').update(transferUpdates).eq('id', transfer_id);
    }

    const saleDate = sale_date || new Date().toISOString().split('T')[0];

    // Shared customer/identity columns — identical across every car for this sale.
    const sharedCols = {
      transfer_id: transfer_id || null,
      created_by:  userId,
      last_modified_by: userId,
      closer_id:   userId,
      company_id:  companyId,
      status:      status || 'open',
      customer_name:    titleCase(customer_name),
      customer_phone,
      customer_phone_2: customer_phone_2 || null,
      customer_email:   customer_email   || null,
      customer_address: customer_address || null,
      client_name: titleCase(client_name) || null,
      fronter_id:  fronter_id  || null,
      sale_date:   saleDate,
    };

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
  if (date_from)  query = query.gte('created_at', etDateToUtcStart(date_from));
  if (date_to)    query = query.lte('created_at', etDateToUtcEnd(date_to));

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
    if (!isCreator && !isManager) return res.status(403).json({ error: 'Permission denied' });

    // Company scope: managers can only edit sales in their own company (compliance sees all)
    if (isManager && !isCompliance && existing.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Sale not within your company scope' });
    }

    // Block edits to sales under compliance review (except by compliance/superadmin)
    if (existing.status === 'pending_review' && !isCompliance) {
      return res.status(403).json({ error: 'This sale is under compliance review and cannot be edited' });
    }

    // Block edits to finalized sales (except by compliance/superadmin)
    if (['closed_won', 'closed_lost'].includes(existing.status) && !isCompliance) {
      return res.status(403).json({ error: 'This sale has been finalized and cannot be edited' });
    }

    const {
      status, customer_name, customer_phone, customer_phone_2, customer_email, customer_address,
      car_year, car_make, car_model, car_miles, car_vin,
      plan, down_payment, monthly_payment, payment_due_note,
      reference_no, client_name, fronter_id, sale_date, form_data, closer_disposition,
    } = req.body;

    const validStatuses = ['open', 'sold', 'cancelled', 'follow_up', 'closed_won', 'closed_lost'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status', allowed: validStatuses });
    }
    if (status && ['closed_won', 'closed_lost'].includes(status) && !isCompliance) {
      return res.status(400).json({ error: 'This status can only be set through the compliance workflow' });
    }

    const updates = { updated_at: new Date().toISOString(), last_modified_by: userId };
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

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('sales').update(updates).eq('id', id).select().single();

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
  const { reason, status, ...otherFields } = req.body;

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('sales').select('*').eq('id', id).single();
  if (fetchErr || !existing) return res.status(404).json({ error: 'Sale not found' });

  const COMPLIANCE_STATUSES = ['cancelled', 'compliance_cancelled', 'dispute', 'chargeback', 'open', 'sold', 'follow_up', 'closed_won', 'closed_lost'];

  if (status && !COMPLIANCE_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status', allowed: COMPLIANCE_STATUSES });
  }

  // Build update — only allow specific fields for compliance
  const updates = { updated_at: new Date().toISOString(), last_modified_by: userId };
  if (status) updates.status = status;

  // Append audit entry
  const currentHistory = Array.isArray(existing.edit_history) ? existing.edit_history : [];
  updates.edit_history = [...currentHistory, {
    editor_id: userId,
    role:      'compliance_manager',
    reason,
    previous_status: existing.status,
    new_status:      status || existing.status,
    edited_at:       new Date().toISOString(),
  }];

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('sales').update(updates).eq('id', id).select().single();

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

module.exports = router;
