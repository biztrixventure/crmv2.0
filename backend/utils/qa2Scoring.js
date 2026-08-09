// ============================================================================
// qa2Scoring.js — QA v2 scoring engine. Pure functions, no DB access. The
// server is the ONLY place a score is ever computed and persisted (a client
// may preview live, but qa2_evaluation's stored columns always come from
// running this module against qa2_answer rows — see mig 237's header). Every
// score is a derivation of raw answers, never a value trusted once and kept.
//
// computeEvaluation({ formVersion, parameters, options, answers })
//   formVersion — a qa2_form_version row (mig 235): base_denominator_mode,
//                 base_denominator, final_score_formula, rounding_mode,
//                 pass_threshold, pass_comparator, autofail_mode,
//                 autofail_table.
//   parameters  — qa2_parameter rows (mig 235) for that version.
//   options     — qa2_parameter_option rows (mig 235) for those parameters.
//   answers     — qa2_answer-shaped rows (mig 237): { parameter_id,
//                 value_num, value_text, value_bool, is_na }.
//   -> { base_sum, base_pct, penalty_total, final_score, autofail_result, result }
//
// KNOWN GAP (flagged, not silently patched): v1's sheet_v2 engine
// (qaSheetFormula.js) has two features this module does NOT reproduce,
// because v2's schema (mig 235) has no equivalent role/column for them yet:
//   - manual_status — a human-entered verdict field that OVERRIDES any
//     computed pass/fail (e.g. the mig-226 weighted TRA sheet has no
//     pass_threshold at all; "Final Status" IS the pass/fail).
//   - quality_score — a closer-side %-of-Yes checklist independent of
//     base/final score (v1's RCM sheet).
// Until qa2_parameter grows a role for this (a 'verdict' role writing
// straight to qa2_evaluation.result, bypassing the threshold comparison),
// a form shaped like that sheet will compute base_sum/base_pct/final_score
// identically to v1 but `result` stays null instead of reflecting a manual
// override — see qa2Scoring.test.js's mig-226 fixture, which asserts exactly
// that boundary.
// ============================================================================

const YES_TEXT = new Set(['Y', 'YES', 'TRUE', '1']);

function isYes(answer) {
  if (!answer) return false;
  if (answer.value_bool != null) return answer.value_bool === true;
  if (answer.value_text != null) return YES_TEXT.has(String(answer.value_text).trim().toUpperCase());
  if (answer.value_num != null) return Number(answer.value_num) === 1;
  return false;
}

function clamp(n, min, max) {
  const lo = Number.isFinite(min) ? min : -Infinity;
  const hi = Number.isFinite(max) ? max : Infinity;
  return Math.min(hi, Math.max(lo, n));
}

// Float-safe precision, mirroring v1's own FLOAT-SAFETY note (21/30*100
// floats to 69.999999999996, which a naive truncate must still render 70.0,
// not 69.9). Round to a high-precision integer first to erase float noise,
// THEN apply the requested precision — never operate on the raw float.
function truncTo(n, decimals) {
  const factor = Math.pow(10, decimals);
  const clean = Math.round(n * factor * 1e6) / 1e6;
  return Math.trunc(clean) / factor;
}
function roundTo(n, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}
function applyRounding(n, mode) {
  if (mode === 'truncate_1') return truncTo(n, 1);
  if (mode === 'round_2') return roundTo(n, 2);
  return roundTo(n, 1); // 'round_1' — the default
}

function optionsByParam(options) {
  const map = new Map();
  for (const o of (options || [])) {
    if (!map.has(o.parameter_id)) map.set(o.parameter_id, new Map());
    map.get(o.parameter_id).set(String(o.value), Number(o.points) || 0);
  }
  return map;
}

function answersByParam(answers) {
  const map = new Map();
  for (const a of (answers || [])) map.set(a.parameter_id, a);
  return map;
}

// The numeric contribution of one answered parameter, by input_type. Choice
// ALWAYS resolves through its qa2_parameter_option rows — unlike v1, which
// fell back to treating the option's own text as a number when no explicit
// points map existed, v2 requires every option to carry its own points value
// (mig 235), so there is no implicit fallback to get subtly wrong.
function fieldPoints(param, answer, optMap) {
  if (!answer || answer.is_na) return 0;
  switch (param.input_type) {
    case 'yes_no':
      return isYes(answer) ? Number(param.points_yes ?? 1) : Number(param.points_no ?? 0);
    case 'scale': {
      const n = Number(answer.value_num);
      if (!Number.isFinite(n)) return 0;
      return clamp(n, param.scale_min ?? 0, param.scale_max ?? param.scale_min ?? 0);
    }
    case 'choice': {
      const key = answer.value_text != null ? String(answer.value_text) : '';
      const pts = optMap.get(param.id);
      return pts && pts.has(key) ? pts.get(key) : 0;
    }
    case 'number': {
      const n = Number(answer.value_num);
      return Number.isFinite(n) ? n : 0;
    }
    default: // 'text' / info-role fields never score
      return 0;
  }
}

