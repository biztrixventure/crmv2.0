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
// Declared at file scope, not inside the describe: client.js captures the axios
// module object when it is first required (at the top of this file), so the
// mock has to be in place before that happens.
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), success: jest.fn() }));

const crypto = require('crypto');
const { normalizeEvent, mappingGaps } = require('./normalize');
const { applyMap, getPath, flatten } = require('./mapping');
const { verifySignature } = require('./accounts');
const { authHeaders } = require('./client');
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

  test('unwrap undoes what a template engine did to the value', () => {
    // Verbatim from CallTools' live connector-button webhook — the right
    // values wearing a costume. Without this the agent never resolved and a
    // real transfer was logged as "agent not mapped".
    const { TRANSFORMS } = require('./mapping');
    const u = TRANSFORMS.unwrap;
    expect(u('"AppUser object (7009fa4d-4169-4c37-b948-6b3b2a4619b4)"')).toBe('7009fa4d-4169-4c37-b948-6b3b2a4619b4');
    expect(u('"28075509"')).toBe('28075509');
    // A null relation renders as the WORD None. Left alone it becomes a real
    // value — every contact-less press would share the lead code "None".
    expect(u('"Queue object (None)"')).toBe('');
    expect(u('None')).toBe('');
    // Anything already plain is untouched, so it is safe to leave on a field.
    expect(u('WTI1025')).toBe('WTI1025');
    expect(u('+15862651319')).toBe('+15862651319');
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

  test('talk time survives however the dialer spells it', () => {
    // Measured against CallTools' live payload: a form-encoded or JSON webhook
    // sends "184", not 184, and requiring a transform for that silently dropped
    // the duration — a QA row with no duration reads like a call that never
    // connected.
    const withTalk = (v) => {
      const p = JSON.parse(JSON.stringify(CALL));
      p.data.call.talk_time = v;
      return normalizeEvent(account(), req(p)).talk_time;
    };
    expect(withTalk(184)).toBe(184);
    expect(withTalk('184')).toBe(184);
    expect(withTalk('184s')).toBe(184);
    expect(withTalk('3:04')).toBe(184);     // mm:ss
    expect(withTalk(184000)).toBe(184);     // milliseconds
    expect(withTalk('')).toBeNull();
    expect(withTalk(null)).toBeNull();
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

describe('outbound API auth', () => {
  test('each auth style produces the header that product actually wants', () => {
    // `token` is Django REST Framework's spelling and is what CallTools
    // answers to — getting this wrong reads as "credentials rejected" rather
    // than "wrong header shape", which is a long afternoon.
    expect(authHeaders({ auth: { type: 'token', token: 'k' } })).toEqual({ Authorization: 'Token k' });
    expect(authHeaders({ auth: { type: 'bearer', token: 'k' } })).toEqual({ Authorization: 'Bearer k' });
    expect(authHeaders({ auth: { type: 'header', header_name: 'X-API-Key', token: 'k' } })).toEqual({ 'X-API-Key': 'k' });
    expect(authHeaders({ auth: { type: 'none' } })).toEqual({});
    expect(authHeaders({ auth: { type: 'token' } })).toEqual({});   // no key, no header
  });
});

describe('the bridge waits for the handler', () => {
  // THE BUG THIS PINS. asyncHandler returns undefined — it keeps the promise
  // so it can route a rejection to next() — so waiting on the handler's return
  // value resolved on the next microtask, before it had touched the database.
  // In production the transfer was created correctly and the bridge had
  // already moved on: the webhook answered transfer_id null, and the row was
  // never stamped with the dialer it came from, so a CallTools transfer read
  // as a VICIdial one. Completion is the RESPONSE, never the return value.
  const { makeRes } = require('./bridge');
  const { asyncHandler } = require('../../middleware/errorHandler');

  // The same wait the bridge performs.
  const run = (fn, res) => new Promise((resolve, reject) => {
    res.answered.then(() => resolve());
    const out = fn({}, res, (err) => (err ? reject(err) : resolve()));
    if (out && typeof out.then === 'function') out.then(() => {}, reject);
  });

  test('a slow asyncHandler is awaited, so its body is readable', async () => {
    const res = makeRes();
    const handler = asyncHandler(async (req, r) => {
      await new Promise(x => setTimeout(x, 30));      // the database round trip
      r.json({ ok: true, transfer_id: 'abc-123' });
    });
    await run(handler, res);
    expect(res.body).toEqual({ ok: true, transfer_id: 'abc-123' });
  });

  test('a handler that fails still settles, via next()', async () => {
    const res = makeRes();
    const handler = asyncHandler(async () => { throw new Error('boom'); });
    await expect(run(handler, res)).rejects.toThrow('boom');
  });

  test('res.end with no body settles too', async () => {
    const res = makeRes();
    await run((req, r) => { r.end(); }, res);
    expect(res.headersSent).toBe(false);
  });
});

describe('recording resolution', () => {
  // Verified against the live CallTools tenant: a call answers with a FILE ID
  // (call_recording_fsfile_id), and the audio lives behind a second,
  // token-authenticated endpoint. A one-hop integration would report "no
  // recording" for every call that has one.
  const axios = require('axios');
  const { recordingForCall } = require('./client');

  const ctAccount = {
    id: 'a', provider: 'calltools', base_url: 'https://dialer.example.invalid',
    auth: { type: 'token', token: 'k' },
    settings: { api: {
      call_path: '/api/calls/?uuid={call_id}',
      recording_url_field: ['results[0].call_recording_fsfile_id'],
      recording_file_path: '/api/filesystemfiles/{file_id}/download/',
    } },
    field_map: {},
  };

  afterEach(() => axios.get.mockReset());

  test('a file id is followed to the download endpoint', async () => {
    axios.get.mockResolvedValue({ status: 200, data: { results: [{ call_recording_fsfile_id: 777569 }] } });
    const r = await recordingForCall(ctAccount, 'call-uuid-1');
    expect(r.ok).toBe(true);
    expect(r.file_id).toBe('777569');
    expect(r.url).toBe('https://dialer.example.invalid/api/filesystemfiles/777569/download/');
  });

  test('a dialer that already returns a URL is not sent on a second hop', async () => {
    axios.get.mockResolvedValue({ status: 200, data: { results: [{ call_recording_fsfile_id: 'https://cdn.example.invalid/clip.mp3' }] } });
    const r = await recordingForCall(ctAccount, 'call-uuid-2');
    expect(r.url).toBe('https://cdn.example.invalid/clip.mp3');
    expect(r.file_id).toBeUndefined();
  });

  test('a call with no recording yet is reported, not invented', async () => {
    axios.get.mockResolvedValue({ status: 200, data: { results: [{ call_recording_fsfile_id: null }] } });
    const r = await recordingForCall(ctAccount, 'call-uuid-3');
    expect(r.ok).toBe(false);
    expect(r.url).toBeNull();
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
