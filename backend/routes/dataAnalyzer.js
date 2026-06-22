// ============================================================================
// /data-analyzer — superadmin-only multi-field analytics across sales OR
// transfers. Drives one query engine for both datasets so the frontend doesn't
// have to know which fields live in typed columns vs form_data JSONB.
//
// Endpoints
//   POST /query       — paginated rows + aggregate stats for the active filter
//   POST /export      — same filter, streamed as CSV (full result, no paging)
//   POST /breakdown   — group-by counts on one field (build mini charts)
// ============================================================================

const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');

const router = express.Router();

router.use(asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin access required' });
  next();
}));

// Per-dataset config. Typed cols get direct PostgREST ops; anything else is
// treated as a form_data JSONB key.
const DATASETS = {
  sales: {
    table: 'sales',
    typed: new Set([
      'id', 'transfer_id', 'created_by', 'closer_id', 'fronter_id', 'company_id', 'status',
      'customer_name', 'customer_phone', 'customer_phone_2', 'customer_email', 'customer_address',
      'car_year', 'car_make', 'car_model', 'car_miles', 'car_vin', 'miles_num',
      'plan', 'down_payment', 'monthly_payment', 'payment_due_note', 'reference_no',
      'client_name', 'sale_date', 'closer_disposition', 'compliance_note',
      'created_at', 'updated_at', 'submitted_for_review_at', 'compliance_reviewed_at',
    ]),
    // Map a form-field name to a typed numeric column so range filters compare
    // numerically instead of lexicographically on JSONB text. miles_num is the
    // digits-only mirror of form_data.Miles (migration 102); car_year is already
    // a populated INTEGER column.
    aliases: { Miles: 'miles_num', CarYear: 'car_year' },
  },
  transfers: {
    table: 'transfers',
    typed: new Set([
      'id', 'company_id', 'created_by', 'assigned_to', 'assigned_closer_id', 'status',
      'normalized_phone', 'rejected_by', 'rejection_reason', 'rejected_at', 'rejection_count',
      'sale_reference_no', 'latest_disposition', 'created_at', 'updated_at',
    ]),
  },
};

const ALLOWED_OPS = new Set(['eq', 'neq', 'in', 'gte', 'lte', 'between', 'ilike', 'is_null', 'not_is_null']);

