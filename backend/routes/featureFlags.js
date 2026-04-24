const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// GET /feature-flags — all authenticated users (needed by every shell to gate UI)
router.get('/', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('feature_flags')
    .select('key, label, description, is_enabled, enabled_at, enabled_by, disabled_at, disabled_by')
    .order('key');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ flags: data || [] });
}));

// PUT /feature-flags/:key — superadmin only
router.put('/:key', asyncHandler(async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });

  const { key } = req.params;
  const { is_enabled } = req.body;
  if (typeof is_enabled !== 'boolean') return res.status(400).json({ error: 'is_enabled must be boolean' });

  const now = new Date().toISOString();
  const updates = is_enabled
    ? { is_enabled: true,  enabled_at: now,  enabled_by: req.user.id, disabled_at: null, disabled_by: null }
    : { is_enabled: false, disabled_at: now, disabled_by: req.user.id };

  const { data, error } = await supabaseAdmin
    .from('feature_flags')
    .update(updates)
    .eq('key', key)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Feature flag not found' });

  res.json({ flag: data });
}));

module.exports = router;
