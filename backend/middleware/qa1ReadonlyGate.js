// ============================================================================
// qa1ReadonlyGate.js — the v1→v2 cutover gate (build brief section 11).
// Mounted AHEAD of routes/qa.js in server.js — v1 itself is never touched.
//
// The clock does NOT start on deploy. business_config global key
// 'qa.v1_freeze_at' is unset by default (same "off until configured" posture
// as every other gate in this codebase), so v1 stays fully writable until a
// superadmin explicitly sets a cutover date via POST /qa2/org/v1-freeze —
// code shipping and the business being ready to cut over are different
// events. Once that date passes, WRITES to /api/qa/* are blocked; GETs
// always pass through, so v1's history stays viewable forever.
// ============================================================================

const { getConfig } = require('../utils/businessConfig');
const logger = require('../utils/logger');

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function qa1ReadonlyGate(req, res, next) {
  if (!WRITE_METHODS.has(req.method)) return next();
  try {
    const freezeAt = await getConfig(null, 'qa.v1_freeze_at', null);
    if (!freezeAt) return next();
    if (new Date(freezeAt).getTime() > Date.now()) return next();
    return res.status(423).json({
      error: 'QA v1 is now read-only — this org has moved to QA v2. Past reviews stay visible here; new work happens in QA v2.',
      qa2_cutover: true,
    });
  } catch (e) {
    // A config-lookup failure must never block v1 — fail open.
    logger.warn('QA1_GATE', `freeze check failed, allowing through: ${e.message}`);
    return next();
  }
}

module.exports = qa1ReadonlyGate;
