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
async function classifyCall({ source, dispo, leg, hasTransfer, hasSale }) {
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
  // THE CRM IDENTITY, ENFORCED AT CLASSIFICATION:  TRA − Closed = Unclosed.
  //   every transfer   → one fronter row  = TRA
  //   every transfer   → one closer row   = Closed if a sale exists, else Unclosed
  // The dispo rules above still run first (a manager's own mapping wins); these
  // fallbacks only decide what the rules could not, using the CRM facts the row
  // carries. Without the closer fallbacks a transfer whose closer never got a
  // matched dispo produced TRA with no Unclosed at all — the whole reason the
  // manager's arithmetic did not add up.
  if (hasTransfer && leg === 'fronter') return methodByLabel('tra', 'fronter');
  if (hasSale && leg === 'closer')      return methodByLabel('closed', 'closer');
  if (hasTransfer && leg === 'closer')  return methodByLabel('unclosed', 'closer');
  return null;
}

// Active method id by label + leg, cached briefly — it changes only when a
// manager renames/archives a method, and a miss (no such method) just leaves
// the call unclassified exactly as before.
const _labelCache = new Map();   // `${label}|${leg}` → { at, id }
async function methodByLabel(label, leg) {
  const key = `${label}|${leg}`;
  const hit = _labelCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.id;
  const { data } = await supabaseAdmin
    .from('qa2_method').select('id')
    .ilike('label', label).eq('is_active', true).in('leg', [leg, 'both'])
    .limit(1).maybeSingle();
  _labelCache.set(key, { at: Date.now(), id: data?.id || null });
  return data?.id || null;
}

module.exports = { classifyCall };
