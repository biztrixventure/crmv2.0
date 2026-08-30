// ============================================================================
// routes/customerLookup.js — staff-facing customer lookup, proxied.
//
//   GET  /customer-lookup/my-access            what the CALLER may do (drives the tab)
//   GET  /customer-lookup/person               ?phone= &name= &scrape=0|1
//   GET  /customer-lookup/search               ?q=
//   GET  /customer-lookup/addresses            ?phone= &name=   (addresses only)
//   GET  /customer-lookup/vehicles             ?address= &zip=
//   GET  /customer-lookup/settings             superadmin — service config, key masked
//   PUT  /customer-lookup/settings             superadmin — base URL / key / on-off
//   GET  /customer-lookup/settings/test        superadmin — reachability + auth probe
//   GET  /customer-lookup/access/:userId       superadmin — one user's switches
//   PUT  /customer-lookup/access/:userId       superadmin — set them
//
// Nothing here writes a lookup result anywhere. The API key never leaves the
// server: settings only ever return a masked tail.
// ============================================================================
const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { setConfig } = require('../utils/businessConfig');
const cl = require('../utils/customerLookup');

const router = express.Router();

const superadminOnly = async (req, res) => {
  if (req.user.role === 'superadmin' || await isSuperAdmin(req.user.id)) return true;
  res.status(403).json({ error: 'Superadmin only' });
  return false;
};

// Resolve the caller's access once per request.
async function myAccess(req) {
  const sa = req.user.role === 'superadmin' || await isSuperAdmin(req.user.id);
  return cl.accessFor(req.user.id, { superadmin: sa });
}

// Shared guard for the data routes: access → rate limit.
async function guard(req, res, need) {
  const acc = await myAccess(req);
  if (!acc[need]) {
    res.status(403).json({
      error: (acc.superadmin || acc.granted?.[need])
        ? (acc.enabled ? 'The lookup service is not configured yet' : 'Customer lookup is turned off')
        : 'Customer lookup is not enabled for you',
    });
    return null;
  }
  const rl = cl.rateLimit(req.user.id);
  if (!rl.ok) {
    res.status(429).json({ error: `Too many lookups — wait ${rl.retryAfter}s and try again.` });
    return null;
  }
  return acc;
}

const send = (res, r) => (r.ok ? res.json(r.data) : res.status(r.status).json({ error: r.error }));

// ── my-access ────────────────────────────────────────────────────────────────
router.get('/my-access', asyncHandler(async (req, res) => {
  const a = await myAccess(req);
  res.json({ people: a.people, vehicles: a.vehicles, any: a.people || a.vehicles });
}));

// ── person lookup (phone, optionally narrowed to one name) ───────────────────
router.get('/person', asyncHandler(async (req, res) => {
  if (!await guard(req, res, 'people')) return;
  const phone = cl.normPhone(req.query.phone);
  if (!phone) return res.status(422).json({ error: 'Enter a 10-digit US phone number' });
  const r = await cl.call('/api/lookup', {
    phone,
    name: req.query.name,
    // scrape=0 is cache-only; anything else lets the service scrape on a miss.
    scrape: req.query.scrape === '0' ? '0' : undefined,
  }, { userId: req.user.id, label: `person ${phone}` });
  send(res, r);
}));

// ── free-text search ─────────────────────────────────────────────────────────
router.get('/search', asyncHandler(async (req, res) => {
  if (!await guard(req, res, 'people')) return;
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.status(422).json({ error: 'Type at least 3 characters' });
  const r = await cl.call('/api/search', { q }, { userId: req.user.id, label: `search "${q}"` });
  send(res, r);
}));

// ── vehicles at an address ───────────────────────────────────────────────────
router.get('/vehicles', asyncHandler(async (req, res) => {
  if (!await guard(req, res, 'vehicles')) return;
  const address = String(req.query.address || '').trim();
  if (!address) return res.status(422).json({ error: 'Enter a street address' });
  const zip = String(req.query.zip || '').replace(/\D/g, '').slice(0, 5);
  const r = await cl.call('/api/vehicles', { address, zip: zip || undefined },
    { userId: req.user.id, label: `vehicles ${address} ${zip}` });
  send(res, r);
}));

// ── addresses for a person, WITHOUT the rest of their profile ────────────────
// Lets someone who only holds the Vehicles switch turn a name or phone into an
// address to search — the whole point of offering name/phone on that form —
// without handing them the full people profile they were not granted.
function parseAddress(s) {
  const str = String(s || '').trim();
  if (!str) return null;
  const parts = str.split(',').map(x => x.trim()).filter(Boolean);
  if (!parts.length) return null;
  const tail = parts[parts.length - 1];
  // "FL 32816 8005" / "FL 32816-8005" / "FL"
  const withZip  = tail.match(/^([A-Za-z]{2})\s+(\d{5})(?:[-\s]\d{4})?$/);
  const stateOnly = /^[A-Za-z]{2}$/.test(tail);
  if (withZip || stateOnly) {
    const state  = (withZip ? withZip[1] : tail).toUpperCase();
    const zip    = withZip ? withZip[2] : '';
    const city   = parts.length >= 3 ? parts[parts.length - 2] : '';
    const street = parts.slice(0, Math.max(1, parts.length - 2)).join(', ');
    return { full: str, street, city, state, zip };
  }
  return { full: str, street: parts.join(', '), city: '', state: '', zip: '' };
}

