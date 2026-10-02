// ============================================================================
// qa2Evaluations.draft.test.js -- a reopened DRAFT follows the current
// scorecard (planDraftUpgrade). Pins the case that went wrong on 2026-10-02:
// Unclosed drafts from August reopened on v1, showing the old yes/no "Wrong
// Dispo" and no Call Outcome list.
// ============================================================================
jest.mock('../config/database', () => {
  const fake = require('../testing/supabaseFake');
  return { supabaseAdmin: fake.admin, supabaseClient: fake.client };
});
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { planDraftUpgrade } = require('./qa2Evaluations');

// v1 of the Unclosed form vs v4: same score questions + call_outcome (same
// lineage), v1's wrong_dispo question is gone, v4 adds additional_comments.
const V1 = [
  { id: 'v1-tone', lineage_id: 'L-tone' },
  { id: 'v1-outcome', lineage_id: 'L-outcome' },
  { id: 'v1-wrong', lineage_id: 'L-wrong' },
];
const V4 = [
  { id: 'v4-tone', lineage_id: 'L-tone' },
  { id: 'v4-outcome', lineage_id: 'L-outcome' },
  { id: 'v4-comments', lineage_id: 'L-comments' },
];

describe('planDraftUpgrade', () => {
  test('every answer moves to the SAME question in the new version', () => {
    const { moves } = planDraftUpgrade(V1, V4, [
      { id: 'a1', parameter_id: 'v1-tone' },
      { id: 'a2', parameter_id: 'v1-outcome' },
    ]);
    expect(moves).toEqual([
      { answer_id: 'a1', parameter_id: 'v4-tone' },
      { answer_id: 'a2', parameter_id: 'v4-outcome' },
    ]);
  });

  test('an answer to a question the new version dropped is left alone, not moved anywhere', () => {
    const { moves, orphans } = planDraftUpgrade(V1, V4, [{ id: 'a3', parameter_id: 'v1-wrong' }]);
    expect(moves).toEqual([]);
    expect(orphans).toEqual(['a3']);
  });

  test('nothing to do when there are no answers yet', () => {
    expect(planDraftUpgrade(V1, V4, [])).toEqual({ moves: [], orphans: [] });
  });
});
