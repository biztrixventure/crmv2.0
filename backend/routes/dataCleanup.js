/**
 * Data Cleanup — superadmin batch find/replace for dirty field values, with
 * blank-fill and per-operation revert. Mounted at /api/data-cleanup.
 *
 *   POST /preview      { field, field_type, old_value, match_blank }
 *   POST /execute      { field, field_type, old_value, new_value, match_blank }
 *   GET  /history      → recent operations (with who + when + counts)
 *   POST /revert/:id   → undo a recorded operation (only the rows it changed)
 *
 * A form field's value lives in form_data[field] on BOTH transfers and sales,
 * and (for some fields) on a denormalized typed sales column the lists/drawers
 * read directly — so all three are cleaned together. Every run records the exact
 * row ids it touched so a revert undoes precisely that change.
 */
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');

const router = express.Router();

router.use(asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin access required' });
  next();
}));

const SALE_COL_BY_FIELD = {
  Phone: 'customer_phone', Phone2: 'customer_phone_2', Email: 'customer_email',
  CarMake: 'car_make', CarModel: 'car_model', CarVin: 'car_vin',
};
const SALE_COL_BY_TYPE = {
  sale_plan: 'plan', sale_client: 'client_name',
  sale_reference_no: 'reference_no', sale_payment_due_note: 'payment_due_note',
};
const saleColumnFor = (field, fieldType) => SALE_COL_BY_FIELD[field] || SALE_COL_BY_TYPE[fieldType] || null;

// ── counters (head:true → count only, no rows) ───────────────────────────────
async function countJsonb(table, field, value, blank) {
  const path = `form_data->>${field}`;
  let q = supabaseAdmin.from(table).select('id', { count: 'exact', head: true });
  q = blank ? q.or(`${path}.is.null,${path}.eq.`) : q.filter(path, 'eq', value);
  const { count, error } = await q;
  if (error) throw new Error(`${table}.${path}: ${error.message}`);
  return count || 0;
}
async function countColumn(table, col, value, blank) {
  let q = supabaseAdmin.from(table).select('id', { count: 'exact', head: true });
  q = blank ? q.or(`${col}.is.null,${col}.eq.`) : q.eq(col, value);
  const { count, error } = await q;
  if (error) throw new Error(`${table}.${col}: ${error.message}`);
  return count || 0;
}

// ── phone/name extraction for the preview sample ─────────────────────────────
const TRANSFER_PHONE_KEYS = ['cli_number', 'customer_phone', 'Phone', 'phone', 'Mobile', 'PhoneNumber', 'phone_number', 'CellPhone'];
const fdPhone = (fd) => { if (!fd) return ''; for (const k of TRANSFER_PHONE_KEYS) if (fd[k]) return String(fd[k]); return ''; };
const fdName  = (fd) => { if (!fd) return ''; const n = [fd.FirstName, fd.LastName].filter(Boolean).join(' ').trim(); return n || fd.customer_name || ''; };

// Sample matching rows (capped) so the operator can eyeball the phone numbers.
async function sampleJsonb(table, field, value, blank, sel, limit) {
  let q = supabaseAdmin.from(table).select(sel).limit(limit);
  q = blank ? q.or(`form_data->>${field}.is.null,form_data->>${field}.eq.`) : q.filter(`form_data->>${field}`, 'eq', value);
  const { data } = await q;
  return data || [];
}
async function sampleColumn(table, col, value, blank, sel, limit) {
  let q = supabaseAdmin.from(table).select(sel).limit(limit);
  q = blank ? q.or(`${col}.is.null,${col}.eq.`) : q.eq(col, value);
  const { data } = await q;
  return data || [];
}

const parseBody = (b) => ({
  field:      String(b.field || '').trim(),
  fieldType:  String(b.field_type || '').trim(),
  oldValue:   b.old_value == null ? '' : String(b.old_value),
  newValue:   b.new_value == null ? '' : String(b.new_value),
  matchBlank: !!b.match_blank,
});

