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
const { lookupZip } = require('../utils/zipLookup');

const router = express.Router();

// Field-name variants used by geo-fill (set/read city, state, zip in form_data).
const CITY_KEYS  = ['City', 'city', 'customer_city'];
const STATE_KEYS = ['State', 'state', 'customer_state'];
const ZIP_KEYS   = ['Zip', 'zip', 'ZipCode', 'zip_code', 'customer_zip', 'PostalCode', 'Postal'];
const firstZip   = (fd) => { for (const k of ZIP_KEYS) { const v = fd && fd[k]; if (v != null && String(v).trim() !== '') return String(v).trim(); } return ''; };
const blankAll   = (fd, keys) => !keys.some(k => fd && fd[k] != null && String(fd[k]).trim() !== '');

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

// Escape LIKE metacharacters so a search for "60%" or "a_b" matches literally.
const likeEscape = (s) => String(s).replace(/[\\%_]/g, '\\$&');

// Apply the chosen match to a query: blank | contains (case-insensitive
// substring) | exact (default). Used by every count/sample/distinct helper so
// all three datasets share one matching rule.
const applyJsonbMatch = (q, field, value, blank, mode) => {
  const path = `form_data->>${field}`;
  if (blank) return q.or(`${path}.is.null,${path}.eq.`);
  if (mode === 'contains') return q.filter(path, 'ilike', `%${likeEscape(value)}%`);
  return q.filter(path, 'eq', value);
};
const applyColMatch = (q, col, value, blank, mode) => {
  if (blank) return q.or(`${col}.is.null,${col}.eq.`);
  if (mode === 'contains') return q.ilike(col, `%${likeEscape(value)}%`);
  return q.eq(col, value);
};

// ── counters (head:true → count only, no rows) ───────────────────────────────
async function countJsonb(table, field, value, blank, mode) {
  let q = supabaseAdmin.from(table).select('id', { count: 'exact', head: true });
  q = applyJsonbMatch(q, field, value, blank, mode);
  const { count, error } = await q;
  if (error) throw new Error(`${table}.form_data->>${field}: ${error.message}`);
  return count || 0;
}
async function countColumn(table, col, value, blank, mode) {
  let q = supabaseAdmin.from(table).select('id', { count: 'exact', head: true });
  q = applyColMatch(q, col, value, blank, mode);
  const { count, error } = await q;
  if (error) throw new Error(`${table}.${col}: ${error.message}`);
  return count || 0;
}

