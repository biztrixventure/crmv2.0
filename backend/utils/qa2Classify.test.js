// ============================================================================
// qa2Classify.test.js — pure matching logic only (classifyCall's DB layer is
// a thin pass-through, not worth mocking Supabase to cover).
// ============================================================================

const { matchDispo, classifyAgainstRules } = require('./qa2Classify');

describe('matchDispo', () => {
  test("'any' always matches, regardless of dispo_match", () => {
    expect(matchDispo({ match_type: 'any', dispo_match: null }, 'anything')).toBe(true);
    expect(matchDispo({ match_type: 'any' }, '')).toBe(true);
  });
  test("'exact' is case-insensitive, whole-string", () => {
    expect(matchDispo({ match_type: 'exact', dispo_match: 'SALE' }, 'sale')).toBe(true);
    expect(matchDispo({ match_type: 'exact', dispo_match: 'SALE' }, 'sale_pending')).toBe(false);
  });
  test("'prefix' is case-insensitive, start-of-string", () => {
    expect(matchDispo({ match_type: 'prefix', dispo_match: 'DNC' }, 'dnc_requested')).toBe(true);
    expect(matchDispo({ match_type: 'prefix', dispo_match: 'DNC' }, 'not_dnc')).toBe(false);
  });
  test("'regex' matches case-insensitively", () => {
    expect(matchDispo({ match_type: 'regex', dispo_match: '^post[_-]?date$' }, 'POSTDATE')).toBe(true);
    expect(matchDispo({ match_type: 'regex', dispo_match: '^post[_-]?date$' }, 'post_date')).toBe(true);
    expect(matchDispo({ match_type: 'regex', dispo_match: '^post[_-]?date$' }, 'something else')).toBe(false);
  });
  test('a malformed regex never throws — treated as no match', () => {
    expect(() => matchDispo({ match_type: 'regex', dispo_match: '(unclosed' }, 'x')).not.toThrow();
    expect(matchDispo({ match_type: 'regex', dispo_match: '(unclosed' }, 'x')).toBe(false);
  });
  test('unknown match_type never matches', () => {
    expect(matchDispo({ match_type: 'nonsense' }, 'x')).toBe(false);
  });
});

describe('classifyAgainstRules — priority ordering, first match wins', () => {
  test('lower priority number wins even if a later rule would also match', () => {
    const rules = [
      { method_id: 'catch-all', match_type: 'any', priority: 100 },
      { method_id: 'specific',  match_type: 'exact', dispo_match: 'SALE', priority: 10 },
    ];
    expect(classifyAgainstRules(rules, { dispo: 'SALE' })).toBe('specific');
  });

  test('rule order in the input array does not matter — sort is by priority, not array position', () => {
    const rules = [
      { method_id: 'catch-all', match_type: 'any', priority: 100 },
      { method_id: 'specific',  match_type: 'exact', dispo_match: 'SALE', priority: 10 },
    ].reverse();
    expect(classifyAgainstRules(rules, { dispo: 'SALE' })).toBe('specific');
  });

  test('zero matches returns null -> Unclassified pool', () => {
    const rules = [{ method_id: 'm1', match_type: 'exact', dispo_match: 'SALE', priority: 10 }];
    expect(classifyAgainstRules(rules, { dispo: 'no_sale' })).toBeNull();
  });

  test('empty rule set returns null', () => {
    expect(classifyAgainstRules([], { dispo: 'anything' })).toBeNull();
  });

  test('missing priority defaults to 100, sorting after explicit lower priorities', () => {
    const rules = [
      { method_id: 'no-priority', match_type: 'any' },              // implicit 100
      { method_id: 'explicit-50', match_type: 'any', priority: 50 },
    ];
    expect(classifyAgainstRules(rules, { dispo: 'x' })).toBe('explicit-50');
  });
});