function applyFilter(query, f, cfg) {
  if (!f || !f.field || !ALLOWED_OPS.has(f.op)) return query;
  // Resolve an alias (e.g. Miles → miles_num) so range ops hit a numeric column.
  const field = (cfg.aliases && cfg.aliases[f.field]) || f.field;
  const isTyped = cfg.typed.has(field);
  const col = isTyped ? field : `form_data->>${field}`;
  const v   = f.value;

  switch (f.op) {
    case 'eq':         return v == null || v === '' ? query : query.filter(col, 'eq', v);
    case 'neq':        return v == null || v === '' ? query : query.filter(col, 'neq', v);
    case 'ilike':      return v == null || v === '' ? query : query.filter(col, 'ilike', `%${v}%`);
    case 'in': {
      const rawArr = Array.isArray(v) ? v.filter(x => x !== '' && x != null).map(String) : [];
      if (!rawArr.length) return query;

      // "Unspecified" sentinel — frontend appends '__UNSPECIFIED__' to the
      // state filter array when the user wants rows whose state value is
      // either NULL or not in the canonical 51-state list. Backend pulls the
      // sentinel out, applies the rest of the in.() normally, then wraps
      // everything in an OR group so the unspecified bucket surfaces too.
      // Specific to state fields because car_make/car_model already use
      // case-insensitive ilike below and "Unspecified" has no meaning there.
      const UNSPEC = '__UNSPECIFIED__';
      const hasUnspec = rawArr.includes(UNSPEC) && /\bstate\b/i.test(f.field);
      const arr = rawArr.filter(x => x !== UNSPEC);

      if (hasUnspec) {
        // After migration 067, every non-canonical / junk state value is
        // rewritten to JSON null. So the Unspecified bucket reduces to
        // is.null.
        //
        // DO NOT wrap the JSONB col ref in "..." inside an OR group — that
        // makes PostgREST treat the whole quoted string as one identifier
        // (e.g. `"form_data->>State"`) and Postgres throws "column does
        // not exist" because no such literal column is registered. Raw
        // `form_data->>State.in.(...)` is the supported syntax; PostgREST's
        // OR parser tokenizes on `.` and recognizes the JSONB operator.
        //
        // OR branches:
        //   1. col in.(user's selected canonical states) when any picked
        //   2. col is.null  (cleaned junk + originally-missing keys)
        const quote = s => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        const orParts = [];
        if (arr.length) orParts.push(`${col}.in.(${arr.map(quote).join(',')})`);
        orParts.push(`${col}.is.null`);
        return query.or(orParts.join(','));
      }

      // Car make / model are stored as-typed in the registry now ("BMW",
      // "RAV4") but legacy form_data rows carry title-cased variants ("Bmw",
      // "Rav4") from migration 059. Match case-insensitively so the chip
      // selection grabs both. Detection by name pattern keeps the matching
      // logic out of the per-field config — any field whose key contains
      // "make" or "model" gets the looser comparison.
      // Case-insensitive match for make/model AND plan — stored values drift in
      // casing/spelling ("Premium" vs "premium"), so exact in() drops rows that
      // really exist. ilike-OR matches them all.
      const isMakeOrModel = /\b(make|model)\b/i.test(f.field) || /plan/i.test(f.field);
      if (isMakeOrModel && isTyped) {
        // Typed column → OR-of-ilike works without JSONB quirks. Quote the
        // value so spaces / commas in entries like "Land Rover" don't split
        // the OR parts.
        const parts = arr.map(s => `${col}.ilike."${s.replace(/"/g, '\\"')}"`).join(',');
        return query.or(parts);
      }
      if (isMakeOrModel) {
        // JSONB key path. PostgREST's or() parser tokenizes column refs on
        // `.` and recognizes raw `form_data->>field` as JSONB access — do
        // NOT wrap the ref in "..." or Postgres reads the whole quoted
        // string as a literal column identifier and 500s on "does not exist".
        // Value-only quoting handles spaces / commas in entries like
        // "Land Rover".
        const parts = arr.map(s => `${col}.ilike."${s.replace(/"/g, '\\"')}"`).join(',');
        return query.or(parts);
      }

      // Default in.(...) for every other field — case-sensitive exact match,
      // which is what state / status / plan filters want.
      const quoted = arr.map(s => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
      return query.filter(col, 'in', `(${quoted})`);
    }
    case 'gte':         return v == null || v === '' ? query : query.filter(col, 'gte', v);
    case 'lte':         return v == null || v === '' ? query : query.filter(col, 'lte', v);
    case 'between': {
      const [lo, hi] = Array.isArray(v) ? v : [];
      let q = query;
      if (lo !== '' && lo != null) q = q.filter(col, 'gte', lo);
      if (hi !== '' && hi != null) q = q.filter(col, 'lte', hi);
      return q;
    }
    case 'is_null':     return query.filter(col, 'is', 'null');
    case 'not_is_null': return query.filter(col, 'not.is', 'null');
    default: return query;
  }
}

function pickDataset(name) {
  const d = DATASETS[name];
  if (!d) return DATASETS.sales;
  return { name, ...d };
}

// Pull ALL filtered rows up to a hard cap. Used by /export and /breakdown so
// stats are computed against the entire match, not just the page the user
// happens to be looking at.
// Pull EVERY filtered row by paging in 1000-row chunks until a short page ends
// it — no artificial cap, so aggregates / export / breakdown reflect the whole
// dataset. `columns` lets callers fetch only what they need (aggregates pull a
// few numeric columns instead of full rows, keeping a 20k-row scan cheap). A
// high safety ceiling guards against a runaway, not real data.
async function fetchAll(dataset, filters, { columns = '*', cap = 1_000_000 } = {}) {
  const cfg = pickDataset(dataset);
  const all = [];
  for (let from = 0; from < cap; from += 1000) {
    let q = supabaseAdmin.from(cfg.table).select(columns).order('created_at', { ascending: false });
    for (const f of filters) q = applyFilter(q, f, cfg);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

// Minimal column sets for the aggregate banner (avoids hauling full rows +
// form_data just to sum a couple of numbers across the whole dataset).
const AGG_COLUMNS = {
  sales:     'status,down_payment,monthly_payment,closer_id',
  transfers: 'status,created_by,assigned_closer_id',
};

// Resolve closer/fronter/company names for a result set (sales has all three;
// transfers carries created_by + assigned_closer_id, no fronter/closer split).
async function enrichNames(rows, dataset) {
  const idSet = new Set();
  const compSet = new Set();
  if (dataset === 'sales') {
    rows.forEach(r => {
      if (r.closer_id)  idSet.add(r.closer_id);
      if (r.fronter_id) idSet.add(r.fronter_id);
      if (r.company_id) compSet.add(r.company_id);
    });
  } else {
    rows.forEach(r => {
      if (r.created_by)         idSet.add(r.created_by);
      if (r.assigned_closer_id) idSet.add(r.assigned_closer_id);
      if (r.company_id)         compSet.add(r.company_id);
    });
  }
  const ids  = [...idSet];
  const cIds = [...compSet];
  const [profilesRes, companiesRes] = await Promise.all([
    ids.length  ? supabaseAdmin.from('user_profiles').select('user_id,first_name,last_name').in('user_id', ids) : { data: [] },
    cIds.length ? supabaseAdmin.from('companies').select('id,name').in('id', cIds)                              : { data: [] },
  ]);
  const profile = {}, company = {};
  (profilesRes.data || []).forEach(p => { profile[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || null; });
  (companiesRes.data || []).forEach(c => { company[c.id] = c.name; });

  if (dataset === 'sales') {
    return rows.map(r => ({
      ...r,
      closer_name:  profile[r.closer_id]  || null,
      fronter_name: profile[r.fronter_id] || null,
      company_name: company[r.company_id] || null,
    }));
  }
  return rows.map(r => ({
    ...r,
    created_by_name:      profile[r.created_by]         || null,
    assigned_closer_name: profile[r.assigned_closer_id] || null,
    company_name:         company[r.company_id]         || null,
  }));
}

// Aggregate stats — computed on the FULL filtered set (capped at 10k) so the
// banner reflects the real match, not the visible page.
function aggregateSales(rows) {
  let down = 0, monthly = 0, won = 0;
  const closers = new Set();
  rows.forEach(s => {
    down    += Number(s.down_payment    || 0);
    monthly += Number(s.monthly_payment || 0);
    if (['closed_won', 'sold'].includes(s.status)) won++;
    if (s.closer_id) closers.add(s.closer_id);
  });
  return {
    count:   rows.length,
    won,
    win_rate: rows.length ? Math.round((won / rows.length) * 100) : 0,
    down_total: down,
    monthly_total: monthly,
    avg_down:    rows.length ? Math.round(down    / rows.length) : 0,
    avg_monthly: rows.length ? Math.round(monthly / rows.length) : 0,
    distinct_closers: closers.size,
  };
}
function aggregateTransfers(rows) {
  const byStatus = {};
  const fronters = new Set();
  const closers  = new Set();
  rows.forEach(t => {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    if (t.created_by)         fronters.add(t.created_by);
    if (t.assigned_closer_id) closers.add(t.assigned_closer_id);
  });
  return {
    count: rows.length,
    by_status: byStatus,
    distinct_fronters: fronters.size,
    distinct_closers:  closers.size,
    completed: byStatus.completed || 0,
    rejected:  byStatus.rejected  || 0,
    completion_rate: rows.length ? Math.round(((byStatus.completed || 0) / rows.length) * 100) : 0,
  };
}

// ============================================================================
// POST /query — paginated rows + aggregates
// ============================================================================
router.post('/query', asyncHandler(async (req, res) => {
  const filters = Array.isArray(req.body?.filters) ? req.body.filters : [];
  const page    = Math.max(1, parseInt(req.body?.page  || 1));
  const limit   = Math.min(200, Math.max(1, parseInt(req.body?.limit || 50)));
  const dataset = req.body?.dataset === 'transfers' ? 'transfers' : 'sales';
  const cfg     = pickDataset(dataset);

  let query = supabaseAdmin.from(cfg.table).select('*', { count: 'exact' }).order('created_at', { ascending: false });
  for (const f of filters) query = applyFilter(query, f, cfg);
  const offset = (page - 1) * limit;
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[data-analyzer/query] supabase error', { code: error.code, message: error.message, filters });
    return res.status(500).json({ error: error.message, code: error.code });
  }

  const enriched = await enrichNames(data || [], dataset);

  // Aggregates run against the FULL filtered set (every row, light columns) so
  // the banner stays honest even when paging through page 5 of 20.
  const all = await fetchAll(dataset, filters, { columns: AGG_COLUMNS[dataset] });
  const aggregates = dataset === 'sales' ? aggregateSales(all) : aggregateTransfers(all);

  res.json({ rows: enriched, total: count || 0, page, limit, dataset, aggregates });
}));

// ============================================================================
// POST /export — same filter, streamed as CSV (entire filtered result)
// ============================================================================
router.post('/export', asyncHandler(async (req, res) => {
  const filters = Array.isArray(req.body?.filters) ? req.body.filters : [];
  const dataset = req.body?.dataset === 'transfers' ? 'transfers' : 'sales';
  const all = await fetchAll(dataset, filters);
  const enriched = await enrichNames(all, dataset);

  // Pull form_fields so JSONB keys get a human label and a stable column order
  // matching what the admin configured on the form. Anything that appears in
  // form_data but isn't in form_fields is appended in name-sorted order so a
  // legacy / orphan key still exports instead of getting silently dropped.
  const { data: ffRows } = await supabaseAdmin
    .from('form_fields').select('name, label, order').order('order');
  const fieldOrder = new Map();
  const fieldLabel = new Map();
  (ffRows || []).forEach((f, i) => {
    fieldOrder.set(f.name, f.order ?? i);
    fieldLabel.set(f.name, f.label || f.name);
  });

  const esc = (v) => {
    // Always quote so embedded commas / newlines / quotes survive Excel + Sheets.
    // Re-serialize booleans/numbers as plain strings; objects (rare leaf in form_data)
    // get JSON so the cell isn't "[object Object]".
    if (v == null) return '""';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };

  // Base typed columns per dataset. Same as before — these stay first in the
  // CSV so existing reports keep their column positions.
  const TYPED_SALES = ['id', 'sale_date', 'status', 'closer_disposition', 'customer_name', 'customer_phone', 'customer_email',
    'car_year', 'car_make', 'car_model', 'car_vin', 'car_miles',
    'plan', 'down_payment', 'monthly_payment', 'reference_no', 'client_name',
    'closer_name', 'fronter_name', 'company_name', 'created_at'];
  const TYPED_TRANSFERS = ['id', 'status', 'latest_disposition', 'created_by_name', 'assigned_closer_name', 'company_name',
    'normalized_phone', 'rejection_reason', 'rejection_count', 'sale_reference_no',
    'created_at', 'updated_at'];

  const typed = dataset === 'sales' ? TYPED_SALES : TYPED_TRANSFERS;
  const typedSet = new Set(typed);

  // Union of JSONB keys actually present in this result set. Skip keys that
  // already exist as typed columns so the CSV doesn't duplicate the same
  // value under both a typed and a JSONB name.
  const jsonKeys = new Set();
  enriched.forEach(r => {
    const fd = r.form_data;
    if (fd && typeof fd === 'object') {
      Object.keys(fd).forEach(k => { if (!typedSet.has(k)) jsonKeys.add(k); });
    }
  });

  // Order: configured form_fields first (by form-builder order), then any
  // orphan keys alphabetically so the suffix is deterministic.
  const ordered = [...jsonKeys].sort((a, b) => {
    const aHas = fieldOrder.has(a), bHas = fieldOrder.has(b);
    if (aHas && bHas)        return fieldOrder.get(a) - fieldOrder.get(b);
    if (aHas !== bHas)       return aHas ? -1 : 1;
    return a.localeCompare(b);
  });

  // Header row uses the admin-set label when one exists, raw key otherwise.
  const headerKeys   = [...typed, ...ordered];
  const headerLabels = headerKeys.map(k => fieldLabel.get(k) || k);

  // Leaf-value normalizer for JSONB cells — JSON-encode objects/arrays so a
  // nested value doesn't blow up the row layout, leave scalars raw.
  const valFor = (row, key) => {
    if (typedSet.has(key)) return row[key];
    const fd = row.form_data;
    return fd && typeof fd === 'object' ? fd[key] : undefined;
  };

  const rows = enriched.map(r => headerKeys.map(k => valFor(r, k)));
  const csv = [headerLabels, ...rows].map(r => r.map(esc).join(',')).join('\n');

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="data-analyzer_${dataset}_${stamp}.csv"`);
  // UTF-8 BOM so Excel reads it correctly on Windows.
  res.send('﻿' + csv);
}));

// ============================================================================
// POST /breakdown — group-by counts on one field
// Body: { dataset, filters, group_by, top: 20 }
// ============================================================================
router.post('/breakdown', asyncHandler(async (req, res) => {
  const filters = Array.isArray(req.body?.filters) ? req.body.filters : [];
  const dataset = req.body?.dataset === 'transfers' ? 'transfers' : 'sales';
  const group   = String(req.body?.group_by || 'status');
  const top     = Math.min(50, Math.max(1, parseInt(req.body?.top || 20)));

  const cfg = pickDataset(dataset);
  // Breakdown only needs the grouped column (typed) or form_data (JSONB key).
  const all = await fetchAll(dataset, filters, { columns: cfg.typed.has(group) ? group : 'form_data' });

  // Resolve the field's raw value off each row, picking from the typed column
  // when it exists and falling back to form_data.
  const valOf = (row) => {
    if (cfg.typed.has(group)) return row[group];
    return row.form_data?.[group];
  };

  const counts = {};
  for (const r of all) {
    const v = valOf(r);
    const key = v == null || v === '' ? '(empty)' : String(v);
    counts[key] = (counts[key] || 0) + 1;
  }

  // For company/closer/fronter id columns, swap the uuid key for a name so the
  // chart is readable.
  const idCols = new Set(['closer_id', 'fronter_id', 'company_id', 'created_by', 'assigned_closer_id']);
  let labelMap = null;
  if (idCols.has(group)) {
    const ids = Object.keys(counts).filter(k => k !== '(empty)');
    if (ids.length) {
      if (group === 'company_id') {
        const { data } = await supabaseAdmin.from('companies').select('id,name').in('id', ids);
        labelMap = Object.fromEntries((data || []).map(c => [c.id, c.name]));
      } else {
        const { data } = await supabaseAdmin.from('user_profiles').select('user_id,first_name,last_name').in('user_id', ids);
        labelMap = Object.fromEntries((data || []).map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.user_id]));
      }
    }
  }

  const items = Object.entries(counts)
    .map(([key, count]) => ({ key, label: labelMap?.[key] || key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, top);

  res.json({ group_by: group, total: all.length, items });
}));

module.exports = router;
