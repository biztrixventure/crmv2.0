/**
 * verify_qa_sheet.js — formula verification for the WaveTech sheet replication.
 * Runs the REAL engine (utils/qaSheetFormula) against the REAL seeded configs
 * (parsed out of migrations/173_qa_sheet_scorecards.sql via the $JF$/$JC$
 * markers — so what's tested is exactly what's in the DB). Pure computation,
 * no DB needed:   node backend/verify_qa_sheet.js
 *
 * Reference rows come from the client's actual QA Google Sheet.
 */
const fs = require('fs');
const path = require('path');
const { computeSheetReview, resolveSheetFields } = require('./utils/qaSheetFormula');

const sql = fs.readFileSync(path.join(__dirname, 'migrations', '173_qa_sheet_scorecards.sql'), 'utf8');
const FRONTER = JSON.parse(sql.match(/\$JF\$(\{[\s\S]*?\})\$JF\$/)[1]);
const CLOSER  = JSON.parse(sql.match(/\$JC\$(\{[\s\S]*?\})\$JC\$/)[1]);

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}   computed=${JSON.stringify(actual)}  expected=${JSON.stringify(expected)}`);
  ok ? pass++ : fail++;
};

// ── Fronter reference rows ───────────────────────────────────────────────────
const F_RATINGS = FRONTER.rating_criteria.map(r => r.key);
const F_FLAGS   = FRONTER.penalty_flags.map(f => f.key);
function fronterRow(ratings, yesFlags, autofail = ['Y', 'Y', 'Y']) {
  const v = {};
  F_RATINGS.forEach((k, i) => { v[k] = ratings[i]; });
  F_FLAGS.forEach(k => { v[k] = yesFlags.includes(k) ? 'Y' : 'N'; });
  FRONTER.autofail.fields.forEach((f, i) => { v[f.key] = autofail[i]; });
  return computeSheetReview(FRONTER, v);
}

console.log('══ SCORECARD 1 — FRONTER (TRA) ══');
let r = fronterRow([2, 3, 2, 4, 3], ['rebuttal_inaccuracy']);
check('Row3 base_score',  r.base_score, 0.4667);
check('Row3 penalty',     r.total_penalty, -5);
check('Row3 final (46.6 truncated, NOT 46.7, -5)', r.final_score, 41.6);
check('Row3 status',      r.passed ? 'Pass' : 'FAIL', 'Pass');

r = fronterRow([4, 3, 3, 4, 3], ['comm_over_explanation', 'rebuttal_inaccuracy']);
check('Row4 base_score',  r.base_score, 0.5667);
check('Row4 penalty',     r.total_penalty, -10);
check('Row4 final (56.6 - 10)', r.final_score, 46.6);
check('Row4 status',      r.passed ? 'Pass' : 'FAIL', 'Pass');

r = fronterRow([2, 0, 2, 3, 4], ['rebuttal_inaccuracy']);
check('Row5 base_score',  r.base_score, 0.3667);
check('Row5 final (36.6 - 5)', r.final_score, 31.6);
check('Row5 status (31.6 not > 35)', r.passed ? 'Pass' : 'FAIL', 'FAIL');

// auto-fail truth table (clean AND): any single N → Fail → Final 0
for (const combo of [['N','Y','Y'], ['Y','N','Y'], ['Y','Y','N'], ['N','N','N']]) {
  r = fronterRow([4, 4, 4, 4, 4], [], combo);
  check(`AutoFail ${combo.join(',')} → Fail, Final 0`, [r.autofail_result, r.final_score], ['Fail', 0]);
}
// float-drift guard: sum 21 → base% must be 70.0, never 69.9 (naive trunc trap)
r = fronterRow([4, 4, 4, 4, 4], []);   // sum 20 → 20000/30 = 666 → 66.6
check('sum 20 → 66.6 (the /30 divisor as-found: max reachable < 100)', r.final_score, 66.6);
{ // simulate sum 21 via a custom config with 6 criteria to prove integer-exact truncation
  const cfg6 = { ...FRONTER, rating_criteria: [...FRONTER.rating_criteria, { key: 'x6', label: 'x6', scale: 4, included_in_base: true }] };
  const v = {}; cfg6.rating_criteria.forEach(rc => { v[rc.key] = rc.key === 'x6' ? 1 : 4; });   // 4*5+1 = 21
  FRONTER.autofail.fields.forEach(f => { v[f.key] = 'Y'; });
  FRONTER.penalty_flags.forEach(f => { v[f.key] = 'N'; });
  check('sum 21 → 70.0 exactly (float-drift guard)', computeSheetReview(cfg6, v).final_score, 70);
}

// ── Closer reference + truth table ───────────────────────────────────────────
console.log('\n══ SCORECARD 2 — CLOSER (RCM) ══');
const C_AF = CLOSER.autofail.fields.map(f => f.key);
function closerRow(af, outcome, qualityYes = [], ratings = {}) {
  const v = { ...ratings };
  C_AF.forEach((k, i) => { v[k] = af[i]; });
  if (outcome !== undefined) v[CLOSER.call_outcome.key] = outcome;
  CLOSER.quality_score.fields.forEach(f => { if (qualityYes.includes(f.key)) v[f.key] = 'Y'; });
  return computeSheetReview(CLOSER, v);
}

// Row3: DNC=Y,ExistSale=Y,BrandImperson=Y,BLA=Y; outcome 'Call Back'; 7 sale-compliance fields blank
r = closerRow(['Y', 'Y', 'Y', 'Y'], 'Call Back');
check('Row3 Auto_Fail', r.autofail_result, 'Pass');
check('Row3 Quality (7 fields blank → count-of-Y = 0 → 0.0, NOT a non-Closed special case)', r.quality_score, 0);
check('Row3 Call_Outcome_Score ("Call Back" ≠ "Closed")', r.call_outcome_score, 0);
check('Row3 final_score never computed for Closer', r.final_score, null);
check('Row3 total_penalty never computed for Closer', r.total_penalty, null);
check('Row3 passed is null (no pass/fail on Closer)', r.passed, null);

// FULL 16-combination enumeration of the irregular auto-fail table
const PASS_SET = new Set(['Y,Y,Y,Y', 'N,N,Y,N', 'N,Y,N,Y', 'Y,N,Y,N']);
let tableOk = true;
for (let i = 0; i < 16; i++) {
  const combo = [8, 4, 2, 1].map(b => (i & b) ? 'Y' : 'N');
  const expected = PASS_SET.has(combo.join(',')) ? 'Pass' : 'Fail';
  const actual = closerRow(combo, 'Closed').autofail_result;
  if (actual !== expected) { tableOk = false; console.log(`  FAIL  combo (${combo.join(',')}) computed=${actual} expected=${expected}`); fail++; }
}
if (tableOk) { console.log('  PASS  all 16 auto-fail combinations match (exactly 4 pass states)'); pass++; }

// Quality Score branch coverage
r = closerRow(['Y', 'Y', 'Y', 'Y'], '');   // blank outcome
check('blank Call_Outcome → Quality N/A (null)', r.quality_score, null);
r = closerRow(['Y', 'Y', 'N', 'Y'], 'Closed', CLOSER.quality_score.fields.map(f => f.key));  // autofail combo not in table
check('Auto_Fail=Fail → Quality forced 0 (even with all 7 = Y)', r.quality_score, 0);
r = closerRow(['Y', 'Y', 'Y', 'Y'], 'Closed', CLOSER.quality_score.fields.slice(0, 5).map(f => f.key));
check('5 of 7 = Y → 71.4', r.quality_score, 71.4);
check('outcome "Closed" → Call_Outcome_Score 1 (case-sensitive)', r.call_outcome_score, 1);
r = closerRow(['Y', 'Y', 'Y', 'Y'], 'closed');
check('outcome "closed" (lowercase) → 0 — Closed match is case-SENSITIVE', r.call_outcome_score, 0);
{ // TRIM(UPPER()) tolerance on the Y counting
  const v = {}; C_AF.forEach(k => { v[k] = 'Y'; }); v[CLOSER.call_outcome.key] = 'Closed';
  v[CLOSER.quality_score.fields[0].key] = ' y ';   // messy but a Y
  check('" y " counts as Y (TRIM/UPPER tolerance)', computeSheetReview(CLOSER, v).quality_score, 14.3);
}
// Base_Score scope: only the 6 in-scope ratings count
{
  const ratings = {};
  CLOSER.rating_criteria.forEach(rc => { ratings[rc.key] = 4; });   // ALL 10 rated 4
  r = closerRow(['Y', 'Y', 'Y', 'Y'], 'Closed', [], ratings);
  check('all 10 ratings=4 → base uses ONLY the 6 in-scope (24/30 = 0.8)', r.base_score, 0.8);
}

// ── v2 field model: per-field `input` + `role` ───────────────────────────────
// The v1 six-array shape and the v2 flat `fields[]` shape MUST score identically,
// and the new input kinds must contribute the points they claim. A scoring
// change that only holds in the browser is how a month of reviews silently
// re-scores — so every one of these runs the real engine.
console.log('\n══ FIELD MODEL v2 (role + input) ══');

// 1. Round-trip: derive the flat list from a v1 card, feed it back as `fields`
//    → every output must match the v1 card's, field for field.
{
  const flat = (cfg) => ({ ...cfg, fields: resolveSheetFields(cfg) });
  const fv = {};
  FRONTER.rating_criteria.forEach((rc, i) => { fv[rc.key] = [2, 3, 2, 4, 3][i]; });
  FRONTER.penalty_flags.forEach(f => { fv[f.key] = f.key === 'rebuttal_inaccuracy' ? 'Y' : 'N'; });
  FRONTER.autofail.fields.forEach(f => { fv[f.key] = 'Y'; });
  check('v1 → v2 round-trip (Fronter Row3) is identical',
    computeSheetReview(flat(FRONTER), fv), computeSheetReview(FRONTER, fv));

  const cv = {};
  CLOSER.autofail.fields.forEach(f => { cv[f.key] = 'Y'; });
  cv[CLOSER.call_outcome.key] = 'Closed';
  CLOSER.quality_score.fields.slice(0, 5).forEach(f => { cv[f.key] = 'Y'; });
  CLOSER.rating_criteria.forEach(rc => { cv[rc.key] = 4; });
  check('v1 → v2 round-trip (Closer, 5/7 quality + all ratings 4) is identical',
    computeSheetReview(flat(CLOSER), cv), computeSheetReview(CLOSER, cv));
}

// 2. A card with NO `role`/`input` anywhere still resolves — the array a field
//    sits in supplies both. (The compatibility promise for the live cards.)
{
  const derived = resolveSheetFields(FRONTER);
  check('derived roles (5 score, 3 autofail, 7 penalty)',
    [derived.filter(f => f.role === 'score').length, derived.filter(f => f.role === 'autofail').length, derived.filter(f => f.role === 'penalty').length],
    [5, 3, 7]);
  check('derived input for a rating is its own min–scale',
    derived.find(f => f.role === 'score').input, { kind: 'scale', min: 0, max: 4, step: 1 });
  check('derived input for an auto-fail is Y/N', derived.find(f => f.role === 'autofail').input.kind, 'yn');
}

// 3. choice input — the 5/10/15/20/25 scale the six-array model had no home for.
//    A numeric option scores itself; no points map needed.
{
  const cfg = {
    model: 'sheet_v2', base_score_divisor: 125, final_score_formula: 'base_plus_penalty_truncated',
    fields: [1, 2, 3, 4, 5].map(i => ({
      key: `q${i}`, label: `Q${i}`, role: 'score', included_in_base: true,
      input: { kind: 'choice', options: ['5', '10', '15', '20', '25'] },
    })),
  };
  check('choice 5/10/15/20/25 — all 25 → 125/125 = 100.0',
    computeSheetReview(cfg, { q1: '25', q2: '25', q3: '25', q4: '25', q5: '25' }).final_score, 100);
  check('choice — 25,20,15,10,5 → 75/125 = 60.0',
    computeSheetReview(cfg, { q1: '25', q2: '20', q3: '15', q4: '10', q5: '5' }).final_score, 60);
  check('choice — a blank cell contributes 0, never NaN',
    computeSheetReview(cfg, { q1: '25' }).final_score, 20);
  check('choice — an option that is not a number and not mapped scores 0',
    computeSheetReview({ ...cfg, fields: [{ key: 'q1', label: 'Q', role: 'score', included_in_base: true, input: { kind: 'choice', options: ['Good', 'Bad'] } }] },
      { q1: 'Good' }).base_sum, 0);
  check('choice — an explicit points map wins over the option text',
    computeSheetReview({ ...cfg, fields: [{ key: 'q1', label: 'Q', role: 'score', included_in_base: true, input: { kind: 'choice', options: ['Good', 'Bad'], points: { Good: 20, Bad: 0 } } }] },
      { q1: 'Good' }).base_sum, 20);
}

// 4. A Y/N column can SCORE (role:'score', input yn) — default Y=1, or a points map.
{
  const cfg = { model: 'sheet_v2', base_score_divisor: 2, fields: [
    { key: 'a', label: 'A', role: 'score', included_in_base: true, input: { kind: 'yn' } },
    { key: 'b', label: 'B', role: 'score', included_in_base: true, input: { kind: 'yn', points: { Y: 10, N: -2 } } },
  ] };
  check('yn scoring — default Y=1, mapped Y=10 → sum 11', computeSheetReview(cfg, { a: 'Y', b: 'Y' }).base_sum, 11);
  check('yn scoring — N uses points.N (-2), blank stays 0', computeSheetReview(cfg, { a: '', b: 'N' }).base_sum, -2);
}

// 5. Moving a column between groups changes ONLY that column's behaviour.
{
  const base = { model: 'sheet_v2', base_score_divisor: 10, final_score_formula: 'base_plus_penalty_truncated', fields: [
    { key: 'r1', label: 'R1', role: 'score', included_in_base: true, input: { kind: 'scale', min: 0, max: 5 } },
    { key: 'flag', label: 'Flag', role: 'tracking', input: { kind: 'yn' } },
  ] };
  check('tracking column never touches the score', computeSheetReview(base, { r1: 5, flag: 'Y' }).final_score, 50);
  const asPenalty = { ...base, fields: [base.fields[0], { ...base.fields[1], role: 'penalty', penalty: -5 }] };
  check('same column moved to penalty now deducts', computeSheetReview(asPenalty, { r1: 5, flag: 'Y' }).final_score, 45);
  const asAutofail = { ...base, fields: [base.fields[0], { ...base.fields[1], role: 'autofail' }] };
  check('same column moved to auto-fail gates the whole call', computeSheetReview(asAutofail, { r1: 5, flag: 'N' }).final_score, 0);
  const asMeta = { ...base, fields: [base.fields[0], { ...base.fields[1], role: 'meta', input: { kind: 'text' } }] };
  check('same column moved to details is inert again', computeSheetReview(asMeta, { r1: 5, flag: 'whatever' }).final_score, 50);
}

// 6. An explicit truth table is POSITIONAL — reordering its columns on the sheet
//    must not re-map which combination passes. field_order pins it.
{
  const flat = resolveSheetFields(CLOSER);
  const afKeys = flat.filter(f => f.role === 'autofail').map(f => f.key);
  const v = {}; afKeys.forEach((k, i) => { v[k] = ['N', 'N', 'Y', 'N'][i]; });   // a PASS combo
  const reordered = { ...CLOSER, fields: [...flat].reverse(), autofail: { ...CLOSER.autofail, field_order: afKeys } };
  check('explicit_table survives a full column reversal (pinned by field_order)',
    computeSheetReview(reordered, v).autofail_result, 'Pass');
  const unpinned = { ...CLOSER, fields: [...flat].reverse(), autofail: { ...CLOSER.autofail, field_order: undefined } };
  check('…and without the pin the reversed order reads the table backwards',
    computeSheetReview(unpinned, v).autofail_result, 'Fail');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
