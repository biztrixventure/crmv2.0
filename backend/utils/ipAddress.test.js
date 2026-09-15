// ============================================================================
// ipAddress.test.js -- the IPv4/IPv6 parser, normaliser and CIDR matcher that
// every IP access decision (mig 319) rests on. Pure functions, no mocks.
// ============================================================================
const { parseIp, normalizeIp, normalizeRule, ipInRule, isPrivateIp } = require('./ipAddress');

describe('normalizeIp -- IPv4', () => {
  test.each([
    ['203.0.113.44', '203.0.113.44'],
    [' 10.0.0.1 ', '10.0.0.1'],
    ['0.0.0.0', '0.0.0.0'],
    ['255.255.255.255', '255.255.255.255'],
  ])('%s -> %s', (input, out) => expect(normalizeIp(input)).toBe(out));

  test.each([
    '256.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', '1.2.3.-4', 'a.b.c.d', '', null, undefined, '1.2.3.4/24',
  ])('rejects %p', (input) => expect(normalizeIp(input)).toBeNull());
});

describe('normalizeIp -- IPv6', () => {
  test.each([
    ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['::', '::'],
    ['::1', '::1'],
    ['1::', '1::'],
    ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'],      // leftmost of two equal runs
    ['2001:db8:0:1:0:0:0:1', '2001:db8:0:1::1'],         // longest run wins
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2:3:4:5:6'],
    ['[2001:db8::7]', '2001:db8::7'],                     // URL brackets
    ['fe80::1%eth0', 'fe80::1'],                          // zone id
    ['64:ff9b::192.0.2.33', '64:ff9b::c000:221'],         // embedded IPv4 tail
  ])('%s -> %s', (input, out) => expect(normalizeIp(input)).toBe(out));

  test('IPv4-mapped IPv6 (what a dual-stack socket reports) collapses to IPv4', () => {
    expect(normalizeIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(normalizeIp('::FFFF:127.0.0.1')).toBe('127.0.0.1');
    expect(parseIp('::ffff:192.0.2.1').version).toBe(4);
  });

  test.each([
    '1::2::3', '12345::', ':1', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7:8::', 'g::1', '::ffff:1.2.3', '1.2.3.4::',
  ])('rejects %p', (input) => expect(normalizeIp(input)).toBeNull());
});

describe('normalizeRule -- validation + canonical storage form', () => {
  test('a single address is stored without a prefix', () => {
    expect(normalizeRule('203.0.113.44')).toMatchObject({ ok: true, value: '203.0.113.44', masked: false });
    expect(normalizeRule('203.0.113.44/32')).toMatchObject({ ok: true, value: '203.0.113.44' });
    expect(normalizeRule('2001:db8::1/128')).toMatchObject({ ok: true, value: '2001:db8::1' });
  });

  test('host bits are cleared and reported', () => {
    expect(normalizeRule('203.0.113.44/24')).toMatchObject({ ok: true, value: '203.0.113.0/24', masked: true });
    expect(normalizeRule('2001:db8:abcd::1/32')).toMatchObject({ ok: true, value: '2001:db8::/32', masked: true });
    expect(normalizeRule('203.0.113.0/24')).toMatchObject({ ok: true, value: '203.0.113.0/24', masked: false });
  });

  test('whole-family ranges are legal', () => {
    expect(normalizeRule('0.0.0.0/0')).toMatchObject({ ok: true, value: '0.0.0.0/0' });
    expect(normalizeRule('::/0')).toMatchObject({ ok: true, value: '::/0' });
  });

  test('::ffff:a.b.c.d/n (n >= 96) is held as the IPv4 range it is', () => {
    expect(normalizeRule('::ffff:10.0.0.0/104')).toMatchObject({ ok: true, value: '10.0.0.0/8', version: 4 });
  });

  test.each([
    '10.0.0.0/33', '2001:db8::/129', '1.2.3.4/', '1.2.3.4/08', '1.2.3.4/-1', '1.2.3.4/abc', 'office', '', '   ',
    '999.1.1.1/8', '1.2.3.4/24/1',
  ])('rejects %p with a readable message', (input) => {
    const r = normalizeRule(input);
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
    expect(r.error.length).toBeGreaterThan(5);
  });
});

describe('ipInRule -- CIDR matching', () => {
  test('IPv4 range boundaries', () => {
    expect(ipInRule('203.0.113.0', '203.0.113.0/24')).toBe(true);
    expect(ipInRule('203.0.113.255', '203.0.113.0/24')).toBe(true);
    expect(ipInRule('203.0.114.0', '203.0.113.0/24')).toBe(false);
    expect(ipInRule('203.0.112.255', '203.0.113.0/24')).toBe(false);
    expect(ipInRule('10.200.3.4', '10.0.0.0/8')).toBe(true);
    expect(ipInRule('11.0.0.1', '10.0.0.0/8')).toBe(false);
  });

  test('exact addresses', () => {
    expect(ipInRule('198.51.100.7', '198.51.100.7')).toBe(true);
    expect(ipInRule('198.51.100.8', '198.51.100.7')).toBe(false);
    expect(ipInRule('2001:db8::1', '2001:0db8:0:0::1')).toBe(true);
  });

  test('IPv6 ranges', () => {
    expect(ipInRule('2001:db8:ffff:1::5', '2001:db8::/32')).toBe(true);
    expect(ipInRule('2001:db9::1', '2001:db8::/32')).toBe(false);
    expect(ipInRule('2001:db8:0:1::1', '2001:db8::/64')).toBe(false);
    expect(ipInRule('2001:db8::abcd', '2001:db8::/64')).toBe(true);
  });

  test('/0 matches its own family only -- IPv4 and IPv6 never cross', () => {
    expect(ipInRule('8.8.8.8', '0.0.0.0/0')).toBe(true);
    expect(ipInRule('2001:db8::1', '0.0.0.0/0')).toBe(false);
    expect(ipInRule('2001:db8::1', '::/0')).toBe(true);
    expect(ipInRule('8.8.8.8', '::/0')).toBe(false);
  });

  test('a mapped client address matches the IPv4 rule', () => {
    expect(ipInRule('::ffff:203.0.113.9', '203.0.113.0/24')).toBe(true);
  });

  test('garbage never matches', () => {
    expect(ipInRule('nope', '10.0.0.0/8')).toBe(false);
    expect(ipInRule('10.0.0.1', 'nope')).toBe(false);
    expect(ipInRule(null, '10.0.0.0/8')).toBe(false);
  });
});

describe('isPrivateIp', () => {
  test.each(['10.1.2.3', '172.16.0.1', '192.168.1.1', '127.0.0.1', '::1', 'fd00::1', 'fe80::1', '100.64.0.1'])(
    '%s is private', (ip) => expect(isPrivateIp(ip)).toBe(true));
  test.each(['8.8.8.8', '203.0.113.9', '2001:db8::1', '172.32.0.1'])(
    '%s is public', (ip) => expect(isPrivateIp(ip)).toBe(false));
});
