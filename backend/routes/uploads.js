const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const {
  getReference, buildIndex, resolveRow, classifyChunk, insertApproved,
  findDuplicateTransferGroups, mergeDuplicateTransfers,
} = require('../utils/uploadService');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = express.Router();

// Superadmin-only across the whole router.
router.use(asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  next();
}));

// GET /uploads/reference — companies + their fronters (valid-names guide + resolution)
router.get('/reference', asyncHandler(async (req, res) => {
  res.json({ companies: await getReference() });
}));

// GET /uploads/mapping — saved global column mapping
router.get('/mapping', asyncHandler(async (req, res) => {
  const { data } = await supabaseAdmin
    .from('upload_column_mappings').select('mapping').eq('scope', 'global').maybeSingle();
  res.json({ mapping: data?.mapping || null });
}));

// POST /uploads/mapping — save global column mapping
router.post('/mapping', asyncHandler(async (req, res) => {
  const mapping = req.body?.mapping;
  if (!mapping || typeof mapping !== 'object') return res.status(400).json({ error: 'mapping object required' });

  const { data, error } = await supabaseAdmin
    .from('upload_column_mappings')
    .upsert({ scope: 'global', mapping, updated_by: req.user.id, updated_at: new Date().toISOString() },
            { onConflict: 'scope' })
    .select('mapping').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ mapping: data.mapping });
}));

// POST /uploads/validate-chunk — classify up to 100 rows against the DB
// Body: { rows: [{ cli_number, fronter_name, company_name, transfer_date, status, created_at, custom_fields }] }
// Returns: { clean, trueDuplicates, conflicts, unmatched }
router.post('/validate-chunk', asyncHandler(async (req, res) => {
  if (req.body?.rows !== undefined && !Array.isArray(req.body.rows)) {
    return res.status(400).json({ error: '"rows" must be an array of records.' });
  }
  const rows = (Array.isArray(req.body?.rows) ? req.body.rows : []).filter(r => r && typeof r === 'object');
  if (rows.length > 100) return res.status(400).json({ error: 'Too many rows in one chunk (max 100). Reduce the chunk size and retry.' });
  if (!rows.length) return res.json({ clean: [], trueDuplicates: [], conflicts: [], unmatched: [] });

  const index = buildIndex(await getReference());

  // Resolve names → IDs first; unresolved rows never reach the DB scan.
  const resolved = [], unmatched = [];
  for (const row of rows) {
    const r = resolveRow(row, index);
    if (!r.ok) { unmatched.push({ ...row, reason: r.reason }); continue; }
    resolved.push({ ...row, company_id: r.company_id, company_name: r.company_name, fronter_user_id: r.fronter_user_id, fronter_name: r.fronter_name });
  }

  const { clean, trueDuplicates, conflicts } = await classifyChunk(resolved);
  res.json({ clean, trueDuplicates, conflicts, unmatched });
}));

// POST /uploads/confirm — insert approved rows (clean + user-included conflicts)
// Body: { rows: [...resolved rows], batch: { file_name, total_rows, skipped_count, conflict_count } }
router.post('/confirm', asyncHandler(async (req, res) => {
  if (req.body?.rows !== undefined && !Array.isArray(req.body.rows)) {
    return res.status(400).json({ error: '"rows" must be an array of records.' });
  }
  const rows  = (Array.isArray(req.body?.rows) ? req.body.rows : []).filter(r => r && typeof r === 'object');
  const batch = (req.body?.batch && typeof req.body.batch === 'object') ? req.body.batch : {};
  if (!rows.length) return res.status(400).json({ error: 'No valid rows to insert.' });

  // Trust-but-verify: every row must still resolve to a real fronter + company.
  const index = buildIndex(await getReference());
  const valid = [];
  for (const row of rows) {
    const r = resolveRow(row, index);
    if (r.ok) valid.push({ ...row, company_id: r.company_id, fronter_user_id: r.fronter_user_id, fronter_name: r.fronter_name, company_name: r.company_name });
  }
  if (!valid.length) return res.status(400).json({ error: 'No rows resolved to a valid fronter + company' });

  const result = await insertApproved(valid, batch, req.user.id);
  res.json(result);
}));

// GET /uploads/duplicate-transfers — groups of same company+fronter+phone (>1)
router.get('/duplicate-transfers', asyncHandler(async (req, res) => {
  res.json({ groups: await findDuplicateTransferGroups() });
}));

// POST /uploads/merge-duplicates — reassign children to a keeper, delete the rest
// Body: { merges: [{ keep_id, remove_ids: [uuid] }] }
router.post('/merge-duplicates', asyncHandler(async (req, res) => {
  const merges = Array.isArray(req.body?.merges) ? req.body.merges : [];
  if (!merges.length) return res.status(400).json({ error: 'No merges provided.' });

  for (const m of merges) {
    if (!m || !UUID_RE.test(m.keep_id || '')) return res.status(400).json({ error: 'Each merge needs a valid keep_id.' });
    if (!Array.isArray(m.remove_ids) || !m.remove_ids.every(id => UUID_RE.test(id || ''))) {
      return res.status(400).json({ error: 'remove_ids must be valid transfer IDs.' });
    }
    if (m.remove_ids.includes(m.keep_id)) return res.status(400).json({ error: 'keep_id cannot also be in remove_ids.' });
  }

  res.json(await mergeDuplicateTransfers(merges));
}));

// GET /uploads/batches — list upload batches (for the delete UI)
router.get('/batches', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('upload_batches').select('*').eq('kind', 'transfer').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  // Resolve uploader names
  const ids = [...new Set((data || []).map(b => b.uploaded_by).filter(Boolean))];
  let names = {};
  if (ids.length) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
    (profiles || []).forEach(p => { names[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });
  }
  res.json({ batches: (data || []).map(b => ({ ...b, uploaded_by_name: names[b.uploaded_by] || '—' })) });
}));

// DELETE /uploads/batches/:id — delete one batch (transfers cascade)
router.delete('/batches/:id', asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('upload_batches').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Batch deleted' });
}));

// DELETE /uploads/bulk — delete ALL bulk-uploaded data (every batch + its transfers)
router.delete('/bulk', asyncHandler(async (req, res) => {
  // gen_random_uuid() never collides with the all-zero UUID, so this matches every row.
  const { error } = await supabaseAdmin
    .from('upload_batches').delete().eq('kind', 'transfer');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'All bulk-uploaded data deleted' });
}));

module.exports = router;
