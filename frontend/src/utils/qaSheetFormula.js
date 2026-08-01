// ============================================================================
// qaSheetFormula (frontend mirror) — MUST stay formula-identical to
// backend/utils/qaSheetFormula.js. The UI uses this for LIVE recomputation as
// the qa_agent fills in the horizontal sheet row; the server recomputes
// authoritatively on submit. See the backend file for the full spec notes,
// including the v1 (six parallel arrays) → v2 (one ordered `fields[]` with a
// per-field `role` + `input`) compatibility rules that resolveSheetFields
// implements. Change one file, change the other, then run:
//   node backend/verify_qa_sheet.js
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

// ── field model ─────────────────────────────────────────────────────────────
// 'outcome' / 'verdict' are PLACEHOLDER roles: call_outcome and manual_status
// still own the option list and the scoring, but a field with that role pins
// WHERE on the sheet the dropdown appears. Neither role scores on its own.
export const SHEET_ROLES = ['meta', 'score', 'autofail', 'penalty', 'tracking', 'quality', 'outcome', 'verdict'];

// v1 arrays → flat order: the exact order SheetScoreRow already rendered them.
const LEGACY_LAYOUT = [
  { role: 'meta',     path: ['meta_fields'] },
  { role: 'score',    path: ['rating_criteria'] },
  { role: 'autofail', path: ['autofail', 'fields'] },
  { role: 'penalty',  path: ['penalty_flags'] },
  { role: 'tracking', path: ['tracking_flags'] },
  { role: 'quality',  path: ['quality_score', 'fields'] },
];

const atPath = (obj, path) => path.reduce((o, k) => (o == null ? o : o[k]), obj);
const numOr = (v, d) => (Number.isFinite(+v) ? +v : d);

export function defaultInputFor(role, f) {
  if (role === 'score') return { kind: 'scale', min: numOr(f && f.min, 0), max: numOr(f && f.scale, 4), step: 1 };
  if (role === 'meta')  return { kind: 'text' };
  if (role === 'outcome' || role === 'verdict') return { kind: 'choice', options: [] };
  return { kind: 'yn' };
}

function normalizeInput(input, role, f) {
  const kind = input && input.kind;
  if (kind === 'scale') {
    const min = numOr(input.min, 0);
    const max = numOr(input.max, 4);
    return { kind: 'scale', min, max: Math.max(min, max), step: Math.max(1, numOr(input.step, 1)) };
  }
  if (kind === 'choice') {
    return {
      kind: 'choice',
      options: Array.isArray(input.options) ? input.options.map(o => String(o)) : [],
      points: (input.points && typeof input.points === 'object') ? input.points : null,
    };
  }
  if (kind === 'yn')   return { kind: 'yn', points: (input.points && typeof input.points === 'object') ? input.points : null };
  if (kind === 'text' || kind === 'date') return { kind };
  return defaultInputFor(role, f);
}

export function normalizeField(f, fallbackRole) {
  const role = SHEET_ROLES.includes(f && f.role) ? f.role : (fallbackRole || 'meta');
  return { ...f, role, input: normalizeInput(f && f.input, role, f) };
}

// THE reader — v1 and v2 cards are indistinguishable downstream.
export function resolveSheetFields(cfg) {
  if (!cfg || typeof cfg !== 'object') return [];
  if (Array.isArray(cfg.fields) && cfg.fields.length) return cfg.fields.map(f => normalizeField(f));
  const out = [];
  for (const { role, path } of LEGACY_LAYOUT) {
    const list = atPath(cfg, path);
    if (!Array.isArray(list)) continue;
    for (const f of list) out.push(normalizeField(f, role));
  }
  return out;
}

// Flat list → the v1 arrays, so anything still reading `criteria.meta_fields`
// keeps working after a card is saved in the new shape.
export function projectSheetFields(fields) {
  const byRole = { meta: [], score: [], autofail: [], penalty: [], tracking: [], quality: [], outcome: [], verdict: [] };
  for (const f of (fields || [])) {
    const role = SHEET_ROLES.includes(f.role) ? f.role : 'meta';
    byRole[role].push(f);
  }
  // outcome/verdict deliberately have no v1 array — call_outcome / manual_status
  // already carry those columns, so projecting them would duplicate the field.
  return byRole;
}

