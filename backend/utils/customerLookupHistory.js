// ============================================================================
// utils/customerLookupHistory.js — the Customer Lookup search history (mig 337)
//
// Every search the tool runs is written to `customer_lookup_searches`: what was
// typed, what came back, and the payload the browser received. Two surfaces
// read it:
//   • the agent's own History tab — re-open a search instead of re-running it
//   • the superadmin Activity tab — what everyone is searching, and the result
//
// THREE RULES THIS FILE EXISTS TO HOLD.
//
// 1. RECORDING NEVER BREAKS A SEARCH. Every write is fire-and-forget and every
//    error is swallowed to a log line. A full disk, a missing migration or a
//    bad row must never turn a working lookup into a 500 — the history is a
//    by-product, not the job. If the table is missing (backend deployed before
//    337 is applied) the first failure parks writes for five minutes instead of
//    hammering the database once per search.
//
// 2. A SUMMARY IS SMALL ON PURPOSE. The list shows counts plus a handful of
//    names and cities. Emails, relatives and the full address book stay inside
//    `result`, which is only read when somebody opens that one row — and which
//    the prune job drops after 30 days.
//
// 3. AN ASYNC SEARCH IS WRITTEN TWICE. A scrape or a VIN run answers with a
//    ticket and finishes minutes later through /job/:ticket, so the row is
//    inserted `pending` when the search starts and completed when the ticket
//    lands. A search that never came back therefore reads as what it was.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');

const TABLE = 'customer_lookup_searches';
const KINDS = ['people', 'search', 'addresses', 'vehicles', 'vin', 'enrich'];

// ── writes off while the table is missing ────────────────────────────────────
let _mutedUntil = 0;
const MUTE_MS = 5 * 60 * 1000;

function muted() { return Date.now() < _mutedUntil; }

function failed(where, error) {
  if (!error) return;
  // 42P01 = relation does not exist: the backend is simply ahead of the
  // migration. Anything else is worth a louder line, but neither is fatal.
  const missing = error.code === '42P01' || /does not exist/i.test(error.message || '');
  if (missing) {
    _mutedUntil = Date.now() + MUTE_MS;
    logger.warn('CUSTOMER_LOOKUP', `history ${where} skipped — ${TABLE} is not there yet (migration 337)`);
  } else {
    logger.warn('CUSTOMER_LOOKUP', `history ${where} failed: ${error.message}`);
  }
}

// ── summarising a result ─────────────────────────────────────────────────────
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// "123 Main St, Tampa, FL 33601" → "Tampa, FL". A full address is not a place
// label, and the list has room for a place.
function placeOf(p) {
  const city = str(p?.current_address?.city || p?.city);
  const state = str(p?.current_address?.state || p?.state);
  if (city || state) return [city, state].filter(Boolean).join(', ');
  const full = str(p?.current_address?.full || p?.address || (Array.isArray(p?.address_history) ? p.address_history[0] : ''));
  if (!full) return '';
  const parts = full.split(',').map(x => x.trim()).filter(Boolean);
  if (parts.length < 2) return '';
  const tail = parts[parts.length - 1];
  const m = tail.match(/^([A-Za-z]{2})\s+\d{5}/);
  return [parts[parts.length - 2], m ? m[1] : tail].filter(Boolean).join(', ');
}

// The same flatten the panel does: /lookup answers { result }, /search answers
// { results:[{data}] }, /enrich answers { person }, and the stream's `done`
// carries { result }. One list of people out of any of them.
function peopleFrom(data) {
  const roots = [];
  if (data?.person) roots.push(data.person);
  if (data?.result && typeof data.result === 'object') roots.push(data.result);
  for (const r of (Array.isArray(data?.results) ? data.results : [])) if (r?.data) roots.push(r.data);
  const out = [];
  const seen = new Set();
  for (const root of roots) {
    // A single-person answer puts the person AT the root, so the root counts —
    // but only when it actually looks like a person. `{ result: { people: [] } }`
    // is a search that found nobody, and counting its envelope as one unnamed
    // person is how an empty result ends up listed as a hit.
    const named = (x) => !!(x && (x.name || x.full_name || x.detail_url));
    const list = (Array.isArray(root.people) && root.people.length)
      ? root.people
      : (named(root) ? [root] : []);
    for (const p of list) {
      if (!p || typeof p !== 'object') continue;
      const k = p.detail_url || `${str(p.name)}|${str(p.age)}`;
      if (k && seen.has(k)) continue;
      if (k) seen.add(k);
      out.push(p);
    }
  }
  return out;
}

