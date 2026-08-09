// ============================================================================
// qa2Scoring.test.js — the two required fixtures (WaveTech Fronter TRA per
// mig 203, and the mig-226 weighted TRA replacement) plus targeted unit
// coverage for the pieces that carry real risk (float-safe rounding, the
// explicit_table auto-fail truth table, the pass_comparator bug fix).
//
// Fixture field lists/values are copied from the actual migration files
// (173, 203, 226), not reconstructed from memory — see PR/commit description
// for the exact grep/read that sourced them.
// ============================================================================

const { computeEvaluation, isYes, applyRounding, truncTo } = require('./qa2Scoring');

// ---------------------------------------------------------------------------
// Fixture 1: WaveTech Fronter — TRA (mig 203). The migration's own header
// comment gives a worked example we can assert against directly:
//   "ratings 4,4,4,4,3 -> Base 19/30 = 63.3%, two penalties -10,
//    compliance all-Y -> Auto_Fail Pass, Final = trunc(63.3)+(-10) = 53.3 -> Pass"
// ---------------------------------------------------------------------------
function traFormVersion(overrides = {}) {
  return {
    base_denominator_mode: 'manual',
    base_denominator: 30,          // the sheet's own quirk divisor — true max is 5*5=25, not 30
    final_score_formula: 'base_pct_plus_penalty',
    rounding_mode: 'truncate_1',
    pass_threshold: 40,
    pass_comparator: 'gte',        // v2 default — v1 hardcodes strict '>' (see divergence test below)
    autofail_mode: 'all_yes',
    autofail_table: {},
    ...overrides,
  };
}

const traRatingParams = [
  { id: 'r1', key: 'communication_energy_level',     role: 'score', input_type: 'scale', scale_min: 1, scale_max: 5, included_in_base: true },
  { id: 'r2', key: 'customer_product_understanding', role: 'score', input_type: 'scale', scale_min: 1, scale_max: 5, included_in_base: true },
  { id: 'r3', key: 'rebuttal_usage',                 role: 'score', input_type: 'scale', scale_min: 1, scale_max: 5, included_in_base: true },
  { id: 'r4', key: 'pronunciation_clarity',          role: 'score', input_type: 'scale', scale_min: 1, scale_max: 5, included_in_base: true },
  { id: 'r5', key: 'sales_intent',                   role: 'score', input_type: 'scale', scale_min: 1, scale_max: 5, included_in_base: true },
];
const traAutofailParams = [
  { id: 'a1', key: 'qualifying_questions_asked',     role: 'autofail', input_type: 'yes_no' },
  { id: 'a2', key: 'compliance_consent_to_transfer', role: 'autofail', input_type: 'yes_no' },
  { id: 'a3', key: 'compliance_misrepresentation',   role: 'autofail', input_type: 'yes_no' },
];
const traPenaltyParams = [
  { id: 'p1', key: 'poor_listening',            role: 'penalty', input_type: 'yes_no', penalty_value: -5 },
  { id: 'p2', key: 'mumbling',                  role: 'penalty', input_type: 'yes_no', penalty_value: -5 },
  { id: 'p3', key: 'low_confidence',            role: 'penalty', input_type: 'yes_no', penalty_value: -5 },
  { id: 'p4', key: 'over_explanation',          role: 'penalty', input_type: 'yes_no', penalty_value: -5 },
  { id: 'p5', key: 'one_way_interaction',       role: 'penalty', input_type: 'yes_no', penalty_value: -5 },
  { id: 'p6', key: 'rebuttal_inaccuracy',       role: 'penalty', input_type: 'yes_no', penalty_value: -5 },
  { id: 'p7', key: 'transfer_aggressive_pushy', role: 'penalty', input_type: 'yes_no', penalty_value: -5 },
];
const traParams = [...traRatingParams, ...traAutofailParams, ...traPenaltyParams];

