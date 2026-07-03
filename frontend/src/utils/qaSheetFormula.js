// ============================================================================
// qaSheetFormula (frontend mirror) — MUST stay formula-identical to
// backend/utils/qaSheetFormula.js. The UI uses this for LIVE recomputation as
// the qa_agent fills in the horizontal sheet row; the server recomputes
// authoritatively on submit. See the backend file for the full spec notes.
// ============================================================================

const norm  = (v) => String(v ?? '').trim().toUpperCase();
export const isY = (v) => norm(v) === 'Y';
const blank = (v) => norm(v) === '';

export function isSheetConfig(criteria) {
  return !!criteria && !Array.isArray(criteria) && criteria.model === 'sheet_v2';
}

// TRUNC(sum/divisor*100, 1) — exact integer math (no float drift: 21/30 must be 70.0, not 69.9)
export function truncPct1(sum, divisor) {
  if (!divisor) return 0;
  return Math.floor((sum * 1000) / divisor) / 10;
}

export function computeSheetReview(cfg, values = {}) {
  const v = (k) => values[k];

  let baseSum = 0;
  for (const rc of (cfg.rating_criteria || [])) {
    const n = parseInt(v(rc.key), 10);
    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(rc.scale ?? 4, n)) : 0;
    if (rc.included_in_base) baseSum += clamped;
  }
  const divisor = cfg.base_score_divisor || 30;
  const base_score = Math.round((baseSum / divisor) * 10000) / 10000;

  const af = cfg.autofail || { fields: [], formula_type: 'all_yes' };
  const afVals = (af.fields || []).map(f => blank(v(f.key)) ? '' : (isY(v(f.key)) ? 'Y' : 'N'));
  let autofail_result;
  if (af.formula_type === 'explicit_table') {
    autofail_result = (afVals.length && !afVals.includes('') &&
      (af.pass_combinations || []).some(c => c.length === afVals.length && c.every((x, i) => norm(x) === afVals[i])))
      ? 'Pass' : 'Fail';
  } else {
    autofail_result = (afVals.length && afVals.every(x => x === 'Y')) ? 'Pass' : 'Fail';
  }

  let total_penalty = null;
  if ((cfg.penalty_flags || []).length) {
    total_penalty = 0;
    for (const f of cfg.penalty_flags) if (isY(v(f.key))) total_penalty += (f.penalty ?? -5);
  }

  let final_score = null, passed = null;
  if (cfg.final_score_formula === 'base_plus_penalty_truncated') {
    final_score = autofail_result === 'Fail'
      ? 0
      : Math.round((truncPct1(baseSum, divisor) + (total_penalty || 0)) * 10) / 10;
    if (cfg.pass_threshold != null) passed = final_score > cfg.pass_threshold;
  }

  let quality_score = null;
  const co = cfg.call_outcome;
  const outcomeRaw = co ? v(co.key) : null;
  const q = cfg.quality_score;
  if (q && (q.fields || []).length) {
    if (co && String(outcomeRaw ?? '').trim() === '') quality_score = null;
    else if (autofail_result !== 'Pass') quality_score = 0;
    else {
      const yes = q.fields.filter(f => isY(v(f.key))).length;
      quality_score = Math.round((yes / q.fields.length) * 1000) / 10;
    }
  }

  let call_outcome_score = null;
  if (co) call_outcome_score = String(outcomeRaw ?? '') === (co.closed_value ?? 'Closed') ? 1 : 0;

  return { base_sum: baseSum, base_score, autofail_result, total_penalty, final_score, passed, quality_score, call_outcome_score };
}