function vehicleRecords(data) {
  for (const key of ['vehicles', 'results', 'data', 'records', 'list']) {
    const v = data?.[key];
    if (Array.isArray(v)) {
      const recs = v.filter(x => x && typeof x === 'object');
      if (recs.length) return recs;
    } else if (v && typeof v === 'object') {
      const recs = Object.values(v).filter(x => x && typeof x === 'object');
      if (recs.length) return recs;
    }
  }
  return [];
}

function vehicleTitle(rec) {
  const pick = (names) => {
    for (const k of Object.keys(rec)) {
      if (names.includes(k.toLowerCase().replace(/[^a-z]/g, ''))) {
        const v = str(rec[k]);
        if (v) return v;
      }
    }
    return '';
  };
  const year  = pick(['year', 'vehicleyear', 'modelyear']);
  const make  = pick(['make', 'vehiclemake', 'manufacturer']);
  const model = pick(['model', 'vehiclemodel']);
  const title = [year, make, model].filter(Boolean).join(' ');
  return title || str(rec.Vehicle || rec.vehicle || rec.description) || '';
}

// Pure, and tested: { count, found, summary } for any payload the service can
// answer with. Never reaches the database.
function summarize(kind, data) {
  if (!data || typeof data !== 'object') return { count: 0, found: false, summary: {} };

  if (kind === 'vehicles') {
    const recs = vehicleRecords(data);
    const titles = recs.map(vehicleTitle).filter(Boolean).slice(0, 6);
    const out = { vehicles: titles };
    const runStatus = str(data.result?.status || data.vehicles_status);
    if (runStatus) out.run_status = runStatus;
    if (data.cached !== undefined) out.cached = !!data.cached;
    return { count: recs.length, found: recs.length > 0, summary: out };
  }

  if (kind === 'vin') {
    const r = data.result || {};
    const vins = (Array.isArray(r.vins) && r.vins.length ? r.vins : (data.vin ? [data.vin] : [])).filter(Boolean).map(String);
    const out = { vins: vins.slice(0, 4) };
    if (str(r.status)) out.run_status = str(r.status);
    return { count: vins.length, found: vins.length > 0, summary: out };
  }

  if (kind === 'addresses') {
    const list = Array.isArray(data.addresses) ? data.addresses : [];
    return {
      count: list.length,
      found: list.length > 0,
      summary: { addresses: list.slice(0, 6).map(a => clip(str(a.street || a.full), 60)).filter(Boolean) },
    };
  }

  // people | search | enrich
  const people = peopleFrom(data);
  const names = people.slice(0, 6).map(p => {
    const row = { name: clip(str(p.name || p.full_name) || 'Unnamed', 60) };
    if (str(p.age)) row.age = str(p.age);
    const place = clip(placeOf(p), 40);
    if (place) row.place = place;
    return row;
  });
  const out = { people: names };
  if (kind === 'enrich') {
    const v = summarize('vehicles', data);
    if (v.count) out.vehicles = v.summary.vehicles;
  }
  if (data.cached !== undefined) out.cached = !!data.cached;
  return { count: people.length, found: people.length > 0, summary: out };
}

// ── the haystack (mig 338) ───────────────────────────────────────────────────
// The History search box searches ANYTHING in the row, not just the number that
// was typed: the name that came back, the city, the car, the VIN. Those live
// inside `summary`, which is jsonb, and PostgREST cannot ILIKE a jsonb
// document — so the row carries its own lowercased text copy.
//
// It is built HERE, beside the summary it flattens, so the two can never drift.
const SEARCH_MAX = 2000;

function buildSearchText({ kind, query, params, summary, error }) {
  const bits = [str(query), str(kind)];
  for (const v of Object.values(params || {})) bits.push(str(v));

  const s = summary || {};
  for (const p of (s.people || [])) bits.push(str(p.name), str(p.place), str(p.age));
  for (const v of (s.vehicles  || [])) bits.push(str(v));
  for (const v of (s.vins      || [])) bits.push(str(v));
  for (const a of (s.addresses || [])) bits.push(str(a));
  if (error) bits.push(str(error));

  // One space between every token, so a needle can never span two unrelated
  // fields while "ford f-150" still matches a vehicle title.
  return bits.filter(Boolean).join(' ').toLowerCase().slice(0, SEARCH_MAX);
}

// The database has not got the column yet (backend deployed ahead of 338). Drop
// it and write the row anyway — a searchable history is worth less than having
// a history at all.
const missingColumn = (error) =>
  !!error && (error.code === 'PGRST204' || error.code === '42703' || /search_text/.test(error.message || ''));

// The parameters, minus anything empty. Everything here was typed by the user
// or derived from it, so nothing is dropped for secrecy — only for size.
function safeParams(params) {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    const s = str(v);
    if (!s) continue;
    out[k] = clip(s, 200);
  }
  return out;
}

