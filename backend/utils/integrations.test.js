// ============================================================================
// integrations.test.js -- the pure rules of Connections (mig 348): key format
// and hashing, scopes, event wildcards, webhook signatures, retry schedule,
// paging, and the outbox fan-out.
// ============================================================================
jest.mock('../config/database', () => ({ supabaseAdmin: {}, supabaseClient: {} }));
jest.mock('./logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const crypto = require('crypto');
const I = require('./integrations');
const { fanOut } = require('./webhookDispatcher');

describe('keys', () => {
  test('generateKey is crm_ + 43 base64url chars and matches KEY_RE', () => {
    for (let i = 0; i < 50; i++) {
      const k = I.generateKey();
      expect(k).toMatch(/^crm_[A-Za-z0-9_-]{43}$/);
      expect(I.looksLikeKey(k)).toBe(true);
    }
  });

  test('keys are unique', () => {
    const set = new Set(Array.from({ length: 200 }, () => I.generateKey()));
    expect(set.size).toBe(200);
  });

  test('hashKey is sha256 hex of the full key, deterministic', () => {
    const k = I.generateKey();
    expect(I.hashKey(k)).toBe(crypto.createHash('sha256').update(k).digest('hex'));
    expect(I.hashKey(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(I.hashKey(k)).not.toBe(I.hashKey(I.generateKey()));
  });

  test('looksLikeKey rejects near misses', () => {
    expect(I.looksLikeKey('crm_' + 'a'.repeat(42))).toBe(false);
    expect(I.looksLikeKey('crm_' + 'a'.repeat(44))).toBe(false);
    expect(I.looksLikeKey('xyz_' + 'a'.repeat(43))).toBe(false);
    expect(I.looksLikeKey('crm_' + 'a'.repeat(42) + '+')).toBe(false);
    expect(I.looksLikeKey(null)).toBe(false);
  });

  test('bearerKey reads the Authorization header', () => {
    expect(I.bearerKey('Bearer crm_abc')).toBe('crm_abc');
    expect(I.bearerKey('bearer   crm_abc ')).toBe('crm_abc');
    expect(I.bearerKey('Basic xyz')).toBeNull();
    expect(I.bearerKey(undefined)).toBeNull();
  });

  test('webhook secrets are whsec_ + 43 chars', () => {
    expect(I.generateSecret()).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
  });
});

describe('scopes', () => {
  test('hasScope is exact', () => {
    expect(I.hasScope(['sales.read'], 'sales.read')).toBe(true);
    expect(I.hasScope(['sales.read'], 'sales.read_pii')).toBe(false);
    expect(I.hasScope(['sales.read_pii'], 'sales.read')).toBe(false);
    expect(I.hasScope(null, 'sales.read')).toBe(false);
  });

  test('invalidScopes names what is unknown', () => {
    expect(I.invalidScopes(['sales.read', 'metrics.write'])).toEqual([]);
    expect(I.invalidScopes(['sales.read', 'sales.write', '*'])).toEqual(['sales.write', '*']);
  });
});

describe('event wildcards', () => {
  test('* matches everything', () => {
    expect(I.eventMatches(['*'], 'sale.approved')).toBe(true);
    expect(I.eventMatches(['*'], 'transfer.created')).toBe(true);
  });

  test('prefix wildcard matches its group only', () => {
    expect(I.eventMatches(['sale.*'], 'sale.approved')).toBe(true);
    expect(I.eventMatches(['sale.*'], 'sale.chargeback')).toBe(true);
    expect(I.eventMatches(['sale.*'], 'transfer.created')).toBe(false);
    expect(I.eventMatches(['sale.*'], 'salesman.x')).toBe(false);
  });

  test('exact names match exactly', () => {
    expect(I.eventMatches(['sale.approved'], 'sale.approved')).toBe(true);
    expect(I.eventMatches(['sale.approved'], 'sale.approved2')).toBe(false);
    expect(I.eventMatches(['sale.approved', 'transfer.created'], 'transfer.created')).toBe(true);
    expect(I.eventMatches([], 'sale.approved')).toBe(false);
    expect(I.eventMatches(null, 'sale.approved')).toBe(false);
  });

  test('invalidEventPatterns accepts *, known events and known groups', () => {
    expect(I.invalidEventPatterns(['*', 'sale.*', 'transfer.*', 'sale.approved', 'transfer.created'])).toEqual([]);
    expect(I.invalidEventPatterns(['sale.bogus', 'nope.*', 'sale'])).toEqual(['sale.bogus', 'nope.*', 'sale']);
  });

  test('every policy_events type (mig 087) has a sale.<type> event', () => {
    for (const t of ['sold', 'submitted', 'approved', 'returned', 'cancelled', 'reinstated', 'chargeback']) {
      expect(I.EVENT_KEYS.has(`sale.${t}`)).toBe(true);
    }
  });
});

describe('company scoping', () => {
  test('null = every company; a list is a whitelist', () => {
    expect(I.companyAllowed(null, 'c1')).toBe(true);
    expect(I.companyAllowed(undefined, 'c1')).toBe(true);
    expect(I.companyAllowed(['c1'], 'c1')).toBe(true);
    expect(I.companyAllowed(['c1'], 'c2')).toBe(false);
    expect(I.companyAllowed([], 'c1')).toBe(false);
    expect(I.companyAllowed(['c1'], null)).toBe(false);
  });
});

describe('signatures', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ event: 'sale.approved', sale: { id: 'x', name: 'Ünïcode' } });

  test('sign = hex HMAC-SHA256(secret, "<ts>.<body>")', () => {
    const ts = '1700000000';
    const want = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    expect(I.sign(secret, ts, body)).toBe(want);
  });

  test('verifySignature accepts the real one inside the tolerance', () => {
    const now = 1700000000 * 1000;
    const ts = '1700000000';
    expect(I.verifySignature(secret, ts, body, I.sign(secret, ts, body), { now })).toBe(true);
    expect(I.verifySignature(secret, ts, body, I.sign(secret, ts, body), { now: now + 299e3 })).toBe(true);
  });

  test('verifySignature rejects a tampered body, wrong secret, old timestamp', () => {
    const now = 1700000000 * 1000;
    const ts = '1700000000';
    const sig = I.sign(secret, ts, body);
    expect(I.verifySignature(secret, ts, body + ' ', sig, { now })).toBe(false);
    expect(I.verifySignature('other', ts, body, sig, { now })).toBe(false);
    expect(I.verifySignature(secret, ts, body, sig, { now: now + 301e3 })).toBe(false);
    expect(I.verifySignature(secret, ts, body, 'abc', { now })).toBe(false);
    expect(I.verifySignature(secret, ts, body, undefined, { now })).toBe(false);
  });
});

