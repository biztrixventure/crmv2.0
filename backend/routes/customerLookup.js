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
//   GET  /customer-lookup/my-quota             what is left of the caller's allowance
//   GET  /customer-lookup/quota                superadmin — global default allowance
//   PUT  /customer-lookup/quota                superadmin — set it
//   POST /customer-lookup/quota/reset/:userId  superadmin — clear one user's usage
//   GET  /customer-lookup/access/:userId       superadmin — one user's switches + quota
//   PUT  /customer-lookup/access/:userId       superadmin — set them
//   GET  /customer-lookup/history              the CALLER's own past searches
//   GET  /customer-lookup/history/all          superadmin — everyone's searches
//   GET  /customer-lookup/history/users        superadmin — who is using the tool
//   GET  /customer-lookup/history/:id          one search WITH the saved result
//
// EVERY SEARCH IS NOW RECORDED (mig 337). It used to be fetched, shown and
// forgotten, which cost an agent their previous result the moment they ran a
// second search, and left a superadmin with no way to see what the tool was
// being used for. utils/customerLookupHistory.js writes who searched what, a
// small summary, and the payload the browser received — so History re-opens a
// result for free instead of spending another search on it.
//
// The API key never leaves the server: settings only ever return a masked tail.
// ============================================================================
const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { supabaseAdmin } = require('../config/database');
const { setConfig } = require('../utils/businessConfig');
const cl = require('../utils/customerLookup');
const hist = require('../utils/customerLookupHistory');

const router = express.Router();

const KIND_LABEL = { people: 'people', vehicles: 'vehicle', vin: 'VIN' };

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
  // Quota is spent BEFORE the upstream call, so firing several at once cannot
  // walk past the limit. finish() hands it back if the call turns out to fail.
  const q = await cl.consume(req.user.id, need);
  if (!q.ok) {
    res.status(429).json({
      error: `You have used all ${q.limit} ${KIND_LABEL[need] || need} searches for this period.`,
      quota: q, quota_exhausted: true,
    });
    return null;
  }
  return acc;
}

// One exit for a proxied call: a failure refunds the search it just spent.
async function finish(req, res, r, kind) {
  if (r.ok) return res.json(r.data);
  if (kind) await cl.refund(req.user.id, kind);
  return res.status(r.status).json({ error: r.error });
}

// "(772) 475-7074" — the history list is read by people, not by machines.
const showPhone = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(v || '');
};

// One history row per search, written as the answer goes out and never awaited
// — the record is a by-product and must not be able to fail a lookup.
//
// A call that answers with a ticket has not finished: it is written `pending`
// with that ticket and completed later from /job/:ticket, which is the only
// place the real result of a scrape or a VIN run ever appears.
function remember(req, kind, query, params, r, t0) {
  const ticket = r.ok ? (r.data?.job || null) : null;
  hist.record({
    userId: req.user.id,
    companyId: req.user.company_id || null,
    kind,
    query,
    params,
    ticket,
    data: (r.ok && !ticket) ? r.data : null,
    error: r.ok ? null : r.error,
    ms: Date.now() - t0,
  });
}

const send = (res, r) => (r.ok ? res.json(r.data) : res.status(r.status).json({ error: r.error }));

// ── my-access ────────────────────────────────────────────────────────────────
router.get('/my-access', asyncHandler(async (req, res) => {
  const a = await myAccess(req);
  const quota = (a.people || a.vehicles || a.vin) ? await cl.quotaStatus(req.user.id) : null;
  // `superadmin` is what the panel keys the Activity tab off — the browser
  // cannot work that out, and it must not have to guess.
  res.json({
    people: a.people, vehicles: a.vehicles, vin: a.vin,
    any: a.people || a.vehicles || a.vin,
    superadmin: a.superadmin,
    quota,
  });
}));

// Just the allowance — polled after a search so the bars move without a reload.
router.get('/my-quota', asyncHandler(async (req, res) => {
  const a = await myAccess(req);
  if (!a.people && !a.vehicles && !a.vin) return res.status(403).json({ error: 'Customer lookup is not enabled for you' });
  res.json(await cl.quotaStatus(req.user.id));
}));

// ── quota administration (superadmin) ────────────────────────────────────────
// The global default applies to everyone who has no override of their own.
router.get('/quota', asyncHandler(async (req, res) => {
  if (!await superadminOnly(req, res)) return;
  res.json({ global: await cl.globalQuota() });
}));