// Numeric contribution of one answered cell — see the backend twin for the rules.
export function fieldPoints(f, raw) {
  const input = (f && f.input) || defaultInputFor(f && f.role, f);
  if (input.kind === 'scale') {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return 0;
    return Math.max(numOr(input.min, 0), Math.min(numOr(input.max, 4), n));
  }
  if (input.kind === 'choice') {
    const key = String(raw ?? '').trim();
    if (key === '') return 0;
    if (input.points && input.points[key] != null) return numOr(input.points[key], 0);
    return numOr(key, 0);
  }
  if (input.kind === 'yn') {
    const pts = input.points || {};
    if (isY(raw)) return numOr(pts.Y, 1);
    if (blank(raw)) return 0;
    return numOr(pts.N, 0);
  }
  const n = Number(String(raw ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}

export function computeSheetReview(cfg, values = {}) {
  const v = (k) => values[k];
  const fields = resolveSheetFields(cfg);
  const roleOf = (r) => fields.filter(f => f.role === r);

  let baseSum = 0;
  for (const f of roleOf('score')) {
    if (f.included_in_base === false) continue;   // explicitly opted out of the Base Score
    baseSum += fieldPoints(f, v(f.key));
  }
  const divisor = cfg.base_score_divisor || 30;
  const base_score = Math.round((baseSum / divisor) * 10000) / 10000;

  const af = cfg.autofail || { fields: [], formula_type: 'all_yes' };
  let afFields = roleOf('autofail');
  // explicit truth tables are POSITIONAL — evaluate in the authored key order
  if (af.formula_type === 'explicit_table' && Array.isArray(af.field_order) && af.field_order.length) {
    const byKey = new Map(afFields.map(f => [f.key, f]));
    const ordered = af.field_order.map(k => byKey.get(k)).filter(Boolean);
    for (const f of afFields) if (!af.field_order.includes(f.key)) ordered.push(f);
    afFields = ordered;
  }
  const afVals = afFields.map(f => (blank(v(f.key)) ? '' : (isY(v(f.key)) ? 'Y' : 'N')));
  let autofail_result;
  if (!afVals.length) {
    autofail_result = null;                       // scorecard has no auto-fail gate (e.g. fronter RCM sheet)
  } else if (af.formula_type === 'explicit_table') {
    autofail_result = (afVals.length && !afVals.includes('') &&
      (af.pass_combinations || []).some(c => c.length === afVals.length && c.every((x, i) => norm(x) === afVals[i])))
      ? 'Pass' : 'Fail';
  } else {
    autofail_result = (afVals.length && afVals.every(x => x === 'Y')) ? 'Pass' : 'Fail';
  }

  let total_penalty = null;
  const penFields = roleOf('penalty');
  if (penFields.length) {
    total_penalty = 0;
    for (const f of penFields) if (isY(v(f.key))) total_penalty += (f.penalty ?? -5);
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
  const qFields = roleOf('quality');
  if (qFields.length) {
    if (co && String(outcomeRaw ?? '').trim() === '') quality_score = null;
    else if (autofail_result !== 'Pass') quality_score = 0;
    else {
      const yes = qFields.filter(f => isY(v(f.key))).length;
      quality_score = Math.round((yes / qFields.length) * 1000) / 10;
    }
  }

  let call_outcome_score = null;
  if (co) call_outcome_score = String(outcomeRaw ?? '') === (co.closed_value ?? 'Closed') ? 1 : 0;

  // Manual QA verdict — evaluator sets Pass/Fail directly (fronter RCM sheet).
  // Authoritative when configured; blank → undecided (passed=null).
  let manual_status = null;
  const ms = cfg.manual_status;
  if (ms) {
    const raw = String(v(ms.key) ?? '').trim();
    manual_status = raw || null;
    passed = raw ? (raw === (ms.pass_value ?? 'Pass')) : null;
  }

  return { base_sum: baseSum, base_score, autofail_result, total_penalty, final_score, passed, quality_score, call_outcome_score, manual_status };
}
