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

async function settings() {
  return {
    enabled:   !!(await getConfig(null, 'blacklist.enabled', false)),
    cacheDays: parseInt(await getConfig(null, 'blacklist.cache_days', 30), 10) || 30,
  };
}

// Shape a cache/row into the client result (message-driven verdict).
function toResult(row, cached) {
  const message = row.message || 'Unknown';
  const blacklisted = !!message && message.toLowerCase() !== 'good';
  return {
    ok: true, cached: !!cached, phone: row.phone, message, blacklisted,
    codes: row.codes || [], wireless: !!row.wireless, carrier: row.carrier || null,
    checked_at: row.checked_at,
  };
}

/**
 * Lookup one number. Returns { ok, ...result } or { ok:false, error }.
 * Uses the cache unless it's older than cache_days (or force=true).
 */
async function lookup(phone, { force = false } = {}) {
  const p = norm(phone);
  if (p.length !== 10) return { ok: false, error: 'invalid phone number' };

  const cfg = await settings();
  if (!cfg.enabled) return { ok: false, error: 'Blacklist lookup is turned off' };

  if (!force) {
    const { data: cached } = await supabaseAdmin.from('blacklist_lookups').select('*').eq('phone', p).maybeSingle();
    if (cached && (Date.now() - new Date(cached.checked_at).getTime()) < cfg.cacheDays * 86400000) {
      return toResult(cached, true);
    }
  }

  const apiKey = await getApiKey();
  if (!apiKey) return { ok: false, error: 'No API key configured' };

  const url = `https://api.blacklistalliance.net/lookup?key=${encodeURIComponent(apiKey)}&ver=v3&resp=json&phone=${p}`;
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
    codes: Array.isArray(data.code) ? data.code : (data.code ? String(data.code).split(',').map(s => s.trim()).filter(Boolean) : []),
    wireless: data.wireless === 1 || data.wireless === '1' || data.wireless === true,
    carrier: data.carrier || null,
    results: data.results ?? null,
    raw: data,
    checked_at: new Date().toISOString(),
  };
  await supabaseAdmin.from('blacklist_lookups').upsert(row, { onConflict: 'phone' }).then(() => {}, () => {});
  return toResult(row, false);
}

module.exports = { lookup, settings, getApiKey, setApiKey, norm };
