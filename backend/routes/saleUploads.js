const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { getReference, classifyChunk, confirmUpload } = require('../utils/saleUploadService');

const router = express.Router();

// Superadmin-only across the whole router.
router.use(asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin access required' });
  next();
}));

// GET /sale-uploads/reference — companies+fronters and closers (valid-names guide + resolution)
router.get('/reference', asyncHandler(async (req, res) => {
  res.json(await getReference());
}));

// GET /sale-uploads/mapping — saved global sale column mapping
router.get('/mapping', asyncHandler(async (req, res) => {
  const { data } = await supabaseAdmin
    .from('upload_column_mappings').select('mapping').eq('scope', 'sales').maybeSingle();
  res.json({ mapping: data?.mapping || null });
}));

// POST /sale-uploads/mapping — save global sale column mapping
router.post('/mapping', asyncHandler(async (req, res) => {
  const mapping = req.body?.mapping;
  if (!mapping || typeof mapping !== 'object') return res.status(400).json({ error: 'mapping object required' });
  const { data, error } = await supabaseAdmin
    .from('upload_column_mappings')
    .upsert({ scope: 'sales', mapping, updated_by: req.user.id, updated_at: new Date().toISOString() }, { onConflict: 'scope' })
    .select('mapping').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ mapping: data.mapping });
}));

// POST /sale-uploads/validate-chunk — classify up to 100 rows
router.post('/validate-chunk', asyncHandler(async (req, res) => {
  if (req.body?.rows !== undefined && !Array.isArray(req.body.rows)) {
    return res.status(400).json({ error: '"rows" must be an array of records.' });
  }
  const rows = (Array.isArray(req.body?.rows) ? req.body.rows : []).filter(r => r && typeof r === 'object');
  if (rows.length > 100) return res.status(400).json({ error: 'Too many rows in one chunk (max 100). Reduce the chunk size and retry.' });
  if (!rows.length) return res.json({ newSales: [], updates: [], skipped: [], unmatched: [], ambiguous: [] });
  res.json(await classifyChunk(rows));
}));

// POST /sale-uploads/confirm — insert new sales + apply confirmed updates
router.post('/confirm', asyncHandler(async (req, res) => {
  const newRows    = (Array.isArray(req.body?.newRows) ? req.body.newRows : []).filter(r => r && typeof r === 'object');
  const updateRows = (Array.isArray(req.body?.updateRows) ? req.body.updateRows : []).filter(r => r && typeof r === 'object');
  if (!newRows.length && !updateRows.length) return res.status(400).json({ error: 'Nothing to insert or update.' });
  const batchMeta = (req.body?.batch && typeof req.body.batch === 'object') ? req.body.batch : {};
  res.json(await confirmUpload({ newRows, updateRows, batchMeta }, req.user.id));
}));

// GET /sale-uploads/batches — list sale batches
router.get('/batches', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('upload_batches').select('*').eq('kind', 'sale').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const ids = [...new Set((data || []).map(b => b.uploaded_by).filter(Boolean))];
  let names = {};
  if (ids.length) {
    const { data: profiles } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
    (profiles || []).forEach(p => { names[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });
  }
  res.json({ batches: (data || []).map(b => ({ ...b, uploaded_by_name: names[b.uploaded_by] || '—' })) });
}));

// DELETE /sale-uploads/batches/:id — delete a sale batch (inserted sales cascade)
router.delete('/batches/:id', asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('upload_batches').delete().eq('id', req.params.id).eq('kind', 'sale');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Batch deleted' });
}));

module.exports = router;
