// ============================================================================
// qaSheetFormula — data-driven scoring engine for "sheet_v2" QA scorecards
// (exact replication of the WaveTech QA Google Sheet formulas, mig 173).
//
// The scorecard's `criteria` JSONB is an OBJECT for this model (the legacy
// weighted model is an ARRAY — see isSheetConfig).
//
// ── TWO STORAGE SHAPES, ONE READER ──────────────────────────────────────────
// v1 (original): six PARALLEL ARRAYS, where the array a field sits in decides
// BOTH where it renders and how it scores:
//   meta_fields[]            {key,label,source?}          — text, no score
//   rating_criteria[]        {key,label,min,scale,included_in_base}
//   autofail {formula_type, fields[], pass_combinations?} — Y/N gate
//   penalty_flags[]          {key,label,penalty:-5}       — Y deducts
//   tracking_flags[]         {key,label}                  — Y/N, no effect
//   quality_score {fields[]}                              — Y/N, % answered Y
//
// v2 (current): ONE ordered array `fields[]`, where a field names its own
// scoring role and its own input widget, independently:
//   { key, label, role, input, source?, penalty?, included_in_base? }
//     role  : 'meta' | 'score' | 'autofail' | 'penalty' | 'tracking' | 'quality'
//     input : { kind:'text'|'date'|'yn'|'scale'|'choice',
//               min,max,step        (scale)
//               options[], points{} (choice — points map an option to a number;
//                                    a numeric option scores itself, so
//                                    [5,10,15,20,25] needs no points map) }
// Type and scoring role are independent, which is what makes "move any column
// to any group" and "score this one 5/10/15/20/25" the same feature.
//
// resolveSheetFields() is the ONLY reader. Given a v1 card (no `fields`) it
// derives the same list from the six arrays, in the exact order the reviewer's
// sheet renders them — so every card written before v2 scores identically and
// needs no migration. Writers should emit BOTH: `fields` (canonical, ordered)
// and the projected v1 arrays (so older readers keep working).
//
// Other invariants:
//   base_score_divisor      e.g. 30 (the sheet divides by 30 even when the max
//                           possible sum is 20 — replicated as-found, do not "fix")
//   autofail.formula_type   'all_yes' (every field must be Y) | 'explicit_table'
//                           (irregular truth table kept as DATA). The table is
//                           POSITIONAL, so an explicit_table card also carries
//                           `field_order` (key order the combinations were
//                           written against) — reordering columns on the sheet
//                           must never silently re-map a truth table.
//   final_score_formula     'base_plus_penalty_truncated' | 'none'
//   pass_threshold          Final_Score must be STRICTLY > threshold to pass
//   call_outcome            {key,label,options[],closed_value}
//   manual_status           {key,label,options[],pass_value}
//
// FLOAT-SAFETY: Final_Score truncation is done in INTEGER space —
// floor(sum*1000/divisor)/10 — because e.g. 21/30*100 floats to 69.999…,
// which a naive trunc would render 69.9 where the sheet shows 70.0.
// This module is mirrored at frontend/src/utils/qaSheetFormula.js (live
// recompute in the UI); the server result is authoritative on submit.
// Change one, change the other, then run: node backend/verify_qa_sheet.js
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

// ── field model ─────────────────────────────────────────────────────────────
// 'outcome' / 'verdict' are PLACEHOLDER roles: the singleton call_outcome and
// manual_status configs still own the option list and the scoring, but a field
// with that role pins WHERE on the sheet the dropdown appears. Without them
// those two columns can only ever render last, which is wrong for any sheet
// that puts the outcome in the middle. Neither role scores on its own.
const SHEET_ROLES = ['meta', 'score', 'autofail', 'penalty', 'tracking', 'quality', 'outcome', 'verdict'];

// v1 arrays → flat order. This IS the order SheetScoreRow rendered them in, so
// a derived card looks identical to what reviewers already see.
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

