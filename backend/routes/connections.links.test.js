// ============================================================================
// connections.links.test.js -- /api/connections/links (mig 349): superadmin
// only, the HR key never leaves the server (list, create, edit, audit), env
// targets listed read-only, URL rules enforced, api_key optional on edit.
// ============================================================================
jest.mock('../config/database', () => {
  const fake = require('../testing/supabaseFake');
  return { supabaseAdmin: fake.admin, supabaseClient: fake.client };
});
jest.mock('../models/helpers', () => ({
  isSuperAdmin: jest.fn(async (id) => id === '22222222-2222-4222-8222-222222222222'),
}));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const express = require('express');
const request = require('supertest');
const fake = require('../testing/supabaseFake');
const connectionsRoutes = require('./connections');

const ADMIN = '22222222-2222-4222-8222-222222222222';
const AGENT = '11111111-1111-4111-8111-111111111111';
const LINK_ID = '33333333-3333-4333-8333-333333333333';
const SECRET = 'hrk_live_SUPERSECRETVALUE_9876';

function app(userId) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { id: userId }; next(); });
  a.use('/api/connections', connectionsRoutes);
  return a;
}

const ENV_KEYS = ['HRMS_URL', 'HRMS_API_KEYS'];
const saved = {};
beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  fake.reset({
    outgoing_links: [{ id: LINK_ID, kind: 'hrms_sales', name: 'WaveTech HR', url: 'https://hr.vertexpakistan.com', api_key: SECRET, enabled: true, created_at: '2026-11-01T00:00:00Z' }],
    module_audit_log: [],
  });
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

test('not a superadmin -> 403', async () => {
  const r = await request(app(AGENT)).get('/api/connections/links');
  expect(r.status).toBe(403);
});

test('list never returns the key; env targets listed read-only', async () => {
  process.env.HRMS_URL = 'https://hr.vertexpakistan.com';
  process.env.HRMS_API_KEYS = `wavetech=${SECRET},vertex=hrk_live_OTHERSECRET_00001111`;
  const r = await request(app(ADMIN)).get('/api/connections/links');
  expect(r.status).toBe(200);
  expect(JSON.stringify(r.body)).not.toContain('SUPERSECRET');
  expect(JSON.stringify(r.body)).not.toContain('OTHERSECRET');
  expect(r.body.ready).toBe(true);
  const [w, e1, e2] = r.body.links;
  expect(w).toMatchObject({ id: LINK_ID, source: 'web', hasKey: true, key_last4: '9876' });
  expect(e1).toMatchObject({ id: 'env:wavetech', source: 'env', readonly: true, key_last4: '9876', same_as: 'WaveTech HR' });
  expect(e2).toMatchObject({ id: 'env:vertex', source: 'env', readonly: true, key_last4: '1111', same_as: null });
});

test('create: https enforced, key not echoed or audited', async () => {
  const bad = await request(app(ADMIN)).post('/api/connections/links')
    .send({ name: 'X', url: 'http://hr.vertexpakistan.com', api_key: SECRET });
  expect(bad.status).toBe(400);

  const r = await request(app(ADMIN)).post('/api/connections/links')
    .send({ name: 'Vertex HR', url: 'https://hr.vertexpakistan.com/', api_key: 'hrk_live_NEWSECRET_abcd' });
  expect(r.status).toBe(201);
  expect(r.body.link).toMatchObject({ name: 'Vertex HR', url: 'https://hr.vertexpakistan.com', hasKey: true, key_last4: 'abcd', enabled: true });
  expect(JSON.stringify(r.body)).not.toContain('NEWSECRET');
  const stored = fake.table('outgoing_links').find((l) => l.name === 'Vertex HR');
  expect(stored.api_key).toBe('hrk_live_NEWSECRET_abcd');
  const audit = fake.table('module_audit_log');
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({ module: 'access', table_name: 'outgoing_links', operation: 'INSERT' });
  expect(JSON.stringify(audit)).not.toContain('NEWSECRET');
});

test('create: missing key -> 400', async () => {
  const r = await request(app(ADMIN)).post('/api/connections/links').send({ name: 'X', url: 'https://hr.vertexpakistan.com' });
  expect(r.status).toBe(400);
});

test('edit without api_key keeps the key; with one changes it, audit hides it', async () => {
  let r = await request(app(ADMIN)).patch(`/api/connections/links/${LINK_ID}`).send({ enabled: false, api_key: '' });
  expect(r.status).toBe(200);
  expect(fake.table('outgoing_links')[0]).toMatchObject({ enabled: false, api_key: SECRET });

  r = await request(app(ADMIN)).patch(`/api/connections/links/${LINK_ID}`).send({ api_key: 'hrk_live_ROTATED_zzzz' });
  expect(r.status).toBe(200);
  expect(r.body.link.key_last4).toBe('zzzz');
  expect(fake.table('outgoing_links')[0].api_key).toBe('hrk_live_ROTATED_zzzz');
  const audit = JSON.stringify(fake.table('module_audit_log'));
  expect(audit).not.toContain('ROTATED');
  expect(audit).not.toContain('SUPERSECRET');
  expect(audit).toContain('(changed)');
});
