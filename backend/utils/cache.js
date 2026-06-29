// ============================================================================
// utils/cache.js — tiny in-process TTL cache with namespaces.
//
// Why in-process (not Redis): the app runs as a single Node process (Coolify
// KVM4), so a Map cache is the right tool — zero infra, microsecond reads. Every
// entry has an explicit TTL so a missed invalidation self-heals quickly, and the
// scheduler sweeps expired entries so memory can't grow unbounded.
//
//   remember(ns, key, ttlMs, loader) — get-or-compute (caches the loader result)
//   get/set                          — manual access
//   invalidate(ns, key)              — drop one entry  (call on writes)
//   invalidateNamespace(ns)          — drop a whole namespace
//   sweep()                          — purge expired (scheduler calls this)
// ============================================================================
const _ns = new Map(); // namespace -> Map(key -> { value, exp })

function _store(ns) {
  let m = _ns.get(ns);
  if (!m) { m = new Map(); _ns.set(ns, m); }
  return m;
}

function get(ns, key) {
  const m = _ns.get(ns);
  if (!m) return undefined;
  const hit = m.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.exp) { m.delete(key); return undefined; }
  return hit.value;
}

function set(ns, key, value, ttlMs) {
  _store(ns).set(key, { value, exp: Date.now() + ttlMs });
  return value;
}

// Get-or-compute. Caches anything except `undefined` (treated as a miss), so
// null/false/0/[] are all cached correctly.
async function remember(ns, key, ttlMs, loader) {
  const cached = get(ns, key);
  if (cached !== undefined) return cached;
  const value = await loader();
  if (value !== undefined) set(ns, key, value, ttlMs);
  return value;
}

function invalidate(ns, key) {
  const m = _ns.get(ns);
  if (m) m.delete(key);
}

function invalidateNamespace(ns) { _ns.delete(ns); }

function clearAll() { _ns.clear(); }

// Drop expired entries across all namespaces (memory hygiene).
function sweep() {
  const now = Date.now();
  let purged = 0;
  for (const [, m] of _ns) {
    for (const [k, v] of m) {
      if (now > v.exp) { m.delete(k); purged++; }
    }
  }
  return purged;
}

function stats() {
  let entries = 0;
  for (const [, m] of _ns) entries += m.size;
  return { namespaces: _ns.size, entries };
}

module.exports = { get, set, remember, invalidate, invalidateNamespace, clearAll, sweep, stats };
