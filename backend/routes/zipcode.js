const express = require('express');
const router  = express.Router();

// State abbreviation → IANA timezone (primary timezone per state)
const STATE_TZ = {
  AL: 'America/Chicago',    AK: 'America/Anchorage',  AZ: 'America/Phoenix',
  AR: 'America/Chicago',    CA: 'America/Los_Angeles', CO: 'America/Denver',
  CT: 'America/New_York',   DE: 'America/New_York',    FL: 'America/New_York',
  GA: 'America/New_York',   HI: 'Pacific/Honolulu',    ID: 'America/Boise',
  IL: 'America/Chicago',    IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago',    KY: 'America/New_York',    LA: 'America/Chicago',
  ME: 'America/New_York',   MD: 'America/New_York',    MA: 'America/New_York',
  MI: 'America/Detroit',    MN: 'America/Chicago',     MS: 'America/Chicago',
  MO: 'America/Chicago',    MT: 'America/Denver',      NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York',   NJ: 'America/New_York',
  NM: 'America/Denver',     NY: 'America/New_York',    NC: 'America/New_York',
  ND: 'America/Chicago',    OH: 'America/New_York',    OK: 'America/Chicago',
  OR: 'America/Los_Angeles', PA: 'America/New_York',   RI: 'America/New_York',
  SC: 'America/New_York',   SD: 'America/Chicago',     TN: 'America/Chicago',
  TX: 'America/Chicago',    UT: 'America/Denver',      VT: 'America/New_York',
  VA: 'America/New_York',   WA: 'America/Los_Angeles', WV: 'America/New_York',
  WI: 'America/Chicago',    WY: 'America/Denver',      DC: 'America/New_York',
  PR: 'America/Puerto_Rico', VI: 'America/St_Thomas',
};

// Simple in-process cache — avoids hitting zippopotam.us on every keystroke
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h

// GET /api/zipcode/:zip
router.get('/:zip', async (req, res) => {
  const zip = req.params.zip?.trim();
  if (!/^\d{5}$/.test(zip)) {
    return res.status(400).json({ error: 'ZIP must be exactly 5 digits' });
  }

  // Serve from cache if fresh
  const cached = cache.get(zip);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    // Use Node's native fetch (available in Node 18+) or https fallback
    const upstream = await fetchUpstream(`https://api.zippopotam.us/us/${zip}`);
    if (!upstream) {
      return res.status(404).json({ error: `ZIP ${zip} not found` });
    }

    const place       = upstream.places?.[0];
    const stateAbbr   = place?.['state abbreviation'] || '';
    const stateName   = place?.['state'] || '';
    const city        = place?.['place name'] || '';
    const timezone    = STATE_TZ[stateAbbr.toUpperCase()] || 'America/New_York';

    const data = { zip, city, state: stateName, state_abbr: stateAbbr, timezone };
    cache.set(zip, { data, ts: Date.now() });
    return res.json(data);
  } catch (err) {
    return res.status(502).json({ error: 'ZIP lookup failed', detail: err.message });
  }
});

async function fetchUpstream(url) {
  // Use globalThis.fetch (Node 18+) with fallback to https module
  if (typeof globalThis.fetch === 'function') {
    const r = await globalThis.fetch(url);
    if (!r.ok) return null;
    return r.json();
  }
  // Node 16 fallback via https module
  return new Promise((resolve, reject) => {
    const https = require('https');
    https.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    }).on('error', reject);
  });
}

module.exports = router;
