// ============================================================================
// integrationKey.test.js -- the machine API's key check (mig 348), on a real
// Express app via supertest. The database is a lookup function, so every
// branch (unknown, revoked, missing table, db down) is driven directly.
// ============================================================================
const express = require('express');
const request = require('supertest');
const { createIntegrationKeyAuth, requireScope, scopedCompanies } = require('./integrationKey');
const { generateKey, hashKey } = require('../utils/integrations');

const GOOD = generateKey();
const REVOKED = generateKey();
const C1 = '11111111-1111-1111-1111-111111111111';
const C2 = '22222222-2222-2222-2222-222222222222';

function rowsFor() {
  return new Map([
    [hashKey(GOOD), { id: 'k1', name: 'HRMS', key_prefix: GOOD.slice(0, 8), scopes: ['sales.read'], company_ids: [C1], revoked_at: null }],
    [hashKey(REVOKED), { id: 'k2', name: 'Old', key_prefix: REVOKED.slice(0, 8), scopes: ['sales.read'], company_ids: null, revoked_at: '2026-01-01T00:00:00Z' }],
  ]);
}

function appWith(opts = {}) {
  const rows = rowsFor();
  const lookups = [];
  const touches = [];
  const auth = createIntegrationKeyAuth({
    lookup: opts.lookup || (async (hash) => { lookups.push(hash); return { row: rows.get(hash) || null }; }),
    touch: (id, at) => { touches.push({ id, at }); },
    now: opts.now,
    ratePerMin: opts.ratePerMin || 600,
  });
  const app = express();
  app.use('/ext', auth);
  app.get('/ext/me', (req, res) => res.json(req.integration));
  app.get('/ext/sales', requireScope('sales.read'), (req, res) => res.json({ ok: true }));
  app.get('/ext/agents', requireScope('agents.read'), (req, res) => res.json({ ok: true }));
  app.get('/ext/scoped', (req, res) => res.json(scopedCompanies(req, req.query.company)));
  return { app, lookups, touches, auth };
}

const bearer = (k) => ({ Authorization: `Bearer ${k}` });

describe('who is calling', () => {
  test('a valid key reaches the route with its name, scopes and companies', async () => {
    const { app } = appWith();
    const r = await request(app).get('/ext/me').set(bearer(GOOD));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: 'k1', name: 'HRMS', scopes: ['sales.read'], company_ids: [C1] });
  });

  test('no header / malformed key = 401, and the database is not asked', async () => {
    const { app, lookups } = appWith();
    expect((await request(app).get('/ext/me')).status).toBe(401);
    expect((await request(app).get('/ext/me').set(bearer('crm_short'))).status).toBe(401);
    expect((await request(app).get('/ext/me').set({ Authorization: 'Basic abc' })).status).toBe(401);
    expect(lookups).toHaveLength(0);
  });

  test('unknown key = 401', async () => {
    const { app } = appWith();
    const r = await request(app).get('/ext/me').set(bearer(generateKey()));
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/Unknown/);
  });

  test('revoked key = 401', async () => {
    const { app } = appWith();
    const r = await request(app).get('/ext/me').set(bearer(REVOKED));
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/revoked/);
  });

  test('only the hash is looked up, never the key', async () => {
    const { app, lookups } = appWith();
    await request(app).get('/ext/me').set(bearer(GOOD));
    expect(lookups).toEqual([hashKey(GOOD)]);
    expect(lookups[0]).not.toContain(GOOD);
  });
});

describe('before migration 348 / database trouble', () => {
  test('missing table = 503 with the migration hint, never a crash', async () => {
    const { app } = appWith({ lookup: async () => ({ notReady: true }) });
    const r = await request(app).get('/ext/me').set(bearer(GOOD));
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('Connections are not set up yet: run migration 348');
  });

  test('a throwing lookup = 503', async () => {
    const { app } = appWith({ lookup: async () => { throw new Error('connection reset'); } });
    const r = await request(app).get('/ext/me').set(bearer(GOOD));
    expect(r.status).toBe(503);
  });
});

describe('scopes', () => {
  test('a held scope passes, a missing one is 403 naming it', async () => {
    const { app } = appWith();
    expect((await request(app).get('/ext/sales').set(bearer(GOOD))).status).toBe(200);
    const r = await request(app).get('/ext/agents').set(bearer(GOOD));
    expect(r.status).toBe(403);
    expect(r.body.needed).toBe('agents.read');
  });
});

describe('company scoping', () => {
  test('no ?company = the key list; inside the list ok; outside 403; junk 400', async () => {
    const { app } = appWith();
    expect((await request(app).get('/ext/scoped').set(bearer(GOOD))).body).toEqual({ ids: [C1] });
    expect((await request(app).get(`/ext/scoped?company=${C1}`).set(bearer(GOOD))).body).toEqual({ ids: [C1] });
    expect((await request(app).get(`/ext/scoped?company=${C2}`).set(bearer(GOOD))).body).toMatchObject({ error: 403 });
    expect((await request(app).get('/ext/scoped?company=nope').set(bearer(GOOD))).body).toMatchObject({ error: 400 });
  });

  test('an all-companies key may narrow to any company', () => {
    const req = { integration: { company_ids: null } };
    expect(scopedCompanies(req, undefined)).toEqual({ ids: null });
    expect(scopedCompanies(req, `${C1},${C2}`)).toEqual({ ids: [C1, C2] });
  });
});

describe('caching, last_used_at, rate limit', () => {
  test('lookups are cached for 30s; clear() forgets them', async () => {
    let t = 1_000_000;
    const { app, lookups, auth } = appWith({ now: () => t });
    await request(app).get('/ext/me').set(bearer(GOOD));
    await request(app).get('/ext/me').set(bearer(GOOD));
    expect(lookups).toHaveLength(1);
    t += 31_000;
    await request(app).get('/ext/me').set(bearer(GOOD));
    expect(lookups).toHaveLength(2);
    auth.clear();
    await request(app).get('/ext/me').set(bearer(GOOD));
    expect(lookups).toHaveLength(3);
  });

  test('last_used_at is written at most once a minute per key', async () => {
    let t = 1_000_000;
    const { app, touches } = appWith({ now: () => t });
    await request(app).get('/ext/me').set(bearer(GOOD));
    t += 10_000;
    await request(app).get('/ext/me').set(bearer(GOOD));
    expect(touches).toHaveLength(1);
    t += 60_000;
    await request(app).get('/ext/me').set(bearer(GOOD));
    expect(touches).toHaveLength(2);
  });

  test('over the per-minute limit = 429 with Retry-After', async () => {
    const { app } = appWith({ ratePerMin: 3 });
    for (let i = 0; i < 3; i++) expect((await request(app).get('/ext/me').set(bearer(GOOD))).status).toBe(200);
    const r = await request(app).get('/ext/me').set(bearer(GOOD));
    expect(r.status).toBe(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
  });

  test('a burst of bad keys from one address is cut off', async () => {
    const { app } = appWith();
    let last;
    for (let i = 0; i < 62; i++) last = await request(app).get('/ext/me').set(bearer(generateKey()));
    expect(last.status).toBe(429);
  });
});
