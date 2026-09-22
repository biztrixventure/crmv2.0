// ============================================================================
// vicidial.codes.test.js — a lead code is a lead code, or it is nothing.
//
// Every dialer builds its callback URLs by substitution, and every dialer sends
// the LITERAL placeholder when a token is wrong or the field is empty.
// VICIdial sends "--A--vendor_lead_code--B--". CallTools' connector buttons
// send "CT{id}". Both are text that LOOKS like a code and matches like one.
//
// Why that is dangerous rather than untidy: the placeholder is identical on
// every call, so a run of transfers all end up sharing one "code", and the
// next closer disposition matches whichever it finds first — attaching a
// closer's outcome, and their name, to a stranger's lead.
// ============================================================================

jest.mock('../config/database', () => ({ supabaseAdmin: {}, supabaseClient: {} }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), success: jest.fn() }));

const { realCode, xferCode } = require('./vicidial');

describe('realCode', () => {
  test('keeps a real code exactly as it arrived', () => {
    expect(realCode('CT26330017')).toBe('CT26330017');
    expect(realCode('WTI264204')).toBe('WTI264204');
    expect(realCode(' 2724512 ')).toBe('2724512');     // bare ids are prefixed elsewhere
    expect(realCode(6094508)).toBe('6094508');
  });

  test('rejects a CallTools token that did not resolve', () => {
    expect(realCode('CT{id}')).toBe('');
    expect(realCode('{id}')).toBe('');
    expect(realCode('{{lead_id}}')).toBe('');
  });

  test('rejects a VICIdial token that did not resolve', () => {
    expect(realCode('--A--vendor_lead_code--B--')).toBe('');
    expect(realCode('--A--lead_id--B--')).toBe('');
  });

  test('rejects the words a dialer sends for "nothing"', () => {
    ['', '   ', null, undefined, 'null', 'NULL', 'undefined', 'none', 'N/A'].forEach(v => {
      expect(realCode(v)).toBe('');
    });
  });
});

// ============================================================================
// xferCode — a lead code names the transfer, and when there is none the CALL
// does. Regression for the five live CallTools presses on 2026-09-21 that
// arrived with `code: null` and produced nothing at all: no transfer row, no
// pending card, no notification. The fronter pressed transfer and the CRM
// stayed empty, silently, because the webhook answers 200 either way.
// ============================================================================
describe('xferCode', () => {
  test('a real lead code wins and is never rewritten', () => {
    expect(xferCode({ code: 'CT26330017', call_id: 'abc' }, 'CT100')).toEqual({ code: 'CT26330017', fromCall: false });
    expect(xferCode({ code: 'WTI264204' }, 'WTI100695')).toEqual({ code: 'WTI264204', fromCall: false });
  });

  test('a bare code still gets the box prefix from the agent', () => {
    expect(xferCode({ code: '2724512' }, 'WTI100695')).toEqual({ code: 'WTI2724512', fromCall: false });
  });

  test('no lead code falls back to the call id — this is the live CallTools case', () => {
    const got = xferCode({ code: null, call_id: '0ce93f60-6a9f-4aa5-b2e2-10b39b7efea5' }, '2629b8cc');
    expect(got).toEqual({ code: 'CALL-0CE93F606A9F4AA5', fromCall: true });
  });

  test('one press is one code, so a duplicate webhook still dedups', () => {
    const a = xferCode({ call_id: 'smoke-A' }, 'x');
    const b = xferCode({ call_id: 'smoke-A' }, 'x');
    expect(a.code).toBe(b.code);
  });

  test('two presses are two codes, so a re-transfer is a new row (mig 291)', () => {
    expect(xferCode({ call_id: 'call-one' }, 'x').code)
      .not.toBe(xferCode({ call_id: 'call-two' }, 'x').code);
  });

  test('VICIdial uniqueid serves as the call id too', () => {
    expect(xferCode({ uniqueid: '1663012345.6789' }, 'WTI100695'))
      .toEqual({ code: 'CALL-16630123456789', fromCall: true });
  });

  test('an unresolved token is not an id — it must not become a shared code', () => {
    expect(xferCode({ code: 'CT{id}', call_id: '{{call_id}}' }, 'x')).toEqual({ code: '', fromCall: false });
    expect(xferCode({ code: null, call_id: 'None' }, 'x')).toEqual({ code: '', fromCall: false });
    expect(xferCode({ code: '--A--vendor_lead_code--B--' }, 'x')).toEqual({ code: '', fromCall: false });
  });

  test('nothing at all stays nothing, so the handler still refuses', () => {
    expect(xferCode({}, 'x')).toEqual({ code: '', fromCall: false });
    expect(xferCode(null, 'x')).toEqual({ code: '', fromCall: false });
  });
});
