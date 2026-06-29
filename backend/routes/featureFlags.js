/**
 * Feature Flags — per-company feature management
 *
 * Tables (migration 021):
 *   feature_flags             — global catalog (key, label, description, category, default_enabled)
 *   company_feature_flags     — per-company enabled/disabled state
 *
 * Routes:
 *   GET    /feature-flags                            — current user's company flags (all roles)
 *   GET    /feature-flags/catalog                    — full catalog (superadmin)
 *   POST   /feature-flags                            — create flag definition (superadmin)
 *   PUT    /feature-flags/:key                       — update flag metadata (superadmin)
 *   DELETE /feature-flags/:key                       — delete flag (superadmin)
 *   GET    /feature-flags/companies                  — all companies × all flags matrix (superadmin)
 *   GET    /feature-flags/companies/:companyId       — flags for one company (superadmin)
 *   PUT    /feature-flags/companies/:companyId/:key  — toggle flag for a company (superadmin)
 */

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const isSA = (user) => user?.role === 'superadmin';

// superadmin, OR a user granted the per-company feature-flag matrix via the
// 'tool_feature_admin' flag (Custom Access workspace). Catalog CRUD (create /
// edit / delete flags) stays superadmin-only. Fail closed if flag uncatalogued.
const { isFeatureEnabled } = require('../utils/featureGate');
const canFeatureAdmin = async (req) => {
  if (isSA(req.user)) return true;
  const { data: flagRow } = await supabaseAdmin.from('feature_flags').select('key').eq('key', 'tool_feature_admin').maybeSingle();
  if (!flagRow) return false;
  return isFeatureEnabled('tool_feature_admin', req.user?.company_id || null, req.user?.id);
};

// ── GET /feature-flags — current user's company flag states (all roles) ──────
router.get('/', asyncHandler(async (req, res) => {
  const companyId = req.user.company_id;

  const { data: catalog, error: catErr } = await supabaseAdmin
    .from('feature_flags')
    .select('key, label, description, category, default_enabled, sort_order')
    .order('sort_order');
  if (catErr) return res.status(500).json({ error: catErr.message });

  if (!companyId) {
    const flags = {};
    (catalog || []).forEach(f => { flags[f.key] = { ...f, is_enabled: f.default_enabled }; });
    return res.json({ flags });
  }

  const { data: overrides } = await supabaseAdmin
    .from('company_feature_flags')
    .select('feature_key, is_enabled')
    .eq('company_id', companyId);

  const overrideMap = {};
  (overrides || []).forEach(o => { overrideMap[o.feature_key] = o.is_enabled; });

  // Per-USER overrides win over the company override (migration 122). If the
  // table isn't there yet, userOv is null and we fall through unchanged.
  const { data: userOv } = await supabaseAdmin
    .from('user_feature_flags')
    .select('feature_key, is_enabled')
    .eq('user_id', req.user.id)
    .eq('company_id', companyId);
  const userMap = {};
  (userOv || []).forEach(o => { userMap[o.feature_key] = o.is_enabled; });

  const flags = {};
  (catalog || []).forEach(f => {
    const resolved = userMap[f.key] !== undefined ? userMap[f.key]
      : overrideMap[f.key] !== undefined ? overrideMap[f.key]
      : f.default_enabled;
    flags[f.key] = { ...f, is_enabled: resolved };
  });

  res.json({ flags });
}));

// ── GET /feature-flags/catalog — full catalog (superadmin) ───────────────────
router.get('/catalog', asyncHandler(async (req, res) => {
  if (!(await canFeatureAdmin(req))) return res.status(403).json({ error: 'Feature-flag admin access required' });

  const { data, error } = await supabaseAdmin
    .from('feature_flags')
    .select('*')
    .order('sort_order');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ flags: data || [] });
}));

// ── GET /feature-flags/companies — all companies × all flags matrix ───────────
router.get('/companies', asyncHandler(async (req, res) => {
  if (!(await canFeatureAdmin(req))) return res.status(403).json({ error: 'Feature-flag admin access required' });

  const [catalogRes, companiesRes, overridesRes] = await Promise.all([
    supabaseAdmin.from('feature_flags').select('key, label, description, category, default_enabled, sort_order').order('sort_order'),
    supabaseAdmin.from('companies').select('id, name, company_type, is_active').order('name'),
    supabaseAdmin.from('company_feature_flags').select('company_id, feature_key, is_enabled, enabled_at, enabled_by, disabled_at, disabled_by'),
  ]);

  if (catalogRes.error)   return res.status(500).json({ error: catalogRes.error.message });
  if (companiesRes.error) return res.status(500).json({ error: companiesRes.error.message });

  const catalog   = catalogRes.data   || [];
  const companies = companiesRes.data || [];

  const overrideMap = {};
  (overridesRes.data || []).forEach(o => {
    if (!overrideMap[o.company_id]) overrideMap[o.company_id] = {};
    overrideMap[o.company_id][o.feature_key] = o;
  });

  const matrix = companies.map(company => {
    const flags = {};
    catalog.forEach(f => {
      const ov = overrideMap[company.id]?.[f.key];
      flags[f.key] = {
        is_enabled:  ov ? ov.is_enabled : f.default_enabled,
        enabled_at:  ov?.enabled_at  || null,
        disabled_at: ov?.disabled_at || null,
      };
    });
    return { ...company, flags };
  });

  res.json({ catalog, companies: matrix });
}));

