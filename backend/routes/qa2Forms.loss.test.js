// ============================================================================
// qa2Forms.loss.test.js — a scorecard save must not destroy in silence.
//
// Two real incidents, one day apart on the SAME form:
//
//   1. 2026-09-22 21:23  version 5 of "Fronters TRA" arrived with two of the
//      ten questions. Eight were gone and four reviews were scored on the
//      remainder before anyone noticed.
//   2. 2026-09-22 ~22:00  with the question guard already shipped, the next
//      save kept all ten keys and sent every options list EMPTY. All 29
//      scoring choices went. The reviewer saw ten correct questions with
//      nothing to pick in any of them; one draft recorded "10", "20", "5" and
//      still scored zero, because a value with no option resolves to no points.
//
// PUT /versions/:vid rebuilds a version from whatever it is handed, so both
// looked like ordinary saves. This is the rule that decides when to stop and
// ask, and it is the part that has to stay right.
// ============================================================================

jest.mock('../config/database', () => ({ supabaseAdmin: {}, supabaseClient: {} }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), success: jest.fn() }));

const { formLossPlan } = require('./qa2Forms');

// The TRA sheet as it stands: ten questions, 29 options across the choices.
const EXISTING = [
  { id: 'p1', key: 'greeting_cro_energy',   input_type: 'choice' },
  { id: 'p2', key: 'communication',         input_type: 'choice' },
  { id: 'p3', key: 'customer_understanding', input_type: 'choice' },
  { id: 'p4', key: 'qualifying_questions',  input_type: 'choice' },
  { id: 'p5', key: 'misguide',              input_type: 'choice' },
  { id: 'p6', key: 'use_of_rebuttals',      input_type: 'choice' },
  { id: 'p7', key: 'comments',              input_type: 'text'   },
  { id: 'p8', key: 'final_status',          input_type: 'choice' },
  { id: 'p9', key: 'status',                input_type: 'choice' },
  { id: 'p10', key: 'reason_of_rejection',  input_type: 'text'   },
];
const COUNTS = new Map([['p1', 3], ['p2', 5], ['p3', 5], ['p4', 5], ['p5', 3], ['p6', 4], ['p8', 2], ['p9', 2]]);

// A payload the builder would send for the whole sheet, unchanged.
const opts = (n) => Array.from({ length: n }, (_, i) => ({ value: String(i * 5), points: i * 5 }));
const full = () => EXISTING.map(p => ({
  key: p.key, input_type: p.input_type,
  options: p.input_type === 'choice' ? opts(COUNTS.get(p.id) || 0) : [],
}));
const plan = (parameters) => formLossPlan({ existingParams: EXISTING, optionCounts: COUNTS, sections: [{ parameters }] });

describe('formLossPlan', () => {
  test('an unchanged save loses nothing', () => {
    expect(plan(full())).toEqual({ removing: [], clearing_options: [] });
  });

  test('incident 1: ten questions replaced by two', () => {
    const { removing, clearing_options } = plan(full().slice(0, 2));
    expect(removing).toEqual([
      'customer_understanding', 'qualifying_questions', 'misguide',
      'use_of_rebuttals', 'comments', 'final_status', 'status', 'reason_of_rejection',
    ]);
    expect(clearing_options).toEqual([]);   // the two that stayed kept their options
  });

  test('incident 2: every key kept, every option stripped', () => {
    // This is what the question guard let through.
    const { removing, clearing_options } = plan(full().map(p => ({ ...p, options: [] })));
    expect(removing).toEqual([]);
    expect(clearing_options).toEqual([
      'greeting_cro_energy', 'communication', 'customer_understanding',
      'qualifying_questions', 'misguide', 'use_of_rebuttals', 'final_status', 'status',
    ]);
  });

  test('a question turned into free text is allowed to have no options', () => {
    const next = full().map(p => (p.key === 'status' ? { ...p, input_type: 'text', options: [] } : p));
    expect(plan(next)).toEqual({ removing: [], clearing_options: [] });
  });

  test('dropping SOME options is an ordinary edit', () => {
    const next = full().map(p => (p.key === 'communication' ? { ...p, options: opts(3) } : p));
    expect(plan(next).clearing_options).toEqual([]);
  });

  test('a text question is never reported as losing options', () => {
    const next = full().map(p => (p.key === 'comments' ? { ...p, options: [] } : p));
    expect(plan(next)).toEqual({ removing: [], clearing_options: [] });
  });

  test('adding and reordering lose nothing', () => {
    const next = [...full()].reverse().concat([{ key: 'new_q', input_type: 'choice', options: opts(3) }]);
    expect(plan(next)).toEqual({ removing: [], clearing_options: [] });
  });

  test('a new choice with no options yet is not a loss — it never had any', () => {
    const next = full().concat([{ key: 'brand_new', input_type: 'choice', options: [] }]);
    expect(plan(next)).toEqual({ removing: [], clearing_options: [] });
  });

  test('an empty payload reports everything, so it can never pass unnoticed', () => {
    const { removing, clearing_options } = plan([]);
    expect(removing).toHaveLength(10);
    expect(clearing_options).toEqual([]);   // all of them are removals, not strips
  });

  test('missing options field counts as none — undefined is not a free pass', () => {
    const next = full().map(({ options, ...rest }) => rest);
    expect(plan(next).clearing_options).toHaveLength(8);
  });
});
