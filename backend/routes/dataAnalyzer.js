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
const { requireToolAccess } = require('../utils/featureGate');
const notifications = require('../utils/notificationService');
const { getBatchRules, isDialerRecipient, ruleExclusions, summarize } = require('../utils/batchRules');

// Roles allowed to distribute a result set as a batch (analyzer access already
// gates the router; readonly_admin can view but not send).
const BATCH_SENDER_ROLES = new Set(['superadmin', 'compliance_manager', 'fronter_manager', 'closer_manager', 'operations_manager', 'company_admin']);

const router = express.Router();

// superadmin/readonly always; others when granted the 'tool_data_analyzer' flag.
router.use(requireToolAccess('tool_data_analyzer'));

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
  // sales_on_phone is an aggregate (count of sales per customer number) — it can
  // never be a column filter; it's resolved in JS by the callers that support it.
  if (f.field === 'sales_on_phone') return query;
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
      // Case-insensitive match for make/model, plan AND client — stored values
      // drift in casing/spelling ("Premium" vs "premium"; config "Steve MTM" vs
      // stored "Steve Mtm"), so exact in() drops rows that really exist (e.g. the
      // client filter returned 0 for every client whose casing differed from the
      // plan-config spelling). ilike-OR matches them all.
      const isMakeOrModel = /\b(make|model)\b/i.test(f.field) || /plan/i.test(f.field) || /client/i.test(f.field);
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

// ── "Sales on this phone" derived metric ─────────────────────────────────────
// How many sales exist in the WHOLE CRM for a row's customer number
// (customer_uuid = UUIDv5 of normalized phone), counting ALL real records —
// active AND cancelled (status <> 'open', so un-submitted drafts are ignored),
// matching the compliance duplicate view. It's an aggregate, so it can't be a
// PostgREST column filter — we build a customer_uuid→count map once (cached),
// attach `sales_on_phone` to every sales row (shown as a column + exported), and
// when the user filters by it we filter IN JS (fetch-all → paginate) so any
// count/range works without an IN() URL blow-up.
const PHONE_COUNT_FIELD = 'sales_on_phone';
let _phoneCount = { map: null, at: 0 };
const PHONE_COUNT_TTL = 60_000;
async function salesCountByUuid() {
  if (_phoneCount.map && Date.now() - _phoneCount.at < PHONE_COUNT_TTL) return _phoneCount.map;
  const map = new Map();
  let complete = true;
  for (let from = 0; from < 5_000_000; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('sales').select('customer_uuid').not('customer_uuid', 'is', null)
      .neq('status', 'open').range(from, from + 999);
    if (error) { complete = false; console.error('[data-analyzer] salesCountByUuid page error', { from, message: error.message }); break; }
    for (const r of (data || [])) map.set(r.customer_uuid, (map.get(r.customer_uuid) || 0) + 1);
    if (!data || data.length < 1000) break;
  }
  // Only cache a FULLY-scanned map. On a partial scan we still return what we
  // have for this request, but leave the cache untouched so the next call
  // retries instead of serving an undercounted total for the whole 60s TTL.
  if (complete) _phoneCount = { map, at: Date.now() };
  return map;
}
// Sales-on-phone for a customer. The map counts only non-open sales, so a
// customer whose ONLY sales are drafts (status='open') is absent → 0 (NOT 1;
// an earlier `|| 1` wrongly inflated those to 1 and skewed the filter/column).
const countFor = (map, uuid) => (uuid ? (map.get(uuid) || 0) : 0);