function traAnswers() {
  return [
    { parameter_id: 'r1', value_num: 4 },
    { parameter_id: 'r2', value_num: 4 },
    { parameter_id: 'r3', value_num: 4 },
    { parameter_id: 'r4', value_num: 4 },
    { parameter_id: 'r5', value_num: 3 },
    { parameter_id: 'a1', value_text: 'Y' },
    { parameter_id: 'a2', value_text: 'Y' },
    { parameter_id: 'a3', value_text: 'Y' },
    { parameter_id: 'p1', value_text: 'Y' },   // 2 of 7 penalties fire -> -10
    { parameter_id: 'p2', value_text: 'Y' },
    { parameter_id: 'p3', value_text: 'N' },
    { parameter_id: 'p4', value_text: 'N' },
    { parameter_id: 'p5', value_text: 'N' },
    { parameter_id: 'p6', value_text: 'N' },
    { parameter_id: 'p7', value_text: 'N' },
  ];
}

describe('WaveTech Fronter TRA (mig 203) — reproduces v1 exactly', () => {
  test('ratings 4,4,4,4,3 -> base 19/30=63.3%, -10 penalty, all-Y autofail pass, final 53.3 -> pass', () => {
    const result = computeEvaluation({
      formVersion: traFormVersion(),
      parameters: traParams,
      options: [],
      answers: traAnswers(),
    });
    expect(result.base_sum).toBe(19);
    expect(result.base_pct).toBe(63.3);
    expect(result.penalty_total).toBe(-10);
    expect(result.autofail_result).toBe('pass');
    expect(result.final_score).toBe(53.3);
    expect(result.result).toBe('pass');
  });

  test('any autofail field blank fails the gate and zeroes final_score, but base_pct is still persisted', () => {
    const answers = traAnswers().map(a => (a.parameter_id === 'a2' ? { parameter_id: 'a2' } : a)); // a2 unanswered
    const result = computeEvaluation({
      formVersion: traFormVersion(),
      parameters: traParams,
      options: [],
      answers,
    });
    expect(result.autofail_result).toBe('fail');
    expect(result.final_score).toBe(0);
    expect(result.result).toBe('fail');
    // The whole point of persisting this regardless of autofail — v1 discards
    // it at the route layer; v2 never does.
    expect(result.base_pct).toBe(63.3);
  });

  test('one compliance field N (not all-Y) fails the autofail gate', () => {
    const answers = traAnswers().map(a => (a.parameter_id === 'a3' ? { parameter_id: 'a3', value_text: 'N' } : a));
    const result = computeEvaluation({
      formVersion: traFormVersion(),
      parameters: traParams,
      options: [],
      answers,
    });
    expect(result.autofail_result).toBe('fail');
    expect(result.final_score).toBe(0);
  });
});

describe('pass_comparator — v2 fixes v1s hardcoded strict ">"', () => {
  test('final_score exactly at threshold: gte (v2 default) passes, gt (v1 exact) fails', () => {
    // Same ratings (base_pct 63.3) but zero penalties, threshold set to 63.3
    // exactly, so this lands precisely on the boundary v1 got wrong.
    const answers = traAnswers().map(a =>
      traPenaltyParams.some(p => p.id === a.parameter_id) ? { parameter_id: a.parameter_id, value_text: 'N' } : a
    );

    const gte = computeEvaluation({
      formVersion: traFormVersion({ pass_threshold: 63.3, pass_comparator: 'gte' }),
      parameters: traParams, options: [], answers,
    });
    expect(gte.final_score).toBe(63.3);
    expect(gte.result).toBe('pass');   // v2 default behaviour — the fix

    const gt = computeEvaluation({
      formVersion: traFormVersion({ pass_threshold: 63.3, pass_comparator: 'gt' }),
      parameters: traParams, options: [], answers,
    });
    expect(gt.final_score).toBe(63.3);
    expect(gt.result).toBe('fail');    // v1's exact (buggy) semantics, opt-in only
  });
});

