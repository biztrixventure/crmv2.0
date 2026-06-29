/**
 * Feature gate helper for backend routes.
 * Checks whether a feature is enabled for a given company.
 * Falls back to the feature's default_enabled if no company override exists.
 */
const { supabaseAdmin } = require('../config/database');

/**
 * Returns true if the feature is enabled for this company.
 * @param {string} featureKey
 * @param {string|null} companyId
 */
async function isFeatureEnabled(featureKey, companyId, userId) {
  // Per-USER override wins over the company override (migration 122).
  // Company-TOLERANT: resolve by user_id, prefer the row matching this company
  // but accept any of the user's rows. Per-user flags (custom_workspace, tool_*)
  // are about the person, and companyId may be null or differ from the grant.
  if (userId) {
    const { data: uos } = await supabaseAdmin
      .from('user_feature_flags')
      .select('is_enabled, company_id')
      .eq('user_id', userId)
      .eq('feature_key', featureKey);
    if (uos && uos.length) {
      const match = uos.find(u => u.company_id === companyId);
      return (match || uos[0]).is_enabled;
    }
  }

  // Fetch override for this company
  if (companyId) {
    const { data: override } = await supabaseAdmin
      .from('company_feature_flags')
      .select('is_enabled')
      .eq('company_id', companyId)
      .eq('feature_key', featureKey)
      .maybeSingle();

    if (override !== null) return override.is_enabled;
  }

  // Fall back to global default
  const { data: flag } = await supabaseAdmin
    .from('feature_flags')
    .select('default_enabled')
    .eq('key', featureKey)
    .maybeSingle();

  return flag?.default_enabled ?? true; // assume enabled if flag doesn't exist yet
}

/**
 * Express middleware that blocks a route if the feature is disabled for the user's company.
 * Usage: router.post('/', requireFeature('callbacks'), handler)
 */
function requireFeature(featureKey) {
  return async (req, res, next) => {
    try {
      // Superadmin bypasses all feature gates
      if (req.user?.role === 'superadmin') return next();

      const companyId = req.user?.company_id || null;
      const enabled   = await isFeatureEnabled(featureKey, companyId, req.user?.id);
      if (!enabled) {
        return res.status(403).json({ error: `Feature '${featureKey}' is not enabled for your company` });
      }
      next();
    } catch (err) {
      // Fail closed: if the gate can't be evaluated, deny rather than expose a
      // potentially-disabled feature. Surface the error for debugging.
      return res.status(503).json({ error: 'Feature availability could not be verified' });
    }
  };
}

/**
 * Gate a superadmin tool so it can be DELEGATED via a feature flag.
 * superadmin (and, by default, readonly_admin) always pass. Everyone else passes
 * only when the tool's feature flag is enabled for their user/company.
 * Usage: router.use(requireToolAccess('tool_customer_profiles'))
 */
function requireToolAccess(featureKey, { allowReadonly = true } = {}) {
  return async (req, res, next) => {
    try {
      const role = req.user?.role;
      if (role === 'superadmin' || (allowReadonly && role === 'readonly_admin')) return next();
      const { isSuperAdmin } = require('../models/helpers');
      if (await isSuperAdmin(req.user?.id)) return next();

      // Fail CLOSED if the flag isn't catalogued yet (migration not applied):
      // isFeatureEnabled() assumes-enabled for unknown keys, which would hand
      // every user these tools. A tool the catalog doesn't know = denied.
      const { data: flagRow } = await supabaseAdmin
        .from('feature_flags').select('key').eq('key', featureKey).maybeSingle();
      if (!flagRow) return res.status(403).json({ error: 'This tool is not available' });

      const ok = await isFeatureEnabled(featureKey, req.user?.company_id || null, req.user?.id);
      if (!ok) return res.status(403).json({ error: 'Access to this tool is not enabled for your account' });
      next();
    } catch (err) {
      return res.status(503).json({ error: 'Access could not be verified' });
    }
  };
}

module.exports = { isFeatureEnabled, requireFeature, requireToolAccess };
