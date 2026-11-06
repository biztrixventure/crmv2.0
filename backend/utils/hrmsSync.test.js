// ============================================================================
// hrmsSync.test.js -- where the CRM -> HR sales push goes (mig 349): web links
// + HRMS_URL/HRMS_API_KEYS merged and de-duplicated, disabled links skipped,
// env only when the table is missing, URL rules, key redaction, and the
// connection test sending an empty list with no window (a no-op in the HRMS).
// ============================================================================
const mockDb = { result: { data: [], error: null }, updates: [] };
jest.mock('../config/database', () => {
  const chain = (table) => {
    const q = {
      _op: 'select',
      select: () => q,
      eq: () => q,
      update: (patch) => { q._op = 'update'; mockDb.updates.push({ table, patch }); return q; },
      then: (resolve, reject) => Promise.resolve(q._op === 'update' ? { data: null, error: null } : mockDb.result).then(resolve, reject),
    };
    return q;
  };
  return { supabaseAdmin: { from: chain }, supabaseClient: {} };
});
jest.mock('./logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const logger = require('./logger');
const H = require('./hrmsSync');

const ENV_KEYS = ['HRMS_URL', 'HRMS_API_KEYS', 'HRMS_SYNC_MINUTES'];
const saved = {};
beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  mockDb.result = { data: [], error: null };
  mockDb.updates = [];
  logger.warn.mockClear();
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const web = (over = {}) => ({ id: 'w1', name: 'WaveTech HR', url: 'https://hr.vertexpakistan.com', api_key: 'hrk_live_abcdefghijkl1234', enabled: true, ...over });

describe('mergeTargets', () => {
  test('web + env, both sent', () => {
    const t = H.mergeTargets([web()], [{ slug: 'other', url: 'https://hr.vertexpakistan.com', key: 'hrk_other_key_000000' }]);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ name: 'WaveTech HR', ids: ['w1'], slugs: [], sources: ['web'] });
    expect(t[1]).toMatchObject({ name: 'other', ids: [], slugs: ['other'], sources: ['env'] });
  });

  test('same url + key in web and env is sent once', () => {
    const t = H.mergeTargets(
      [web({ url: 'https://HR.vertexpakistan.com/' })],
      [{ slug: 'wavetech', url: 'https://hr.vertexpakistan.com', key: 'hrk_live_abcdefghijkl1234' }],
    );
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ ids: ['w1'], slugs: ['wavetech'], sources: ['web', 'env'] });
  });

  test('same url, different key = two HR companies', () => {
    const t = H.mergeTargets([web(), web({ id: 'w2', api_key: 'hrk_live_zzzzzzzzzzzz9999' })], []);
    expect(t).toHaveLength(2);
  });

  test('two web links with the same url + key are sent once, both ids get the result', () => {
    const t = H.mergeTargets([web(), web({ id: 'w2', name: 'copy' })], []);
    expect(t).toHaveLength(1);
    expect(t[0].ids).toEqual(['w1', 'w2']);
  });

  test('disabled and keyless links are skipped', () => {
    const t = H.mergeTargets([web({ enabled: false }), web({ id: 'w2', api_key: '  ' }), web({ id: 'w3', url: '' })], []);
    expect(t).toEqual([]);
  });

  test('nothing anywhere = no targets', () => {
    expect(H.mergeTargets([], [])).toEqual([]);
    expect(H.mergeTargets(null, undefined)).toEqual([]);
  });
});

describe('envTargets', () => {
  test('reads HRMS_URL + HRMS_API_KEYS', () => {
    process.env.HRMS_URL = 'https://hr.vertexpakistan.com/';
    process.env.HRMS_API_KEYS = 'wavetech=k1k1k1k1k1, vertex=k2k2k2k2k2 ,bad';
    expect(H.envTargets()).toEqual([
      { source: 'env', slug: 'wavetech', name: 'wavetech', url: 'https://hr.vertexpakistan.com', key: 'k1k1k1k1k1' },
      { source: 'env', slug: 'vertex', name: 'vertex', url: 'https://hr.vertexpakistan.com', key: 'k2k2k2k2k2' },
    ]);
  });

  test('no HRMS_URL = none', () => {
    process.env.HRMS_API_KEYS = 'wavetech=k1';
    expect(H.envTargets()).toEqual([]);
  });
});