// ── POST /preview ─────────────────────────────────────────────────────────────
router.post('/preview', asyncHandler(async (req, res) => {
  const { field, fieldType, oldValue, matchBlank } = parseBody(req.body);
  if (!field) return res.status(400).json({ error: 'field is required' });
  if (!matchBlank && oldValue === '') return res.status(400).json({ error: 'old_value is required (or enable blank matching)' });

  const col = saleColumnFor(field, fieldType);
  const SAMPLE = 200;
  const [transfers_form_data, sales_form_data, sales_column, tRows, sRows, cRows] = await Promise.all([
    countJsonb('transfers', field, oldValue, matchBlank),
    countJsonb('sales', field, oldValue, matchBlank),
    col ? countColumn('sales', col, oldValue, matchBlank) : Promise.resolve(0),
    sampleJsonb('transfers', field, oldValue, matchBlank, 'id, normalized_phone, form_data', SAMPLE),
    sampleJsonb('sales', field, oldValue, matchBlank, 'id, customer_phone, customer_name', SAMPLE),
    col ? sampleColumn('sales', col, oldValue, matchBlank, 'id, customer_phone, customer_name', SAMPLE) : Promise.resolve([]),
  ]);

  // Build a de-duplicated sample (per source+id) of phone + name so the operator
  // can verify exactly which records will change before running it.
  const seen = new Set();
  const samples = [];
  const push = (source, id, phone, name) => {
    const key = `${source}:${id}`;
    if (seen.has(key)) return; seen.add(key);
    if (phone || name) samples.push({ source, phone: phone || '', name: name || '' });
  };
  tRows.forEach(r => push('transfer', r.id, r.normalized_phone || fdPhone(r.form_data), fdName(r.form_data)));
  sRows.forEach(r => push('sale', r.id, r.customer_phone, r.customer_name));
  cRows.forEach(r => push('sale', r.id, r.customer_phone, r.customer_name));

  const total = transfers_form_data + sales_form_data + sales_column;
  res.json({
    field, old_value: oldValue, match_blank: matchBlank, column: col,
    counts: { transfers_form_data, sales_form_data, sales_column },
    total,
    samples: samples.slice(0, SAMPLE),
    sample_truncated: total > Math.min(samples.length, SAMPLE),
  });
}));

// ── POST /execute ─────────────────────────────────────────────────────────────
router.post('/execute', asyncHandler(async (req, res) => {
  const { field, fieldType, oldValue, newValue, matchBlank } = parseBody(req.body);
  if (!field || newValue === '') return res.status(400).json({ error: 'field and new_value are required' });
  if (!matchBlank && oldValue === '') return res.status(400).json({ error: 'old_value is required (or enable blank matching)' });
  if (!matchBlank && oldValue === newValue) return res.status(400).json({ error: 'Old and new values are identical' });

  const col = saleColumnFor(field, fieldType);
  const affected = { transfers: [], sales_form: [], sales_col: [] };

  // JSONB form_data (one UPDATE per table; returns the changed ids).
  for (const table of ['transfers', 'sales']) {
    const { data, error } = await supabaseAdmin.rpc('app_data_cleanup_jsonb', {
      p_table: table, p_field: field, p_old: oldValue, p_new: newValue, p_match_blank: matchBlank,
    });
    if (error) {
      const hint = /function .* does not exist/i.test(error.message)
        ? ' — apply migration 094_data_cleanup_history.sql first.' : '';
      return res.status(500).json({ error: `Cleanup failed on ${table}: ${error.message}${hint}` });
    }
    // A SETOF uuid RPC comes back as ['uuid', …] or [{<fn>: 'uuid'}, …]
    // depending on PostgREST version — normalize both to a flat id list.
    affected[table === 'transfers' ? 'transfers' : 'sales_form'] =
      (data || []).map(r => (typeof r === 'string' ? r : (r && (r.id || Object.values(r)[0])))).filter(Boolean);
  }

  // Denormalized sales column copy.
  if (col) {
    let q = supabaseAdmin.from('sales').update({ [col]: newValue });
    q = matchBlank ? q.or(`${col}.is.null,${col}.eq.`) : q.eq(col, oldValue);
    const { data, error } = await q.select('id');
    if (error) return res.status(500).json({ error: `Cleanup failed on sales.${col}: ${error.message}` });
    affected.sales_col = (data || []).map(r => r.id);
  }

  const counts = {
    transfers_form_data: affected.transfers.length,
    sales_form_data: affected.sales_form.length,
    sales_column: affected.sales_col.length,
  };
  const total = counts.transfers_form_data + counts.sales_form_data + counts.sales_column;

  // Record the operation so it can be reverted later (best-effort: a failed log
  // never undoes the cleanup that already landed).
  let opId = null;
  try {
    const { data: op } = await supabaseAdmin.from('data_cleanup_operations').insert({
      field, field_type: fieldType || null, sale_column: col, match_blank: matchBlank,
      old_value: matchBlank ? null : oldValue, new_value: newValue,
      affected, counts: { ...counts, total }, performed_by: req.user.id,
    }).select('id').single();
    opId = op?.id || null;
  } catch { /* non-critical */ }

  res.json({ updated: total, detail: counts, column: col, operation_id: opId });
}));