// ---------------------------------------------------------------------------
// Fixture 2: the mig-226 weighted TRA replacement — six 'choice' fields with
// genuinely different per-option weights (0/5/10 .. 0/5/10/15/20), no
// autofail gate (fields: [] in the source JSON), base divides by 100 even
// though the bands only total 95 (mig 226's own comment: "the divisor is
// 100"). Pass/fail in v1 comes from a human-entered "Final Status" field
// (manual_status) which v2's schema has no equivalent for yet — see
// qa2Scoring.js's header. This fixture asserts the SCORE MATH matches v1
// exactly and explicitly documents that `result` stays null here, rather
// than silently asserting something v2 doesn't actually compute.
// ---------------------------------------------------------------------------
const weightedTraParams = [
  { id: 'w1', key: 'greeting_cro_energy',     role: 'score', input_type: 'choice', included_in_base: true },
  { id: 'w2', key: 'communication',           role: 'score', input_type: 'choice', included_in_base: true },
  { id: 'w3', key: 'customer_understanding',  role: 'score', input_type: 'choice', included_in_base: true },
  { id: 'w4', key: 'qualifying_questions',    role: 'score', input_type: 'choice', included_in_base: true },
  { id: 'w5', key: 'misguide',                role: 'score', input_type: 'choice', included_in_base: true },
  { id: 'w6', key: 'use_of_rebuttals',        role: 'score', input_type: 'choice', included_in_base: true },
];
const weightedTraOptions = [
  ...['0', '5', '10'].map(v => ({ parameter_id: 'w1', value: v, points: Number(v) })),
  ...['0', '5', '10', '15', '20'].map(v => ({ parameter_id: 'w2', value: v, points: Number(v) })),
  ...['0', '5', '10', '15', '20'].map(v => ({ parameter_id: 'w3', value: v, points: Number(v) })),
  ...['0', '5', '10', '15', '20'].map(v => ({ parameter_id: 'w4', value: v, points: Number(v) })),
  ...['0', '5', '10'].map(v => ({ parameter_id: 'w5', value: v, points: Number(v) })),
  ...['0', '5', '10', '15'].map(v => ({ parameter_id: 'w6', value: v, points: Number(v) })),
];
const weightedTraAnswers = [
  { parameter_id: 'w1', value_text: '10' },
  { parameter_id: 'w2', value_text: '15' },
  { parameter_id: 'w3', value_text: '20' },
  { parameter_id: 'w4', value_text: '15' },
  { parameter_id: 'w5', value_text: '10' },
  { parameter_id: 'w6', value_text: '15' },
];
const weightedTraFormVersion = {
  base_denominator_mode: 'manual',
  base_denominator: 100,           // bands total 95; the sheet still divides by 100 (mig 226)
  final_score_formula: 'base_pct_plus_penalty',
  rounding_mode: 'truncate_1',
  pass_threshold: null,            // no threshold in the source JSON — manual_status decides in v1
  pass_comparator: 'gte',
  autofail_mode: 'none',           // source JSON's autofail.fields is [] — no gate
  autofail_table: {},
};

