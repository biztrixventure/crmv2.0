// ============================================================================
// middleware/integrationKey.js -- who is calling the machine API (/api/ext/v1).
//
//   Authorization: Bearer crm_<43 base64url chars>
//
// The key is hashed (sha256) and looked up in integration_keys (mig 348); the
// key itself is never stored. On success req.integration = { id, name,
// scopes, company_ids } and the route asks requireScope('sales.read').
//
//   bad / unknown key     401
//   revoked key           401
//   missing scope         403
//   too many requests     429 (per key, EXT_API_RATE_PER_MIN, default 600)
//   migration not applied 503 {error: 'Connections are not set up yet: ...'}
//
// Never throws past itself: a database problem is a 503, not a crash.
// Lookups are cached for 30s (keyCache.clear() on revoke makes it instant in
// this process). last_used_at is written at most once a minute per key.
// ============================================================================
const { bearerKey, looksLikeKey, hashKey, hasScope, isMissingTable, NOT_READY } = require('../utils/integrations');

const CACHE_MS = 30_000;
const TOUCH_MS = 60_000;
const FAIL_WINDOW_MS = 60_000;
const FAIL_MAX = 60;   // bad keys per IP per minute before we stop looking

function defaultLookup() {
  const { supabaseAdmin } = require('../config/database');
  return async (hash) => {
    const { data, error } = await supabaseAdmin
      .from('integration_keys')
      .select('id, name, key_prefix, scopes, company_ids, revoked_at')
      .eq('key_hash', hash)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) return { notReady: true };
      throw new Error(error.message);
    }
    return { row: data || null };
  };
}

function defaultTouch() {
  const { supabaseAdmin } = require('../config/database');
  return (id, at) => supabaseAdmin.from('integration_keys').update({ last_used_at: at }).eq('id', id)
    .then(() => {}, () => {});
}

function createIntegrationKeyAuth({
  lookup,
  touch,
  now = () => Date.now(),
  ratePerMin = Number(process.env.EXT_API_RATE_PER_MIN) || 600,
} = {}) {
  const cache = new Map();     // hash -> { at, result }
  const touched = new Map();   // key id -> ms of last last_used_at write
  const windows = new Map();   // key id -> { start, count }
  const fails = new Map();     // ip -> { start, count }
  let _lookup = lookup;
  let _touch = touch;

  const hit = (map, id, max, windowMs) => {
    const t = now();
    let w = map.get(id);
    if (!w || t - w.start >= windowMs) { w = { start: t, count: 0 }; map.set(id, w); }
    w.count += 1;
    if (map.size > 10_000) map.clear();   // memory guard; worst case one fresh window
    return { over: w.count > max, retryAfter: Math.ceil((w.start + windowMs - t) / 1000) };
  };

  async function resolve(hash) {
    const c = cache.get(hash);
    if (c && now() - c.at < CACHE_MS) return c.result;
    if (!_lookup) _lookup = defaultLookup();
    const result = await _lookup(hash);
    if (!result.notReady) cache.set(hash, { at: now(), result });
    if (cache.size > 1000) cache.clear();
    return result;
  }

  async function integrationKeyAuth(req, res, next) {
    try {
      const ip = req.ip || 'unknown';
      const f = fails.get(ip);
      if (f && now() - f.start < FAIL_WINDOW_MS && f.count >= FAIL_MAX) {
        return res.status(429).json({ error: 'Too many failed attempts' });
      }
      const key = bearerKey(req.headers.authorization);
      if (!looksLikeKey(key)) {
        hit(fails, ip, FAIL_MAX, FAIL_WINDOW_MS);
        return res.status(401).json({ error: 'Missing or malformed API key (Authorization: Bearer crm_...)' });
      }
      let result;
      try {
        result = await resolve(hashKey(key));
      } catch {
        return res.status(503).json({ error: 'API key check is unavailable, try again' });
      }
      if (result.notReady) return res.status(503).json({ error: NOT_READY });
      const row = result.row;
      if (!row) {
        hit(fails, ip, FAIL_MAX, FAIL_WINDOW_MS);
        return res.status(401).json({ error: 'Unknown API key' });
      }
      if (row.revoked_at) return res.status(401).json({ error: 'API key revoked' });

      const rl = hit(windows, row.id, ratePerMin, 60_000);
      if (rl.over) {
        res.set('Retry-After', String(Math.max(1, rl.retryAfter)));
        return res.status(429).json({ error: 'Rate limit exceeded', limit_per_minute: ratePerMin });
      }

      const t = now();
      if (!touched.has(row.id) || t - touched.get(row.id) >= TOUCH_MS) {
        touched.set(row.id, t);
        if (!_touch) _touch = defaultTouch();
        Promise.resolve(_touch(row.id, new Date(t).toISOString())).catch(() => {});
      }

      req.integration = {
        id: row.id,
        name: row.name,
        key_prefix: row.key_prefix,
        scopes: Array.isArray(row.scopes) ? row.scopes : [],
        company_ids: Array.isArray(row.company_ids) ? row.company_ids : null,
      };
      next();
    } catch (e) {
      res.status(503).json({ error: 'API key check failed', detail: e.message });
    }
  }

  integrationKeyAuth.clear = () => cache.clear();
  return integrationKeyAuth;
}

/** 403 unless the calling key holds `scope`. */
function requireScope(scope) {
  return (req, res, next) => {
    if (!req.integration) return res.status(401).json({ error: 'API key required' });
    if (!hasScope(req.integration.scopes, scope)) {
      return res.status(403).json({ error: `This key does not have the ${scope} scope`, needed: scope });
    }
    next();
  };
}

/**
 * The companies this request may read: the key's list, narrowed by ?company=.
 * null = every company. Asking for a company outside the key's list is a 403.
 */
function scopedCompanies(req, requested) {
  const allowed = req.integration ? req.integration.company_ids : null;
  if (!requested) return { ids: allowed };
  const want = String(requested).split(',').map((s) => s.trim()).filter(Boolean);
  if (want.some((c) => !/^[0-9a-f-]{36}$/i.test(c))) return { error: 400, message: 'company must be a company id (uuid)' };
  if (allowed && want.some((c) => !allowed.includes(c))) return { error: 403, message: 'This key is not allowed to read that company' };
  return { ids: want };
}

const integrationKey = createIntegrationKeyAuth();

module.exports = { integrationKey, createIntegrationKeyAuth, requireScope, scopedCompanies };
