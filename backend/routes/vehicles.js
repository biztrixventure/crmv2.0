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
// case-folded-deduped array of names. Names are preserved AS TYPED — "BMW"
// stays "BMW", "iPad" stays "iPad" — because brand styling carries meaning
// and was previously being clobbered to "Bmw" / "Ipad" by an auto-titlecase.
// Dedupe is case-insensitive so the same casing-variant pasted twice still
// collapses to one entry, but the casing of the first occurrence wins.
function parseCsv(input) {
  if (typeof input !== 'string') return [];
  const seen = new Set();
  const out = [];
  for (const raw of input.split(/[,\n\r\t|;]+/)) {
    const name = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
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

  // Per-row insert + swallow 23505 unique_violation. PostgREST doesn't accept
  // expression-based ON CONFLICT targets (lower(name)), so we let Postgres
  // raise on the case-insensitive index and treat duplicates as a no-op.
  const inserted = [];
  for (const name of names) {
    const { data, error } = await supabaseAdmin.from('vehicle_makes').insert({ name }).select().single();
    if (!error && data) inserted.push(data);
    else if (error && error.code !== '23505') {
      return res.status(500).json({ error: error.message });
    }
  }
  res.json({ added: inserted.length, makes: inserted });
}));

// ── PUT /vehicles/makes/:id — rename a make (casing fix, typo correction) ───
// Existing sale / transfer rows reference the make by name string, not by FK,
// so a rename here is local to the registry and doesn't cascade. The Data
// Analyzer already matches case-insensitively for make/model fields, so a
// historic "Gmc" row keeps matching after the registry entry becomes "GMC".
router.put('/makes/:id', superadminOnly, asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim();
  if (!name) return res.status(400).json({ error: 'name required.' });
  const { data, error } = await supabaseAdmin
    .from('vehicle_makes').update({ name }).eq('id', req.params.id).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: `Another make already uses "${name}"` });
    return res.status(500).json({ error: error.message });
  }
  res.json({ make: data });
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
    else if (error && error.code !== '23505') {
      return res.status(500).json({ error: error.message });
    }
  }
  res.json({ added: inserted.length, models: inserted });
}));

// ── PUT /vehicles/models/:id — rename a model (casing fix, typo correction) ─
router.put('/models/:id', superadminOnly, asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim();
  if (!name) return res.status(400).json({ error: 'name required.' });
  const { data, error } = await supabaseAdmin
    .from('vehicle_models').update({ name }).eq('id', req.params.id).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: `Another model already uses "${name}" for this make` });
    return res.status(500).json({ error: error.message });
  }
  res.json({ model: data });
}));

// ── DELETE /vehicles/models/:id ──────────────────────────────────────────────
router.delete('/models/:id', superadminOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('vehicle_models').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

module.exports = router;
