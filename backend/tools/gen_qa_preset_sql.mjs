// ============================================================================
// gen_qa_preset_sql.mjs — emit the SQL that writes a client sheet layout onto a
// live scorecard, GENERATED FROM the same module the editor's "Load …" button
// uses (frontend/src/utils/qaSheetPresets.js).
//
// Why generated: the layout exists in two places that must agree — the button a
// manager presses, and the migration that puts the sheet in front of reviewers.
// Hand-copying the JSON into a .sql once is how they start to drift, and a
// drifted scorecard is one where the sheet you edit is not the sheet you score.
//
//   node backend/tools/gen_qa_preset_sql.mjs closer_dispo=<uuid> tra=<uuid>
//
// It prints SQL to stdout; paste it into a numbered migration. It never touches
// the database itself.
//
// The criteria are written in BOTH shapes — the ordered `fields` plus the v1
// arrays projected from it — exactly as ScorecardEditor's save path does, so a
// card written by this tool is indistinguishable from one saved in the UI.
// ============================================================================
import { pathToFileURL } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const { SHEET_PRESETS, applyPresetFields } = await import(pathToFileURL(join(root, 'frontend/src/utils/qaSheetPresets.js')).href);
const { projectSheetFields, resolveSheetFields } = await import(pathToFileURL(join(root, 'frontend/src/utils/qaSheetFormula.js')).href);

const args = process.argv.slice(2).map(a => a.split('='));
if (!args.length || args.some(a => a.length !== 2)) {
  console.error('usage: node backend/tools/gen_qa_preset_sql.mjs <method>=<scorecard_uuid> [...]');
  process.exit(1);
}

const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

for (const [method, id] of args) {
  const preset = SHEET_PRESETS[method];
  if (!preset) { console.error(`unknown method: ${method}`); process.exit(1); }

  const fields = applyPresetFields([], preset.fields());
  const byRole = projectSheetFields(fields);
  const criteria = {
    model: 'sheet_v2',
    fields,
    meta_fields: byRole.meta,
    rating_criteria: byRole.score,
    penalty_flags: byRole.penalty,
    tracking_flags: byRole.tracking,
    autofail: { formula_type: 'all_yes', fields: byRole.autofail },
    ...(byRole.quality.length ? { quality_score: { fields: byRole.quality } } : {}),
    ...(preset.divisor ? { base_score_divisor: preset.divisor } : {}),
    ...(preset.outcome ? { call_outcome: preset.outcome } : {}),
    ...(preset.manual_status ? { manual_status: preset.manual_status } : {}),
    final_score_formula: 'base_plus_penalty_truncated',
  };

  // sanity: the flat list and the projection must describe the same sheet
  const roundTrip = resolveSheetFields(criteria);
  if (roundTrip.length !== fields.length) {
    console.error(`FATAL: ${method} round-trip lost columns (${fields.length} → ${roundTrip.length})`);
    process.exit(1);
  }

  const counts = Object.entries(byRole).filter(([, v]) => v.length).map(([k, v]) => `${k} ${v.length}`).join(', ');
  console.log(`
-- ── ${method}: ${preset.label} ──
-- ${fields.length} columns (${counts})${preset.divisor ? `, base divides by ${preset.divisor}` : ''}
UPDATE qa_scorecards
   SET criteria = ${sqlStr(JSON.stringify(criteria))}::jsonb
 WHERE id = '${id}'::uuid;
`);
}
