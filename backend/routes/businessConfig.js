const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { getAllConfig, setConfig, resetConfig } = require('../utils/businessConfig');

const router = express.Router();

// Superadmin-only across the whole router.
router.use(asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  next();
}));

// GET /business-config?company_id=<uuid>   — resolved values (global + override)
router.get('/', asyncHandler(async (req, res) => {
  const config = await getAllConfig(req.query.company_id || null);
  res.json({ config });
}));

// PUT /business-config — upsert a single key
// Body: { scope: 'global'|'company:<uuid>', key, value }
router.put('/', asyncHandler(async (req, res) => {
  const { scope, key, value } = req.body || {};
  if (!scope || !key)   return res.status(400).json({ error: 'scope and key are required.' });
  if (value === undefined) return res.status(400).json({ error: 'value is required (null/false/0 are allowed but must be sent).' });
  if (typeof scope !== 'string' || (scope !== 'global' && !/^company:[0-9a-f-]{36}$/i.test(scope))) {
    return res.status(400).json({ error: 'scope must be "global" or "company:<uuid>".' });
  }
  await setConfig(scope, key, value, req.user.id);
  res.json({ ok: true });
}));

// DELETE /business-config/:scope/:key  — clear a company override (falls back to global)
router.delete('/:scope/:key', asyncHandler(async (req, res) => {
  await resetConfig(req.params.scope, req.params.key);
  res.json({ ok: true });
}));

module.exports = router;