describe('retry schedule', () => {
  test('1m, 5m, 30m, 2h, 6h, 12h, then give up', () => {
    expect([1, 2, 3, 4, 5, 6].map(I.retryDelayMs)).toEqual([60e3, 300e3, 1800e3, 7200e3, 21600e3, 43200e3]);
    expect(I.retryDelayMs(7)).toBeNull();
    const total = I.RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(24 * 3600e3);
  });
});

describe('missing table detection', () => {
  test('recognises PostgREST and Postgres missing-relation errors only', () => {
    expect(I.isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.integration_keys' in the schema cache" })).toBe(true);
    expect(I.isMissingTable({ code: '42P01', message: 'relation "integration_keys" does not exist' })).toBe(true);
    expect(I.isMissingTable({ code: '42703', message: 'column x does not exist' })).toBe(false);
    expect(I.isMissingTable(null)).toBe(false);
  });
});

describe('paging', () => {
  test('defaults and caps', () => {
    expect(I.parsePaging({})).toEqual({ limit: 100, offset: null, cursor: null });
    expect(I.parsePaging({ limit: '5000' }).limit).toBe(1000);
    expect(I.parsePaging({ offset: '20' }).offset).toBe(20);
  });

  test('bad values are 400s', () => {
    expect(() => I.parsePaging({ limit: '0' })).toThrow(/limit/);
    expect(() => I.parsePaging({ limit: 'abc' })).toThrow(/limit/);
    expect(() => I.parsePaging({ offset: '-1' })).toThrow(/offset/);
    expect(() => I.parsePaging({ cursor: '!!!' })).toThrow(/cursor/);
    try { I.parsePaging({ limit: '0' }); } catch (e) { expect(e.status).toBe(400); }
  });

  test('cursor round-trips', () => {
    const c = I.encodeCursor({ c: 'created_at', v: '2026-11-06T10:00:00.123+00:00', id: 'abc' });
    expect(I.parsePaging({ cursor: c }).cursor).toEqual({ c: 'created_at', v: '2026-11-06T10:00:00.123+00:00', id: 'abc' });
  });

  test('parseTime keeps days, normalises timestamps, rejects junk', () => {
    expect(I.parseTime('2026-11-01', 'from')).toBe('2026-11-01');
    expect(I.parseTime('2026-11-01T10:00:00+05:00', 'from')).toBe('2026-11-01T05:00:00.000Z');
    expect(I.parseTime('', 'from')).toBeNull();
    expect(() => I.parseTime('yesterday', 'from')).toThrow(/from/);
  });
});

describe('outbox fan-out', () => {
  const ev = (event, company_id) => ({ event, company_id, body: { id: 'e1', event } });
  const hooks = [
    { id: 'all', events: ['*'], company_ids: null },
    { id: 'sales', events: ['sale.*'], company_ids: null },
    { id: 'c1-approved', events: ['sale.approved'], company_ids: ['c1'] },
    { id: 'transfers', events: ['transfer.created'], company_ids: ['c2'] },
  ];

  test('each event goes to every webhook whose events AND companies match', () => {
    const rows = fanOut([ev('sale.approved', 'c1'), ev('sale.cancelled', 'c2'), ev('transfer.created', 'c2'), ev('transfer.created', 'c1')], hooks);
    const pairs = rows.map((r) => `${r.webhook_id}:${r.event}`).sort();
    expect(pairs).toEqual([
      'all:sale.approved', 'all:sale.cancelled', 'all:transfer.created', 'all:transfer.created',
      'c1-approved:sale.approved',
      'sales:sale.approved', 'sales:sale.cancelled',
      'transfers:transfer.created',
    ].sort());
    expect(rows.every((r) => r.payload && r.next_attempt_at)).toBe(true);
  });

  test('no webhooks = nothing queued', () => {
    expect(fanOut([ev('sale.approved', 'c1')], [])).toEqual([]);
  });
});
