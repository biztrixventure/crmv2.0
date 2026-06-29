const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { isFeatureEnabled } = require('../utils/featureGate');
const { supabaseAdmin } = require('../config/database');
const { getAllConfig, setConfig, resetConfig } = require('../utils/businessConfig');

const router = express.Router();

// Write gate — only superadmin can change config. Reads are open to any
// authenticated user because the frontend reads runtime flags on every
// dashboard (resell.enabled_statuses, drawer.layout.*, kpi.* …) and those
// must be visible to fronters and closers, not just admins.
const requireSuperAdmin = asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  next();
});

// Keys a delegated Business Rules user (tool_business_rules) must NEVER write —
// these are per-user / access-control config, not "business rules". They stay
// superadmin-only even for a delegate.
const SENSITIVE_KEY = (key) =>
  /^drawer\.layout\.[^.]+\.user\./.test(key) ||      // per-user record-view layouts
  key === 'access_templates' ||
  key === 'record_view_templates' ||
  /^chat\.view_limit\./.test(key) ||                 // delegated chat caps
  /^readonly_admin\.nav\./.test(key);

// May this request write business-config for `key`? superadmin always; a
// tool_business_rules holder may write non-sensitive keys only.
const canWriteConfig = async (req, key) => {
  if (await isSuperAdmin(req.user.id)) return true;
  if (SENSITIVE_KEY(key)) return false;
  const { data: flagRow } = await supabaseAdmin.from('feature_flags').select('key').eq('key', 'tool_business_rules').maybeSingle();
  if (!flagRow) return false;
  return isFeatureEnabled('tool_business_rules', req.user?.company_id || null, req.user?.id);
};

// GET /business-config?company_id=<uuid>   — resolved values (global + override)
// Open to any authenticated user so the UI can render config-driven sections.
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
  if (!(await canWriteConfig(req, key))) {
    return res.status(403).json({ error: 'You do not have permission to change this setting.' });
  }
  await setConfig(scope, key, value, req.user.id);
  res.json({ ok: true });
}));

// DELETE /business-config/:scope/:key  — clear a company override (falls back to global)
router.delete('/:scope/:key', requireSuperAdmin, asyncHandler(async (req, res) => {
  await resetConfig(req.params.scope, req.params.key);
  res.json({ ok: true });
}));

// POST /business-config/clone-global/:companyId  — copy every global default
// into a per-company override block. Lets superadmin set a one-off starting
// point for a new client and then tweak from there. Existing overrides are
// preserved unless overwrite=true.
router.post('/clone-global/:companyId', requireSuperAdmin, asyncHandler(async (req, res) => {
  const { supabaseAdmin } = require('../config/database');
  const { setConfig } = require('../utils/businessConfig');
  const companyId = req.params.companyId;
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) {
    return res.status(400).json({ error: 'Invalid companyId.' });
  }
  const overwrite = req.body?.overwrite === true;

  const { data: globals, error: gErr } = await supabaseAdmin
    .from('business_config').select('key, value').eq('scope', 'global');
  if (gErr) return res.status(500).json({ error: gErr.message });

  const scope = `company:${companyId}`;
  let { data: existing } = await supabaseAdmin
    .from('business_config').select('key').eq('scope', scope);
  const existingKeys = new Set((existing || []).map(r => r.key));

  let copied = 0, skipped = 0;
  for (const row of (globals || [])) {
    if (!overwrite && existingKeys.has(row.key)) { skipped++; continue; }
    await setConfig(scope, row.key, row.value, req.user.id);
    copied++;
  }
  res.json({ ok: true, copied, skipped, scope });
}));

module.exports = router;
