// ============================================================================
// businessConfig — resolver for company → global → code-default config values.
// Reads from business_config table (mig 068). 60s in-process cache holding a
// whole SCOPE at a time, so a hot path (every sale insert hitting
// dedup.window_days) doesn't hammer Supabase. Cache clears on write.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');

const TTL_MS = 60_000;

// Cached PER SCOPE, not per key.
//
// The old cache was keyed `${scope}|${key}`, and getConfig reads two scopes
// (company, then global) for every key it is asked for. A page that resolves a
// dozen settings therefore issued ~28 separate round-trips on a cold cache —
// measured: 29 business_config queries in ONE /qa/config request, 15.6s of a
// 15.6s response, because each round-trip to this database costs ~445ms.
//
// A scope is a handful of rows, so fetching all of it costs exactly the same
// one round-trip as fetching a single key. Two queries now answer every key.
const _scopes = new Map();    // scope → { map: Map<key,value>, at }
const _inflight = new Map();  // scope → Promise — concurrent callers share one fetch
const EMPTY = new Map();      // stands in for "no company scope asked for"

async function readScope(scope) {
  const hit = _scopes.get(scope);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;
  const pending = _inflight.get(scope);
  if (pending) return pending;                     // never stampede the same scope
  const p = (async () => {
    const { data, error } = await supabaseAdmin
      .from('business_config').select('key, value').eq('scope', scope);
    if (error) {
      logger.warn('BIZ_CONFIG', `read scope ${scope}: ${error.message}`);
      return hit?.map || new Map();                // stale beats failing the caller
    }
    const map = new Map((data || []).map(r => [r.key, r.value]));
    _scopes.set(scope, { map, at: Date.now() });
    return map;
  })().finally(() => _inflight.delete(scope));
  _inflight.set(scope, p);
  return p;
}

async function readOne(scope, key) {
  return (await readScope(scope)).get(key);
}

// Resolve in order: company:<id> → global → fallback.
// undefined return only happens when fallback itself is undefined.
// Both scopes are fetched TOGETHER: the company value usually misses, and
// awaiting it before even starting the global read made every cold lookup two
// sequential round-trips instead of one.
async function getConfig(companyId, key, fallback) {
  const [c, g] = await Promise.all([
    companyId ? readScope(`company:${companyId}`) : Promise.resolve(EMPTY),
    readScope('global'),
  ]);
  const v = c.get(key);
  if (v !== undefined && v !== null) return v;
  const gv = g.get(key);
  if (gv !== undefined && gv !== null) return gv;
  return fallback;
}

// Fetch ALL keys for a scope chain at once — used by the SuperAdmin UI so
// it can render every page section with a single round-trip.
async function getAllConfig(companyId) {
  // same two cached scope reads getConfig uses — so a page that calls both
  // pays for the fetch once, not twice
  const [g, c] = await Promise.all([
    readScope('global'),
    companyId ? readScope(`company:${companyId}`) : Promise.resolve(new Map()),
  ]);
  const out = {};
  for (const [k, v] of g) out[k] = v;      // global first → company overrides on top
  for (const [k, v] of c) out[k] = v;
  return out;
}

async function setConfig(scope, key, value, updatedBy) {
  const { error } = await supabaseAdmin
    .from('business_config')
    .upsert({ scope, key, value, updated_by: updatedBy, updated_at: new Date().toISOString() },
            { onConflict: 'scope,key' });
  if (error) throw new Error(error.message);
  _scopes.delete(scope);
  return true;
}

async function resetConfig(scope, key) {
  if (scope === 'global') throw new Error('Cannot delete a global default. Update the value instead.');
  const { error } = await supabaseAdmin.from('business_config').delete().eq('scope', scope).eq('key', key);
  if (error) throw new Error(error.message);
  _scopes.delete(scope);
  return true;
}

function clearConfigCache() { _scopes.clear(); }

module.exports = { getConfig, getAllConfig, setConfig, resetConfig, clearConfigCache };
