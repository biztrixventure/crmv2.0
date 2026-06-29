// Shared US ZIP → city/state lookup (zippopotam.us, no API key needed), with a
// 24h in-process cache. Used by the /zipcode route and the Data Cleanup geo-fill.
const STATE_TZ_FALLBACK = 'America/New_York';
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

async function fetchUpstream(url) {
  if (typeof globalThis.fetch === 'function') {
    const r = await globalThis.fetch(url);
    if (!r.ok) return null;
    return r.json();
  }
  return new Promise((resolve, reject) => {
    require('https').get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}

/**
 * Look up a 5-digit US ZIP. Returns { zip, city, state, state_abbr } or null.
 * Never throws — a network/parse failure resolves to null so callers degrade.
 */
async function lookupZip(zip) {
  const z = String(zip || '').replace(/\D/g, '').slice(0, 5);
  if (!/^\d{5}$/.test(z)) return null;
  const hit = cache.get(z);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;
  try {
    const up = await fetchUpstream(`https://api.zippopotam.us/us/${z}`);
    const place = up && up.places && up.places[0];
    if (!place) { cache.set(z, { data: null, ts: Date.now() }); return null; }
    const data = {
      zip: z,
      city: place['place name'] || '',
      state: place['state'] || '',
      state_abbr: place['state abbreviation'] || '',
    };
    cache.set(z, { data, ts: Date.now() });
    return data;
  } catch { return null; }
}

module.exports = { lookupZip, STATE_TZ_FALLBACK };
