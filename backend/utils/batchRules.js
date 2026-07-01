// ============================================================================
// batchRules — Phase 3 rule evaluation for distribution batches.
// Rules live in business_config ('batch_rules', company→global resolver). The
// heavy check is the app_batch_rule_filter RPC (set-based, migration 156).
// Everything here FAILS OPEN: a rules error never blocks a send.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { getConfig } = require('./businessConfig');

const DEFAULT_RULES = {
  block_reassign_same_person: false,
  skip_if_transferred_by_recipient: false,
  skip_if_transferred_by_anyone: false,
  transferred_scope: 'company',   // 'company' | 'anywhere'
};

async function getBatchRules(companyId) {
  const v = await getConfig(companyId || null, 'batch_rules', DEFAULT_RULES);
  return { ...DEFAULT_RULES, ...(v && typeof v === 'object' ? v : {}) };
}

const anyRuleOn = (r) =>
  !!(r && (r.block_reassign_same_person || r.skip_if_transferred_by_recipient || r.skip_if_transferred_by_anyone));

// Is the recipient a dialer (fronter/closer) — the "final hop" where person
// rules actually bite and excluded rows get written.
async function isDialerRecipient(userId) {
  if (!userId) return false;
  const { data } = await supabaseAdmin.from('user_company_roles')
    .select('custom_roles(level)').eq('user_id', userId).eq('is_active', true);
  return (data || []).some(r => ['fronter', 'closer'].includes(r.custom_roles?.level));
}

// Run the filter → Map(phone → reason). Empty when no rule is on or on any error.
async function ruleExclusions(phones, recipientId, companyId, rules) {
  const list = [...new Set((phones || []).filter(Boolean))];
  if (!list.length || !anyRuleOn(rules)) return new Map();
  try {
    const { data, error } = await supabaseAdmin.rpc('app_batch_rule_filter', {
      p_phones: list, p_recipient: recipientId, p_company: companyId || null, p_rules: rules,
    });
    if (error) return new Map();   // fail-open (e.g. migration not applied yet)
    return new Map((data || []).map(r => [r.phone_number, r.reason]));
  } catch { return new Map(); }
}

// Preview shape shared by both send paths: counts + reason breakdown.
function summarize(phones, exMap) {
  const total = phones.length;
  const excluded = exMap.size;
  const by_reason = {};
  for (const reason of exMap.values()) by_reason[reason] = (by_reason[reason] || 0) + 1;
  return { total, excluded, included: total - excluded, by_reason };
}

module.exports = { getBatchRules, anyRuleOn, isDialerRecipient, ruleExclusions, summarize, DEFAULT_RULES };
