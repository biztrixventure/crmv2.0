// ============================================================================
// qaScoreVisibility.test.js -- the switch that decides whether an agent sees
// their own QA score (Business Rules -> QA Scores).
//
// The default is the whole point of the feature: FRONTERS OFF, closers
// unchanged. Getting that backwards would publish numbers to exactly the people
// the setting exists to protect, silently, on the next deploy -- so the default
// is asserted here rather than left to a config row existing.
// ============================================================================
jest.mock('./businessConfig', () => ({ getConfig: jest.fn() }));

const { getConfig } = require('./businessConfig');
const { scoresVisibleFor, legForRole, DEFAULTS } = require('./qaScoreVisibility');

const req = (role, companyId = 'c1') => ({ user: { id: 'u1', role, company_id: companyId } });

// getConfig(companyId, key, fallback) -- the real one returns the fallback when
// no row exists, so a stub standing in for "nothing configured" must too.
const noRow = () => getConfig.mockImplementation(async (_c, _k, fallback) => fallback);
const rowIs = (value) => getConfig.mockResolvedValue(value);

beforeEach(() => getConfig.mockReset());

describe('legForRole', () => {
  test('closers and closer managers are the closer floor', () => {
    expect(legForRole('closer')).toBe('closer');
    expect(legForRole('closer_manager')).toBe('closer');
  });

  test('a trainee follows the fronter switch', () => {
    expect(legForRole('trainee')).toBe('fronter');
    expect(legForRole('fronter')).toBe('fronter');
  });

  test('an unknown or missing role falls to the fronter side, never the open one', () => {
    expect(legForRole(undefined)).toBe('fronter');
    expect(legForRole('something_new')).toBe('fronter');
  });
});

describe('scoresVisibleFor', () => {
  test('with nothing configured, a fronter does NOT see scores', async () => {
    noRow();
    await expect(scoresVisibleFor(req('fronter'))).resolves.toEqual({ visible: false, leg: 'fronter' });
  });

  test('with nothing configured, a closer still does -- nothing changes for them', async () => {
    noRow();
    await expect(scoresVisibleFor(req('closer'))).resolves.toEqual({ visible: true, leg: 'closer' });
  });

  test('turning fronters on shows them', async () => {
    rowIs({ fronter: true, closer: true });
    await expect(scoresVisibleFor(req('fronter'))).resolves.toMatchObject({ visible: true });
  });

  test('turning closers off hides them', async () => {
    rowIs({ fronter: false, closer: false });
    await expect(scoresVisibleFor(req('closer'))).resolves.toMatchObject({ visible: false });
  });

  test('a half-written row keeps the default for the floor it does not mention', async () => {
    rowIs({ closer: false });   // says nothing about fronters
    await expect(scoresVisibleFor(req('fronter'))).resolves.toMatchObject({ visible: false });
  });

  test('a junk value is ignored rather than read as "on"', async () => {
    rowIs('yes please');
    await expect(scoresVisibleFor(req('fronter'))).resolves.toMatchObject({ visible: false });
    rowIs('yes please');
    await expect(scoresVisibleFor(req('closer'))).resolves.toMatchObject({ visible: true });
  });

  test('a config read that throws falls back to the defaults, never to open', async () => {
    getConfig.mockRejectedValue(new Error('database down'));
    await expect(scoresVisibleFor(req('fronter'))).resolves.toEqual({ visible: false, leg: 'fronter' });
  });

  test('the company scope is the one asked for', async () => {
    noRow();
    await scoresVisibleFor(req('fronter', 'company-7'));
    expect(getConfig).toHaveBeenCalledWith('company-7', 'qa.agent_scores', DEFAULTS);
  });
});
