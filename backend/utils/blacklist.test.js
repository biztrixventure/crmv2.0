// ============================================================================
// blacklist.test.js -- naming every answer the Blacklist Alliance gives.
//
// The lookup used to return one boolean: not-"Good" meant blacklisted. Live
// data (2026-09-26) holds three messages -- Good, Blacklisted and Suppressed --
// and a suppressed number is a different rule from a litigator: it is someone
// who asked this client never to be called again. Agents saw both as one red
// "bad", so they could not tell which rule they were about to break.
//
// classify() is that naming. `blacklisted` is deliberately NOT retested here as
// anything other than not-Good: the bulk scan, the compliance report and every
// stored count still key on it.
// ============================================================================
jest.mock('../config/database', () => ({ supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) } }));

const { classify, norm } = require('./blacklist');

describe('classify', () => {
  test('Good is clean', () => {
    expect(classify('Good', [])).toBe('clean');
    expect(classify('good', [])).toBe('clean');
  });

  test('Suppressed is its own verdict, not blacklisted', () => {
    expect(classify('Suppressed', ['suppression'])).toBe('suppressed');
  });

  test('Blacklisted stays blacklisted', () => {
    expect(classify('Blacklisted', ['plaintiff-primary', 'screamer'])).toBe('blacklisted');
  });

  test('a DNC wording counts as blacklisted', () => {
    expect(classify('Federal DNC', ['federal-dnc'])).toBe('blacklisted');
  });

  test('an unknown message WITH codes is treated as blacklisted, never good', () => {
    expect(classify('Wireless Scrub Hit', ['gov'])).toBe('blacklisted');
  });

  test('an unknown message with no codes is flagged under its own name', () => {
    expect(classify('Pending Review', [])).toBe('flagged');
  });

  test('no message at all is unknown', () => {
    expect(classify('', [])).toBe('unknown');
    expect(classify(null, [])).toBe('unknown');
  });
});

describe('norm', () => {
  test('strips formatting and the leading 1', () => {
    expect(norm('+1 (915) 929-1527')).toBe('9159291527');
    expect(norm('9159291527')).toBe('9159291527');
  });
});
