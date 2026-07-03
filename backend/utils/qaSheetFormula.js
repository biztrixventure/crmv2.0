// ============================================================================
// qaSheetFormula — data-driven scoring engine for "sheet_v2" QA scorecards
// (exact replication of the WaveTech QA Google Sheet formulas, mig 173).
//
// The scorecard's `criteria` JSONB is an OBJECT for this model (the legacy
// weighted model is an ARRAY — see isSheetConfig). Everything is read from
// config so a third scorecard type needs data, not code:
//   rating_criteria[]       {key,label,scale,included_in_base}
//   base_score_divisor      e.g. 30 (the sheet divides by 30 even when the max
//                           possible sum is 20 — replicated as-found, do not "fix")
//   autofail                {formula_type:'all_yes'|'explicit_table', fields[],
//                            pass_combinations[[Y,N,..],..]}  ← explicit table
//                           kept as DATA, never simplified to a boolean rule
//   penalty_flags[]         {key,label,penalty:-5} — each 'Y' adds penalty
//   tracking_flags[]        captured Y/N, consumed by NO formula (tracking only)
//   final_score_formula     'base_plus_penalty_truncated' | 'none'
//   pass_threshold          Final_Score must be STRICTLY > threshold to pass
//   quality_score           {fields[]} — Closer's 7-item sale-compliance checklist
//   call_outcome            {key,label,options[],closed_value}
//   meta_fields[]           non-scoring text fields
//
// FLOAT-SAFETY: Final_Score truncation is done in INTEGER space —
// floor(sum*1000/divisor)/10 — because e.g. 21/30*100 floats to 69.999…,
// which a naive trunc would render 69.9 where the sheet shows 70.0.
// This module is mirrored at frontend/src/utils/qaSheetFormula.js (live
// recompute in the UI); the server result is authoritative on submit.
// ============================================================================

const norm  = (v) => String(v ?? '').trim().toUpperCase();
const isY   = (v) => norm(v) === 'Y';          // TRIM(UPPER(...)) tolerance, per the sheet
const blank = (v) => norm(v) === '';

// criteria object (not array) + model marker = sheet_v2 scorecard
function isSheetConfig(criteria) {
  return !!criteria && !Array.isArray(criteria) && criteria.model === 'sheet_v2';
}

// TRUNC(sum/divisor*100, 1) — exact, integer math (sum & divisor are integers).
function truncPct1(sum, divisor) {
  if (!divisor) return 0;
  return Math.floor((sum * 1000) / divisor) / 10;
}

// values: flat map { field_key → raw entered value } (rating number or 'Y'/'N'/'' or text)
function computeSheetReview(cfg, values = {}) {
  const v = (k) => values[k];

  // ── Base_Score = SUM(included ratings) / divisor ────────────────────────────
  let baseSum = 0;
  for (const rc of (cfg.rating_criteria || [])) {
    const n = parseInt(v(rc.key), 10);
    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(rc.scale ?? 4, n)) : 0;
    if (rc.included_in_base) baseSum += clamped;
  }
  const divisor = cfg.base_score_divisor || 30;
  const base_score = Math.round((baseSum / divisor) * 10000) / 10000;   // e.g. 0.4667

  // ── Auto_Fail gate ──────────────────────────────────────────────────────────
  const af = cfg.autofail || { fields: [], formula_type: 'all_yes' };
  const afVals = (af.fields || []).map(f => blank(v(f.key)) ? '' : (isY(v(f.key)) ? 'Y' : 'N'));
  let autofail_result;
  if (af.formula_type === 'explicit_table') {
    // Irregular truth table replicated EXACTLY as data. A blank answer → Fail
    // (combos are defined over Y/N only; never let an unanswered field
    // accidentally match an N slot in a pass combo).
    autofail_result = (afVals.length && !afVals.includes('') &&
      (af.pass_combinations || []).some(c => c.length === afVals.length && c.every((x, i) => norm(x) === afVals[i])))
      ? 'Pass' : 'Fail';
  } else { // 'all_yes' — clean AND rule (Fronter): every field must be 'Y'
    autofail_result = (afVals.length && afVals.every(x => x === 'Y')) ? 'Pass' : 'Fail';
  }

  // ── Total_Penalty = Σ(-5 per 'Y' flag) — null when the scorecard has none ──
  let total_penalty = null;
  if ((cfg.penalty_flags || []).length) {
    total_penalty = 0;
    for (const f of cfg.penalty_flags) if (isY(v(f.key))) total_penalty += (f.penalty ?? -5);
  }

  // ── Final_Score (Fronter): 0 on Auto_Fail, else TRUNC(base%,1) + penalty ────
  let final_score = null, passed = null;
  if (cfg.final_score_formula === 'base_plus_penalty_truncated') {
    final_score = autofail_result === 'Fail'
      ? 0
      : Math.round((truncPct1(baseSum, divisor) + (total_penalty || 0)) * 10) / 10;
    if (cfg.pass_threshold != null) passed = final_score > cfg.pass_threshold;  // STRICTLY >
  }

  // ── Quality Score (Closer): blank outcome → N/A; Auto_Fail → 0; else %Y/7 ──
  let quality_score = null;
  const co = cfg.call_outcome;
  const outcomeRaw = co ? v(co.key) : null;
  const q = cfg.quality_score;
  if (q && (q.fields || []).length) {
    if (co && String(outcomeRaw ?? '').trim() === '') quality_score = null;      // no outcome set → no scoring
    else if (autofail_result !== 'Pass') quality_score = 0;
    else {
      const yes = q.fields.filter(f => isY(v(f.key))).length;                    // blank/N both count as not-Y
      quality_score = Math.round((yes / q.fields.length) * 1000) / 10;           // e.g. 71.4
    }
  }

  // ── Call_Outcome_Score: CASE-SENSITIVE exact match, per the sheet ───────────
  let call_outcome_score = null;
  if (co) call_outcome_score = String(outcomeRaw ?? '') === (co.closed_value ?? 'Closed') ? 1 : 0;

  return { base_sum: baseSum, base_score, autofail_result, total_penalty, final_score, passed, quality_score, call_outcome_score };
}

module.exports = { isSheetConfig, computeSheetReview, truncPct1, isY, norm };