describe('resolveTargets / loadWebLinks', () => {
  test('table missing (mig 349 not applied) -> env only, warns once, no throw', async () => {
    process.env.HRMS_URL = 'https://hr.vertexpakistan.com';
    process.env.HRMS_API_KEYS = 'wavetech=k1k1k1k1k1';
    mockDb.result = { data: null, error: { code: '42P01', message: 'relation "public.outgoing_links" does not exist' } };
    const a = await H.resolveTargets();
    const b = await H.resolveTargets();
    expect(a.ready).toBe(false);
    expect(a.targets).toHaveLength(1);
    expect(a.targets[0]).toMatchObject({ slugs: ['wavetech'], sources: ['env'] });
    expect(b.targets).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test('PostgREST "could not find the table" also counts as missing', async () => {
    mockDb.result = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.outgoing_links'" } };
    const r = await H.loadWebLinks();
    expect(r).toEqual({ ready: false, rows: [] });
  });

  test('another read error -> env still sent', async () => {
    process.env.HRMS_URL = 'https://hr.vertexpakistan.com';
    process.env.HRMS_API_KEYS = 'wavetech=k1k1k1k1k1';
    mockDb.result = { data: null, error: { message: 'timeout' } };
    const r = await H.resolveTargets();
    expect(r.targets).toHaveLength(1);
  });

  test('web links are read every time (no restart needed)', async () => {
    mockDb.result = { data: [], error: null };
    expect((await H.resolveTargets()).targets).toHaveLength(0);
    mockDb.result = { data: [web()], error: null };
    expect((await H.resolveTargets()).targets).toHaveLength(1);
  });
});

describe('pushSalesToHrms', () => {
  test('no targets: skipped, reads only the links table', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => { throw new Error('must not call'); });
    try {
      const r = await H.pushSalesToHrms();
      expect(r.skipped).toMatch(/no HR links/);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
});

describe('normalizeHrmsUrl', () => {
  test('https kept, trailing slash dropped', () => {
    expect(H.normalizeHrmsUrl('https://hr.vertexpakistan.com/')).toBe('https://hr.vertexpakistan.com');
    expect(H.normalizeHrmsUrl('  https://hr.vertexpakistan.com  ')).toBe('https://hr.vertexpakistan.com');
    expect(H.normalizeHrmsUrl('https://example.com/hr//')).toBe('https://example.com/hr');
  });

  test('http only for localhost', () => {
    expect(H.normalizeHrmsUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(H.normalizeHrmsUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080');
    expect(() => H.normalizeHrmsUrl('http://hr.vertexpakistan.com')).toThrow(/https/);
  });

  test('rejects junk', () => {
    expect(() => H.normalizeHrmsUrl('')).toThrow(/required/);
    expect(() => H.normalizeHrmsUrl(null)).toThrow(/required/);
    expect(() => H.normalizeHrmsUrl('hr.vertexpakistan.com')).toThrow();
    expect(() => H.normalizeHrmsUrl('ftp://hr.vertexpakistan.com')).toThrow(/https/);
    expect(() => H.normalizeHrmsUrl('javascript:alert(1)')).toThrow();
    expect(() => H.normalizeHrmsUrl('https://u:p@hr.vertexpakistan.com')).toThrow(/username/);
    expect(() => H.normalizeHrmsUrl('https://hr.vertexpakistan.com/?x=1')).toThrow(/\?/);
  });
});

describe('key redaction', () => {
  test('redactLink drops the key, keeps last 4 + hasKey', () => {
    const r = H.redactLink(web());
    expect(r).not.toHaveProperty('api_key');
    expect(JSON.stringify(r)).not.toContain('abcdefghijkl');
    expect(r).toMatchObject({ source: 'web', hasKey: true, key_last4: '1234', name: 'WaveTech HR' });
  });

  test('short keys show no characters at all', () => {
    expect(H.keyLast4('short123')).toBe('');
    expect(H.keyLast4(null)).toBe('');
    expect(H.redactLink(web({ api_key: '' }))).toMatchObject({ hasKey: false, key_last4: '' });
  });
});

describe('testHrmsLink', () => {
  const answer = (status, body) => jest.spyOn(global, 'fetch').mockResolvedValue({
    status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body || {}),
  });

  test('sends an empty list with NO window (cannot void anything)', async () => {
    const spy = answer(200, { received: 0 });
    try {
      const r = await H.testHrmsLink('https://hr.vertexpakistan.com', 'hrk_live_abcdefghijkl1234');
      expect(r).toMatchObject({ ok: true, status: 200, result: 'connected' });
      const [url, init] = spy.mock.calls[0];
      expect(url).toBe('https://hr.vertexpakistan.com/api/v1/connect/crm/sales');
      const body = JSON.parse(init.body);
      expect(body.items).toEqual([]);
      expect(body).not.toHaveProperty('window');
      expect(init.headers.authorization).toBe('Bearer hrk_live_abcdefghijkl1234');
    } finally { spy.mockRestore(); }
  });

  test.each([
    [401, 'wrong_key'],
    [403, 'no_permission'],
    [404, 'not_found'],
    [500, 'error'],
  ])('HTTP %i -> %s', async (status, result) => {
    const spy = answer(status, { message: 'x' });
    try {
      const r = await H.testHrmsLink('https://hr.vertexpakistan.com', 'k');
      expect(r).toMatchObject({ ok: false, status, result });
    } finally { spy.mockRestore(); }
  });

  test('network failure -> unreachable, no throw', async () => {
    const spy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    try {
      const r = await H.testHrmsLink('https://hr.vertexpakistan.com', 'k');
      expect(r).toMatchObject({ ok: false, status: null, result: 'unreachable' });
    } finally { spy.mockRestore(); }
  });
});
