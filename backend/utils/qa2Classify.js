// ============================================================================
// qa2Classify.js — classification: which qa2_method (if any) an incoming
// call belongs to. Ingest routes no longer hardcode TRA/SALE labels (v1's
// approach) — every call is matched against active qa2_method_rule rows for
// its source, ordered by priority ascending, FIRST MATCH WINS. Zero matches
// -> the caller stores method_id = NULL (Unclassified pool, mig 234).
//
// classifyAgainstRules() is pure (rules already fetched, sorted) — this file
// has ZERO requires on purpose, unit-testable with no Supabase env vars.
// classifyCall(), the thin DB wrapper Phase 5's ingest hook actually calls,
// lives in qa2ClassifyResolver.js instead.
// ============================================================================

// One rule's match against a raw dispo string.
function matchDispo(rule, dispo) {
  const d = String(dispo || '');
  const pattern = rule.dispo_match;
  switch (rule.match_type) {
    case 'any':
      return true;
    case 'exact':
      return d.toUpperCase() === String(pattern || '').toUpperCase();
    case 'prefix':
      return d.toUpperCase().startsWith(String(pattern || '').toUpperCase());
    case 'regex':
      try {
        return new RegExp(pattern, 'i').test(d);
      } catch {
        // A malformed regex saved by a manager must never crash ingest —
        // treat it as a non-match, not a thrown error.
        return false;
      }
    default:
      return false;
  }
}

// Pure. rules: qa2_method_rule-shaped rows already scoped to one `source`.
// Returns the winning method_id, or null (-> Unclassified pool).
function classifyAgainstRules(rules, { dispo } = {}) {
  const sorted = [...(rules || [])].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  for (const rule of sorted) {
    if (matchDispo(rule, dispo)) return rule.method_id;
  }
  return null;
}

module.exports = { matchDispo, classifyAgainstRules };