// A payload is kept whole so History can re-open it, but a runaway one is not
// worth a row that nothing can list. 512KB is far above any real answer.
const MAX_RESULT_BYTES = 512 * 1024;
function capped(data) {
  try {
    const s = JSON.stringify(data);
    if (!s) return null;
    if (s.length <= MAX_RESULT_BYTES) return data;
    return { __truncated: true, bytes: s.length, note: 'The result was too large to keep. Run the search again to see it.' };
  } catch { return null; }
}

// ── writing ──────────────────────────────────────────────────────────────────
// Returns nothing and awaits nothing the caller has to care about: call it
// without `await` from a route and the response is never held up by it.
function record({ userId, companyId, kind, query, params, ticket, data, status, error, ms }) {
  if (!userId || muted()) return;
  const k = KINDS.includes(kind) ? kind : 'people';
  const s = summarize(k, data);
  const row = {
    user_id: userId,
    company_id: companyId || null,
    kind: k,
    query: clip(str(query), 300),
    params: safeParams(params),
    ticket: ticket ? clip(str(ticket), 80) : null,
    status: status || (error ? 'error' : (ticket && !data ? 'pending' : (s.found ? 'ok' : 'empty'))),
    found: data ? s.found : null,
    result_count: s.count,
    summary: s.summary,
    result: data ? capped(data) : null,
    error: error ? clip(str(error), 400) : null,
    ms: Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : null,
    completed_at: (ticket && !data && !error) ? null : new Date().toISOString(),
    search_text: buildSearchText({ kind: k, query, params, summary: s.summary, error }),
  };
  (async () => {
    const { error: e } = await supabaseAdmin.from(TABLE).insert(row);
    if (!e) return;
    if (missingColumn(e)) {
      const { search_text: _drop, ...plain } = row;
      const { error: e2 } = await supabaseAdmin.from(TABLE).insert(plain);
      failed('insert', e2);
      return;
    }
    failed('insert', e);
  })().catch(e => failed('insert', e));
}

// The ticket half of an async search: the row already exists, this is the
// answer landing. Matched on (user, ticket) and only while still unfinished, so
// repeated polling cannot rewrite a finished row.
function complete({ userId, ticket, kind, data, error, status }) {
  if (!userId || !ticket || muted()) return;
  (async () => {
    // The job route does not know what KIND of search its ticket belongs to —
    // one endpoint finishes people, vehicle and VIN jobs alike — and the kind
    // decides how the payload is read. The pending row knows, so ask it.
    let k = KINDS.includes(kind) ? kind : null;
    let pending = null;
    if (!k) {
      // The row's own query and params are what the haystack is rebuilt from —
      // this answer is the result half, which is only part of it.
      const { data: row, error: e } = await supabaseAdmin.from(TABLE)
        .select('kind, query, params').eq('user_id', userId).eq('ticket', String(ticket))
        .is('completed_at', null).maybeSingle();
      if (e) { failed('complete', e); return; }
      if (!row) return;      // nothing pending under that ticket: already done
      pending = row;
      k = row.kind;
    }
    const s = summarize(k, data);
    const patch = {
      status: status || (error ? 'error' : (s.found ? 'ok' : 'empty')),
      found: error ? null : s.found,
      result_count: s.count,
      summary: s.summary,
      result: data ? capped(data) : null,
      error: error ? clip(str(error), 400) : null,
      completed_at: new Date().toISOString(),
      // A pending row was written before its result existed, so its haystack
      // held only what was typed. Rebuild it now that the names are known.
      search_text: buildSearchText({
        kind: k, query: pending?.query, params: pending?.params, summary: s.summary, error,
      }),
    };
    const where = () => supabaseAdmin.from(TABLE).update(patch)
      .eq('user_id', userId).eq('ticket', String(ticket)).is('completed_at', null);
    const { error: e2 } = await where();
    if (e2 && missingColumn(e2)) {
      delete patch.search_text;
      const { error: e3 } = await where();
      failed('complete', e3);
      return;
    }
    failed('complete', e2);
  })().catch(e => failed('complete', e));
}

// ── reading ──────────────────────────────────────────────────────────────────
// The list never selects `result`: that column holds the whole payload and a
// page of them would be megabytes. One row's payload comes from getOne().
const LIST_COLS = 'id,user_id,company_id,kind,query,params,ticket,status,found,result_count,summary,error,ms,created_at,completed_at';

// A needle for an ILIKE: the wildcards are ours, so a typed % or _ is a
// character to look for and never a pattern of the user's own.
const needle = (text) => `%${String(text).trim().toLowerCase().replace(/[%_\\]/g, m => '\\' + m)}%`;

