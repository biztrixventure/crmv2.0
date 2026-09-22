// ============================================================================
// qa2RecordingMatch.test.js — the right clip, or none.
//
// Reported by QA on 2026-09-22: nine customers whose review screen played
// somebody else's conversation. On lead 2982052 all three fronter legs held
// another leg's audio, rotated among the calls, and the closer leg played the
// fronter's.
//
// The cause was a unit mix-up rather than a lookup failure. VICIdial reports
// "2026-09-18 17:39:50" -- a naive wall clock in the BOX's zone -- and the
// picker compared it to call_at, a UTC instant, by subtraction. On a
// US-Eastern dialer that is four hours of error in every comparison, and with
// no limit on how far a match could be, the least-badly-wrong clip always won.
//
// The fixture below is the dialer's OWN answer for lead 2982052, pasted
// verbatim from recording_lookup, and the expectations are the pairing that
// falls out once the offset is applied: every call matches a clip within 45
// seconds. That is the whole bug, so that is what this file pins.
// ============================================================================

jest.mock('../config/database', () => ({ supabaseAdmin: {}, supabaseClient: {} }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), success: jest.fn() }));
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));

const { rankClips } = require('./qa2RecordingPoller');

// recording_lookup, lead_id=2982052, box wavetechpk (America/New_York):
//   start|user|recording_id|lead_id|duration|location
const CLIPS = [
  { box: 'wavetechpk', start: '2026-09-18 17:39:50', user: 'WTI1052', recording_id: '478425', duration: 18 },
  { box: 'wavetechpk', start: '2026-09-19 18:42:03', user: 'WTI1052', recording_id: '488879', duration: 11 },
  { box: 'wavetechpk', start: '2026-09-21 18:45:48', user: 'WTI1052', recording_id: '496260', duration: 357 },
  { box: 'wavetechpk', start: '2026-09-21 18:51:46', user: 'WTI1003', recording_id: '496362', duration: 310 },
];
const pick = (row) => (rankClips(CLIPS, row)[0] || {}).recording_id || null;

describe('which clip belongs to this call', () => {
  // The four rows as they exist in qa2_call, with the clip each one SHOULD
  // have had. Every one of these was wrong in production.
  test.each([
    ['fronter 09-18', { agent_user: 'WTI1052', call_at: '2026-09-18T21:40:11Z' }, '478425'],
    ['fronter 09-19', { agent_user: 'WTI1052', call_at: '2026-09-19T22:42:19Z' }, '488879'],
    ['fronter 09-21', { agent_user: 'WTI1052', call_at: '2026-09-21T22:52:30Z' }, '496260'],
    ['closer  09-21', { agent_user: 'WTI1003', call_at: '2026-09-21T22:57:05Z' }, '496362'],
  ])('%s gets its own clip', (_label, row, expected) => {
    expect(pick(row)).toBe(expected);
  });

  test('the agent breaks a tie the clock cannot', () => {
    // 45s to the fronter's own clip, 44s to the closer's. Time alone hands the
    // fronter leg the closer's conversation; that is the swap QA reported.
    const row = { agent_user: 'WTI1052', call_at: '2026-09-21T22:52:30Z' };
    expect(pick(row)).toBe('496260');
    expect(pick({ ...row, agent_user: 'WTI1003' })).toBe('496362');
  });

  test('a clip from another day is refused, not handed over', () => {
    // The old picker had no maximum distance, so a call with no clip of its own
    // took the nearest one in existence -- days away, another conversation.
    const row = { agent_user: 'WTI1052', call_at: '2026-10-05T22:52:30Z' };
    expect(pick(row)).toBeNull();
  });

  test('a naive clock is never read as UTC', () => {
    // 17:39:50 Eastern is 21:39:50Z. Reading it as 21:39:50 local -- which is
    // what `new Date("2026-09-18T17:39:50")` does in a UTC container -- puts
    // the call four hours from its own audio and outside the window entirely.
    expect(pick({ agent_user: 'WTI1052', call_at: '2026-09-18T17:39:50Z' })).toBeNull();
    expect(pick({ agent_user: 'WTI1052', call_at: '2026-09-18T21:39:50Z' })).toBe('478425');
  });

  test('DST is not a constant: the same wall clock shifts in December', () => {
    const winter = [{ box: 'wavetechpk', start: '2026-12-18 17:39:50', user: 'WTI1052', recording_id: 'w1', duration: 18 }];
    // EST is -5, so 17:39:50 is 22:39:50Z. A hardcoded -4 would miss by an hour.
    expect((rankClips(winter, { agent_user: 'WTI1052', call_at: '2026-12-18T22:39:55Z' })[0] || {}).recording_id).toBe('w1');
    expect(rankClips(winter, { agent_user: 'WTI1052', call_at: '2026-12-18T21:39:55Z' })).toEqual([]);
  });

  test('a stranger agent needs to be nearly coincident, not merely nearest', () => {
    // Same lead, different agent, three minutes out: that is the other leg.
    expect(pick({ agent_user: 'WTI9999', call_at: '2026-09-21T22:54:46Z' })).toBeNull();
  });

  test('with no timestamp, one candidate is an answer and several are a guess', () => {
    expect(rankClips(CLIPS, { agent_user: 'WTI1003', call_at: null })).toHaveLength(1);
    expect(rankClips(CLIPS, { agent_user: 'WTI1052', call_at: null })).toEqual([]);
  });

  test('an unreadable start sorts last instead of scoring as a perfect match', () => {
    const junk = [{ box: 'wavetechpk', start: '', user: 'WTI1052', recording_id: 'junk', duration: 0 }, ...CLIPS];
    expect((rankClips(junk, { agent_user: 'WTI1052', call_at: '2026-09-18T21:40:11Z' })[0] || {}).recording_id).toBe('478425');
  });
});
