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

  // Fetch both global (null) AND company-specific configs
  query = query.or(`company_id.is.null,company_id.eq.${companyId}`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Deduplicate: company-specific value overrides global if same value
  const seen = new Set();
  const configs = (data || []).filter(c => {
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

    const { data, error } = await supabaseAdmin
      .from('sale_configs')
      .insert({ company_id: companyId, type, value: value.trim(), sort_order })
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

module.exports = router;
