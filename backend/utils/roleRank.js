// ============================================================================
// utils/roleRank.js — the ladder work travels DOWN.
// Lower number = more authority. Numbers only ever flow to a STRICTLY lower
// rank: you cannot load up your own level or anyone above you. A superadmin
// cannot assign to a superadmin, compliance cannot assign to compliance, and a
// fronter manager cannot assign to another fronter manager — only to the agents
// beneath them. Company scoping is a separate, additional gate.
//
// This is deliberately NOT models/helpers.js ROLE_HIERARCHY. That map exists to
// answer "who outranks whom" for permissions and puts compliance_manager on the
// same tier (4) as fronter_manager. For distribution compliance must be able to
// hand work to a fronter manager, so compliance sits above the company roles
// here. Changing the permissions map to match would move authority checks all
// over the app — a separate ladder for a separate question is the safer split.
// ============================================================================
const RANK = {
  superadmin:         0,
  readonly_admin:     1,
  compliance_manager: 2,
  qa_manager:         2,
  company_admin:      3,
  operations_manager: 4,
  closer_manager:     5,
  fronter_manager:    5,
  closer:             6,
  qa_agent:           6,
  fronter:            7,
};
// An unknown/custom role sits at the bottom: it can receive from anyone and can
// assign to nobody. A mislabelled role can never gain reach it should not have.
const UNKNOWN_RANK = 99;

const rankOf = (level) => (level && RANK[level] !== undefined ? RANK[level] : UNKNOWN_RANK);

// Strictly below me. Equal rank is excluded on purpose.
const canAssignTo = (senderLevel, recipientLevel) => rankOf(recipientLevel) > rankOf(senderLevel);

module.exports = { RANK, UNKNOWN_RANK, rankOf, canAssignTo };