// The maximum achievable points for one 'score' parameter — used to build
// the 'auto' base denominator (step 3). 'number' has no natural ceiling, so
// it contributes 0 here; a form leaning on number-type score fields should
// use base_denominator_mode='manual' instead of 'auto'.
function maxPoints(param, optMap) {
  switch (param.input_type) {
    case 'yes_no':
      return Math.max(Number(param.points_yes ?? 1), Number(param.points_no ?? 0));
    case 'scale':
      return Number(param.scale_max ?? 0);
    case 'choice': {
      const pts = optMap.get(param.id);
      if (!pts || !pts.size) return 0;
      return Math.max(...pts.values());
    }
    default:
      return 0;
  }
}

function computeAutofail(formVersion, afParams, ansMap) {
  const mode = formVersion.autofail_mode || 'none';
  if (mode === 'none' || !afParams.length) return null;

  if (mode === 'all_yes') {
    // A blank (unanswered or N/A) autofail field never passes the gate —
    // it must never silently default to "Y" just because nothing was typed.
    return afParams.every(p => {
      const a = ansMap.get(p.id);
      return !!a && !a.is_na && isYes(a);
    }) ? 'pass' : 'fail';
  }

  // explicit_table — an irregular Y/N truth table kept as DATA, matched
  // POSITIONALLY against autofail_table.field_order so reordering columns in
  // the builder can never silently re-map which combination passes.
  const table = formVersion.autofail_table || {};
  const order = Array.isArray(table.field_order) && table.field_order.length
    ? table.field_order
    : afParams.map(p => p.key);
  const byKey = new Map(afParams.map(p => [p.key, p]));
  const ordered = order.map(k => byKey.get(k)).filter(Boolean);
  for (const p of afParams) if (!order.includes(p.key)) ordered.push(p);

  const vals = ordered.map(p => {
    const a = ansMap.get(p.id);
    if (!a || a.is_na) return '';
    return isYes(a) ? 'Y' : 'N';
  });
  const combos = Array.isArray(table.pass_combinations) ? table.pass_combinations : [];
  const passes = vals.length > 0 && !vals.includes('') &&
    combos.some(c => c.length === vals.length && c.every((x, i) => String(x).trim().toUpperCase() === vals[i]));
  return passes ? 'pass' : 'fail';
}

function computeEvaluation({ formVersion, parameters, options, answers }) {
  const params = parameters || [];
  const optMap = optionsByParam(options);
  const ansMap = answersByParam(answers);

  // ── Base sum + denominator ──────────────────────────────────────────────
  const scoreParams = params.filter(p => p.role === 'score' && p.included_in_base !== false);
  const isManualDenom = formVersion.base_denominator_mode === 'manual';

  let baseSum = 0;
  let autoMax = 0;
  for (const p of scoreParams) {
    const a = ansMap.get(p.id);
    const na = !!(a && a.is_na);
    if (!na) baseSum += fieldPoints(p, a, optMap);
    // An N/A'd parameter subtracts its own ceiling from the achievable max
    // too (step 3) — an excused question shouldn't lower the bar for
    // everyone else being measured against a smaller denominator.
    if (!isManualDenom && !na) autoMax += maxPoints(p, optMap);
  }

  const denom = isManualDenom ? (Number(formVersion.base_denominator) || 0) : autoMax;
  const base_pct = denom > 0 ? applyRounding((baseSum / denom) * 100, formVersion.rounding_mode) : 0;

  // ── Auto-fail ────────────────────────────────────────────────────────────
  const afParams = params.filter(p => p.role === 'autofail');
  const autofail_result = computeAutofail(formVersion, afParams, ansMap);

  // ── Penalties — per-parameter penalty_value, not a global constant ─────
  const penParams = params.filter(p => p.role === 'penalty');
  let penalty_total = null;
  if (penParams.length) {
    penalty_total = 0;
    for (const p of penParams) {
      const a = ansMap.get(p.id);
      if (a && !a.is_na && isYes(a)) penalty_total += Number(p.penalty_value ?? -5);
    }
  }

  // ── Final score — 0 on auto-fail, base_pct is still ALWAYS persisted ───
  // ("would have been 87% but auto-failed on disclosure" is the most
  // actionable number in the system — never let a Fail hide it).
  const final_score = autofail_result === 'fail'
    ? 0
    : applyRounding(base_pct + (penalty_total || 0), formVersion.rounding_mode);

  // ── Pass / fail ──────────────────────────────────────────────────────────
  let result = null;
  if (autofail_result === 'fail') {
    result = 'fail';
  } else if (formVersion.pass_threshold != null) {
    const threshold = Number(formVersion.pass_threshold);
    const passes = formVersion.pass_comparator === 'gt' ? final_score > threshold : final_score >= threshold;
    result = passes ? 'pass' : 'fail';
  }
  // No threshold configured and no auto-fail -> result stays null
  // (informational card, e.g. a closer/RCM sheet with no pass/fail line).

  return { base_sum: baseSum, base_pct, penalty_total, final_score, autofail_result, result };
}

module.exports = { computeEvaluation, isYes, applyRounding, truncTo, roundTo, fieldPoints, maxPoints };
