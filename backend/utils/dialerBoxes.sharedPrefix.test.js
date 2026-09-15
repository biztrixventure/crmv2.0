// ============================================================================
// dialerBoxes.sharedPrefix.test.js -- two dialer boxes on ONE vendor-code prefix.
//
// 2026-09-15: wti_flexo went live on WTI next to wavetechpk. Each box numbers
// its own leads from 1 (the new box's first transfer was WTI10), so a code like
// WTI10 names a different customer on each. Four callers took p.boxes[0]; with
// both boxes at sort_order 0 that was whichever row the database returned first,
// and every old-dialer call got labelled as the new one. boxForCode is the one
// place that decides, by asking each box whose phone the lead carries.
//
// Offline: axios and the database are mocked, so nothing reaches a dialer.
// ============================================================================
jest.mock('axios');
jest.mock('../config/database', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: null, error: null }) }) }) }) },
}));

const axios = require('axios');
const { boxForCode } = require('./dialerBoxes');

const OLD = { id: 'old_box', base: 'https://old.example', user: 'u', pass: 'p', prefix: 'WTI' };
const NEW = { id: 'new_box', base: 'https://new.example', user: 'u', pass: 'p', prefix: 'WTI' };

// What lead_field_info answers for phone_number on each box.
function phonesOnBoxes(byBase) {
  axios.get.mockImplementation(async (url) => {
    const base = Object.keys(byBase).find(b => url.startsWith(b));
    const phone = base && byBase[base];
    return { data: phone ? `${phone}\n` : 'ERROR: lead_field_info LEAD NOT FOUND - 10' };
  });
}

beforeEach(() => axios.get.mockReset());

// Lead ids differ per test: lead_field_info answers are cached per box+lead.
describe('boxForCode', () => {
  test('one box on the prefix is the answer, with no dialer call', async () => {
    const box = await boxForCode({ boxes: [OLD], leadId: '101' }, '');
    expect(box).toBe(OLD);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('two boxes: the one whose lead carries this phone wins, even when listed second', async () => {
    phonesOnBoxes({ [OLD.base]: '5551230000', [NEW.base]: '8002550711' });
    const box = await boxForCode({ boxes: [OLD, NEW], leadId: '102' }, '18002550711');
    expect(box).toBe(NEW);
  });

  test('two boxes and no phone to check: no box, never boxes[0]', async () => {
    const box = await boxForCode({ boxes: [NEW, OLD], leadId: '103' }, '');
    expect(box).toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('two boxes and neither lead carries the phone: no box', async () => {
    phonesOnBoxes({ [OLD.base]: '5551230000', [NEW.base]: '5559870000' });
    const box = await boxForCode({ boxes: [NEW, OLD], leadId: '104' }, '8002550711');
    expect(box).toBeNull();
  });

  test('a box that does not have the lead at all is skipped, not trusted', async () => {
    phonesOnBoxes({ [OLD.base]: '8002550711' });   // NEW answers LEAD NOT FOUND
    const box = await boxForCode({ boxes: [NEW, OLD], leadId: '105' }, '8002550711');
    expect(box).toBe(OLD);
  });
});
