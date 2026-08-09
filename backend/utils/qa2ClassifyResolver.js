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
async function classifyCall({ source, dispo, leg }) {
  let query = supabaseAdmin
    .from('qa2_method_rule')
    .select('method_id, match_type, dispo_match, priority, qa2_method!inner(is_active, leg)')
    .eq('source', source)
    .eq('is_active', true)
    .eq('qa2_method.is_active', true);
  if (leg) query = query.in('qa2_method.leg', [leg, 'both']);

  const { data: rules, error } = await query;
  if (error) throw error;
  return classifyAgainstRules(rules || [], { dispo });
}

module.exports = { classifyCall };
