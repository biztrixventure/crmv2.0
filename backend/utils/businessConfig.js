// ============================================================================
// businessConfig — resolver for company → global → code-default config values.
// Reads from business_config table (mig 068). 60s in-process cache keyed on
// (scope, key) so a hot path (every sale insert hitting dedup.window_days)
// doesn't hammer Supabase. Cache clears on write via clearConfigCache().
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');

const TTL_MS = 60_000;
const _cache = new Map();   // `${scope}|${key}` → { value, at }

const cacheKey = (scope, key) => `${scope}|${key}`;

async function readOne(scope, key) {
  const k = cacheKey(scope, key);
  const hit = _cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const { data, error } = await supabaseAdmin
    .from('business_config').select('value').eq('scope', scope).eq('key', key).maybeSingle();
  if (error) { logger.warn('BIZ_CONFIG', `read ${scope}|${key}: ${error.message}`); return undefined; }
  const value = data?.value;
  _cache.set(k, { value, at: Date.now() });
  return value;
}

// Resolve in order: company:<id> → global → fallback.
// undefined return only happens when fallback itself is undefined.
async function getConfig(companyId, key, fallback) {
  if (companyId) {
    const v = await readOne(`company:${companyId}`, key);
    if (v !== undefined && v !== null) return v;
  }
  const g = await readOne('global', key);
  if (g !== undefined && g !== null) return g;
  return fallback;
}

// Fetch ALL keys for a scope chain at once — used by the SuperAdmin UI so
// it can render every page section with a single round-trip.
async function getAllConfig(companyId) {
  const out = {};
  // global first → company overrides on top
  const { data: g } = await supabaseAdmin
    .from('business_config').select('key, value').eq('scope', 'global');
  (g || []).forEach(r => { out[r.key] = r.value; });
  if (companyId) {
    const { data: c } = await supabaseAdmin
      .from('business_config').select('key, value').eq('scope', `company:${companyId}`);
    (c || []).forEach(r => { out[r.key] = r.value; });
  }
  return out;
}

async function setConfig(scope, key, value, updatedBy) {
  const { error } = await supabaseAdmin
    .from('business_config')
    .upsert({ scope, key, value, updated_by: updatedBy, updated_at: new Date().toISOString() },
            { onConflict: 'scope,key' });
  if (error) throw new Error(error.message);
  _cache.delete(cacheKey(scope, key));
  return true;
}

async function resetConfig(scope, key) {
  if (scope === 'global') throw new Error('Cannot delete a global default. Update the value instead.');
  const { error } = await supabaseAdmin.from('business_config').delete().eq('scope', scope).eq('key', key);
  if (error) throw new Error(error.message);
  _cache.delete(cacheKey(scope, key));
  return true;
}

function clearConfigCache() { _cache.clear(); }

module.exports = { getConfig, getAllConfig, setConfig, resetConfig, clearConfigCache };
