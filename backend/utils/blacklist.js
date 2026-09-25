// ============================================================================
// utils/blacklist.js — Blacklist Alliance DNC / litigation lookup.
// Single number, cached. The API key is read from app_secrets (service-role
// only); enabled + cache_days from business_config. Never throws to the caller.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { getConfig } = require('./businessConfig');
const logger = require('./logger');

const KEY_NAME = 'blacklist.api_key';

// Normalize to a bare 10-digit US number (strip +1 / formatting).
function norm(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d;
}

async function getApiKey() {
  const { data } = await supabaseAdmin.from('app_secrets').select('value').eq('key', KEY_NAME).maybeSingle();
  return data?.value || '';
}
async function setApiKey(value, userId) {
  await supabaseAdmin.from('app_secrets')
    .upsert({ key: KEY_NAME, value: value || null, updated_at: new Date().toISOString(), updated_by: userId || null }, { onConflict: 'key' });
}

const VALID_VERSIONS = ['v1', 'v2', 'v3', 'v5'];
async function settings() {
  const v = String(await getConfig(null, 'blacklist.version', 'v3'));
  return {
    enabled:   !!(await getConfig(null, 'blacklist.enabled', false)),
    cacheDays: parseInt(await getConfig(null, 'blacklist.cache_days', 30), 10) || 30,
    version:   VALID_VERSIONS.includes(v) ? v : 'v3',
    // Seconds an agent's own search may be served from cache. Small on purpose:
    // it only exists so a double-tap, or the badge and the panel asking about
    // the same number at once, do not fire two identical live lookups.
    freshGraceSec: Math.max(0, parseInt(await getConfig(null, 'blacklist.fresh_grace_sec', 60), 10) || 0),
  };
}

// EVERY ANSWER THE ALLIANCE GIVES, NOT JUST GOOD/BAD.
//
// The API answers with a message per list it matched -- live data shows Good,
// Blacklisted and Suppressed, and a suppressed number is NOT the same thing as
// a litigator: it is a number the client asked never to be called again. The
// old boolean painted both bright red "Blacklisted", so an agent could not tell
// which rule they were about to break, and the reason (the `code` list:
// plaintiff-primary, prelitigation2, screamer, suppression, federal-dnc ...)
// was the only thing separating them.
//
// `verdict` is that answer, normalized: clean | suppressed | blacklisted |
// flagged (anything new the Alliance starts sending -- named, never silently
// dropped into one of the others). `blacklisted` stays exactly as it was, so
// the bulk scan, the compliance report and every stored count keep their
// meaning: not-Good.
const VERDICTS = [
  { verdict: 'clean',       test: (m) => m === 'good' },
  { verdict: 'suppressed',  test: (m) => m.includes('suppress') },
  { verdict: 'blacklisted', test: (m) => m.includes('blacklist') || m.includes('dnc') },
];
function classify(message, codes = []) {
  const m = String(message || '').trim().toLowerCase();
  if (!m) return 'unknown';
  const hit = VERDICTS.find(v => v.test(m));
  if (hit) return hit.verdict;
  // An unrecognised message with no codes behind it is still an answer, not a
  // clean number -- surface it under its own name rather than calling it good.
  return codes.length ? 'blacklisted' : 'flagged';
}

// Shape a cache/row into the client result (message-driven verdict).
function toResult(row, cached) {
  const message = row.message || 'Unknown';
  const codes = row.codes || [];
  const blacklisted = !!message && message.toLowerCase() !== 'good';
  return {
    ok: true, cached: !!cached, phone: row.phone, message, blacklisted,
    verdict: classify(message, codes),
    api_status: row.status || null,          // the Alliance's own call status
    results: row.results ?? null,            // how many lists it matched
    codes, wireless: !!row.wireless, carrier: row.carrier || null,
    checked_at: row.checked_at,
  };
}

// Cache HIT bookkeeping — a number everyone keeps looking up must not look like
// a one-off, and the last searcher should still be the person who just asked.
async function touchCache(phone, userId, source) {
  await supabaseAdmin.rpc('app_touch_blacklist_lookup', {
    p_phone: phone, p_user: userId || null, p_source: source || 'lookup',
  }).then(() => {}, () => {});
}

/**
 * Lookup one number. Returns { ok, ...result } or { ok:false, error }.
 * Uses the cache unless it's older than cache_days (or force=true).
 * `userId` / `source` are stamped on the cache row so compliance can see who
 * searched what and how often (mig 253).
 */
async function lookup(phone, { force = false, maxAgeMs = null, userId = null, source = 'lookup' } = {}) {
  const p = norm(phone);
  if (p.length !== 10) return { ok: false, error: 'invalid phone number' };

  const cfg = await settings();
  if (!cfg.enabled) return { ok: false, error: 'Blacklist lookup is turned off' };

  // How old a cached answer may be for THIS caller. The bulk tools keep the
  // full cache window; an agent typing a number in gets a live answer, because
  // a number that was clean three weeks ago can be on a litigator list today
  // and they are about to dial it now.
  const window = force ? 0 : (Number.isFinite(maxAgeMs) && maxAgeMs !== null ? maxAgeMs : cfg.cacheDays * 86400000);
  if (window > 0) {
    const { data: cached } = await supabaseAdmin.from('blacklist_lookups').select('*').eq('phone', p).maybeSingle();
    if (cached && (Date.now() - new Date(cached.checked_at).getTime()) < window) {
      await touchCache(p, userId, source);
      return toResult(cached, true);
    }
  }

  const apiKey = await getApiKey();
  if (!apiKey) return { ok: false, error: 'No API key configured' };

  const url = `https://api.blacklistalliance.net/lookup?key=${encodeURIComponent(apiKey)}&ver=${cfg.version}&resp=json&phone=${p}`;
  let data;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (r.status === 403) return { ok: false, error: 'Invalid API key' };
    if (r.status === 422) return { ok: false, error: 'Invalid phone number' };
    if (!r.ok) return { ok: false, error: `Lookup failed (${r.status})` };
    data = await r.json();
  } catch (e) {
    logger.warn('BLACKLIST', `lookup error for ${p}: ${e.message}`);
    return { ok: false, error: 'Lookup service unavailable' };
  }

  const row = {
    phone: p,
    status: data.status || null,
    message: data.message || null,
    // The API sends code:"none" for clean numbers — treat that as no codes.
    codes: (Array.isArray(data.code) ? data.code : String(data.code || '').split(','))
      .map(s => String(s).trim()).filter(c => c && c.toLowerCase() !== 'none'),
    wireless: data.wireless === 1 || data.wireless === '1' || data.wireless === true,
    carrier: data.carrier || null,
    results: data.results ?? null,
    raw: data,
    checked_at: new Date().toISOString(),
  };
  // Atomic upsert + counter bump (a plain upsert can't read the old count).
  await supabaseAdmin.rpc('app_record_blacklist_lookup', {
    p_phone: row.phone, p_status: row.status, p_message: row.message, p_codes: row.codes,
    p_wireless: row.wireless, p_carrier: row.carrier, p_results: row.results, p_raw: row.raw,
    p_user: userId || null, p_source: source || 'lookup',
  }).then(({ error }) => {
    // Pre-253 database: fall back to the plain upsert so lookups never break.
    if (error) return supabaseAdmin.from('blacklist_lookups').upsert(row, { onConflict: 'phone' });
  }, () => {});
  return toResult(row, false);
}

module.exports = { lookup, settings, getApiKey, setApiKey, norm, classify };
