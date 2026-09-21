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

const { realCode } = require('./vicidial');

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