describe('mig-226 weighted TRA — score math matches v1; documents the manual_status gap', () => {
  test('10+15+20+15+10+15=85 over /100 -> base_pct 85.0, no autofail gate, final_score 85.0', () => {
    const result = computeEvaluation({
      formVersion: weightedTraFormVersion,
      parameters: weightedTraParams,
      options: weightedTraOptions,
      answers: weightedTraAnswers,
    });
    expect(result.base_sum).toBe(85);
    expect(result.base_pct).toBe(85.0);
    expect(result.autofail_result).toBeNull();   // fields: [] in v1 -> no gate, same here
    expect(result.penalty_total).toBeNull();      // no penalty-role parameters on this card
    expect(result.final_score).toBe(85.0);
    // KNOWN GAP: v1's real card has manual_status ("Final Status") override
    // this to passed=true. v2 has no verdict-role equivalent yet, so this is
    // correctly null, not a mismatch — see qa2Scoring.js header.
    expect(result.result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// explicit_table auto-fail — WaveTech Closer RCM (mig 173): an irregular
// 4-combination Y/N truth table, kept as data, matched positionally.
// ---------------------------------------------------------------------------
const rcmAutofailParams = [
  { id: 'c1', key: 'compliance_dnc_check',                role: 'autofail', input_type: 'yes_no' },
  { id: 'c2', key: 'compliance_existsale_check',           role: 'autofail', input_type: 'yes_no' },
  { id: 'c3', key: 'brand_impersonation',                  role: 'autofail', input_type: 'yes_no' },
  { id: 'c4', key: 'sale_bla_verification_compliance',     role: 'autofail', input_type: 'yes_no' },
];
const rcmFormVersion = {
  base_denominator_mode: 'manual',
  base_denominator: 30,
  autofail_mode: 'explicit_table',
  autofail_table: {
    field_order: ['compliance_dnc_check', 'compliance_existsale_check', 'brand_impersonation', 'sale_bla_verification_compliance'],
    pass_combinations: [
      ['Y', 'Y', 'Y', 'Y'],
      ['N', 'N', 'Y', 'N'],
      ['N', 'Y', 'N', 'Y'],
      ['Y', 'N', 'Y', 'N'],
    ],
  },
  final_score_formula: 'none',
  pass_threshold: null,
  pass_comparator: 'gte',
};

describe('explicit_table auto-fail (mig 173 WaveTech Closer RCM) — irregular truth table', () => {
  test('an exact match on a non-obvious pass combination (N,N,Y,N) passes', () => {
    const result = computeEvaluation({
      formVersion: rcmFormVersion,
      parameters: rcmAutofailParams,
      options: [],
      answers: [
        { parameter_id: 'c1', value_text: 'N' },
        { parameter_id: 'c2', value_text: 'N' },
        { parameter_id: 'c3', value_text: 'Y' },
        { parameter_id: 'c4', value_text: 'N' },
      ],
    });
    expect(result.autofail_result).toBe('pass');
  });

  test('a combination not in the pass table fails, even though every field is answered', () => {
    const result = computeEvaluation({
      formVersion: rcmFormVersion,
      parameters: rcmAutofailParams,
      options: [],
      answers: [
        { parameter_id: 'c1', value_text: 'N' },
        { parameter_id: 'c2', value_text: 'N' },
        { parameter_id: 'c3', value_text: 'N' },
        { parameter_id: 'c4', value_text: 'N' },
      ],
    });
    expect(result.autofail_result).toBe('fail');
  });

  test('a blank field never passes, even if the other three match a valid combo', () => {
    const result = computeEvaluation({
      formVersion: rcmFormVersion,
      parameters: rcmAutofailParams,
      options: [],
      answers: [
        { parameter_id: 'c1', value_text: 'Y' },
        { parameter_id: 'c2', value_text: 'Y' },
        { parameter_id: 'c3', value_text: 'Y' },
        // c4 unanswered
      ],
    });
    expect(result.autofail_result).toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// Small unit-level coverage for the pieces that carry real risk.
// ---------------------------------------------------------------------------
describe('isYes', () => {
  test('accepts Y/YES/TRUE/1 case-insensitively via value_text', () => {
    expect(isYes({ value_text: 'y' })).toBe(true);
    expect(isYes({ value_text: 'Yes' })).toBe(true);
    expect(isYes({ value_text: 'true' })).toBe(true);
    expect(isYes({ value_text: 'N' })).toBe(false);
    expect(isYes({ value_text: '' })).toBe(false);
  });
  test('value_bool takes priority when present', () => {
    expect(isYes({ value_bool: true, value_text: 'N' })).toBe(true);
    expect(isYes({ value_bool: false, value_text: 'Y' })).toBe(false);
  });
  test('missing/null answer is never yes', () => {
    expect(isYes(null)).toBe(false);
    expect(isYes({})).toBe(false);
  });
});

describe('float-safe rounding', () => {
  test('truncTo never clips a value that is only float-noise below the next tenth', () => {
    // Mirrors v1's own documented trap: a division that should read 70.0 can
    // land on 69.999999999996 in IEEE-754 — a naive Math.trunc(n*10)/10 would
    // wrongly render 69.9.
    const noisy = (21 / 30) * 100; // whatever IEEE-754 actually produces here
    expect(truncTo(noisy, 1)).toBe(70.0);
  });
  test('round_2 mode keeps two decimals', () => {
    expect(applyRounding(63.333333, 'round_2')).toBe(63.33);
  });
  test('default mode (round_1) rounds rather than truncates', () => {
    expect(applyRounding(63.36, undefined)).toBe(63.4);
  });
});
