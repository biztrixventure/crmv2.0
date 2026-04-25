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
async function isFeatureEnabled(featureKey, companyId) {
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
      const companyId = req.user?.company_id || null;
      const enabled   = await isFeatureEnabled(featureKey, companyId);
      if (!enabled) {
        return res.status(403).json({ error: `Feature '${featureKey}' is not enabled for your company` });
      }
      next();
    } catch {
      next(); // on error, allow through (don't block on infra issues)
    }
  };
}

module.exports = { isFeatureEnabled, requireFeature };