async function list({ userId, kind, q: text, limit = 40, offset = 0 } = {}) {
  const take = Math.min(Math.max(parseInt(limit, 10) || 40, 1), 200);
  const build = (column) => {
    let q = supabaseAdmin.from(TABLE).select(LIST_COLS, { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + take - 1);
    if (kind && KINDS.includes(kind)) q = q.eq('kind', kind);
    if (text) q = q.ilike(column, needle(text));
    return q;
  };
  let { data, error, count } = await build('search_text');
  // 338 not applied yet: searching what was TYPED still beats an empty list.
  if (error && text && missingColumn(error)) ({ data, error, count } = await build('query'));
  if (error) { failed('list', error); return { rows: [], total: 0 }; }
  return { rows: data || [], total: count || 0 };
}

async function listAll({ userId, kind, q: text, from, to, limit = 50, offset = 0 } = {}) {
  const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const build = (column) => {
    let q = supabaseAdmin.from(TABLE).select(LIST_COLS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + take - 1);
    if (userId) q = q.eq('user_id', userId);
    if (kind && KINDS.includes(kind)) q = q.eq('kind', kind);
    if (from) q = q.gte('created_at', from);
    if (to) q = q.lte('created_at', to);
    // The SAME haystack the agent's own History searches — "who searched this
    // number" and "who found this name" are one question asked two ways.
    if (text) q = q.ilike(column, needle(text));
    return q;
  };
  let { data, error, count } = await build('search_text');
  if (error && text && missingColumn(error)) ({ data, error, count } = await build('query'));
  if (error) { failed('listAll', error); return { rows: [], total: 0 }; }
  return { rows: data || [], total: count || 0 };
}

// One row WITH its payload. A non-superadmin only ever gets their own.
async function getOne(id, { userId, superadmin = false } = {}) {
  let q = supabaseAdmin.from(TABLE).select('*').eq('id', id);
  if (!superadmin) q = q.eq('user_id', userId);
  const { data, error } = await q.maybeSingle();
  if (error) { failed('getOne', error); return null; }
  return data || null;
}

// Who is using the tool, over a window. Aggregated here rather than in SQL
// because the window is small and this needs no new database object.
const STATS_CAP = 5000;

async function stats({ from, to } = {}) {
  let q = supabaseAdmin.from(TABLE).select('user_id,kind,status,result_count,created_at')
    .order('created_at', { ascending: false }).limit(STATS_CAP);
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lte('created_at', to);
  const { data, error } = await q;
  if (error) { failed('stats', error); return { users: [], totals: {}, capped: false }; }
  const rows = data || [];
  const byUser = new Map();
  const totals = { searches: 0, found: 0, empty: 0, errors: 0, pending: 0 };
  for (const r of rows) {
    totals.searches += 1;
    if (r.status === 'ok') totals.found += 1;
    else if (r.status === 'empty') totals.empty += 1;
    else if (r.status === 'error') totals.errors += 1;
    else if (r.status === 'pending') totals.pending += 1;
    const u = byUser.get(r.user_id) || { user_id: r.user_id, searches: 0, found: 0, kinds: {}, last_at: r.created_at };
    u.searches += 1;
    if (r.status === 'ok') u.found += 1;
    u.kinds[r.kind] = (u.kinds[r.kind] || 0) + 1;
    if (!u.last_at || r.created_at > u.last_at) u.last_at = r.created_at;
    byUser.set(r.user_id, u);
  }
  return {
    users: [...byUser.values()].sort((a, b) => b.searches - a.searches),
    totals,
    capped: rows.length >= STATS_CAP,
  };
}

// Any row whose haystack is NULL is invisible to the History search box, and
// there are two ways to get one: a row written while the backend was still
// ahead of mig 338, and any future write path that forgets. So the housekeeping
// job fills them in rather than trusting that it never happens — one statement
// of its own, never fused with the prune, because two data-modifying CTEs in
// one statement must not be able to touch the same row.
async function fillSearchText() {
  const { data, error } = await supabaseAdmin.rpc('fn_fill_customer_lookup_search_text');
  if (error) { failed('fill search_text', error); return 0; }
  return Number(Array.isArray(data) ? data[0] : data) || 0;
}

async function prune({ resultDays = 30, historyDays = 180 } = {}) {
  const filled = await fillSearchText();
  const { data, error } = await supabaseAdmin.rpc('fn_prune_customer_lookup_searches', {
    p_result_days: resultDays, p_history_days: historyDays,
  });
  if (error) { failed('prune', error); return filled ? { filled, stripped: 0, deleted: 0 } : null; }
  const r = Array.isArray(data) ? data[0] : data;
  return { ...(r || { stripped: 0, deleted: 0 }), filled };
}

module.exports = {
  KINDS, TABLE,
  summarize, peopleFrom, placeOf, vehicleTitle, vehicleRecords, safeParams, capped,
  buildSearchText, needle,
  record, complete, list, listAll, getOne, stats, prune, fillSearchText,
};
