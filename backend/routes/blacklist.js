// ============================================================================
// routes/blacklist.js — DNC / litigation lookup proxy + settings.
//   GET  /blacklist/lookup/:phone   check one number (closer + compliance, gated)
//   GET  /blacklist/settings        superadmin: enabled + cache + key status
//   PUT  /blacklist/settings        superadmin: set enabled / cache / API key
// The API key never leaves the server; settings only ever return a masked tail.
// ============================================================================
const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { getConfig, setConfig } = require('../utils/businessConfig');
const { isFeatureEnabled } = require('../utils/featureGate');
const bl = require('../utils/blacklist');

const router = express.Router();

const VALID_VERSIONS = ['v1', 'v2', 'v3', 'v5'];
const maskedSettings = async () => {
  const key = await bl.getApiKey();
  const v = String(await getConfig(null, 'blacklist.version', 'v3'));
  return {
    enabled:    !!(await getConfig(null, 'blacklist.enabled', false)),
    cache_days: parseInt(await getConfig(null, 'blacklist.cache_days', 30), 10) || 30,
    version:    VALID_VERSIONS.includes(v) ? v : 'v3',
    has_key:    !!key,
    key_preview: key ? `••••${String(key).slice(-4)}` : null,
  };
};

// ── GET /lookup/:phone ───────────────────────────────────────────────────────
router.get('/lookup/:phone', asyncHandler(async (req, res) => {
  const sa = await isSuperAdmin(req.user.id);
  const enabled = sa || await isFeatureEnabled('tool_blacklist_lookup', req.user.company_id || null, req.user.id).catch(() => false);
  if (!enabled) return res.status(403).json({ error: 'Blacklist lookup is not enabled for you' });

  const r = await bl.lookup(req.params.phone, { force: sa && req.query.refresh === 'true' });
  if (!r.ok) {
    const code = /invalid phone/i.test(r.error) ? 422 : (/api key/i.test(r.error) ? 503 : 400);
    return res.status(code).json({ error: r.error });
  }
  res.json(r);
}));

// ── GET/PUT /settings (superadmin) ───────────────────────────────────────────
router.get('/settings', asyncHandler(async (req, res) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin only' });
  res.json(await maskedSettings());
}));

router.put('/settings', asyncHandler(async (req, res) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin only' });
  const b = req.body || {};
  if (b.enabled !== undefined)    await setConfig('global', 'blacklist.enabled', !!b.enabled, req.user.id);
  if (b.cache_days !== undefined) await setConfig('global', 'blacklist.cache_days', Math.max(1, Math.min(parseInt(b.cache_days, 10) || 30, 365)), req.user.id);
  if (b.version !== undefined && VALID_VERSIONS.includes(String(b.version))) await setConfig('global', 'blacklist.version', String(b.version), req.user.id);
  if (b.clear_key) {
    await bl.setApiKey('', req.user.id);
  } else if (typeof b.api_key === 'string' && b.api_key.trim()) {
    await bl.setApiKey(b.api_key.trim(), req.user.id);
    // Saving a key activates the feature unless the same request explicitly
    // disabled it — removes the "added the key but still off" foot-gun.
    if (b.enabled === undefined) await setConfig('global', 'blacklist.enabled', true, req.user.id);
  }
  res.json(await maskedSettings());
}));

module.exports = router;
