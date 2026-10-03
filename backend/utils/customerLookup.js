// ============================================================================
// utils/customerLookup.js — the people / vehicle lookup service behind the
// staff "Customer Lookup" tool.
//
// This talks to a SELF-HOSTED lookup service (the operator runs it themselves).
// Everything about that service is configuration, never code:
//   • base URL   → business_config  global  customer_lookup.base_url
//   • API key    → app_secrets      customer_lookup.api_key   (never leaves the server)
//   • master on  → business_config  global  customer_lookup.enabled     (default OFF)
//   • timeout    → business_config  global  customer_lookup.timeout_ms
//   • per user   → business_config  global  customer_lookup.users
//                  { "<user_id>": { "people": true, "vehicles": false } }
//
// The per-user map lives in ONE config row rather than a new table — the same
// shape `export.columns.__users` already uses. Nothing here writes a lookup
// RESULT anywhere: results are proxied straight to the caller and forgotten.
//
// ── WHY A PROXY AND NOT A DIRECT BROWSER CALL ───────────────────────────────
// The browser must never hold the API key, and the service is plain http on a
// fixed IP — a browser on https would have the request blocked as mixed
// content anyway. So the CRM server is the only thing that ever speaks to it.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { getConfig, setConfig } = require('./businessConfig');
const logger = require('./logger');

const KEY_NAME        = 'customer_lookup.api_key';
const DEFAULT_BASE    = 'http://104.234.94.216:5050';
const DEFAULT_TIMEOUT = 25_000;   // a cold lookup SCRAPES, so it is not fast
const MAX_TIMEOUT     = 90_000;

// ── secret ───────────────────────────────────────────────────────────────────
// THE KEY IS READ ONCE, NOT ON EVERY CALL. app_secrets is a round trip, and
// this database charges ~330ms for one -- measured 2026-09-30. accessFor() asks
// for the key and then call()/stream() asks again, so a single lookup paid it
// TWICE (~650ms) before its request had even left the building. A 30s memo cuts
// that to nothing without making a rotated key wait: setApiKey clears it, and
// the window is shorter than anyone can re-test a key by hand.
let _keyCache = { at: 0, value: null };
const KEY_TTL_MS = 30_000;

async function getApiKey() {
  if (_keyCache.value !== null && Date.now() - _keyCache.at < KEY_TTL_MS) return _keyCache.value;
  const { data } = await supabaseAdmin.from('app_secrets').select('value').eq('key', KEY_NAME).maybeSingle();
  const value = data?.value || '';
  _keyCache = { at: Date.now(), value };
  return value;
}
async function setApiKey(value, userId) {
  await supabaseAdmin.from('app_secrets').upsert(
    { key: KEY_NAME, value: value || null, updated_at: new Date().toISOString(), updated_by: userId || null },
    { onConflict: 'key' },
  );
  _keyCache = { at: 0, value: null };   // a rotated key takes effect now, not in 30s
}

// ── base URL ─────────────────────────────────────────────────────────────────
// Only a superadmin can set this, so it is a trusted input — but a typo that
// points the CRM at cloud metadata would hand out instance credentials, and no
// real lookup service ever lives there. Cheap to refuse.
const BLOCKED_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal', '[fd00:ec2::254]']);

function normalizeBase(raw) {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return { ok: false, error: 'Base URL is required' };
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: 'Base URL is not a valid URL (include http:// or https://)' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'Base URL must be http:// or https://' };
  if (BLOCKED_HOSTS.has(u.hostname)) return { ok: false, error: 'That host is not allowed' };
  // Keep origin + any path prefix; a query or hash on a BASE is always a typo.
  const base = (u.origin + u.pathname).replace(/\/+$/, '');
  return { ok: true, base };
}

async function settings() {
  const rawBase = await getConfig(null, 'customer_lookup.base_url', DEFAULT_BASE);
  const n = normalizeBase(rawBase);
  const t = parseInt(await getConfig(null, 'customer_lookup.timeout_ms', DEFAULT_TIMEOUT), 10);
  return {
    enabled:   !!(await getConfig(null, 'customer_lookup.enabled', false)),
    baseUrl:   n.ok ? n.base : '',
    baseError: n.ok ? null : n.error,
    timeoutMs: Math.min(Math.max(Number.isFinite(t) ? t : DEFAULT_TIMEOUT, 3_000), MAX_TIMEOUT),
  };
}