// Distinct field values among matching rows (so a "contains" search surfaces
// every junk variant — 60k, 150K, "60k mi" — with how many rows each has).
async function distinctValues(field, value, blank, mode, cap = 2000) {
  const counts = new Map();
  for (const table of ['transfers', 'sales']) {
    let q = supabaseAdmin.from(table).select('form_data').limit(cap);
    q = applyJsonbMatch(q, field, value, blank, mode);
    const { data } = await q;
    (data || []).forEach(r => {
      const v = r.form_data ? r.form_data[field] : undefined;
      const key = (v == null || v === '') ? '' : String(v);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 80);
}

// ── phone/name extraction for the preview sample ─────────────────────────────
const TRANSFER_PHONE_KEYS = ['cli_number', 'customer_phone', 'Phone', 'phone', 'Mobile', 'PhoneNumber', 'phone_number', 'CellPhone'];
const fdPhone = (fd) => { if (!fd) return ''; for (const k of TRANSFER_PHONE_KEYS) if (fd[k]) return String(fd[k]); return ''; };
const fdName  = (fd) => { if (!fd) return ''; const n = [fd.FirstName, fd.LastName].filter(Boolean).join(' ').trim(); return n || fd.customer_name || ''; };

// Sample matching rows (capped) so the operator can eyeball the phone numbers.
async function sampleJsonb(table, field, value, blank, mode, sel, limit) {
  let q = supabaseAdmin.from(table).select(sel).limit(limit);
  q = applyJsonbMatch(q, field, value, blank, mode);
  const { data } = await q;
  return data || [];
}
async function sampleColumn(table, col, value, blank, mode, sel, limit) {
  let q = supabaseAdmin.from(table).select(sel).limit(limit);
  q = applyColMatch(q, col, value, blank, mode);
  const { data } = await q;
  return data || [];
}

const parseBody = (b) => ({
  field:      String(b.field || '').trim(),
  fieldType:  String(b.field_type || '').trim(),
  oldValue:   b.old_value == null ? '' : String(b.old_value),
  newValue:   b.new_value == null ? '' : String(b.new_value),
  matchBlank: !!b.match_blank,
  mode:       b.mode === 'contains' ? 'contains' : 'exact',
  // Multi-field search: [{ name, field_type }] (or bare names).
  fields: Array.isArray(b.fields)
    ? b.fields.map(f => (typeof f === 'string'
        ? { name: String(f).trim(), field_type: '' }
        : { name: String(f?.name || '').trim(), field_type: String(f?.field_type || '').trim() }))
        .filter(f => f.name)
    : null,
});

const MAX_FIELDS = 12;

// One field's preview: counts across transfers/sales (+ sale column) + the
// distinct matching values + a small phone/name sample.
async function previewField(field, fieldType, oldValue, matchBlank, mode) {
  const col = saleColumnFor(field, fieldType);
  const SAMPLE = 60;
  const [transfers_form_data, sales_form_data, sales_column, tRows, sRows, cRows, values] = await Promise.all([
    countJsonb('transfers', field, oldValue, matchBlank, mode),
    countJsonb('sales', field, oldValue, matchBlank, mode),
    col ? countColumn('sales', col, oldValue, matchBlank, mode) : Promise.resolve(0),
    sampleJsonb('transfers', field, oldValue, matchBlank, mode, 'id, normalized_phone, form_data', SAMPLE),
    sampleJsonb('sales', field, oldValue, matchBlank, mode, 'id, customer_phone, customer_name', SAMPLE),
    col ? sampleColumn('sales', col, oldValue, matchBlank, mode, 'id, customer_phone, customer_name', SAMPLE) : Promise.resolve([]),
    distinctValues(field, oldValue, matchBlank, mode),
  ]);

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
  return {
    field, field_type: fieldType, column: col,
    counts: { transfers_form_data, sales_form_data, sales_column },
    total, values,
    samples: samples.slice(0, SAMPLE),
    sample_truncated: total > Math.min(samples.length, SAMPLE),
  };
}

// ── POST /preview ─────────────────────────────────────────────────────────────
// Body: { field?, field_type?, fields?:[{name,field_type}], old_value, match_blank, mode }
// Searches ONE or MANY fields; returns a per-field result so dirty data can be
// found across many fields at once. (Replace/execute stays single-field.)
router.post('/preview', asyncHandler(async (req, res) => {
  const { field, fieldType, oldValue, matchBlank, mode, fields } = parseBody(req.body);
  const list = (fields && fields.length ? fields : (field ? [{ name: field, field_type: fieldType }] : [])).slice(0, MAX_FIELDS);
  if (!list.length) return res.status(400).json({ error: 'select at least one field' });
  if (!matchBlank && oldValue === '') return res.status(400).json({ error: 'a search value is required (or enable blank matching)' });

  const results = await Promise.all(list.map(f => previewField(f.name, f.field_type, oldValue, matchBlank, mode)));
  const grand_total = results.reduce((s, r) => s + r.total, 0);

  res.json({
    old_value: oldValue, match_blank: matchBlank, mode,
    results,                // [{ field, field_type, column, counts, total, values, samples, sample_truncated }]
    grand_total,
    // Back-compat single-field shape (first result) so nothing old breaks.
    ...(results[0] ? { field: results[0].field, column: results[0].column, counts: results[0].counts, total: results[0].total, values: results[0].values, samples: results[0].samples, sample_truncated: results[0].sample_truncated } : {}),
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

  // Bulk-by-id / geo-fill ops store a per-row before-snapshot — restore each.
  if (Array.isArray(aff.bulk) && aff.bulk.length) {
    let restoredBulk = 0;
    for (const ent of aff.bulk) {
      const tbl = ent.table === 'transfers' ? 'transfers' : 'sales';
      const { data: cur } = await supabaseAdmin.from(tbl).select('form_data').eq('id', ent.id).maybeSingle();
      if (!cur) continue;
      const fd = { ...(cur.form_data || {}) };
      Object.entries(ent.before?.form || {}).forEach(([k, v]) => { if (v == null) delete fd[k]; else fd[k] = v; });
      const upd = { form_data: fd };
      Object.entries(ent.before?.col || {}).forEach(([c, v]) => { upd[c] = v; });
      const { error } = await supabaseAdmin.from(tbl).update(upd).eq('id', ent.id);
      if (!error) restoredBulk++;
    }
    await supabaseAdmin.from('data_cleanup_operations')
      .update({ reverted_at: new Date().toISOString(), reverted_by: req.user.id }).eq('id', op.id);
    return res.json({ reverted: restoredBulk });
  }

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

// ── POST /bulk-by-id — update specific records by their id ───────────────────
// Body: { table:'sales'|'transfers', fields:[{name,field_type}], rows:[{id,values:[]}],
//         fill_geo?, dry_run? }. Each row's `values` line up positionally with
// `fields`. Empty cell = leave that field unchanged. Reports per-row status
// (updated / not_found / no_change / error) so mismatched ids are surfaced.
router.post('/bulk-by-id', asyncHandler(async (req, res) => {
  const table = req.body?.table === 'transfers' ? 'transfers' : (req.body?.table === 'sales' ? 'sales' : null);
  if (!table) return res.status(400).json({ error: "table must be 'sales' or 'transfers'" });
  const fields = Array.isArray(req.body?.fields)
    ? req.body.fields.map(f => ({ name: String(f?.name || '').trim(), field_type: String(f?.field_type || '').trim() })).filter(f => f.name)
    : [];
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const fillGeo = !!req.body?.fill_geo;
  const dryRun = !!req.body?.dry_run;
  if (!fields.length && !fillGeo) return res.status(400).json({ error: 'select at least one field to update' });
  if (!rows.length) return res.status(400).json({ error: 'no rows provided' });
  if (rows.length > 5000) return res.status(400).json({ error: 'max 5000 rows per run' });

  const ids = [...new Set(rows.map(r => String(r.id || '').trim()).filter(Boolean))];
  const saleCols = ', customer_phone, customer_phone_2, customer_email, car_make, car_model, car_vin, plan, client_name, reference_no, payment_due_note';
  const sel = 'id, form_data' + (table === 'sales' ? saleCols : '');
  const existing = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabaseAdmin.from(table).select(sel).in('id', ids.slice(i, i + 200));
    if (error) return res.status(500).json({ error: error.message });
    (data || []).forEach(r => existing.set(r.id, r));
  }

  const results = [], snapshot = [];
  let updated = 0, notFound = 0, errored = 0, geoFilled = 0, noChange = 0;

  // ── Phase 1: build every row's patch + column set + before-snapshot in memory
  // (no DB writes here). fd = the merged form_data, used for geo + city/state key
  // detection. Nothing here awaits, so 4000 rows are prepared instantly.
  const prepared = [];          // { id, fd, patch, cols, before, changed }
  const geoNeed  = [];          // { entry, zip }
  for (const raw of rows) {
    const id = String(raw.id || '').trim();
    const values = Array.isArray(raw.values) ? raw.values : [];
    if (!id) { results.push({ id: '', status: 'error', message: 'missing id' }); errored++; continue; }
    const rec = existing.get(id);
    if (!rec) { results.push({ id, status: 'not_found' }); notFound++; continue; }

    const fd = { ...(rec.form_data || {}) };
    const before = { form: {}, col: {} };
    const changed = {}, patch = {}, cols = {};
    fields.forEach((f, i) => {
      const v = values[i];
      if (v == null || String(v).trim() === '') return;        // empty cell → unchanged
      const val = String(v).trim();
      before.form[f.name] = rec.form_data ? (rec.form_data[f.name] ?? null) : null;
      fd[f.name] = val; patch[f.name] = val; changed[f.name] = val;
      const col = table === 'sales' ? saleColumnFor(f.name, f.field_type) : null;
      if (col) { before.col[col] = rec[col] ?? null; cols[col] = val; }
    });

    const entry = { id, fd, patch, cols, before, changed };
    prepared.push(entry);
    if (fillGeo) { const z = firstZip(fd); if (z) geoNeed.push({ entry, zip: z }); }
  }

  // ── Phase 2: geo — look up each DISTINCT zip once, in parallel (the util caches
  // repeats), then stamp city/state onto each row's patch. 4000 rows sharing a
  // few hundred zips = a few hundred lookups, batched, not one-per-row serial.
  if (fillGeo && geoNeed.length) {
    const distinct = [...new Set(geoNeed.map(g => g.zip))];
    const geoMap = new Map();
    const CONC = 12;
    for (let i = 0; i < distinct.length; i += CONC) {
      const slice = distinct.slice(i, i + CONC);
      const got = await Promise.all(slice.map(z => lookupZip(z).catch(() => null)));
      slice.forEach((z, k) => geoMap.set(z, got[k]));
    }
    for (const { entry, zip } of geoNeed) {
      const geo = geoMap.get(zip);
      if (!geo || !geo.city || !geo.state) continue;
      const cityKey = CITY_KEYS.find(k => k in entry.fd) || 'City';
      const stKey   = STATE_KEYS.find(k => k in entry.fd) || 'State';
      if (!(cityKey in entry.before.form)) entry.before.form[cityKey] = entry.fd[cityKey] ?? null;
      if (!(stKey in entry.before.form))   entry.before.form[stKey]   = entry.fd[stKey] ?? null;
      entry.fd[cityKey] = geo.city; entry.fd[stKey] = geo.state;
      entry.patch[cityKey] = geo.city; entry.patch[stKey] = geo.state;
      entry.changed[cityKey] = geo.city; entry.changed[stKey] = geo.state;
      geoFilled++;
    }
  }

  // ── Phase 3: finalize. Skip no-change rows; collect the rest for one bulk write.
  const toWrite = [];
  for (const e of prepared) {
    if (!Object.keys(e.changed).length) { results.push({ id: e.id, status: 'no_change' }); noChange++; continue; }
    if (dryRun) { results.push({ id: e.id, status: 'would_update', changed: e.changed }); updated++; continue; }
    toWrite.push(e);
    results.push({ id: e.id, status: 'updated', changed: e.changed });
    updated++;
  }

  // ── Phase 4: ONE bulk UPDATE per chunk via the RPC (thousands of rows in <1s).
  // Falls back to per-row updates if migration 143 isn't applied yet.
  if (!dryRun && toWrite.length) {
    const rpcRows = toWrite.map(e => table === 'sales' ? { id: e.id, patch: e.patch, cols: e.cols } : { id: e.id, patch: e.patch });
    let rpcMissing = false;
    for (let i = 0; i < rpcRows.length; i += 1000) {
      const chunk = rpcRows.slice(i, i + 1000);
      const { error } = await supabaseAdmin.rpc('app_bulk_update_by_id', { p_table: table, p_rows: chunk });
      if (error) {
        if (/function .* does not exist/i.test(error.message) || error.code === 'PGRST202') { rpcMissing = true; break; }
        return res.status(500).json({ error: `Bulk update failed: ${error.message}` });
      }
    }
    if (rpcMissing) {
      // Legacy path (slow) — only hit before migration 143 is applied.
      for (const e of toWrite) {
        await supabaseAdmin.from(table).update({ form_data: e.fd, ...e.cols }).eq('id', e.id).then(() => {}, () => {});
      }
    }
    toWrite.forEach(e => snapshot.push({ table, id: e.id, before: e.before }));
  }

  let opId = null;
  if (!dryRun && snapshot.length) {
    try {
      const { data: op } = await supabaseAdmin.from('data_cleanup_operations').insert({
        field: `(bulk by id: ${fields.map(f => f.name).join(', ') || 'geo'})`, field_type: 'bulk_by_id',
        sale_column: null, match_blank: false, old_value: null, new_value: `${updated} row(s)`,
        affected: { bulk: snapshot }, counts: { updated, not_found: notFound, errored, geo_filled: geoFilled, total: updated },
        performed_by: req.user.id,
      }).select('id').single();
      opId = op?.id || null;
    } catch { /* non-critical */ }
  }

  res.json({ summary: { updated, not_found: notFound, errored, geo_filled: geoFilled, no_change: noChange, dry_run: dryRun }, results, operation_id: opId });
}));

// ── POST /fill-geo — fetch + fill City/State from ZIP where missing ──────────
// Body: { table, dry_run?, limit? }. Scans rows that have a ZIP but a blank
// city or state and fills them from the ZIP lookup.
router.post('/fill-geo', asyncHandler(async (req, res) => {
  const table = req.body?.table === 'transfers' ? 'transfers' : (req.body?.table === 'sales' ? 'sales' : null);
  if (!table) return res.status(400).json({ error: "table must be 'sales' or 'transfers'" });
  const dryRun = !!req.body?.dry_run;
  const limit = Math.min(parseInt(req.body?.limit, 10) || 200, 500);

  const { data, error } = await supabaseAdmin.from(table)
    .select('id, form_data').not('form_data->>Zip', 'is', null).limit(limit * 4);
  if (error) return res.status(500).json({ error: error.message });

  const candidates = (data || []).filter(r => {
    const fd = r.form_data || {};
    return firstZip(fd) && (blankAll(fd, CITY_KEYS) || blankAll(fd, STATE_KEYS));
  }).slice(0, limit);

  const results = [], snapshot = [];
  let filled = 0, failed = 0;
  for (const r of candidates) {
    const fd = { ...(r.form_data || {}) };
    const zipVal = firstZip(fd);
    const geo = await lookupZip(zipVal);
    if (!geo || !geo.city || !geo.state) { results.push({ id: r.id, zip: zipVal, status: 'zip_not_found' }); failed++; continue; }
    const cityKey = CITY_KEYS.find(k => k in fd) || 'City';
    const stKey   = STATE_KEYS.find(k => k in fd) || 'State';
    const before  = { form: { [cityKey]: fd[cityKey] ?? null, [stKey]: fd[stKey] ?? null }, col: {} };
    if (!dryRun) {
      fd[cityKey] = geo.city; fd[stKey] = geo.state;
      const { error: uErr } = await supabaseAdmin.from(table).update({ form_data: fd }).eq('id', r.id);
      if (uErr) { results.push({ id: r.id, zip: zipVal, status: 'error', message: uErr.message }); failed++; continue; }
      snapshot.push({ table, id: r.id, before });
    }
    results.push({ id: r.id, zip: zipVal, city: geo.city, state: geo.state, status: dryRun ? 'would_fill' : 'filled' });
    filled++;
  }

  let opId = null;
  if (!dryRun && snapshot.length) {
    try {
      const { data: op } = await supabaseAdmin.from('data_cleanup_operations').insert({
        field: `(geo-fill city/state: ${table})`, field_type: 'fill_geo', sale_column: null, match_blank: false,
        old_value: null, new_value: `${filled} row(s)`, affected: { bulk: snapshot },
        counts: { filled, failed, total: filled }, performed_by: req.user.id,
      }).select('id').single();
      opId = op?.id || null;
    } catch { /* non-critical */ }
  }
  res.json({ summary: { filled, failed, scanned: (data || []).length, candidates: candidates.length, dry_run: dryRun }, results: results.slice(0, 200), operation_id: opId });
}));

module.exports = router;