router.put('/quota', asyncHandler(async (req, res) => {
  if (!await superadminOnly(req, res)) return;
  res.json({ global: await cl.setGlobalQuota(req.body || {}, req.user.id) });
}));

// Put someone back to a full allowance without waiting for their window.
router.post('/quota/reset/:userId', asyncHandler(async (req, res) => {
  if (!await superadminOnly(req, res)) return;
  const kind = ['people', 'vehicles', 'vin'].includes(req.body?.kind) ? req.body.kind : null;
  await cl.resetUsage(req.params.userId, kind);
  res.json({ user_id: req.params.userId, reset: kind || 'all', quota: await cl.quotaStatus(req.params.userId) });
}));

// ── person lookup (phone, optionally narrowed to one name) ───────────────────
router.get('/person', asyncHandler(async (req, res) => {
  if (!await guard(req, res, 'people')) return;
  const phone = cl.normPhone(req.query.phone);
  if (!phone) return res.status(422).json({ error: 'Enter a 10-digit US phone number' });
  const cacheOnly = req.query.scrape === '0';
  const t0 = Date.now();
  const r = await cl.call('/api/lookup', {
    phone,
    name: req.query.name,
    // scrape=0 is cache-only; anything else lets the service scrape on a miss.
    scrape: cacheOnly ? '0' : undefined,
    // A cache read answers inline in a second or two. Anything that MIGHT
    // scrape goes through the job queue instead, so a slow scrape can never
    // walk into our 25s abort — the same ticket + /job/:ticket polling the
    // vehicle search already uses. A cache hit still answers inline even with
    // async=1 set, so this costs nothing when the record is already there.
    async: cacheOnly ? undefined : '1',
  }, { userId: req.user.id, label: `person ${phone}` });
  remember(req, 'people', showPhone(phone), { phone, name: req.query.name, scrape: cacheOnly ? '0' : undefined }, r, t0);
  await finish(req, res, r, 'people');
}));