// ── per-user access ──────────────────────────────────────────────────────────
// TWO LAYERS, AND THE PERSON'S OWN ROW ALWAYS WINS.
//
// It shipped as one layer: a name in `customer_lookup.users`, or nothing. That
// is the right default for a tool nobody has decided about yet, and the wrong
// one the moment the whole floor should have it — granting it sixty times by
// hand and again for every new hire is not a policy, it is a chore.
//
// So `customer_lookup.default_access` says what EVERYONE gets, and a user row
// overrides it in both directions: an explicit `false` against an all-on
// default is how one person is shut out. An absent key follows the default.
// The code fallback is still all-off, so a fresh install hands out nothing
// until a superadmin says otherwise.
const ACCESS_KINDS = ['people', 'vehicles', 'vin'];

async function userMap() {
  const m = await getConfig(null, 'customer_lookup.users', {});
  return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
}

async function defaultAccess() {
  const d = await getConfig(null, 'customer_lookup.default_access', null);
  const o = (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
  return { people: !!o.people, vehicles: !!o.vehicles, vin: !!o.vin };
}

async function setDefaultAccess(patch, updatedBy) {
  const next = { ...(await defaultAccess()) };
  for (const k of ACCESS_KINDS) if (patch && patch[k] !== undefined) next[k] = !!patch[k];
  await setConfig('global', 'customer_lookup.default_access', next, updatedBy);
  return next;
}

async function accessFor(userId, { superadmin = false } = {}) {
  const [cfg, key, map, dflt] = await Promise.all([settings(), getApiKey(), userMap(), defaultAccess()]);
  const configured = !!cfg.baseUrl && !!key;
  const row = map[userId] || {};
  // A superadmin administers the tool, so they can always exercise it — the
  // same rule the DNC lookup uses. Everyone else gets the default unless their
  // own row says otherwise.
  const resolve = (k) => superadmin || (row[k] === undefined ? dflt[k] : !!row[k]);
  const people   = resolve('people');
  const vehicles = resolve('vehicles');
  const vin      = resolve('vin');
  const live = cfg.enabled && configured;
  return {
    people:   live && people,
    vehicles: live && vehicles,
    vin:      live && vin,
    // Diagnostics, so the UI can say WHY it is closed instead of just vanishing.
    enabled: cfg.enabled, configured, superadmin,
    granted: { people, vehicles, vin },
    defaults: dflt,
    // Which of the three this person was named for, either way. The admin UI
    // needs "following the default" to read as a different state from "off".
    explicit: Object.fromEntries(ACCESS_KINDS.filter(k => row[k] !== undefined).map(k => [k, !!row[k]])),
  };
}

async function setAccess(userId, patch, updatedBy) {
  const [map, dflt] = await Promise.all([userMap(), defaultAccess()]);
  const row = { ...(map[userId] || {}) };
  for (const k of ACCESS_KINDS) if (patch && patch[k] !== undefined) row[k] = !!patch[k];
  // Drop the key when it no longer says anything the default does not already
  // say — that keeps the config row from growing a tombstone for every user
  // ever toggled. A quota override IS something it says, so it keeps the row.
  const redundant = ACCESS_KINDS.every(k => row[k] === undefined || !!row[k] === !!dflt[k]);
  if (redundant && !row.quota) delete map[userId];
  else map[userId] = row;
  await setConfig('global', 'customer_lookup.users', map, updatedBy);
  return row;
}

// ── rate limit ───────────────────────────────────────────────────────────────
// The upstream is one self-hosted box that SCRAPES on a cache miss. A stuck UI
// or an over-eager user must not turn into a hundred concurrent scrapes.
const hits = new Map();   // userId → number[] (ms timestamps)
const WINDOW_MS = 60_000, MAX_PER_WINDOW = 40;

function rateLimit(userId) {
  const now = Date.now();
  const arr = (hits.get(userId) || []).filter(t => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((WINDOW_MS - (now - arr[0])) / 1000)) };
  }
  arr.push(now);
  hits.set(userId, arr);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some(t => now - t < WINDOW_MS)) hits.delete(k);
  return { ok: true };
}