// Pull the sales_on_phone filters out of the list and compile a numeric
// predicate (eq / gte / lte / between). Returns { rest, pred } where rest is the
// normal column filters and pred is null when no count filter is set.
function splitPhoneCountFilter(filters) {
  const rest = [], pc = [];
  for (const f of filters) (f && f.field === PHONE_COUNT_FIELD ? pc : rest).push(f);
  if (!pc.length) return { rest, pred: null };
  const tests = [];
  for (const f of pc) {
    const v = f.value;
    if (f.op === 'eq' && v !== '' && v != null) { const n = +v; if (Number.isFinite(n)) tests.push(x => x === n); }
    else if (f.op === 'gte' && v !== '' && v != null) { const n = +v; if (Number.isFinite(n)) tests.push(x => x >= n); }
    else if (f.op === 'lte' && v !== '' && v != null) { const n = +v; if (Number.isFinite(n)) tests.push(x => x <= n); }
    else if (f.op === 'between') {
      const [lo, hi] = Array.isArray(v) ? v : [];
      if (lo !== '' && lo != null) { const l = +lo; if (Number.isFinite(l)) tests.push(x => x >= l); }
      if (hi !== '' && hi != null) { const h = +hi; if (Number.isFinite(h)) tests.push(x => x <= h); }
    }
  }
  return { rest, pred: tests.length ? (n => tests.every(t => t(n))) : null };
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

  const offset = (page - 1) * limit;

  // sales_on_phone is an aggregate filter → handled in JS, not PostgREST.
  const { rest, pred } = dataset === 'sales' ? splitPhoneCountFilter(filters) : { rest: filters, pred: null };
  const countMap = dataset === 'sales' ? await salesCountByUuid() : null;
  const withCount = (rows) => (countMap ? rows.map(r => ({ ...r, sales_on_phone: countFor(countMap, r.customer_uuid) })) : rows);

  // ── Count-filter path: fetch all matching (light), filter by count in JS, then
  // paginate. Only used when the user actually filters by sales_on_phone. ──────
  if (pred) {
    const light = await fetchAll('sales', rest, { columns: 'id, customer_uuid, status, down_payment, monthly_payment, closer_id, created_at' });
    const matched = light.filter(r => pred(countFor(countMap, r.customer_uuid)));
    const total = matched.length;
    const pageIds = matched.slice(offset, offset + limit).map(r => r.id);
    let data = [];
    if (pageIds.length) {
      const { data: full, error: fErr } = await supabaseAdmin.from(cfg.table).select('*').in('id', pageIds);
      if (fErr) return res.status(500).json({ error: fErr.message, code: fErr.code });
      const pos = new Map(pageIds.map((id, i) => [id, i]));
      data = (full || []).sort((a, b) => pos.get(a.id) - pos.get(b.id));
    }
    const enriched = await enrichNames(withCount(data), dataset);
    const aggregates = aggregateSales(matched);   // light rows carry the agg columns
    return res.json({ rows: enriched, total, page, limit, dataset, aggregates });
  }

  // Deferred-join pagination: ORDER BY + LIMIT on a NARROW (id) projection so the
  // sort operates on tiny tuples, not full form_data rows. Selecting * and
  // ordering directly made the planner sort the whole filtered set of wide JSONB
  // rows into temp files (hundreds of MB spilled to disk per call). We page the
  // ids here, then fetch the wide rows for just this page.
  let idQuery = supabaseAdmin.from(cfg.table).select('id', { count: 'exact' }).order('created_at', { ascending: false });
  for (const f of rest) idQuery = applyFilter(idQuery, f, cfg);
  idQuery = idQuery.range(offset, offset + limit - 1);

  const { data: idRows, error: idErr, count } = await idQuery;
  if (idErr) {
    // eslint-disable-next-line no-console
    console.error('[data-analyzer/query] supabase error', { code: idErr.code, message: idErr.message, filters });
    return res.status(500).json({ error: idErr.message, code: idErr.code });
  }

  const pageIds = (idRows || []).map(r => r.id);
  let data = [];
  if (pageIds.length) {
    const { data: full, error: fErr } = await supabaseAdmin.from(cfg.table).select('*').in('id', pageIds);
    if (fErr) {
      // eslint-disable-next-line no-console
      console.error('[data-analyzer/query] fetch error', { code: fErr.code, message: fErr.message });
      return res.status(500).json({ error: fErr.message, code: fErr.code });
    }
    // .in() doesn't preserve order — restore the paged created_at DESC order.
    const pos = new Map(pageIds.map((id, i) => [id, i]));
    data = (full || []).sort((a, b) => pos.get(a.id) - pos.get(b.id));
  }

  const enriched = await enrichNames(withCount(data), dataset);

  // Aggregates run against the FULL filtered set (every row, light columns) so
  // the banner stays honest even when paging through page 5 of 20.
  const all = await fetchAll(dataset, rest, { columns: AGG_COLUMNS[dataset] });
  const aggregates = dataset === 'sales' ? aggregateSales(all) : aggregateTransfers(all);

  res.json({ rows: enriched, total: count || 0, page, limit, dataset, aggregates });
}));