router.get('/addresses', asyncHandler(async (req, res) => {
  const acc = await myAccess(req);
  if (!acc.people && !acc.vehicles) return res.status(403).json({ error: 'Customer lookup is not enabled for you' });
  const rl = cl.rateLimit(req.user.id);
  if (!rl.ok) return res.status(429).json({ error: `Too many lookups — wait ${rl.retryAfter}s and try again.` });

  const phone = cl.normPhone(req.query.phone);
  const name  = String(req.query.name || '').trim();
  if (!phone && name.length < 3) return res.status(422).json({ error: 'Enter a phone number or a name' });

  const r = phone
    ? await cl.call('/api/lookup', { phone, name: name || undefined, scrape: req.query.scrape === '0' ? '0' : undefined },
        { userId: req.user.id, label: `addresses ${phone}` })
    : await cl.call('/api/search', { q: name }, { userId: req.user.id, label: `addresses "${name}"` });
  if (!r.ok) return res.status(r.status).json({ error: r.error });

  // Both shapes carry the same person object — /lookup as `result`, /search as
  // `results[].data` — so flatten to one list either way.
  const people = [];
  if (r.data?.result) people.push(r.data.result);
  for (const row of (r.data?.results || [])) if (row?.data) people.push(row.data);
  for (const p of [...people]) for (const sub of (p.people || [])) people.push(sub);

  const seen = new Set(); const addresses = [];
  for (const p of people) {
    const raw = [p.current_address?.full, ...(p.address_history || []), ...(p.all_addresses || [])];
    for (const a of raw) {
      const parsed = parseAddress(a);
      if (!parsed || !parsed.street) continue;
      const k = `${parsed.street}|${parsed.zip}`.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      addresses.push({ ...parsed, person: p.name || null });
    }
  }
  res.json({ found: addresses.length > 0, count: addresses.length, addresses: addresses.slice(0, 40) });
}));

// ── settings (superadmin) ────────────────────────────────────────────────────
async function masked() {
  const [cfg, key, map] = await Promise.all([cl.settings(), cl.getApiKey(), cl.userMap()]);
  const granted = Object.values(map).filter(v => v?.people || v?.vehicles);
  return {
    enabled: cfg.enabled,
    base_url: cfg.baseUrl || '',
    base_error: cfg.baseError,
    default_base_url: cl.DEFAULT_BASE,
    timeout_ms: cfg.timeoutMs,
    has_key: !!key,
    key_preview: key ? `••••${String(key).slice(-4)}` : null,
    configured: !!cfg.baseUrl && !!key,
    granted_users: granted.length,
  };
}

router.get('/settings', asyncHandler(async (req, res) => {
  if (!await superadminOnly(req, res)) return;
  res.json(await masked());
}));

router.put('/settings', asyncHandler(async (req, res) => {
  if (!await superadminOnly(req, res)) return;
  const b = req.body || {};

  if (b.base_url !== undefined) {
    const n = cl.normalizeBase(b.base_url);
    if (!n.ok) return res.status(422).json({ error: n.error });
    await setConfig('global', 'customer_lookup.base_url', n.base, req.user.id);
  }
  if (b.timeout_ms !== undefined) {
    const t = Math.min(Math.max(parseInt(b.timeout_ms, 10) || 25000, 3000), 90000);
    await setConfig('global', 'customer_lookup.timeout_ms', t, req.user.id);
  }
  if (b.enabled !== undefined) await setConfig('global', 'customer_lookup.enabled', !!b.enabled, req.user.id);

  if (b.clear_key) {
    await cl.setApiKey('', req.user.id);
    // A service with no key can serve nobody — say so by switching it off
    // rather than leaving a dead "on" that fails on every search.
    await setConfig('global', 'customer_lookup.enabled', false, req.user.id);
  } else if (typeof b.api_key === 'string' && b.api_key.trim()) {
    await cl.setApiKey(b.api_key.trim(), req.user.id);
    if (b.enabled === undefined) await setConfig('global', 'customer_lookup.enabled', true, req.user.id);
  }
  res.json(await masked());
}));

// Reachability + auth probe. Cache-only, so it never triggers a scrape.
router.get('/settings/test', asyncHandler(async (req, res) => {
  if (!await superadminOnly(req, res)) return;
  const phone = cl.normPhone(req.query.phone) || '555-000-0000';
  const t0 = Date.now();
  const r = await cl.call('/api/lookup', { phone, scrape: '0' }, { userId: req.user.id, label: 'settings test' });
  const ms = Date.now() - t0;
  res.json(r.ok
    ? { ok: true, ms, message: `Connected — the service answered in ${ms}ms.`, found: !!r.data?.found }
    : { ok: false, ms, error: r.error });
}));

// ── per-user access (superadmin) ─────────────────────────────────────────────
router.get('/access/:userId', asyncHandler(async (req, res) => {
  if (!await superadminOnly(req, res)) return;
  const map = await cl.userMap();
  const row = map[req.params.userId] || {};
  res.json({ user_id: req.params.userId, people: !!row.people, vehicles: !!row.vehicles, settings: await masked() });
}));

router.put('/access/:userId', asyncHandler(async (req, res) => {
  if (!await superadminOnly(req, res)) return;
  const b = req.body || {};
  if (b.people === undefined && b.vehicles === undefined) return res.status(422).json({ error: 'Nothing to change' });
  const row = await cl.setAccess(req.params.userId, b, req.user.id);
  res.json({ user_id: req.params.userId, people: !!row.people, vehicles: !!row.vehicles, settings: await masked() });
}));

module.exports = router;