// ── the call ─────────────────────────────────────────────────────────────────
// Returns { ok, status, data } or { ok:false, status, error }. Never throws.
async function call(path, params, { userId, label } = {}) {
  // Independent reads, so they wait together rather than one after the other.
  const [cfg, key] = await Promise.all([settings(), getApiKey()]);
  if (!cfg.enabled) return { ok: false, status: 503, error: 'Customer lookup is turned off' };
  if (!cfg.baseUrl) return { ok: false, status: 503, error: cfg.baseError || 'No lookup base URL configured' };
  if (!key)         return { ok: false, status: 503, error: 'No lookup API key configured' };

  let url;
  try {
    url = new URL(cfg.baseUrl + path);
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && String(v).trim() !== '') url.searchParams.set(k, String(v).trim());
    }
  } catch { return { ok: false, status: 500, error: 'Could not build the lookup URL' }; }

  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { 'X-API-Key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(cfg.timeoutMs),
      redirect: 'manual',    // a redirect here means "login page", not data
    });
    const ct = r.headers.get('content-type') || '';
    const ms = Date.now() - t0;

    // Who looked up what, without storing the answer. This is the only record
    // of a PII lookup, so it is deliberately unconditional.
    logger.info('CUSTOMER_LOOKUP', `${label || path} by ${userId || 'unknown'} -> ${r.status} in ${ms}ms`);

    if (r.status === 401 || r.status === 403) return { ok: false, status: 502, error: 'The lookup service rejected the API key' };
    if (r.status >= 300 && r.status < 400)    return { ok: false, status: 502, error: 'The lookup service asked for a login — check the API key and base URL' };
    if (!ct.includes('json'))                 return { ok: false, status: 502, error: `The lookup service returned ${r.status} but not JSON — check the base URL` };

    const data = await r.json();
    if (!r.ok) return { ok: false, status: 502, error: data?.error || `Lookup service error (${r.status})` };
    return { ok: true, status: 200, data };
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    logger.warn('CUSTOMER_LOOKUP', `${label || path} failed after ${Date.now() - t0}ms: ${e.message}`);
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      error: timedOut
        ? 'The lookup service did not answer in time. A first search has to scrape — try again, the second attempt is usually cached.'
        : 'Could not reach the lookup service',
    };
  }
}

// ── the same call, but READ AS IT ARRIVES ───────────────────────────────────
// One phone number can hold ten people, and each needs its own page fetch
// upstream. /api/lookup stays silent for ~33s and then answers everything;
// /api/lookup/stream sends NDJSON -- the names and addresses of all N within a
// few seconds, then each full person as their page lands.
//
// So this must never buffer: it reads the body chunk by chunk, splits on
// newlines, and hands each parsed object to `onLine` the moment it exists.
//
// NO TOTAL TIMEOUT. `call` aborts at cfg.timeoutMs, which is right for a single
// answer and fatal here -- a healthy stream legitimately runs longer. The guard
// is IDLE time instead: the service sends a `waiting` keep-alive while a slow
// page is in flight, so silence, not duration, is the failure.
//
// A line we cannot parse is skipped, never fatal, and an event we do not
// recognise is passed on: the service adds events over time, and the client is
// the one that decides what to ignore.
const STREAM_IDLE_MS = 120_000;

async function stream(path, params, { userId, label, onLine, signal } = {}) {
  const [cfg, key] = await Promise.all([settings(), getApiKey()]);
  if (!cfg.enabled) return { ok: false, status: 503, error: 'Customer lookup is turned off' };
  if (!cfg.baseUrl) return { ok: false, status: 503, error: cfg.baseError || 'No lookup base URL configured' };
  if (!key)         return { ok: false, status: 503, error: 'No lookup API key configured' };

  let url;
  try {
    url = new URL(cfg.baseUrl + path);
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && String(v).trim() !== '') url.searchParams.set(k, String(v).trim());
    }
  } catch { return { ok: false, status: 500, error: 'Could not build the lookup URL' }; }

  const t0 = Date.now();
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal?.addEventListener('abort', onAbort);
  let idled = false;
  let idle = setTimeout(() => { idled = true; ac.abort(); }, STREAM_IDLE_MS);
  const keepAlive = () => {
    clearTimeout(idle);
    idle = setTimeout(() => { idled = true; ac.abort(); }, STREAM_IDLE_MS);
  };

  try {
    const r = await fetch(url, {
      headers: { 'X-API-Key': key, Accept: 'application/x-ndjson' },
      signal: ac.signal,
      redirect: 'manual',
    });
    logger.info('CUSTOMER_LOOKUP', `${label || path} by ${userId || 'unknown'} -> ${r.status} (stream)`);

    if (r.status === 401 || r.status === 403) return { ok: false, status: 502, error: 'The lookup service rejected the API key' };
    if (r.status === 429) {
      // Their daily quota, not ours, and it is not retryable today.
      let body = null; try { body = await r.json(); } catch { /* not json */ }
      return { ok: false, status: 429, error: body?.error || 'The lookup service has hit its daily quota' };
    }
    if (r.status >= 300 && r.status < 400) return { ok: false, status: 502, error: 'The lookup service asked for a login — check the API key and base URL' };
    if (!r.ok) {
      let body = null; try { body = await r.json(); } catch { /* not json */ }
      return { ok: false, status: 502, error: body?.error || `Lookup service error (${r.status})` };
    }
    if (!r.body) return { ok: false, status: 502, error: 'The lookup service sent no stream' };

    let buf = '';
    let lines = 0;
    for await (const chunk of r.body) {
      keepAlive();
      buf += Buffer.from(chunk).toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let obj; try { obj = JSON.parse(line); } catch { continue; }   // half a line, or noise
        lines += 1;
        await onLine?.(obj);
      }
    }
    const tail = buf.trim();
    if (tail) { try { const obj = JSON.parse(tail); lines += 1; await onLine?.(obj); } catch { /* ignore */ } }

    logger.info('CUSTOMER_LOOKUP', `${label || path} streamed ${lines} events in ${Date.now() - t0}ms`);
    return { ok: true, status: 200, lines };
  } catch (e) {
    const cancelled = !!signal?.aborted && !idled;
    logger.warn('CUSTOMER_LOOKUP', `${label || path} stream ended after ${Date.now() - t0}ms: ${cancelled ? 'client left' : e.message}`);
    if (cancelled) return { ok: false, status: 499, error: 'Cancelled', cancelled: true };
    return {
      ok: false,
      status: idled ? 504 : 502,
      error: idled
        ? 'The lookup service went quiet. Try again — the second attempt is usually cached.'
        : 'Could not reach the lookup service',
    };
  } finally {
    clearTimeout(idle);
    signal?.removeEventListener('abort', onAbort);
  }
}