// ── GET /feature-flags/companies/:companyId — flags for one company ───────────
router.get('/companies/:companyId',
  param('companyId').isUUID(),
  asyncHandler(async (req, res) => {
    if (!(await canFeatureAdmin(req))) return res.status(403).json({ error: 'Feature-flag admin access required' });

    const { companyId } = req.params;

    const [catalogRes, companyRes, overridesRes] = await Promise.all([
      supabaseAdmin.from('feature_flags').select('*').order('sort_order'),
      supabaseAdmin.from('companies').select('id, name, company_type').eq('id', companyId).single(),
      supabaseAdmin.from('company_feature_flags').select('*').eq('company_id', companyId),
    ]);

    if (companyRes.error) return res.status(404).json({ error: 'Company not found' });

    const overrideMap = {};
    (overridesRes.data || []).forEach(o => { overrideMap[o.feature_key] = o; });

    const flags = (catalogRes.data || []).map(f => ({
      ...f,
      is_enabled:      overrideMap[f.key] ? overrideMap[f.key].is_enabled : f.default_enabled,
      enabled_at:      overrideMap[f.key]?.enabled_at  || null,
      disabled_at:     overrideMap[f.key]?.disabled_at || null,
      override_exists: !!overrideMap[f.key],
    }));

    res.json({ company: companyRes.data, flags });
  })
);

// ── PUT /feature-flags/companies/:companyId/:key — toggle for a company ───────
router.put('/companies/:companyId/:key',
  [param('companyId').isUUID(), body('is_enabled').isBoolean()],
  asyncHandler(async (req, res) => {
    if (!(await canFeatureAdmin(req))) return res.status(403).json({ error: 'Feature-flag admin access required' });

    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { companyId, key } = req.params;
    const { is_enabled } = req.body;
    const now     = new Date().toISOString();
    const actorId = req.user.id;

    const [flagRow, companyRow] = await Promise.all([
      supabaseAdmin.from('feature_flags').select('key').eq('key', key).single(),
      supabaseAdmin.from('companies').select('id, name').eq('id', companyId).single(),
    ]);

    if (!flagRow.data)    return res.status(404).json({ error: 'Feature flag not found' });
    if (!companyRow.data) return res.status(404).json({ error: 'Company not found' });

    const updates = is_enabled
      ? { is_enabled: true,  enabled_at: now,  enabled_by: actorId, disabled_at: null, disabled_by: null, updated_at: now }
      : { is_enabled: false, disabled_at: now, disabled_by: actorId, updated_at: now };

    const { data, error } = await supabaseAdmin
      .from('company_feature_flags')
      .upsert({ company_id: companyId, feature_key: key, ...updates }, { onConflict: 'company_id,feature_key' })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ flag: data, company: companyRow.data });
  })
);

// ── POST /feature-flags — create flag definition (superadmin) ────────────────
router.post('/',
  [
    body('key').trim().notEmpty().matches(/^[a-z_]+$/).withMessage('key: lowercase letters and underscores only'),
    body('label').trim().notEmpty(),
    body('description').optional().trim(),
    body('category').optional().isIn(['core', 'operations', 'quality', 'analytics', 'admin', 'general']),
    body('default_enabled').optional().isBoolean(),
    body('sort_order').optional().isInt({ min: 0 }),
  ],
  asyncHandler(async (req, res) => {
    if (!isSA(req.user)) return res.status(403).json({ error: 'Superadmin only' });

    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const {
      key, label,
      description    = null,
      category       = 'general',
      default_enabled = false,
      sort_order     = 99,
    } = req.body;

    const { data: existing } = await supabaseAdmin.from('feature_flags').select('key').eq('key', key).single();
    if (existing) return res.status(409).json({ error: `Flag '${key}' already exists` });

    const { data: flag, error } = await supabaseAdmin
      .from('feature_flags')
      .insert({ key, label, description, category, default_enabled, sort_order, created_by: req.user.id })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Backfill all existing active companies with default state
    const { data: companies } = await supabaseAdmin.from('companies').select('id').eq('is_active', true);
    if (companies?.length) {
      const rows = companies.map(c => ({ company_id: c.id, feature_key: key, is_enabled: default_enabled }));
      await supabaseAdmin.from('company_feature_flags').upsert(rows, { onConflict: 'company_id,feature_key', ignoreDuplicates: true });
    }

    res.status(201).json({ flag });
  })
);

// ── PUT /feature-flags/:key — update flag metadata (superadmin) ──────────────
router.put('/:key',
  [
    body('label').optional().trim().notEmpty(),
    body('description').optional(),
    body('category').optional().isIn(['core', 'operations', 'quality', 'analytics', 'admin', 'general']),
    body('default_enabled').optional().isBoolean(),
    body('sort_order').optional().isInt({ min: 0 }),
  ],
  asyncHandler(async (req, res) => {
    if (!isSA(req.user)) return res.status(403).json({ error: 'Superadmin only' });

    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const allowed = ['label', 'description', 'category', 'default_enabled', 'sort_order'];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No fields to update' });

    const { data, error } = await supabaseAdmin
      .from('feature_flags')
      .update(updates)
      .eq('key', req.params.key)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'Feature flag not found' });

    res.json({ flag: data });
  })
);

// ── DELETE /feature-flags/:key — delete flag + company overrides (superadmin) ─
router.delete('/:key', asyncHandler(async (req, res) => {
  if (!isSA(req.user)) return res.status(403).json({ error: 'Superadmin only' });

  const { key } = req.params;

  const { error } = await supabaseAdmin.from('feature_flags').delete().eq('key', key);
  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: `Feature flag '${key}' deleted` });
}));

module.exports = router;
