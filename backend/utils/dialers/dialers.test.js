// ============================================================================
// dialers.test.js — the rules that decide what a dialer's webhook MEANS.
//
// Everything here is pure: a payload in, a canonical call out. That is
// deliberate — the risky part of this integration is not the HTTP plumbing but
// the judgements (is this a transfer? whose lead id is this? is this duration
// seconds or milliseconds?), and those are exactly what can be pinned down
// without a database.
//
// The cases below are the ones that would quietly corrupt data if they broke:
//   • a bare lead id must be prefixed, or two dialers collide on one transfer
//   • only a listed disposition may create a transfer
//   • a UTC datetime with no zone must not be read as local time
//   • an unmapped agent must fail SOFTLY (reason, no throw), never 500
// ============================================================================

jest.mock('../../config/database', () => ({ supabaseAdmin: {}, supabaseClient: {} }));
jest.mock('../logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), success: jest.fn() }));

const crypto = require('crypto');
const { normalizeEvent, mappingGaps } = require('./normalize');
const { applyMap, getPath, flatten } = require('./mapping');
const { verifySignature } = require('./accounts');
const { toIngestParams } = require('./bridge');
const { getProvider } = require('./providers');

const account = (over = {}) => ({
  id: '11111111-2222-4333-8444-555555555555',
  provider: 'calltools',
  name: 'CallTools test',
  prefix: 'CT',
  field_map: getProvider('calltools').preset.field_map,
  settings: { xfer_dispos: ['TRANSFERRED'], default_leg: 'fronter', ignore_dispos: [] },
  auth: {},
  ...over,
});

const req = (body, query = {}) => ({ body, query, headers: {} });

const CALL = {
  data: {
    user: { username: 'ct1001' },
    contact: { id: '88421', first_name: 'Jane', last_name: 'Doe', phone_number: '+1 (555) 010-2233', state: 'TX' },
    call: { id: 'CT-9f21', talk_time: 184, created: '2026-09-21 14:03:11', recording_url: 'https://example.invalid/rec.mp3' },
    call_disposition: { name: 'Transferred' },
  },
};

describe('mapping', () => {
  test('reads nested paths, array indexes and JSON-in-a-string', () => {
    expect(getPath({ a: { b: [{ c: 7 }] } }, 'a.b[0].c')).toBe(7);
    expect(getPath({ data: '{"x":{"y":"z"}}' }, 'data.x.y')).toBe('z');
    expect(getPath({ a: 1 }, 'a.b.c')).toBeUndefined();
  });

  test('takes the first non-empty path from a fallback list', () => {
    expect(applyMap({ b: 'second' }, { agent: ['a', 'b', 'c'] }).agent).toBe('second');
  });

  test('a template joins fields the dialer only sends separately', () => {
    expect(applyMap({ f: 'Jane', l: 'Doe' }, { first: { template: '{{f}} {{l}}' } }).first).toBe('Jane Doe');
  });

  test('seconds transform leaves seconds alone and converts milliseconds', () => {
    expect(applyMap({ d: 184 }, { talk_time: { path: 'd', transform: 'seconds' } }).talk_time).toBe(184);
    expect(applyMap({ d: 184000 }, { talk_time: { path: 'd', transform: 'seconds' } }).talk_time).toBe(184);
  });

  test('a zoneless UTC datetime is not shifted by the server timezone', () => {
    expect(applyMap({ t: '2026-09-21 14:03:11' }, { call_at: { path: 't', transform: 'iso' } }).call_at)
      .toBe('2026-09-21T14:03:11.000Z');
  });

  test('flatten gives the field picker the real keys', () => {
    const keys = Object.keys(flatten(CALL));
    expect(keys).toContain('data.contact.phone_number');
    expect(keys).toContain('data.call.talk_time');
  });

  test('a broken regex in a mapping cannot throw the webhook', () => {
    expect(() => applyMap({ a: 'x' }, { agent: { path: 'a', regex: '([' } })).not.toThrow();
  });
});

describe('normalize', () => {
  test('a CallTools transfer becomes an xfer with a prefixed lead code', () => {
    const ev = normalizeEvent(account(), req(CALL));
    expect(ev.ok).toBe(true);
    expect(ev.event_type).toBe('xfer');
    expect(ev.leg).toBe('fronter');
    expect(ev.agent).toBe('ct1001');
    expect(ev.phone).toBe('5550102233');
    expect(ev.dispo).toBe('TRANSFERRED');
    expect(ev.code).toBe('CT88421');              // bare 88421 + the account prefix
    expect(ev.external_call_id).toBe('CT-9f21');
    expect(ev.talk_time).toBe(184);
    expect(ev.call_at).toBe('2026-09-21T14:03:11.000Z');
    expect(ev.recording_url).toBe('https://example.invalid/rec.mp3');
    expect(ev.customer.first).toBe('Jane');
  });

  test('a disposition that is not a transfer disposition never creates a transfer', () => {
    const payload = JSON.parse(JSON.stringify(CALL));
    payload.data.call_disposition.name = 'Not Interested';
    const ev = normalizeEvent(account(), req(payload));
    expect(ev.ok).toBe(true);             // still recorded for QA
    expect(ev.event_type).toBe('dispo');  // but NOT an xfer
  });

  test('an already-qualified code is left alone, never double-prefixed', () => {
    const payload = JSON.parse(JSON.stringify(CALL));
    payload.data.contact.id = 'CT88421';
    expect(normalizeEvent(account(), req(payload)).code).toBe('CT88421');
  });

  test('leg_rules decide the closer leg from the campaign', () => {
    const acct = account({
      settings: {
        xfer_dispos: ['TRANSFERRED'], default_leg: 'fronter',
        leg_rules: [{ when: { path: 'data.campaign.name', contains: 'closer' }, leg: 'closer' }],
      },
    });
    const payload = JSON.parse(JSON.stringify(CALL));
    payload.data.campaign = { name: 'Closer Room A' };
    const ev = normalizeEvent(acct, req(payload));
    expect(ev.leg).toBe('closer');
    expect(ev.event_type).toBe('dispo');   // a closer leg is never an xfer
  });

  test('an unmapped agent fails softly with a reason, not an exception', () => {
    const payload = { data: { contact: { phone_number: '5550102233' }, call_disposition: { name: 'Transferred' } } };
    const ev = normalizeEvent(account(), req(payload));
    expect(ev.ok).toBe(false);
    expect(ev.reason).toMatch(/agent/i);
  });

  test('nothing to match on is refused before it reaches the transfer engine', () => {
    const ev = normalizeEvent(account(), req({ data: { user: { username: 'ct1001' } } }));
    expect(ev.ok).toBe(false);
    expect(ev.reason).toMatch(/phone|code/i);
  });

  test('the ignore list drops a disposition without touching anything', () => {
    const acct = account({ settings: { xfer_dispos: ['TRANSFERRED'], ignore_dispos: ['TRANSFERRED'] } });
    const ev = normalizeEvent(acct, req(CALL));
    expect(ev.ok).toBe(false);
    expect(ev.event_type).toBe('ignored');
  });

  test('a GET-style dialer sending everything in the query string works too', () => {
    const acct = account({ provider: 'generic', prefix: 'GEN', field_map: getProvider('generic').preset.field_map });
    const ev = normalizeEvent(acct, req({}, { agent: '1001', phone: '5550102233', dispo: 'XFER', lead_id: '55' }));
    expect(ev.agent).toBe('1001');
    expect(ev.code).toBe('GEN55');
  });

  test('unmapped custom fields still travel with the call', () => {
    const acct = account({ field_map: { ...getProvider('calltools').preset.field_map, vin: 'data.contact.vin' } });
    const payload = JSON.parse(JSON.stringify(CALL));
    payload.data.contact.vin = '1HGCM82633A004352';
    expect(normalizeEvent(acct, req(payload)).extras.vin).toBe('1HGCM82633A004352');
  });

  test('mappingGaps names the required fields an account has not mapped', () => {
    expect(mappingGaps(account({ field_map: { agent: 'a' } }))).toEqual(expect.arrayContaining(['phone', 'dispo']));
    expect(mappingGaps(account())).toEqual([]);
  });
});

describe('bridge parameters', () => {
  test('the canonical call is spoken in the ingest handlers own token names', () => {
    const p = toIngestParams(normalizeEvent(account(), req(CALL)));
    expect(p.agent).toBe('ct1001');
    expect(p.code).toBe('CT88421');
    expect(p.alt_code).toBe('CT88421');   // both keys the dispo matcher tries
    expect(p.phone).toBe('5550102233');
    expect(p.dispo).toBe('TRANSFERRED');
    expect(p.talk_time).toBe('184');
    expect(p.uniqueid).toBe('CT-9f21');
    expect(p.first).toBe('Jane');
  });
});

describe('webhook signatures', () => {
  const secret = 'shhh';
  const body = JSON.stringify({ a: 1 });
  const hmac = (enc) => crypto.createHmac('sha256', secret).update(body).digest(enc);

  test('hex and base64 signatures are both accepted, with or without sha256=', () => {
    const acct = { webhook_secret: secret, settings: {} };
    expect(verifySignature(acct, { headers: { 'x-signature': hmac('hex') }, rawBody: body }).ok).toBe(true);
    expect(verifySignature(acct, { headers: { 'x-signature': `sha256=${hmac('hex')}` }, rawBody: body }).ok).toBe(true);
    expect(verifySignature(acct, { headers: { 'x-signature': hmac('base64') }, rawBody: body }).ok).toBe(true);
  });

  test('a wrong signature, and a missing one, are both refused', () => {
    const acct = { webhook_secret: secret, settings: {} };
    expect(verifySignature(acct, { headers: { 'x-signature': 'deadbeef' }, rawBody: body }).ok).toBe(false);
    expect(verifySignature(acct, { headers: {}, rawBody: body }).ok).toBe(false);
  });

  test('a signature over a DIFFERENT body is refused (the raw bytes matter)', () => {
    const acct = { webhook_secret: secret, settings: {} };
    const other = crypto.createHmac('sha256', secret).update('{"a":2}').digest('hex');
    expect(verifySignature(acct, { headers: { 'x-signature': other }, rawBody: body }).ok).toBe(false);
  });

  test('an account with no secret does not require one', () => {
    expect(verifySignature({ settings: {} }, { headers: {}, rawBody: body }).ok).toBe(true);
  });
});