// Digits-only, last 10 — then hyphenated, the form the service's own examples
// use (772-475-7074).
function normPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  return ten.length === 10 ? `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}` : '';
}

// ── quotas ───────────────────────────────────────────────────────────────────
// "N searches per D days", set globally and overridable per person. People and
// vehicle searches are counted separately because they cost different things.
//
// Config lives beside the access switches:
//   global default  business_config global customer_lookup.quota
//                   { people: { limit, days }, vehicles: { limit, days } }
//   per user        customer_lookup.users -> <id>.quota.{people,vehicles}
// limit 0 means unlimited, which is the shipped default so nothing is capped
// until somebody decides to cap it.
//
// USAGE is one row PER USER (scope customer_lookup.usage, key = user id) and is
// read straight from the table, never through the 60s config cache. A single
// shared blob would have every counter fighting the same read-modify-write, and
// a cached read would hand out a stale count.
//
// The window rolls from the FIRST search in it, not the calendar month: the
// first search starts the clock, and D days later the count is back to zero.
const USAGE_SCOPE = 'customer_lookup.usage';
const QUOTA_KEY   = 'customer_lookup.quota';
const KINDS = ['people', 'vehicles', 'vin'];

const oneQuota = (x, fallbackDays) => ({
  limit: Math.max(0, parseInt(x && x.limit, 10) || 0),
  days:  Math.min(Math.max(parseInt(x && x.days, 10) || fallbackDays, 1), 365),
});

async function globalQuota() {
  const q = await getConfig(null, QUOTA_KEY, null);
  return { people: oneQuota(q && q.people, 30), vehicles: oneQuota(q && q.vehicles, 30), vin: oneQuota(q && q.vin, 30) };
}

async function setGlobalQuota(patch, updatedBy) {
  const cur = await globalQuota();
  const next = {
    people:   oneQuota(patch && patch.people   ? patch.people   : cur.people,   cur.people.days),
    vehicles: oneQuota(patch && patch.vehicles ? patch.vehicles : cur.vehicles, cur.vehicles.days),
    vin:      oneQuota(patch && patch.vin      ? patch.vin      : cur.vin,      cur.vin.days),
  };
  await setConfig('global', QUOTA_KEY, next, updatedBy);
  return next;
}

// Effective limits for one person: their own override wins, else the global.
async function quotaFor(userId) {
  const [g, map] = await Promise.all([globalQuota(), userMap()]);
  const own = (map[userId] || {}).quota || {};
  const out = {};
  for (const kind of KINDS) {
    const o = own[kind];
    out[kind] = (o && (o.limit !== undefined || o.days !== undefined))
      ? Object.assign(oneQuota(o, g[kind].days), { source: 'user' })
      : Object.assign({}, g[kind], { source: 'global' });
  }
  return out;
}

