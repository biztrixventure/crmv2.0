const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin, hasPermission } = require('../models/helpers');

const router = express.Router();

// ============================================================================
// GET /sale-configs?company_id=...&type=plan|client
// Returns company-specific + global defaults merged, deduped.
// ============================================================================
router.get('/', asyncHandler(async (req, res) => {
  const { type, company_id } = req.query;
  const companyId = company_id || req.user.company_id;

  let query = supabaseAdmin
    .from('sale_configs')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('value',      { ascending: true });

  if (type) query = query.eq('type', type);

  // Fetch global (null) configs + company-specific if company_id present
  if (companyId) {
    query = query.or(`company_id.is.null,company_id.eq.${companyId}`);
  } else {
    query = query.is('company_id', null);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Hidden options are excluded from the form-facing read (default) so they no
  // longer appear on the Sale/Transfer forms; the admin manager passes
  // includeHidden=1 to see + un-hide them. Deduplicate: company-specific value
  // overrides global if same value.
  const includeHidden = req.query.includeHidden === '1' || req.query.includeHidden === 'true';
  const seen = new Set();
  const configs = (data || []).filter(c => {
    if (!includeHidden && c.hidden) return false;
    const key = `${c.type}:${c.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  res.json({ configs });
}));

// ============================================================================
// POST /sale-configs — Add a new plan or client option (SuperAdmin / CompanyAdmin)
// ============================================================================
router.post('/',
  [
    body('type').isIn(['plan', 'client']).withMessage('type must be plan or client'),
    body('value').trim().isLength({ min: 1 }).withMessage('value is required'),
    body('company_id').isUUID().optional(),
    body('sort_order').isInt({ min: 0 }).optional(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { type, value, sort_order = 0 } = req.body;
    const userId    = req.user.id;
    const companyId = req.body.company_id || req.user.company_id;

    // Only superadmin or someone with manage permission can create configs
    const superadmin = await isSuperAdmin(userId);
    const canManage  = superadmin || await hasPermission(userId, companyId, 'manage_forms');
    if (!canManage) return res.status(403).json({ error: 'Insufficient permissions to manage sale configs' });

    // Optional structured metadata (mig 214) — additive; free-text value unchanged.
    const metadata = (req.body.metadata && typeof req.body.metadata === 'object') ? req.body.metadata : undefined;

    const { data, error } = await supabaseAdmin
      .from('sale_configs')
      .insert({ company_id: companyId, type, value: value.trim(), sort_order, ...(metadata !== undefined ? { metadata } : {}) })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: `"${value}" already exists in ${type} list` });
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({ config: data });
  })
);

// ============================================================================
// PUT /sale-configs/:id — Reorder or rename (SuperAdmin / CompanyAdmin)
// ============================================================================
router.put('/:id',
  [
    body('value').trim().optional(),
    body('sort_order').isInt({ min: 0 }).optional(),
  ],
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId  = req.user.id;
    const companyId = req.user.company_id;

    const superadmin = await isSuperAdmin(userId);
    const canManage  = superadmin || await hasPermission(userId, companyId, 'manage_forms');
    if (!canManage) return res.status(403).json({ error: 'Insufficient permissions' });

    const updates = {};
    if (req.body.value !== undefined) updates.value = req.body.value.trim();
    if (req.body.sort_order !== undefined) updates.sort_order = req.body.sort_order;
    if (req.body.hidden !== undefined) updates.hidden = !!req.body.hidden;   // eye-off toggle
    if (req.body.metadata !== undefined) updates.metadata = req.body.metadata;   // structured attrs (mig 214)

    const { data, error } = await supabaseAdmin
      .from('sale_configs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ config: data });
  })
);

// ============================================================================
// DELETE /sale-configs/:id — Remove option (SuperAdmin / CompanyAdmin)
// Sales records that already used this value are NOT affected — value is stored
// on the sale record itself, not as a FK.
// ============================================================================
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId  = req.user.id;
  const companyId = req.user.company_id;

  const superadmin = await isSuperAdmin(userId);
  const canManage  = superadmin || await hasPermission(userId, companyId, 'manage_forms');
  if (!canManage) return res.status(403).json({ error: 'Insufficient permissions' });

  // Prevent deleting global defaults (company_id IS NULL) unless superadmin
  const { data: config } = await supabaseAdmin
    .from('sale_configs')
    .select('company_id')
    .eq('id', id)
    .single();

  if (config?.company_id === null && !superadmin) {
    return res.status(403).json({ error: 'Only Super Admin can delete global defaults' });
  }

  const { error } = await supabaseAdmin.from('sale_configs').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: 'Config deleted. Existing sale records retain their saved value.' });
}));

// ============================================================================
// GET /sale-configs/usage?company_id=... — read-only lifecycle/usage rollup for
// the Clients & Plans command center: how many sales each client (carrier) and
// each plan has, broken down by status, so an admin sees which products are
// actually in use / active. Reads sales only (no writes). SuperAdmin / manage_forms.
// ============================================================================
router.get('/usage', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const companyId = req.query.company_id || null;
  const superadmin = await isSuperAdmin(userId);
  const canManage = superadmin || await hasPermission(userId, companyId || req.user.company_id, 'manage_forms');
  if (!canManage) return res.status(403).json({ error: 'Insufficient permissions' });

  // Plan metadata (mig 214) → revenue/margin/term for lifecycle math. Merge
  // global + company like the catalog read; first value wins (company overrides).
  let mq = supabaseAdmin.from('sale_configs').select('value, metadata, company_id').eq('type', 'plan');
  mq = companyId ? mq.or(`company_id.is.null,company_id.eq.${companyId}`) : mq.is('company_id', null);
  const { data: metaRows } = await mq;
  const planMeta = {};
  for (const r of (metaRows || [])) {
    const k = (r.value || '').toLowerCase();
    // company-specific (non-null company_id) wins over global
    if (!planMeta[k] || r.company_id) planMeta[k] = r.metadata || {};
  }
  const metaOf = (plan) => planMeta[(plan || '').toLowerCase()] || {};

  let q = supabaseAdmin.from('sales').select('client_name, plan, status, sale_date').limit(100000);
  if (companyId) q = q.eq('company_id', companyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const now = Date.now();
  const addMonths = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + (parseInt(m, 10) || 0)); return x; };

  const mk = (k) => ({ value: k, total: 0, active: 0, status: {}, revenue: 0, margin: 0, expiring: 0 });
  const roll = (map, key, s) => {
    const k = key || '(none)';
    const row = (map[k] ||= mk(k));
    row.total += 1;
    row.status[s.status || 'unknown'] = (row.status[s.status || 'unknown'] || 0) + 1;
    if (s.status === 'closed_won') {                       // active policy = closed_won
      row.active += 1;
      const m = metaOf(s.plan);
      const price = Number(m.price) || 0, cost = Number(m.cost) || 0, term = Number(m.term_months) || 0;
      row.revenue += price;
      row.margin  += (price - cost);
      if (term && s.sale_date) {                           // expiring within the next 90 days
        const days = Math.floor((addMonths(s.sale_date, term).getTime() - now) / 86400000);
        if (days >= 0 && days <= 90) row.expiring += 1;
      }
    }
  };
  const byClient = {}, byPlan = {};
  for (const s of (data || [])) { roll(byClient, s.client_name, s); roll(byPlan, s.plan, s); }
  const sort = (m) => Object.values(m).sort((a, b) => b.total - a.total);
  const bp = sort(byPlan), bc = sort(byClient);
  const sum = (rows, f) => rows.reduce((n, r) => n + r[f], 0);

  res.json({
    total: (data || []).length,
    summary: { active: sum(bp, 'active'), revenue: sum(bp, 'revenue'), margin: sum(bp, 'margin'), expiring: sum(bp, 'expiring') },
    byClient: bc, byPlan: bp,
  });
}));

module.exports = router;
