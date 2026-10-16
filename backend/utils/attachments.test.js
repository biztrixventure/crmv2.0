// ============================================================================
// attachments.test.js — objectPath decides which Storage key gets DELETED, so
// it is the one function here that can destroy a file that was not meant to go.
// A url it cannot parse must answer null and the purge must leave it alone;
// guessing a key would mean deleting a stranger's object.
// ============================================================================
jest.mock('../config/database', () => ({ supabaseAdmin: {}, supabaseClient: {} }));
jest.mock('./businessConfig', () => ({ getConfig: jest.fn(), setConfig: jest.fn() }));
jest.mock('./logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const a = require('./attachments');

const PUB = 'https://example.supabase.co/storage/v1/object/public';

describe('objectPath', () => {
  test('pulls the key out of a public chat url', () => {
    expect(a.objectPath(`${PUB}/chat-attachments/42/1700000000-report.pdf`, 'chat-attachments'))
      .toBe('42/1700000000-report.pdf');
  });

  test('pulls the key out of a public email url', () => {
    expect(a.objectPath(`${PUB}/email-attachments/7/x.png`, 'email-attachments'))
      .toBe('7/x.png');
  });

  test('decodes an escaped key — the key is what Storage stored, not what the url shows', () => {
    expect(a.objectPath(`${PUB}/chat-attachments/9/call%20log%20%231.csv`, 'chat-attachments'))
      .toBe('9/call log #1.csv');
  });

  // THE BUCKET IS PART OF THE MATCH. An email url handed to the chat bucket
  // must not yield a key: that key exists in the other bucket, and removing it
  // from this one is at best a no-op and at worst a collision.
  test('refuses a url from the other bucket', () => {
    expect(a.objectPath(`${PUB}/email-attachments/7/x.png`, 'chat-attachments')).toBeNull();
  });

  test('refuses anything that is not a public storage url', () => {
    expect(a.objectPath('https://evil.test/chat-attachments/1/x.png', 'chat-attachments')).toBeNull();
    expect(a.objectPath(`${PUB}/sign/chat-attachments/1/x.png`, 'chat-attachments')).toBeNull();
    expect(a.objectPath('', 'chat-attachments')).toBeNull();
    expect(a.objectPath(null, 'chat-attachments')).toBeNull();
    expect(a.objectPath(undefined, 'chat-attachments')).toBeNull();
  });

  test('a half-decoded key is not guessed at', () => {
    // decodeURIComponent throws on a lone %; the answer is null, not a throw.
    expect(a.objectPath(`${PUB}/chat-attachments/9/100%.csv`, 'chat-attachments')).toBeNull();
  });
});

describe('settings', () => {
  const { getConfig } = require('./businessConfig');

  test('an unset estate gets the defaults', async () => {
    getConfig.mockResolvedValue(null);
    await expect(a.settings()).resolves.toEqual({
      max_mb: a.DEFAULT_MAX_MB,
      retention_hours: a.DEFAULT_RETENTION_HOURS,
      max_settable_mb: a.MAX_SETTABLE_MB,
    });
  });

  // The cap is clamped on READ as well as on write: a value stored before the
  // body parser was raised — or by hand in SQL — must not be handed to the
  // upload routes as a limit the parser will reject with a bare 413.
  test('a stored cap above the body-parser limit is clamped down', async () => {
    getConfig.mockImplementation((_c, key) => Promise.resolve(key === 'attachments.max_mb' ? 500 : null));
    const s = await a.settings();
    expect(s.max_mb).toBe(a.MAX_SETTABLE_MB);
  });

  test('a nonsense cap falls back instead of becoming zero', async () => {
    for (const bad of [0, -3, 'big', NaN]) {
      getConfig.mockImplementation((_c, key) => Promise.resolve(key === 'attachments.max_mb' ? bad : null));
      expect((await a.settings()).max_mb).toBe(a.DEFAULT_MAX_MB);
    }
  });

  // 0 is the ONE falsy value with a meaning here — "keep forever" — so it has
  // to survive the clamp rather than fall back to 24h and start deleting.
  test('retention 0 means keep forever and is not treated as unset', async () => {
    getConfig.mockImplementation((_c, key) => Promise.resolve(key === 'attachments.retention_hours' ? 0 : null));
    expect((await a.settings()).retention_hours).toBe(0);
  });

  test('a negative retention falls back rather than expiring everything', async () => {
    getConfig.mockImplementation((_c, key) => Promise.resolve(key === 'attachments.retention_hours' ? -5 : null));
    expect((await a.settings()).retention_hours).toBe(a.DEFAULT_RETENTION_HOURS);
  });

  test('maxBytes is the setting in bytes', async () => {
    getConfig.mockImplementation((_c, key) => Promise.resolve(key === 'attachments.max_mb' ? 10 : null));
    await expect(a.maxBytes()).resolves.toBe(10 * 1024 * 1024);
  });
});

describe('purgeExpired', () => {
  const { getConfig } = require('./businessConfig');

  test('does nothing at all when retention is off', async () => {
    getConfig.mockImplementation((_c, key) => Promise.resolve(key === 'attachments.retention_hours' ? 0 : null));
    const r = await a.purgeExpired();
    expect(r).toEqual({ skipped: 'retention off', removed: 0 });
  });
});