async function setUserQuota(userId, patch, updatedBy) {
  const map = await userMap();
  const row = Object.assign({}, map[userId] || {});
  const quota = Object.assign({}, row.quota || {});
  for (const kind of KINDS) {
    if (!patch || patch[kind] === undefined) continue;
    // null clears the override and puts them back on the global default.
    if (patch[kind] === null) delete quota[kind];
    else quota[kind] = oneQuota(patch[kind], 30);
  }
  if (Object.keys(quota).length) row.quota = quota; else delete row.quota;
  // Keep the row only while it still says something. An access key that is
  // present and FALSE says plenty now that there is a default to override —
  // testing truthiness here would have quietly re-granted a blocked user the
  // next time their quota was edited.
  if (!ACCESS_KINDS.some(k => row[k] !== undefined) && !row.quota) delete map[userId];
  else map[userId] = row;
  await setConfig('global', 'customer_lookup.users', map, updatedBy);
  return row.quota || {};
}

async function readUsage(userId) {
  const { data } = await supabaseAdmin.from('business_config')
    .select('value').eq('scope', USAGE_SCOPE).eq('key', userId).maybeSingle();
  return (data && data.value && typeof data.value === 'object' && !Array.isArray(data.value)) ? data.value : {};
}

async function writeUsage(userId, value) {
  const { error } = await supabaseAdmin.from('business_config').upsert(
    { scope: USAGE_SCOPE, key: userId, value, updated_at: new Date().toISOString() },
    { onConflict: 'scope,key' },
  );
  if (error) logger.warn('CUSTOMER_LOOKUP', 'usage write failed: ' + error.message);
}

// Where one counter stands right now, expiring the window if it has run out.
function windowState(entry, days) {
  const ms = days * 86400000;
  const since = entry && entry.since ? Date.parse(entry.since) : 0;
  if (!since || Number.isNaN(since) || Date.now() - since >= ms) return { used: 0, since: null, resetsAt: null };
  return {
    used: Math.max(0, parseInt(entry.used, 10) || 0),
    since: new Date(since).toISOString(),
    resetsAt: new Date(since + ms).toISOString(),
  };
}

async function quotaStatus(userId) {
  const [q, usage] = await Promise.all([quotaFor(userId), readUsage(userId)]);
  const out = {};
  for (const kind of KINDS) {
    const w = windowState(usage[kind], q[kind].days);
    const unlimited = q[kind].limit === 0;
    out[kind] = {
      limit: q[kind].limit, days: q[kind].days, source: q[kind].source,
      unlimited, used: w.used,
      remaining: unlimited ? null : Math.max(0, q[kind].limit - w.used),
      window_started: w.since, resets_at: w.resetsAt,
    };
  }
  return out;
}

// Spend one search. Checked and written BEFORE the upstream call so a quota
// cannot be walked past by firing several at once; refund() puts it back when
// the call turns out to have failed.
async function consume(userId, kind) {
  // The allowance and what has been used are separate rows and neither depends
  // on the other -- read together. This sits in front of every search.
  const [quotas, usage] = await Promise.all([quotaFor(userId), readUsage(userId)]);
  const q = quotas[kind];
  const w = windowState(usage[kind], q.days);
  if (q.limit > 0 && w.used >= q.limit) {
    return { ok: false, limit: q.limit, days: q.days, used: w.used, resets_at: w.resetsAt };
  }
  const since = w.since || new Date().toISOString();
  usage[kind] = { used: w.used + 1, since };
  await writeUsage(userId, usage);
  return { ok: true, limit: q.limit, days: q.days, used: w.used + 1, resets_at: new Date(Date.parse(since) + q.days * 86400000).toISOString() };
}

async function refund(userId, kind) {
  const usage = await readUsage(userId);
  const e = usage[kind];
  if (!e || !e.since) return;
  const used = Math.max(0, (parseInt(e.used, 10) || 0) - 1);
  // Dropping to zero also drops the window, so the next search starts a fresh
  // one rather than inheriting a clock nothing is counted against.
  if (used === 0) delete usage[kind]; else usage[kind] = { used, since: e.since };
  await writeUsage(userId, usage);
}

async function resetUsage(userId, kind) {
  if (!kind) { await writeUsage(userId, {}); return {}; }
  const usage = await readUsage(userId);
  delete usage[kind];
  await writeUsage(userId, usage);
  return usage;
}

module.exports = {
  KEY_NAME, DEFAULT_BASE,
  getApiKey, setApiKey, normalizeBase, settings,
  userMap, accessFor, setAccess, defaultAccess, setDefaultAccess, ACCESS_KINDS,
  rateLimit, call, stream, normPhone,
  globalQuota, setGlobalQuota, quotaFor, setUserQuota,
  quotaStatus, consume, refund, resetUsage, readUsage,
};
