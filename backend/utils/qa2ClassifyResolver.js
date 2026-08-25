// ============================================================================
// qa2ClassifyResolver.js — the DB-fetching half of classification. Split
// from qa2Classify.js so that file stays pure (zero requires, unit-testable
// without Supabase env vars) while this one does the actual row-fetching.
// ============================================================================

const { supabaseAdmin } = require('../config/database');
const { classifyAgainstRules } = require('./qa2Classify');

// Only active rules on active (non-archived) methods can classify a NEW
// call — an archived method shouldn't keep absorbing calls just because its
// rules are still sitting in the table.
//
// `leg` is optional and mostly redundant for ingest — 'ingest_fronter' vs
// 'ingest_closer' already separates the two legs at the SOURCE level. It's
// required for 'sweep', though: unlike ingest, a sweep has exactly one
// source value covering BOTH legs in the same pool, so without this filter
// a fronter-leg and a closer-leg call could match the same rule regardless
// of which leg either one is actually on.
async function classifyCall({ source, dispo, leg, hasTransfer }) {
  let query = supabaseAdmin
    .from('qa2_method_rule')
    .select('method_id, match_type, dispo_match, priority, qa2_method!inner(is_active, leg)')
    .eq('source', source)
    .eq('is_active', true)
    .eq('qa2_method.is_active', true);
  if (leg) query = query.in('qa2_method.leg', [leg, 'both']);

  const { data: rules, error } = await query;
  if (error) throw error;
  const matched = classifyAgainstRules(rules || [], { dispo });
  if (matched) return matched;

  // TRA membership comes from the TRANSFER EXISTING, not from what the dispo
  // says — the rule the Load Day UI already states in as many words. The rules
  // above only read the dispo, so a fronter call that IS a transfer but carries
  // an odd dispo string fell to the Unclassified tab for a human to hand-sort:
  // 524 of them in 30 days, 96% with audio, every one answerable by the system.
  if (hasTransfer && leg === 'fronter') return traMethodId();
  return null;
}

// The active fronter-leg method labelled TRA, cached briefly — it changes only
// when a manager renames/archives the method, and a miss (no such method) just
// leaves the call unclassified exactly as before.
let _traCache = { at: 0, id: null };
async function traMethodId() {
  if (Date.now() - _traCache.at < 10 * 60 * 1000) return _traCache.id;
  const { data } = await supabaseAdmin
    .from('qa2_method').select('id')
    .ilike('label', 'tra').eq('is_active', true).in('leg', ['fronter', 'both'])
    .limit(1).maybeSingle();
  _traCache = { at: Date.now(), id: data?.id || null };
  return _traCache.id;
}

module.exports = { classifyCall };