// ── person lookup, STREAMED ──────────────────────────────────────────────────
// The same search as /person, read as it arrives. The browser gets the names
// and addresses of everyone on the number within a few seconds and fills each
// row in as that person's detail page lands, instead of watching a spinner for
// ~33 seconds.
//
// NDJSON straight through, one object per line, in the order the service sent
// them -- including events this code has never heard of, because the service
// adds events over time and the client is the one that decides what to ignore.
// The only line we mint ourselves is an `error` when the upstream never opens.
//
// The API key stays here. That is the whole reason this is a proxy rather than
// a direct call from the browser.
router.get('/person/stream', asyncHandler(async (req, res) => {
  if (!await guard(req, res, 'people')) return;
  const phone = cl.normPhone(req.query.phone);
  if (!phone) {
    await cl.refund(req.user.id, 'people');
    return res.status(422).json({ error: 'Enter a 10-digit US phone number' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // A proxy buffers a response by default, which would hold every line back
  // until the end and undo the entire point of streaming.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // The browser navigating away must stop the upstream work, not leak a socket.
  const ac = new AbortController();
  res.on('close', () => ac.abort());

  let sawEnd = false;
  // `done` carries the complete record — the same object the blocking endpoint
  // returns — so it is what the history keeps. The row and the browser then
  // hold exactly the same thing, which is what makes re-opening it honest.
  let doneEvent = null;
  let streamError = null;
  const t0 = Date.now();
  const params = {
    phone,
    name: req.query.name,
    mode: req.query.mode === 'quick' ? 'quick' : undefined,
    scrape: req.query.scrape === '0' ? '0' : undefined,
    refresh: req.query.refresh === '1' ? '1' : undefined,
  };
  const r = await cl.stream('/api/lookup/stream', params, {
    userId: req.user.id,
    label: `person stream ${phone}`,
    signal: ac.signal,
    onLine: (obj) => {
      if (obj?.event === 'done') { sawEnd = true; doneEvent = obj; }
      else if (obj?.event === 'error') { sawEnd = true; streamError = obj.error || 'Lookup failed'; }
      if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n');
    },
  });

  // A search that produced nothing is not one the person should be charged for
  // -- the same rule finish() applies to the blocking route.
  if (!r.ok && !sawEnd) {
    await cl.refund(req.user.id, 'people');
    if (!r.cancelled && !res.writableEnded) {
      res.write(JSON.stringify({ event: 'error', error: r.error, status: r.status }) + '\n');
    }
  }

  // A stream the browser walked away from is still a search that was run and
  // charged, so it is recorded either way — with whatever it had reached.
  remember(req, 'people', showPhone(phone), params,
    doneEvent
      ? { ok: true, data: doneEvent }
      : { ok: false, error: streamError || (r.cancelled ? 'Cancelled before it answered' : (r.ok ? 'The stream ended before it answered' : r.error)) },
    t0);

  if (!res.writableEnded) res.end();
}));

// ── free-text search ─────────────────────────────────────────────────────────
router.get('/search', asyncHandler(async (req, res) => {
  if (!await guard(req, res, 'people')) return;
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.status(422).json({ error: 'Type at least 3 characters' });
  const t0 = Date.now();
  const r = await cl.call('/api/search', { q }, { userId: req.user.id, label: `search "${q}"` });
  remember(req, 'search', q, { q }, r, t0);
  await finish(req, res, r, 'people');
}));

// ── vehicles at an address ───────────────────────────────────────────────────
// The upstream is read-through: a cached address answers instantly and free, a
// miss RUNS a real Progressive quote form and stores the answer. Running one
// needs the applicant fields (name required, dob/zip strongly recommended) —
// address alone can only ever read the cache, which is why an address-only
// search used to come back empty forever.
//
// `mode` decides how much we are willing to spend:
//   cache  → run=0, never scrapes. Free, instant, may legitimately be empty.
//   fresh  → refresh=1, re-runs even when cached. Needs applicant fields.
//   auto   → default; serves the cache, runs only on a miss.
//
// A run takes far longer than a request should block for, so anything that can
// scrape goes through the service's async job queue and the browser polls
// /job/:ticket. Only cache reads answer inline.
//
// The earlier version retried three address spellings in a loop. That was
// harmless while every call was a cache read and actively wrong now: each
// retry could start its own Progressive run. One call, one run.
const APPLICANT = ['name', 'dob', 'email', 'first_name', 'last_name', 'middle_initial', 'phone'];

router.get('/vehicles', asyncHandler(async (req, res) => {
  if (!await guard(req, res, 'vehicles')) return;
  const raw = String(req.query.address || '').trim();
  if (!raw) return res.status(422).json({ error: 'Enter a street address' });

  // A pasted "7307 Independence Way, San Antonio, TX 78223 4870" still works:
  // the street and ZIP are split out rather than sent as one blob.
  const parsed = parseAddress(raw);
  const street = parsed?.street || raw;
  const zip = String(req.query.zip || '').replace(/\D/g, '').slice(0, 5) || parsed?.zip || '';

  const mode = ['cache', 'fresh', 'auto'].includes(req.query.mode) ? req.query.mode : 'auto';
  const params = { address: street, zip: zip || undefined };
  for (const k of APPLICANT) {
    const v = String(req.query[k] || '').trim();
    if (v) params[k] = v;
  }

  const label = [street, zip].filter(Boolean).join(' · ');

  if (mode === 'cache') {
    params.run = '0';
    const t0 = Date.now();
    const r = await cl.call('/api/vehicles', params, { userId: req.user.id, label: `vehicles cache ${street}` });
    remember(req, 'vehicles', label, { ...params, mode }, r, t0);
    if (!r.ok) { await cl.refund(req.user.id, 'vehicles'); return res.status(r.status).json({ error: r.error }); }
    return res.json({ ...r.data, mode });
  }

  // A fresh run fills a quote form — without a name it cannot even start, and
  // the upstream would just hand back an empty cache read that looks like
  // "no vehicles". Say what is missing instead.
  if (!params.name && !(params.first_name && params.last_name)) {
    await cl.refund(req.user.id, 'vehicles');    // nothing was searched
    return res.status(422).json({
      error: 'A new vehicle search needs the person’s name. Add a name (a date of birth makes it far more reliable), or switch to cached-only.',
      needs: ['name'],
    });
  }
  if (mode === 'fresh') params.refresh = '1';
  params.async = '1';

  const t0 = Date.now();
  const r = await cl.call('/api/vehicles', params, { userId: req.user.id, label: `vehicles ${mode} ${street}` });
  remember(req, 'vehicles', label, { ...params, mode }, r, t0);
  if (!r.ok) { await cl.refund(req.user.id, 'vehicles'); return res.status(r.status).json({ error: r.error }); }
  res.json({ ...r.data, mode, address: street, zip });
}));

// ── VIN for one vehicle at one address ──────────────────────────────────────
// The last step of the chain: a vehicle we already found, plus the person at
// that address, resolved to its VIN. Upstream drives a real browser, so this is
// the most expensive of the three lookups and carries its own switch and its
// own allowance.
//
// Everything it needs is already on screen when a user clicks a vehicle card —
// the address and ZIP they searched, and the year/make/model of the row they
// clicked — so the client sends what it has and this only validates.
router.get('/vin', asyncHandler(async (req, res) => {
  if (!await guard(req, res, 'vin')) return;

  // A pasted full address still works, same as the vehicle search.
  const raw = String(req.query.address || '').trim();
  const parsed = parseAddress(raw);
  const address = parsed?.street || raw;
  const zip = String(req.query.zip || '').replace(/\D/g, '').slice(0, 5) || parsed?.zip || '';
  const year  = String(req.query.year  || '').trim();
  const make  = String(req.query.make  || '').trim();
  const model = String(req.query.model || '').trim();

  const missing = [];
  if (!address) missing.push('address');
  if (!zip)     missing.push('ZIP');
  if (!year)    missing.push('year');
  if (!make)    missing.push('make');
  if (!model)   missing.push('model');
  if (missing.length) {
    await cl.refund(req.user.id, 'vin');        // nothing was looked up
    return res.status(422).json({ error: 'A VIN lookup needs ' + missing.join(', ') + '.', needs: missing });
  }

  // The name is what ties a VIN to a person at that address. Accept it split or
  // whole, because the vehicle form collects a single Name field.
  let first = String(req.query.first_name || '').trim();
  let last  = String(req.query.last_name  || '').trim();
  const whole = String(req.query.name || '').trim();
  if (!first && !last && whole) {
    const bits = whole.split(/\s+/).filter(Boolean);
    first = bits[0] || '';
    last  = bits.length > 1 ? bits[bits.length - 1] : '';
  }

  const mode = ['cache', 'fresh', 'auto'].includes(req.query.mode) ? req.query.mode : 'auto';
  const params = { address, zip, year, make, model };
  if (first) params.first_name = first;
  if (last)  params.last_name  = last;

  if (mode === 'cache') {
    params.run = '0';
  } else {
    if (mode === 'fresh') params.refresh = '1';
    // A cold VIN opens a browser and can take a minute — never inline.
    params.async = '1';
  }

  const label = 'vin ' + year + ' ' + make + ' ' + model + ' @ ' + address;
  const t0 = Date.now();
  const r = await cl.call('/api/vin', params, { userId: req.user.id, label });
  remember(req, 'vin', `${year} ${make} ${model} · ${address}`, { ...params, mode }, r, t0);
  if (!r.ok) { await cl.refund(req.user.id, 'vin'); return res.status(r.status).json({ error: r.error }); }
  res.json({ ...r.data, mode });
}));

// ── poll an async job ────────────────────────────────────────────────────────
// The ticket is opaque and generated by the service; keep it to the character
// set it actually uses so it can never be bent into another upstream path.
const refunded = new Set();   // tickets already refunded, so polling cannot over-refund

router.get('/job/:ticket', asyncHandler(async (req, res) => {
  const acc = await myAccess(req);
  if (!acc.people && !acc.vehicles && !acc.vin) return res.status(403).json({ error: 'Customer lookup is not enabled for you' });
  const ticket = String(req.params.ticket || '');
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(ticket)) return res.status(422).json({ error: 'Bad job reference' });

  const r = await cl.call(`/api/job/${ticket}`, {}, { userId: req.user.id, label: `job ${ticket}` });
  if (!r.ok) return res.status(r.status).json({ error: r.error });

  // A job that finished in failure searched nothing, so hand the quota back —
  // but polling repeats, so only the first terminal look refunds.
  const failed = r.data?.status === 'error' || r.data?.vehicles_status === 'error' || r.data?.result?.status === 'error';

  // The pending history row written when the search STARTED is finished here —
  // this is the only place a scrape's or a VIN run's real answer appears. The
  // update is keyed on (user, ticket) and only matches a row that is still
  // open, so the browser's repeated polling cannot rewrite a finished one.
  if (r.data?.status === 'done' || r.data?.status === 'error') {
    hist.complete({
      userId: req.user.id,
      ticket,
      data: r.data?.status === 'error' ? null : r.data,
      error: r.data?.status === 'error'
        ? (r.data?.error || r.data?.result?.error || 'The search did not complete')
        : null,
    });
  }

  if (failed && !refunded.has(ticket)) {
    refunded.add(ticket);
    if (refunded.size > 500) refunded.clear();
    await cl.refund(req.user.id, 'vehicles');
  }
  // A vehicles-only user must not receive the person half of an enrich job.
  const data = { ...r.data };
  if (!acc.people) delete data.person;
  if (!acc.vin) delete data.vin;
  if (!acc.vehicles) { delete data.vehicles; delete data.vehicles_status; }
  // result is the run detail for whichever job this was; keep it only when the
  // caller holds a switch that could have started that kind of job.
  if (!acc.vehicles && !acc.vin) delete data.result;
  res.json(data);
}));

// ── enrich: one phone → the person AND their vehicles ────────────────────────
// The whole job in a single call, which is how a closer actually works: they
// have a number, they want to know who it is and what they drive.
router.get('/enrich', asyncHandler(async (req, res) => {
  const acc = await myAccess(req);
  if (!acc.people) {
    return res.status(403).json({
      error: acc.vehicles ? 'Enrich needs the People search, which is not enabled for you' : 'Customer lookup is not enabled for you',
    });
  }
  const rl = cl.rateLimit(req.user.id);
  if (!rl.ok) return res.status(429).json({ error: `Too many lookups — wait ${rl.retryAfter}s and try again.` });

  const phone = cl.normPhone(req.query.phone);
  if (!phone) return res.status(422).json({ error: 'Enter a 10-digit US phone number' });

  // Enrich returns a person AND vehicles, so it spends from both allowances —
  // otherwise it would be a way around the vehicle limit.
  const spent = [];
  for (const kind of (acc.vehicles ? ['people', 'vehicles'] : ['people'])) {
    const q = await cl.consume(req.user.id, kind);
    if (!q.ok) {
      for (const done of spent) await cl.refund(req.user.id, done);
      return res.status(429).json({
        error: `You have used all ${q.limit} ${kind === 'people' ? 'people' : 'vehicle'} searches for this period.`,
        quota: q, quota_exhausted: true,
      });
    }
    spent.push(kind);
  }

  const mode = ['cache', 'fresh', 'auto'].includes(req.query.mode) ? req.query.mode : 'auto';
  const params = { phone };
  for (const k of ['name', 'dob']) {
    const v = String(req.query[k] || '').trim();
    if (v) params[k] = v;
  }
  // Never fetch the vehicle half for someone who was not granted it.
  if (!acc.vehicles) params.vehicles = '0';
  if (mode === 'cache') params.run = '0';
  if (mode === 'fresh') params.refresh = '1';
  // The vehicle half can run Progressive, so anything but cache-only goes async.
  if (mode !== 'cache' && acc.vehicles) params.async = '1';

  const t0 = Date.now();
  const r = await cl.call('/api/enrich', params, { userId: req.user.id, label: `enrich ${phone}` });
  remember(req, 'enrich', showPhone(phone), { ...params, mode }, r, t0);
  if (!r.ok) {
    for (const kind of spent) await cl.refund(req.user.id, kind);
    return res.status(r.status).json({ error: r.error });
  }
  const data = { ...r.data, mode };
  if (!acc.vehicles) { delete data.vehicles; delete data.vehicles_status; delete data.vehicles_cached; }
  res.json(data);
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

  // Finding someone's addresses IS a search. Charge it to the allowance the
  // caller actually holds, so a vehicles-only user is not billed for people.
  const kind = acc.people ? 'people' : 'vehicles';
  const t0 = Date.now();
  const spend = await cl.consume(req.user.id, kind);
  if (!spend.ok) {
    return res.status(429).json({
      error: `You have used all ${spend.limit} ${kind === 'people' ? 'people' : 'vehicle'} searches for this period.`,
      quota: spend, quota_exhausted: true,
    });
  }

  const r = phone
    ? await cl.call('/api/lookup', { phone, name: name || undefined, scrape: req.query.scrape === '0' ? '0' : undefined },
        { userId: req.user.id, label: `addresses ${phone}` })
    : await cl.call('/api/search', { q: name }, { userId: req.user.id, label: `addresses "${name}"` });
  if (!r.ok) {
    remember(req, 'addresses', phone ? showPhone(phone) : name, { phone: phone || undefined, name: name || undefined }, r, t0);
    await cl.refund(req.user.id, kind);
    return res.status(r.status).json({ error: r.error });
  }

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
  const payload = { found: addresses.length > 0, count: addresses.length, addresses: addresses.slice(0, 40) };
  // Turning a name or a number into an address IS a search, and it spends an
  // allowance, so it belongs in the history like any other.
  remember(req, 'addresses', phone ? showPhone(phone) : name, { phone: phone || undefined, name: name || undefined },
    { ok: true, data: payload }, t0);
  res.json(payload);
}));

// ── settings (superadmin) ────────────────────────────────────────────────────
async function masked() {
  const [cfg, key, map, dflt] = await Promise.all([cl.settings(), cl.getApiKey(), cl.userMap(), cl.defaultAccess()]);
  const granted = Object.values(map).filter(v => v?.people || v?.vehicles);
  const blocked = Object.values(map).filter(v => cl.ACCESS_KINDS.some(k => v?.[k] === false)).length;
  return {
    enabled: cfg.enabled,
    // What EVERYONE gets without being named. The named rows below override it
    // in both directions, so "blocked_users" is a real number, not a rounding.
    default_access: dflt,
    blocked_users: blocked,
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

  // "Everyone gets it" — one write instead of a switch per person. A user who
  // was explicitly turned off stays off: their row overrides this.
  if (b.default_access && typeof b.default_access === 'object') {
    await cl.setDefaultAccess(b.default_access, req.user.id);
  }

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

// Reachability + auth probe. Two steps, because they fail differently:
// /api/health is free and unauthenticated (proves the box is up), then one
// cache-only lookup proves the API KEY is accepted. Neither ever scrapes.
router.get('/settings/test', asyncHandler(async (req, res) => {
  if (!await superadminOnly(req, res)) return;
  const t0 = Date.now();
  const health = await cl.call('/api/health', {}, { userId: req.user.id, label: 'health' });
  if (!health.ok) return res.json({ ok: false, ms: Date.now() - t0, error: health.error });

  const auth = await cl.call('/api/lookup', { phone: '555-000-0000', scrape: '0' }, { userId: req.user.id, label: 'auth probe' });
  const ms = Date.now() - t0;
  if (!auth.ok) return res.json({ ok: false, ms, error: `Service is up, but the key was refused: ${auth.error}` });
  res.json({ ok: true, ms, message: `Connected to ${health.data?.service || 'the service'} — answered in ${ms}ms, key accepted.` });
}));

// ── per-user access (superadmin) ─────────────────────────────────────────────
// The three switches now report the EFFECTIVE answer (default, unless this
// person's own row overrides it) and say which of the two it came from, so the
// admin screen can show "on for everyone" differently from "on for them".
async function accessPayload(userId) {
  const [a, quota, gq, cfg, map] = await Promise.all([
    cl.accessFor(userId, { superadmin: await isSuperAdmin(userId) }),
    cl.quotaStatus(userId), cl.globalQuota(), masked(), cl.userMap(),
  ]);
  const row = map[userId] || {};
  return {
    user_id: userId,
    people: a.granted.people, vehicles: a.granted.vehicles, vin: a.granted.vin,
    defaults: a.defaults,
    explicit: a.explicit,
    is_superadmin: a.superadmin,
    quota_override: row.quota || {},
    quota, global_quota: gq, settings: cfg,
  };
}

router.get('/access/:userId', asyncHandler(async (req, res) => {
  if (!await superadminOnly(req, res)) return;
  res.json(await accessPayload(req.params.userId));
}));

router.put('/access/:userId', asyncHandler(async (req, res) => {
  if (!await superadminOnly(req, res)) return;
  const b = req.body || {};
  if (b.people === undefined && b.vehicles === undefined && b.vin === undefined && b.quota === undefined) {
    return res.status(422).json({ error: 'Nothing to change' });
  }
  // Order matters: both writers rewrite the same users row, so the quota write
  // has to read back what the access write just saved.
  if (b.people !== undefined || b.vehicles !== undefined || b.vin !== undefined) await cl.setAccess(req.params.userId, b, req.user.id);
  if (b.quota !== undefined) await cl.setUserQuota(req.params.userId, b.quota, req.user.id);

  res.json(await accessPayload(req.params.userId));
}));

// ── history ──────────────────────────────────────────────────────────────────
// Who looked at whom. Reading is gated the same way searching is: your own
// history needs a switch on the tool, everyone else's needs superadmin.

// user_profiles first/last → auth email → the raw id, never nothing. A history
// row outlives the profile it names (no FK, by design in mig 337), so a name
// that cannot be resolved must still list.
async function userNames(ids) {
  const out = {};
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return out;
  // PostgREST puts an .in() list in the URL, so it is chunked at the estate's
  // usual 150 rather than risking a 22,000-character request.
  for (let i = 0; i < uniq.length; i += 150) {
    const { data } = await supabaseAdmin.from('user_profiles')
      .select('user_id, first_name, last_name').in('user_id', uniq.slice(i, i + 150));
    for (const p of (data || [])) {
      const n = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      if (n) out[p.user_id] = n;
    }
  }
  // user_profiles has no email column, so an unnamed or missing profile is
  // resolved from auth — per id, which is why it is capped.
  const missing = uniq.filter(id => !out[id]).slice(0, 25);
  await Promise.all(missing.map(async (id) => {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(id);
      if (data?.user?.email) out[id] = data.user.email;
    } catch { /* a name we cannot resolve is not a reason to fail the list */ }
  }));
  for (const id of uniq) if (!out[id]) out[id] = 'Unknown user';
  return out;
}

const clampInt = (v, d, min, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : d;
};

router.get('/history', asyncHandler(async (req, res) => {
  const acc = await myAccess(req);
  if (!acc.people && !acc.vehicles && !acc.vin && !acc.superadmin) {
    return res.status(403).json({ error: 'Customer lookup is not enabled for you' });
  }
  const { rows, total } = await hist.list({
    userId: req.user.id,
    kind: req.query.kind,
    limit: clampInt(req.query.limit, 40, 1, 200),
    offset: clampInt(req.query.offset, 0, 0, 100000),
  });
  res.json({ rows, total });
}));

// Everyone's searches. Defined BEFORE /history/:id — Express matches in the
// order routes are declared, and "all" would otherwise be read as an id.
router.get('/history/all', asyncHandler(async (req, res) => {
  if (!await superadminOnly(req, res)) return;
  const { rows, total } = await hist.listAll({
    userId: req.query.user_id || undefined,
    kind: req.query.kind,
    q: String(req.query.q || '').trim() || undefined,
    from: req.query.from || undefined,
    to: req.query.to || undefined,
    limit: clampInt(req.query.limit, 50, 1, 200),
    offset: clampInt(req.query.offset, 0, 0, 100000),
  });
  res.json({ rows, total, names: await userNames(rows.map(r => r.user_id)) });
}));

// Who is using the tool, over a window — the header of the Activity tab.
router.get('/history/users', asyncHandler(async (req, res) => {
  if (!await superadminOnly(req, res)) return;
  const s = await hist.stats({ from: req.query.from || undefined, to: req.query.to || undefined });
  res.json({ ...s, names: await userNames(s.users.map(u => u.user_id)) });
}));

// One search WITH the result the browser was given. This is what makes History
// worth having: re-opening a search spends no allowance and runs nothing.
router.get('/history/:id', asyncHandler(async (req, res) => {
  const acc = await myAccess(req);
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(422).json({ error: 'Bad history reference' });
  if (!acc.people && !acc.vehicles && !acc.vin && !acc.superadmin) {
    return res.status(403).json({ error: 'Customer lookup is not enabled for you' });
  }
  const row = await hist.getOne(id, { userId: req.user.id, superadmin: acc.superadmin });
  if (!row) return res.status(404).json({ error: 'That search is no longer in the history' });
  // A vehicles-only user must not read the people half of an old enrich, the
  // same rule /job/:ticket applies to a live one.
  if (row.result && !acc.superadmin) {
    if (!acc.people) { delete row.result.person; delete row.result.result; delete row.result.results; }
    if (!acc.vehicles) { delete row.result.vehicles; delete row.result.vehicles_status; }
    if (!acc.vin) delete row.result.vin;
  }
  const names = acc.superadmin ? await userNames([row.user_id]) : {};
  res.json({ row, names });
}));

module.exports = router;
