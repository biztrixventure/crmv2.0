// ============================================================================
// customerLookupHistory.test.js — the summary is what the history LISTS, so it
// is the part that has to be right for every shape the lookup service answers
// with. Pure functions only; nothing here touches the database.
// ============================================================================
// The module holds a supabase handle for its writes; these tests only exercise
// the pure half, so the client is stubbed rather than configured.
jest.mock('../config/database', () => ({ supabaseAdmin: {}, supabaseClient: {} }));
jest.mock('./logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const h = require('./customerLookupHistory');

describe('summarize — people', () => {
  test('/api/lookup shape ({ result })', () => {
    const s = h.summarize('people', {
      cached: true,
      result: {
        people: [
          { name: 'J. Doe', age: '47', current_address: { full: '1 Main St, Tampa, FL 33601' } },
          { name: 'A. Roe', current_address: { city: 'Orlando', state: 'FL' } },
        ],
      },
    });
    expect(s.count).toBe(2);
    expect(s.found).toBe(true);
    expect(s.summary.people[0]).toEqual({ name: 'J. Doe', age: '47', place: 'Tampa, FL' });
    expect(s.summary.people[1].place).toBe('Orlando, FL');
    expect(s.summary.cached).toBe(true);
  });

  test('/api/search shape ({ results:[{data}] })', () => {
    const s = h.summarize('search', { results: [{ data: { name: 'Solo Person', age: '31' } }] });
    expect(s.count).toBe(1);
    expect(s.summary.people[0].name).toBe('Solo Person');
  });

  test('the stream done event is the same shape as the blocking call', () => {
    const done = { event: 'done', found: true, count: 1, result: { people: [{ name: 'Streamed' }] } };
    expect(h.summarize('people', done).count).toBe(1);
  });

  test('a person seen twice is counted once', () => {
    const p = { name: 'Dup', age: '50', detail_url: '/x/1' };
    const s = h.summarize('people', { person: p, result: { people: [p] } });
    expect(s.count).toBe(1);
  });

  test('nothing found is empty, not an error', () => {
    const s = h.summarize('people', { result: { people: [] } });
    expect(s.count).toBe(0);
    expect(s.found).toBe(false);
  });

  test('at most six names are kept, and the count still reports them all', () => {
    const people = Array.from({ length: 10 }, (_, i) => ({ name: `P${i}`, detail_url: `/p/${i}` }));
    const s = h.summarize('people', { result: { people } });
    expect(s.count).toBe(10);
    expect(s.summary.people).toHaveLength(6);
  });

  test('a missing payload summarises to nothing instead of throwing', () => {
    expect(h.summarize('people', null)).toEqual({ count: 0, found: false, summary: {} });
    expect(h.summarize('people', 'not an object').count).toBe(0);
  });
});

describe('summarize — vehicles and VINs', () => {
  test('year/make/model become one title', () => {
    const s = h.summarize('vehicles', {
      vehicles: [{ Year: '2015', Make: 'Ford', Model: 'F-150' }, { Vehicle: '2019 Toyota Camry' }],
      result: { status: 'ok' },
    });
    expect(s.count).toBe(2);
    expect(s.summary.vehicles).toEqual(['2015 Ford F-150', '2019 Toyota Camry']);
    expect(s.summary.run_status).toBe('ok');
  });

  test('a failed run is recorded as a run that found nothing, with its status', () => {
    const s = h.summarize('vehicles', { vehicles: [], vehicles_status: 'error' });
    expect(s.found).toBe(false);
    expect(s.summary.run_status).toBe('error');
  });

  test('vehicles keyed by an object, not an array', () => {
    const s = h.summarize('vehicles', { vehicles: { a: { Year: '2020', Make: 'Kia', Model: 'Rio' } } });
    expect(s.summary.vehicles).toEqual(['2020 Kia Rio']);
  });

  test('a VIN answers from result.vins or the bare vin field', () => {
    expect(h.summarize('vin', { result: { vins: ['1FTEW1E', '2FTEW1E'], status: 'found' } }).count).toBe(2);
    expect(h.summarize('vin', { vin: '3FTEW1E' }).summary.vins).toEqual(['3FTEW1E']);
    expect(h.summarize('vin', { result: { status: 'not_found' } }).found).toBe(false);
  });

  test('enrich carries both halves', () => {
    const s = h.summarize('enrich', {
      person: { name: 'Both Halves' },
      vehicles: [{ Year: '2011', Make: 'Honda', Model: 'Civic' }],
    });
    expect(s.summary.people[0].name).toBe('Both Halves');
    expect(s.summary.vehicles).toEqual(['2011 Honda Civic']);
  });

  test('addresses summarise to streets', () => {
    const s = h.summarize('addresses', { addresses: [{ street: '1 Main St', zip: '33601' }, { full: '2 Oak Ave' }] });
    expect(s.count).toBe(2);
    expect(s.summary.addresses).toEqual(['1 Main St', '2 Oak Ave']);
  });
});

describe('placeOf', () => {
  test('a full address becomes a place, not the whole address', () => {
    expect(h.placeOf({ current_address: { full: '123 Main St, Tampa, FL 33601' } })).toBe('Tampa, FL');
  });
  test('city and state are preferred when the service gives them', () => {
    expect(h.placeOf({ city: 'Austin', state: 'TX' })).toBe('Austin, TX');
  });
  test('a street with nothing else is not guessed at', () => {
    expect(h.placeOf({ current_address: { full: '123 Main St' } })).toBe('');
    expect(h.placeOf({})).toBe('');
  });
});

describe('safeParams and capped', () => {
  test('empty values are dropped, long ones clipped', () => {
    const p = h.safeParams({ phone: '7724757074', name: '', zip: undefined, note: 'x'.repeat(500) });
    expect(p).toHaveProperty('phone', '7724757074');
    expect(p).not.toHaveProperty('name');
    expect(p).not.toHaveProperty('zip');
    expect(p.note.length).toBe(200);
  });

  test('a payload that fits is kept whole', () => {
    const data = { result: { people: [{ name: 'Small' }] } };
    expect(h.capped(data)).toBe(data);
  });

  test('a runaway payload is replaced by a note, never stored', () => {
    const huge = { blob: 'x'.repeat(600 * 1024) };
    const out = h.capped(huge);
    expect(out.__truncated).toBe(true);
    expect(out.blob).toBeUndefined();
  });
});