// ============================================================================
// POST /export — same filter, streamed as CSV (entire filtered result)
// ============================================================================
router.post('/export', asyncHandler(async (req, res) => {
  const filters = Array.isArray(req.body?.filters) ? req.body.filters : [];
  const dataset = req.body?.dataset === 'transfers' ? 'transfers' : 'sales';
  const { rest, pred } = dataset === 'sales' ? splitPhoneCountFilter(filters) : { rest: filters, pred: null };
  let all = await fetchAll(dataset, rest);
  // Attach the sales-on-phone count to every sales row (exported as a column so
  // the downloaded file can be filtered/sorted in Excel), then apply the count
  // filter if one is set.
  if (dataset === 'sales') {
    const countMap = await salesCountByUuid();
    all = all.map(r => ({ ...r, sales_on_phone: countFor(countMap, r.customer_uuid) }));
    if (pred) all = all.filter(r => pred(r.sales_on_phone));
  }

  // ── Egress governance (server-side): enforce row cap + daily count BEFORE
  // building/streaming, and log allow/deny. Reuses the same guard as every
  // other surface. (The fetch already ran — a pre-count would need to replicate
  // the analyzer's filter application, so we enforce on the fetched length;
  // flagged as a known minor inefficiency, correctness is unaffected.)
  const { enforceEgress } = require('../utils/egressGuard');
  const { resolveExportColumns } = require('../utils/egressConfig');
  const egress = await enforceEgress({
    user: req.user, actionType: 'csv_export', dataset: 'data_analyzer',
    surface: `data_analyzer:${dataset}`, rowCount: all.length,
    filters: { dataset, filters },
  });
  if (!egress.allowed) return res.status(429).json({ error: egress.message, code: 'EGRESS_LIMIT', limit: egress.limit });

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
  // Friendly header for the derived count column.
  fieldLabel.set('sales_on_phone', 'Sales on Phone');

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
    'sales_on_phone',
    'car_year', 'car_make', 'car_model', 'car_vin', 'car_miles',
    'plan', 'down_payment', 'monthly_payment', 'reference_no', 'client_name',
    'closer_name', 'fronter_name', 'company_name', 'created_at'];
  const TYPED_TRANSFERS = ['id', 'status', 'latest_disposition', 'created_by_name', 'assigned_closer_name', 'company_name',
    'normalized_phone', 'rejection_reason', 'rejection_count', 'sale_reference_no',
    'created_at', 'updated_at'];

  const typed = dataset === 'sales' ? TYPED_SALES : TYPED_TRANSFERS;
  const typedSet = new Set(typed);

  // ── De-dup ── form_data carries MANY keys that are just other names for a
  // typed column (Phone↔customer_phone, VIN↔car_vin, SalePlan↔plan, FirstName/
  // LastName↔customer_name, City/customer_city…). The old export only matched
  // EXACT names, so every such field showed up twice (or thrice). Match
  // case/separator-insensitively AND after stripping the customer_/car_/sale_
  // prefixes, so all the variants fold onto their typed column. typedSet is no
  // longer used directly — column membership is tracked per-column below.
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const sem  = (s) => norm(s).replace(/^(customer|car|sale)/, '');
  const typedNorm = new Set(typed.map(norm));
  const typedSem  = new Set(typed.map(sem));
  // Name parts + the couple of synonyms the prefix-strip can't connect.
  const EXTRA_SKIP = new Set(['firstname', 'lastname', 'fullname', 'middlename', 'middle', 'client', 'disposition']);
  const isTypedDup = (k) => {
    const n = norm(k), s = sem(k);
    return typedNorm.has(n) || typedSem.has(s) || EXTRA_SKIP.has(n) || EXTRA_SKIP.has(s);
  };

  // Group every surviving json key by its semantic form so City/city/
  // customer_city become ONE column — its value read from whichever variant a
  // given row actually used (rows differ as the form evolved).
  const semVariants = new Map();   // sem → Set(original keys)
  enriched.forEach(r => {
    const fd = r.form_data;
    if (fd && typeof fd === 'object') Object.keys(fd).forEach(k => {
      if (isTypedDup(k)) return;
      const s = sem(k);
      if (!semVariants.has(s)) semVariants.set(s, new Set());
      semVariants.get(s).add(k);
    });
  });
  // Representative key per group → drives the header label + column order
  // (prefer a configured form_field, else the shortest/cleanest variant name).
  const repOf = (s) => {
    const ks = [...semVariants.get(s)];
    return ks.find(k => fieldOrder.has(k)) || ks.slice().sort((a, b) => a.length - b.length)[0];
  };
  const orderedSems = [...semVariants.keys()].sort((a, b) => {
    const ka = repOf(a), kb = repOf(b);
    const aHas = fieldOrder.has(ka), bHas = fieldOrder.has(kb);
    if (aHas && bHas) return fieldOrder.get(ka) - fieldOrder.get(kb);
    if (aHas !== bHas) return aHas ? -1 : 1;
    return ka.localeCompare(kb);
  });

  // Columns: typed first (positions preserved), then one per json group. A
  // label-level dedup is the final safety net (two surviving keys resolving to
  // the same human label collapse to one column).
  const seenLabel = new Set();
  const cols = [];
  for (const k of typed) {
    const label = fieldLabel.get(k) || k;
    const nl = norm(label);
    if (seenLabel.has(nl)) continue;
    seenLabel.add(nl);
    cols.push({ typed: true, key: k, label });
  }
  for (const s of orderedSems) {
    const rep = repOf(s);
    const label = fieldLabel.get(rep) || rep;
    const nl = norm(label);
    if (seenLabel.has(nl)) continue;
    seenLabel.add(nl);
    cols.push({ typed: false, variants: [...semVariants.get(s)], label });
  }

  // ── Field selection: keep only columns whose LABEL is in the configured
  // allow-list for this role (export.columns.data_analyzer.<role>). No config →
  // all columns (unchanged). Analyzer columns are dynamic, so we match on the
  // human label the admin UI presents.
  const allowedLabels = await resolveExportColumns({ companyId: req.user?.company_id, dataset: 'data_analyzer', role: req.user?.role });
  const exportCols = (allowedLabels && allowedLabels.length)
    ? cols.filter(c => allowedLabels.includes(c.label))
    : cols;

  const headerLabels = exportCols.map(c => c.label);
  const valFor = (row, c) => {
    if (c.typed) return row[c.key];
    const fd = row.form_data;
    if (!fd || typeof fd !== 'object') return undefined;
    for (const k of c.variants) { const v = fd[k]; if (v != null && v !== '') return v; }  // first non-empty variant
    return undefined;
  };

  const rows = enriched.map(r => exportCols.map(c => valFor(r, c)));
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
  const { rest, pred } = dataset === 'sales' ? splitPhoneCountFilter(filters) : { rest: filters, pred: null };
  // Breakdown only needs the grouped column (typed) or form_data (JSONB key);
  // add customer_uuid when a sales-on-phone filter is active so we can apply it.
  const groupCol = cfg.typed.has(group) ? group : 'form_data';
  let all = await fetchAll(dataset, rest, { columns: pred ? `customer_uuid, ${groupCol}` : groupCol });
  if (pred) { const cm = await salesCountByUuid(); all = all.filter(r => pred(countFor(cm, r.customer_uuid))); }

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

// ============================================================================
// POST /send-batch — distribute the current filtered result as a distribution
// batch (original: parent_batch_id NULL, source 'data_analyzer'). Dedupes the
// result to DISTINCT phone numbers (a result can have many rows/lead_ids per
// phone — phone is the unit per the audit). Notifies the recipient.
// Body: { dataset, filters, name, recipient_id }
// ============================================================================
router.post('/send-batch', asyncHandler(async (req, res) => {
  if (!BATCH_SENDER_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Not allowed to send batches' });
  const filters = Array.isArray(req.body?.filters) ? req.body.filters : [];
  const dataset = req.body?.dataset === 'transfers' ? 'transfers' : 'sales';
  const name    = String(req.body?.name || 'Untitled batch').slice(0, 200);
  const recipientId = req.body?.recipient_id;
  if (!recipientId) return res.status(400).json({ error: 'recipient_id is required' });

  // light columns; dedupe by the last-10 of the normalized phone
  const { rest, pred } = dataset === 'sales' ? splitPhoneCountFilter(filters) : { rest: filters, pred: null };
  const baseCols = dataset === 'sales' ? 'customer_phone,customer_phone_2,customer_name' : 'normalized_phone';
  let all = await fetchAll(dataset, rest, { columns: pred ? `customer_uuid,${baseCols}` : baseCols, cap: 50_000 });
  if (pred) { const cm = await salesCountByUuid(); all = all.filter(r => pred(countFor(cm, r.customer_uuid))); }

  const dig = (s) => String(s || '').replace(/\D/g, '');
  const tail = (d) => (d.length >= 10 ? d.slice(-10) : d);
  const byPhone = new Map();
  for (const r of all) {
    const cands = dataset === 'sales' ? [r.customer_phone, r.customer_phone_2] : [r.normalized_phone];
    const nm = dataset === 'sales' ? (r.customer_name || null) : null;
    for (const c of cands) {
      const d = dig(c); if (d.length < 7) continue;
      const key = tail(d);
      if (!byPhone.has(key)) byPhone.set(key, { phone_number: d, customer_name: nm });
    }
  }
  const items = [...byPhone.values()];
  if (!items.length) return res.status(400).json({ error: 'No phone numbers in the current result to send' });

  const { data: rcr } = await supabaseAdmin.from('user_company_roles')
    .select('company_id').eq('user_id', recipientId).eq('is_active', true).order('created_at', { ascending: true }).limit(1).maybeSingle();

  const { data: batch, error: bErr } = await supabaseAdmin.from('distribution_batches').insert({
    name, created_by: req.user.id, parent_batch_id: null, source: 'data_analyzer',
    sent_to_user_id: recipientId, company_id: rcr?.company_id || null, item_count: items.length,
  }).select().single();
  if (bErr) return res.status(500).json({ error: bErr.message });

  // Rule filter — only writes 'excluded' rows at the FINAL hop (recipient is a
  // fronter/closer). Upstream recipients (managers) get everything; the excluded
  // preview travels via /rule-preview instead.
  const rules = await getBatchRules(rcr?.company_id || null);
  const dialer = await isDialerRecipient(recipientId);
  const exMap = dialer ? await ruleExclusions(items.map(i => i.phone_number), recipientId, rcr?.company_id, rules) : new Map();

  const rows = items.map((i, idx) => {
    const reason = exMap.get(i.phone_number);
    // position = 1-based insertion order within this batch (Phase A foundation).
    return { batch_id: batch.id, position: idx + 1, phone_number: i.phone_number, customer_name: i.customer_name, ...(reason ? { status: 'excluded', exclusion_reason: reason } : {}) };
  });
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await supabaseAdmin.from('distribution_batch_items').insert(rows.slice(i, i + 1000));
    if (error) { await supabaseAdmin.from('distribution_batches').delete().eq('id', batch.id); return res.status(500).json({ error: error.message }); }
  }

  notifications.notifyUsers([recipientId], {
    type: 'batch_received', title: 'New batch received',
    message: `${req.user.name || 'A superadmin'} sent you "${name}" (${items.length - exMap.size} numbers).`,
    companyId: batch.company_id, data: { batch_id: batch.id, kind: 'distribution_batch' }, dedupBase: `batch_${batch.id}`,
  }).catch(() => {});
  res.status(201).json({ batch: { id: batch.id, name, item_count: items.length, excluded_count: exMap.size } });
}));

// Pull the current analyzer result and reduce to DISTINCT last-10 phone numbers.
// Shared by the modal's "resolve phones once" + preview-fallback paths (R1).
async function resolveDistinctPhones(dataset, filters) {
  const { rest, pred } = dataset === 'sales' ? splitPhoneCountFilter(filters) : { rest: filters, pred: null };
  const baseCols = dataset === 'sales' ? 'customer_phone,customer_phone_2' : 'normalized_phone';
  let all = await fetchAll(dataset, rest, { columns: pred ? `customer_uuid,${baseCols}` : baseCols, cap: 50_000 });
  if (pred) { const cm = await salesCountByUuid(); all = all.filter(r => pred(countFor(cm, r.customer_uuid))); }
  const dig = (s) => String(s || '').replace(/\D/g, '');
  const tail = (d) => (d.length >= 10 ? d.slice(-10) : d);
  const set = new Set();
  for (const r of all) for (const c of (dataset === 'sales' ? [r.customer_phone, r.customer_phone_2] : [r.normalized_phone])) { const d = dig(c); if (d.length >= 7) set.add(tail(d)); }
  return [...set];
}

// ── POST /send-batch/phones — resolve the modal's DISTINCT phone set ONCE ───────
// The Send Batch modal calls this on open, caches the array, and passes it to
// /send-batch/preview on each recipient change — so switching recipients never
// re-runs fetchAll against the dataset (R1). Heavy work happens exactly once.
router.post('/send-batch/phones', asyncHandler(async (req, res) => {
  if (!BATCH_SENDER_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Not allowed' });
  const filters = Array.isArray(req.body?.filters) ? req.body.filters : [];
  const dataset = req.body?.dataset === 'transfers' ? 'transfers' : 'sales';
  const phones = await resolveDistinctPhones(dataset, filters);
  res.json({ phones, total: phones.length });
}));

// ── POST /send-batch/preview — dry-run rule counts for the Send Batch modal ────
router.post('/send-batch/preview', asyncHandler(async (req, res) => {
  if (!BATCH_SENDER_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Not allowed' });
  const recipientId = req.body?.recipient_id;
  if (!recipientId) return res.status(400).json({ error: 'recipient_id is required' });

  // Prefer the client-cached phone set (R1 — no re-fetch per recipient). Fall
  // back to resolving from dataset/filters for back-compat / direct callers.
  let phones = Array.isArray(req.body?.phones) ? req.body.phones.filter(Boolean) : null;
  if (!phones) {
    const filters = Array.isArray(req.body?.filters) ? req.body.filters : [];
    const dataset = req.body?.dataset === 'transfers' ? 'transfers' : 'sales';
    phones = await resolveDistinctPhones(dataset, filters);
  }

  const { data: rcr } = await supabaseAdmin.from('user_company_roles').select('company_id').eq('user_id', recipientId).eq('is_active', true).order('created_at', { ascending: true }).limit(1).maybeSingle();
  const rules = await getBatchRules(rcr?.company_id || null);
  const dialer = await isDialerRecipient(recipientId);
  const exMap = await ruleExclusions(phones, recipientId, rcr?.company_id, rules);
  res.json({ ...summarize(phones, exMap), recipient_is_dialer: dialer, rules });
}));

module.exports = router;