// The widget a field gets when it doesn't name one — derived from its role, so
// a v1 card behaves exactly as before.
function defaultInputFor(role, f) {
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

function normalizeField(f, fallbackRole) {
  const role = SHEET_ROLES.includes(f && f.role) ? f.role : (fallbackRole || 'meta');
  return { ...f, role, input: normalizeInput(f && f.input, role, f) };
}

// THE reader. Every consumer (engine, reviewer form, editor, score persistence,
// reports) goes through this, so v1 and v2 cards are indistinguishable downstream.
function resolveSheetFields(cfg) {
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
function projectSheetFields(fields) {
  const byRole = { meta: [], score: [], autofail: [], penalty: [], tracking: [], quality: [], outcome: [], verdict: [] };
  for (const f of (fields || [])) {
    const role = SHEET_ROLES.includes(f.role) ? f.role : 'meta';
    byRole[role].push(f);
  }
  // outcome/verdict deliberately have no v1 array — call_outcome / manual_status
  // already carry those columns, so projecting them would duplicate the field.
  return byRole;
}

// The numeric contribution of one answered cell, by input kind:
//   scale  → the number, clamped to [min,max]
//   choice → points[option] when mapped, else the option itself if numeric
//   yn     → points.Y / points.N (default 1 / 0)
//   text   → the text if it parses as a number, else 0
function fieldPoints(f, raw) {
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

// values: flat map { field_key → raw entered value } (rating number or 'Y'/'N'/'' or text)
function computeSheetReview(cfg, values = {}) {
  const v = (k) => values[k];
  const fields = resolveSheetFields(cfg);
  const roleOf = (r) => fields.filter(f => f.role === r);

  // ── Base_Score = SUM(in-base scoring fields) / divisor ──────────────────────
  let baseSum = 0;
  for (const f of roleOf('score')) {
    // A scoring column counts unless it is explicitly opted out. v1 cards all
    // carry the flag; a column promoted to 'score' in the editor is stamped too.
    if (f.included_in_base === false) continue;
    baseSum += fieldPoints(f, v(f.key));
  }
  const divisor = cfg.base_score_divisor || 30;
  const base_score = Math.round((baseSum / divisor) * 10000) / 10000;   // e.g. 0.4667

  // ── Auto_Fail gate ──────────────────────────────────────────────────────────
  const af = cfg.autofail || { fields: [], formula_type: 'all_yes' };
  let afFields = roleOf('autofail');
  // An explicit truth table is POSITIONAL. Evaluate in the key order the
  // combinations were authored against, so moving the column on the sheet can
  // never silently re-map which combination passes.
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
  const penFields = roleOf('penalty');
  if (penFields.length) {
    total_penalty = 0;
    for (const f of penFields) if (isY(v(f.key))) total_penalty += (f.penalty ?? -5);
  }

  // ── Final_Score (Fronter): 0 on Auto_Fail, else TRUNC(base%,1) + penalty ────
  let final_score = null, passed = null;
  if (cfg.final_score_formula === 'base_plus_penalty_truncated') {
    final_score = autofail_result === 'Fail'
      ? 0
      : Math.round((truncPct1(baseSum, divisor) + (total_penalty || 0)) * 10) / 10;
    if (cfg.pass_threshold != null) passed = final_score > cfg.pass_threshold;  // STRICTLY >
  }

  // ── Quality Score (Closer): blank outcome → N/A; Auto_Fail → 0; else %Y/n ──
  let quality_score = null;
  const co = cfg.call_outcome;
  const outcomeRaw = co ? v(co.key) : null;
  const qFields = roleOf('quality');
  if (qFields.length) {
    if (co && String(outcomeRaw ?? '').trim() === '') quality_score = null;      // no outcome set → no scoring
    else if (autofail_result !== 'Pass') quality_score = 0;
    else {
      const yes = qFields.filter(f => isY(v(f.key))).length;                     // blank/N both count as not-Y
      quality_score = Math.round((yes / qFields.length) * 1000) / 10;            // e.g. 71.4
    }
  }

  // ── Call_Outcome_Score: CASE-SENSITIVE exact match, per the sheet ───────────
  let call_outcome_score = null;
  if (co) call_outcome_score = String(outcomeRaw ?? '') === (co.closed_value ?? 'Closed') ? 1 : 0;

  // ── Manual QA verdict — the evaluator sets Pass/Fail directly (fronter RCM
  // sheet: "QA Overall Status"). When configured it IS the authoritative
  // pass/fail, overriding any score-derived one. Blank → undecided (passed=null).
  let manual_status = null;
  const ms = cfg.manual_status;
  if (ms) {
    const raw = String(v(ms.key) ?? '').trim();
    manual_status = raw || null;
    passed = raw ? (raw === (ms.pass_value ?? 'Pass')) : null;
  }

  return { base_sum: baseSum, base_score, autofail_result, total_penalty, final_score, passed, quality_score, call_outcome_score, manual_status };
}

module.exports = {
  isSheetConfig, computeSheetReview, truncPct1, isY, norm,
  SHEET_ROLES, resolveSheetFields, projectSheetFields, fieldPoints, defaultInputFor, normalizeField,
};
