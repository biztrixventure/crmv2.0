// ============================================================================
// audioCache — keep played QA recordings in the browser (IndexedDB).
//
// Two problems, one answer:
//
//   1. Re-fetching. Leave the tab, come back, and the clip was pulled from
//      VICIdial all over again — same bytes, same wait, more load on a dialer
//      that is also running a call centre.
//   2. Seeking. Streaming playback can only seek through what the upstream
//      recording host serves by Range; when it will not, dragging the bar
//      stalls. A clip held locally is a complete Blob, so scrubbing anywhere is
//      instant and always works.
//
// IndexedDB, not localStorage: localStorage is ~5 MB, synchronous and strings
// only — one call recording would blow it. IDB stores Blobs natively and
// asynchronously.
//
// Bounded on purpose. A QA reviewer opens hundreds of calls a week and must
// never be the reason a browser runs out of disk, so the store is capped and
// least-recently-used clips are evicted. Every failure path degrades to "not
// cached" — a private window with IDB disabled simply streams, as before.
// ============================================================================

const DB_NAME = 'qa-audio';
const STORE = 'clips';
const DB_VERSION = 1;
const MAX_BYTES = 300 * 1024 * 1024;       // ~300 MB of call audio, then LRU eviction
const MAX_CLIP_BYTES = 60 * 1024 * 1024;   // never cache one absurd file

let _db = null;
function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'key' });
        os.createIndex('at', 'at');            // LRU eviction reads this
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
  });
}

const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let req;
    try { req = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
};

/** The cached Blob for a clip, or null. Touches `at` so LRU keeps what is used. */
export async function getClip(key) {
  if (!key) return null;
  try {
    const row = await tx('readonly', (s) => s.get(key));
    if (!row || !row.blob) return null;
    // best-effort recency bump; never block playback on it
    tx('readwrite', (s) => s.put({ ...row, at: Date.now() })).catch(() => {});
    return row.blob;
  } catch { return null; }
}

/** Store a clip, then evict the oldest until the store is back under the cap. */
export async function putClip(key, blob) {
  if (!key || !blob || !blob.size || blob.size > MAX_CLIP_BYTES) return false;
  try {
    await tx('readwrite', (s) => s.put({ key, blob, size: blob.size, at: Date.now() }));
    await prune();
    return true;
  } catch { return false; }
}

/** Drop least-recently-used clips until the total is under MAX_BYTES. */
export async function prune(maxBytes = MAX_BYTES) {
  try {
    const rows = await tx('readonly', (s) => s.getAll());
    const list = Array.isArray(rows) ? rows : [];
    let total = list.reduce((n, r) => n + (r.size || 0), 0);
    if (total <= maxBytes) return;
    list.sort((a, b) => (a.at || 0) - (b.at || 0));            // oldest touched first
    for (const r of list) {
      if (total <= maxBytes) break;
      await tx('readwrite', (s) => s.delete(r.key)).catch(() => {});
      total -= (r.size || 0);
    }
  } catch { /* eviction is best-effort */ }
}

/** Bytes currently held — lets a "clear cached audio" control report a size. */
export async function cacheSize() {
  try {
    const rows = await tx('readonly', (s) => s.getAll());
    return (Array.isArray(rows) ? rows : []).reduce((n, r) => n + (r.size || 0), 0);
  } catch { return 0; }
}

export async function clearCache() {
  try { await tx('readwrite', (s) => s.clear()); return true; } catch { return false; }
}

/** Stable key for one recording: the box owns the id, so both are needed. */
export const clipKey = (boxId, recordingId) => `${boxId || '?'}|${recordingId || '?'}`;
