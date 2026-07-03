const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { getReference, classifyChunk, confirmUpload, createTransferFromRow } = require('../utils/saleUploadService');

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
  const result = await confirmUpload({ newRows, updateRows, batchMeta }, req.user.id);
  if (result?.error) return res.status(400).json({ error: result.error });
  res.json(result);
}));

// POST /sale-uploads/create-transfer — create the missing transfer for an
// unmatched sale row, inline, so it can match without leaving the page.
router.post('/create-transfer', asyncHandler(async (req, res) => {
  const row = req.body?.row;
  if (!row || typeof row !== 'object') return res.status(400).json({ error: 'A sale row is required.' });
  const result = await createTransferFromRow(row);
  if (!result.ok) return res.status(400).json({ error: result.reason });
  res.status(201).json({ transfer: result.transfer });
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

// GET /sale-uploads/batches/:id/export — reconstruct the batch's sales in the
// re-uploadable column shape so the operator can re-upload after deleting.
router.get('/batches/:id/export', asyncHandler(async (req, res) => {
  const batchId = req.params.id;
  const { data: batch } = await supabaseAdmin
    .from('upload_batches').select('id, file_name, kind').eq('id', batchId).maybeSingle();
  if (!batch || batch.kind !== 'sale') return res.status(404).json({ error: 'Sale batch not found.' });

  const sales = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('sales').select('*').eq('upload_batch_id', batchId)
      .order('created_at', { ascending: true }).range(from, from + 999);
    if (error) return res.status(500).json({ error: error.message });
    if (!data || !data.length) break;
    sales.push(...data);
    if (data.length < 1000) break;
  }

  // Egress governance: gate + log this batch re-export.
  const { enforceEgress } = require('../utils/egressGuard');
  const egress = await enforceEgress({ user: req.user, actionType: 'csv_export', dataset: 'upload_batch', surface: 'sale_upload_batch_export', rowCount: sales.length, filters: { batch_id: batchId } });
  if (!egress.allowed) return res.status(429).json({ error: egress.message, code: 'EGRESS_LIMIT', limit: egress.limit });

  const coIds = [...new Set(sales.map(s => s.company_id).filter(Boolean))];
  const uIds  = [...new Set(sales.flatMap(s => [s.fronter_id, s.closer_id]).filter(Boolean))];
  const [{ data: cos }, { data: profs }] = await Promise.all([
    coIds.length ? supabaseAdmin.from('companies').select('id, name').in('id', coIds) : Promise.resolve({ data: [] }),
    uIds.length ? supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', uIds) : Promise.resolve({ data: [] }),
  ]);
  const coName = {}; (cos || []).forEach(c => { coName[c.id] = c.name; });
  const nm = {}; (profs || []).forEach(p => { nm[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });

  res.json({
    file_name: batch.file_name,
    count: sales.length,
    sales: sales.map(s => ({
      ...s,
      company_name: coName[s.company_id] || '',
      fronter_name: nm[s.fronter_id] || '',
      closer_name:  nm[s.closer_id] || '',
    })),
  });
}));

// DELETE /sale-uploads/batches/:id — delete a sale batch (inserted sales cascade)
router.delete('/batches/:id', asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('upload_batches').delete().eq('id', req.params.id).eq('kind', 'sale');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Batch deleted' });
}));

// DELETE /sale-uploads/bulk — delete ALL bulk-uploaded sale batches (sales cascade)
router.delete('/bulk', asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('upload_batches').delete().eq('kind', 'sale');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'All bulk-uploaded sale data deleted' });
}));

module.exports = router;