// ── GET /history ──────────────────────────────────────────────────────────────
router.get('/history', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('data_cleanup_operations')
    .select('id, field, field_type, sale_column, match_blank, old_value, new_value, counts, performed_by, performed_at, reverted_at, reverted_by')
    .order('performed_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });

  const ids = [...new Set((data || []).flatMap(o => [o.performed_by, o.reverted_by]).filter(Boolean))];
  let names = {};
  if (ids.length) {
    const { data: profs } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
    (profs || []).forEach(p => { names[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Superadmin'; });
  }
  res.json({
    operations: (data || []).map(o => ({
      ...o,
      performed_by_name: names[o.performed_by] || 'Superadmin',
      reverted_by_name: o.reverted_by ? (names[o.reverted_by] || 'Superadmin') : null,
    })),
  });
}));

// ── POST /revert/:id ──────────────────────────────────────────────────────────
router.post('/revert/:id', asyncHandler(async (req, res) => {
  const { data: op, error: loadErr } = await supabaseAdmin
    .from('data_cleanup_operations').select('*').eq('id', req.params.id).maybeSingle();
  if (loadErr || !op) return res.status(404).json({ error: 'Operation not found' });
  if (op.reverted_at) return res.status(400).json({ error: 'This operation was already reverted' });

  const aff = op.affected || {};
  let restored = 0;

  // Revert JSONB: set the field back to the old value, or unset it when the
  // rows were originally blank.
  for (const [table, key] of [['transfers', 'transfers'], ['sales', 'sales_form']]) {
    const idArr = aff[key] || [];
    if (!idArr.length) continue;
    const { data, error } = await supabaseAdmin.rpc('app_data_cleanup_jsonb_restore', {
      p_table: table, p_field: op.field, p_ids: idArr,
      p_value: op.old_value, p_unset: !!op.match_blank,
    });
    if (error) return res.status(500).json({ error: `Revert failed on ${table}: ${error.message}` });
    restored += Number(data) || 0;
  }

  // Revert the sales column copy.
  if (op.sale_column && (aff.sales_col || []).length) {
    const revertVal = op.match_blank ? null : op.old_value;
    const { data, error } = await supabaseAdmin
      .from('sales').update({ [op.sale_column]: revertVal }).in('id', aff.sales_col).select('id');
    if (error) return res.status(500).json({ error: `Revert failed on sales.${op.sale_column}: ${error.message}` });
    restored += (data || []).length;
  }

  await supabaseAdmin.from('data_cleanup_operations')
    .update({ reverted_at: new Date().toISOString(), reverted_by: req.user.id }).eq('id', op.id);

  res.json({ reverted: restored });
}));

module.exports = router;
