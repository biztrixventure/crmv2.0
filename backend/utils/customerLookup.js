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
async function getApiKey() {
  const { data } = await supabaseAdmin.from('app_secrets').select('value').eq('key', KEY_NAME).maybeSingle();
  return data?.value || '';
}
async function setApiKey(value, userId) {
  await supabaseAdmin.from('app_secrets').upsert(
    { key: KEY_NAME, value: value || null, updated_at: new Date().toISOString(), updated_by: userId || null },
    { onConflict: 'key' },
  );
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
// Absent user → both false. That IS the "off by default" the tool ships with:
// turning the service on globally still shows it to nobody until a superadmin
// flips a switch for a named person.
async function userMap() {
  const m = await getConfig(null, 'customer_lookup.users', {});
  return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
}

async function accessFor(userId, { superadmin = false } = {}) {
  const [cfg, key, map] = await Promise.all([settings(), getApiKey(), userMap()]);
  const configured = !!cfg.baseUrl && !!key;
  const row = map[userId] || {};
  // A superadmin administers the tool, so they can always exercise it — the
  // same rule the DNC lookup uses. Everyone else needs their own switch.
  const people   = superadmin || !!row.people;
  const vehicles = superadmin || !!row.vehicles;
  const live = cfg.enabled && configured;
  return {
    people:   live && people,
    vehicles: live && vehicles,
    // Diagnostics, so the UI can say WHY it is closed instead of just vanishing.
    enabled: cfg.enabled, configured, superadmin,
    granted: { people, vehicles },
  };
}

async function setAccess(userId, patch, updatedBy) {
  const map = await userMap();
  const row = { ...(map[userId] || {}) };
  if (patch.people   !== undefined) row.people   = !!patch.people;
  if (patch.vehicles !== undefined) row.vehicles = !!patch.vehicles;
  // Drop the key entirely when nothing is granted — keeps the config row from
  // growing a tombstone for every user ever toggled.
  if (!row.people && !row.vehicles) delete map[userId];
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
  const cfg = await settings();
  if (!cfg.enabled) return { ok: false, status: 503, error: 'Customer lookup is turned off' };
  if (!cfg.baseUrl) return { ok: false, status: 503, error: cfg.baseError || 'No lookup base URL configured' };
  const key = await getApiKey();
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
const KINDS = ['people', 'vehicles'];

const oneQuota = (x, fallbackDays) => ({
  limit: Math.max(0, parseInt(x && x.limit, 10) || 0),
  days:  Math.min(Math.max(parseInt(x && x.days, 10) || fallbackDays, 1), 365),
});

async function globalQuota() {
  const q = await getConfig(null, QUOTA_KEY, null);
  return { people: oneQuota(q && q.people, 30), vehicles: oneQuota(q && q.vehicles, 30) };
}

async function setGlobalQuota(patch, updatedBy) {
  const cur = await globalQuota();
  const next = {
    people:   oneQuota(patch && patch.people   ? patch.people   : cur.people,   cur.people.days),
    vehicles: oneQuota(patch && patch.vehicles ? patch.vehicles : cur.vehicles, cur.vehicles.days),
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
  // Keep the row only while it still says something.
  if (!row.people && !row.vehicles && !row.quota) delete map[userId];
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
  const q = (await quotaFor(userId))[kind];
  const usage = await readUsage(userId);
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
  userMap, accessFor, setAccess,
  rateLimit, call, normPhone,
  globalQuota, setGlobalQuota, quotaFor, setUserQuota,
  quotaStatus, consume, refund, resetUsage, readUsage,
};
