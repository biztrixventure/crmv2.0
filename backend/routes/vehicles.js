// ============================================================================
// /vehicles — Vehicle make/model registry powering form pickers.
//
// Reads (GET) are open to any authenticated user so SaleForm / TransferForm
// can populate their typeaheads. Writes are superadmin-only and the bulk
// endpoints accept a CSV line for fast paste-to-seed configuration.
// ============================================================================

const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');

const router = express.Router();

const superadminOnly = asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin access required' });
  next();
});

// Turn a pasted CSV / newline / pipe-separated string into a clean,
// case-folded-deduped array of names. Tolerates extra whitespace and trailing
// separators so users can paste straight from a spreadsheet cell.
function parseCsv(input) {
  if (typeof input !== 'string') return [];
  return [...new Set(
    input
      .split(/[,\n\r\t|;]+/)
      .map(s => s.trim())
      .filter(Boolean)
  )];
}

// ── GET /vehicles — full make+model tree ─────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const [{ data: makes }, { data: models }] = await Promise.all([
    supabaseAdmin.from('vehicle_makes').select('*').order('name'),
    supabaseAdmin.from('vehicle_models').select('*').order('name'),
  ]);
  const modelsByMake = {};
  (models || []).forEach(m => { (modelsByMake[m.make_id] = modelsByMake[m.make_id] || []).push(m); });
  const tree = (makes || []).map(mk => ({ ...mk, models: modelsByMake[mk.id] || [] }));
  res.json({ makes: tree });
}));

// ── POST /vehicles/makes/bulk — paste a CSV of makes ────────────────────────
router.post('/makes/bulk', superadminOnly, asyncHandler(async (req, res) => {
  const names = parseCsv(req.body?.csv || '');
  if (!names.length) return res.status(400).json({ error: 'No makes parsed from input.' });

  // Upsert against the case-folded unique index — Postgres handles the dedupe;
  // if a name with different casing already exists, the new row collides on
  // lower(name) and ON CONFLICT DO NOTHING keeps the existing one.
  const rows = names.map(name => ({ name }));
  const { data, error } = await supabaseAdmin
    .from('vehicle_makes').upsert(rows, { onConflict: 'lower(name)', ignoreDuplicates: true })
    .select();
  // PostgREST may reject the named expression conflict target; fall back to
  // a plain insert and swallow unique-violation errors.
  if (error && /onConflict|on_conflict/i.test(error.message || '')) {
    const inserted = [];
    for (const r of rows) {
      const { data: d, error: e } = await supabaseAdmin.from('vehicle_makes').insert(r).select().single();
      if (!e && d) inserted.push(d);
      // 23505 = unique_violation — silently skip the duplicate.
    }
    return res.json({ added: inserted.length, makes: inserted });
  }
  if (error) return res.status(500).json({ error: error.message });
  res.json({ added: (data || []).length, makes: data || [] });
}));

// ── DELETE /vehicles/makes/:id ───────────────────────────────────────────────
router.delete('/makes/:id', superadminOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('vehicle_makes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// ── POST /vehicles/models/bulk — paste a CSV of models for one make ─────────
router.post('/models/bulk', superadminOnly, asyncHandler(async (req, res) => {
  const make_id = req.body?.make_id;
  const names   = parseCsv(req.body?.csv || '');
  if (!make_id) return res.status(400).json({ error: 'make_id required.' });
  if (!names.length) return res.status(400).json({ error: 'No models parsed from input.' });

  // Confirm the parent make exists so we don't dangle FK errors back as 500.
  const { data: mk } = await supabaseAdmin.from('vehicle_makes').select('id').eq('id', make_id).maybeSingle();
  if (!mk) return res.status(404).json({ error: 'Make not found.' });

  const inserted = [];
  for (const name of names) {
    const { data, error } = await supabaseAdmin.from('vehicle_models').insert({ make_id, name }).select().single();
    if (!error && data) inserted.push(data);
    // 23505 unique-violation = already exists → skip silently.
  }
  res.json({ added: inserted.length, models: inserted });
}));

// ── DELETE /vehicles/models/:id ──────────────────────────────────────────────
router.delete('/models/:id', superadminOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('vehicle_models').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

module.exports = router;
