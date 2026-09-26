// ============================================================================
// qaScoreVisibility.js -- may an AGENT see their own QA scores?
//
// The self-view (/qa2/my-scores) shipped gated on one permission,
// qa2.view_own_scores, seeded for fronter and closer. That made "can they see
// scores" a role question answered once for the whole estate, and it is not:
// it is a coaching decision, it differs per company, and it differs between the
// two floors. A fronter handed a raw number with no coach beside it argues with
// the number; a closer usually reviews their own calls anyway.
//
// So the permission still says WHO may ever have the tab, and this switch says
// whether it is on right now:
//
//   business_config  qa.agent_scores  { "fronter": false, "closer": true }
//
// FRONTERS ARE OFF BY DEFAULT -- the explicit ask, and the safer default: a
// score nobody has explained yet is worse than no score. Closers keep what they
// have today, so nothing changes for them until someone turns it off.
//
// Per COMPANY, because business_config resolves company scope first and falls
// back to global (Business Rules -> QA Scores, scope picker at the top).
// ============================================================================
const { getConfig } = require('./businessConfig');

const KEY = 'qa.agent_scores';
const DEFAULTS = { fronter: false, closer: true };

// Which floor is this person on? A trainee is a fronter who has not been signed
// off (mig 311), so they follow the fronter switch -- they are the single most
// likely person to be handed a number without the conversation around it.
function legForRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'closer' || r === 'closer_manager') return 'closer';
  return 'fronter';
}

/**
 * Is the self-score view switched on for this person's floor + company?
 * Returns { visible, leg }. Never throws: a config read that fails falls back
 * to the defaults rather than taking the tab away by accident -- and the
 * fronter default is off either way, so a failure can never expose scores.
 */
async function scoresVisibleFor(req) {
  const leg = legForRole(req?.user?.role);
  try {
    const cfg = await getConfig(req?.user?.company_id || null, KEY, DEFAULTS);
    const merged = { ...DEFAULTS, ...(cfg && typeof cfg === 'object' ? cfg : {}) };
    return { visible: merged[leg] !== false, leg };
  } catch {
    return { visible: DEFAULTS[leg] !== false, leg };
  }
}

module.exports = { scoresVisibleFor, legForRole, KEY, DEFAULTS };
