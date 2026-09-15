// ============================================================================
// utils/ipAddress.js -- parse, validate, normalise and match IPv4 / IPv6
// addresses and CIDR ranges. Pure functions, no dependencies, no I/O.
//
// Used by IP access control (mig 319). Addresses are held as BigInt so one
// code path covers a 32-bit IPv4 and a 128-bit IPv6 address alike.
//
//   parseIp('203.0.113.44')         -> { version: 4, value: 3405803820n }
//   normalizeIp('::FFFF:10.0.0.1')  -> '10.0.0.1'   (IPv4-mapped IPv6 collapses to IPv4)
//   normalizeRule('203.0.113.44/24')-> { ok: true, value: '203.0.113.0/24', masked: true }
//   ipInRule(parseIp(ip), parseRule(rule)) -> boolean
//
// Canonical text forms (what gets stored and compared):
//   * IPv4 dotted quad, no leading zeros.
//   * IPv6 RFC 5952: lowercase, leading zeros dropped, the longest run of two
//     or more zero groups shortened to '::' (leftmost on a tie).
//   * A rule that covers exactly one address is written WITHOUT a prefix
//     ('203.0.113.44', not '203.0.113.44/32'); anything wider keeps '/n' and
//     has its host bits cleared, so 203.0.113.44/24 is stored as 203.0.113.0/24.
// ============================================================================

const V4_BITS = 32;
const V6_BITS = 128;

function parseIPv4(s) {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const p of parts) {
    // Decimal only. A leading zero is refused rather than guessed at: some
    // parsers read '010' as octal 8, others as decimal 10.
    if (!/^(0|[1-9]\d{0,2})$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function parseIPv6(s) {
  if (!s || s.length > 45) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;

  const toGroups = (part, isLastHalf) => {
    if (part === '') return [];
    const raw = part.split(':');
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const g = raw[i];
      // An embedded IPv4 tail (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) is only legal
      // as the very last piece of the whole address.
      if (g.includes('.')) {
        if (!isLastHalf || i !== raw.length - 1) return null;
        const v4 = parseIPv4(g);
        if (v4 === null) return null;
        out.push(Number((v4 >> 16n) & 0xffffn), Number(v4 & 0xffffn));
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  let groups;
  if (halves.length === 2) {
    const head = toGroups(halves[0], false);
    const tail = toGroups(halves[1], true);
    if (head === null || tail === null) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;                 // '::' must stand for at least one group
    groups = [...head, ...new Array(missing).fill(0), ...tail];
  } else {
    groups = toGroups(halves[0], true);
    if (groups === null) return null;
  }
  if (groups.length !== 8) return null;
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
}

// Strip what a socket or a header may wrap an address in: surrounding
// whitespace, [brackets] (URL form), a %zone id (fe80::1%eth0).
function clean(input) {
  if (input === null || input === undefined) return '';
  let s = String(input).trim();
  if (s.startsWith('[') && s.includes(']')) s = s.slice(1, s.indexOf(']'));
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  return s;
}

// Parse one address. Returns { version, value } or null. IPv4-mapped IPv6
// (::ffff:a.b.c.d -- what a dual-stack Node socket reports for an IPv4 client)
// is returned as the IPv4 address it is.
function parseIp(input) {
  const s = clean(input);
  if (!s || s.includes('/')) return null;
  if (s.includes(':')) {
    const v = parseIPv6(s);
    if (v === null) return null;
    if ((v >> 32n) === 0xffffn) return { version: 4, value: v & 0xffffffffn };
    return { version: 6, value: v };
  }
  const v = parseIPv4(s);
  return v === null ? null : { version: 4, value: v };
}

function formatIPv4(value) {
  return [24n, 16n, 8n, 0n].map(sh => String((value >> sh) & 0xffn)).join('.');
}

function formatIPv6(value) {
  const groups = [];
  for (let i = 7; i >= 0; i--) groups.push(Number((value >> BigInt(i * 16)) & 0xffffn));
  // Longest run of zero groups (length >= 2); leftmost wins a tie.
  let bestStart = -1, bestLen = 0;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) { bestStart = i; bestLen = j - i; }
    i = j;
  }
  const hex = groups.map(g => g.toString(16));
  if (bestLen < 2) return hex.join(':');
  const left = hex.slice(0, bestStart).join(':');
  const right = hex.slice(bestStart + bestLen).join(':');
  return `${left}::${right}`;
}

function formatIp(ip) {
  if (!ip) return null;
  return ip.version === 4 ? formatIPv4(ip.value) : formatIPv6(ip.value);
}

// Canonical text for one address, or null when it is not one.
function normalizeIp(input) {
  return formatIp(parseIp(input));
}

const bitsOf = (version) => (version === 4 ? V4_BITS : V6_BITS);

function maskFor(version, prefix) {
  const bits = bitsOf(version);
  if (prefix === 0) return 0n;
  const all = (1n << BigInt(bits)) - 1n;
  return (all >> BigInt(bits - prefix)) << BigInt(bits - prefix);
}

// Parse a rule: a single address or CIDR. Returns
//   { version, network, prefix, masked, text }  or null.
// `masked` is true when host bits were set and had to be cleared -- the caller
// can tell the admin what was actually stored.
function parseRule(input) {
  const s = clean(input);
  if (!s) return null;
  const slash = s.indexOf('/');
  const addrPart = slash === -1 ? s : s.slice(0, slash);
  const prefixPart = slash === -1 ? null : s.slice(slash + 1);

  // Parse the raw family FIRST, before IPv4-mapped collapsing, so a prefix is
  // checked against the family it was written in.
  let version, value;
  if (addrPart.includes(':')) {
    const v = parseIPv6(addrPart);
    if (v === null) return null;
    version = 6; value = v;
  } else {
    const v = parseIPv4(addrPart);
    if (v === null) return null;
    version = 4; value = v;
  }

  let prefix = bitsOf(version);
  if (prefixPart !== null) {
    if (!/^(0|[1-9]\d{0,2})$/.test(prefixPart)) return null;
    prefix = Number(prefixPart);
    if (prefix > bitsOf(version)) return null;
  }

  // ::ffff:a.b.c.d/n with n >= 96 is really an IPv4 range; hold it as one so it
  // matches the IPv4 addresses a dual-stack socket reports.
  if (version === 6 && prefix >= 96 && (value >> 32n) === 0xffffn) {
    version = 4; value &= 0xffffffffn; prefix -= 96;
  }

  const mask = maskFor(version, prefix);
  const network = value & mask;
  const masked = network !== value;
  const addrText = formatIp({ version, value: network });
  const text = prefix === bitsOf(version) ? addrText : `${addrText}/${prefix}`;
  return { version, network, prefix, masked, text };
}

// Validate + normalise user input for storage. Never throws.
//   { ok: true,  value, masked, version, prefix }
//   { ok: false, error }
function normalizeRule(input) {
  const raw = clean(input);
  if (!raw) return { ok: false, error: 'Enter an IP address or a CIDR range.' };
  if (raw.length > 64) return { ok: false, error: 'That is too long to be an IP address or range.' };
  const r = parseRule(raw);
  if (!r) {
    return {
      ok: false,
      error: `"${raw}" is not a valid IPv4/IPv6 address or CIDR range (examples: 203.0.113.44, 203.0.113.0/24, 2001:db8::/32).`,
    };
  }
  return { ok: true, value: r.text, masked: r.masked, version: r.version, prefix: r.prefix };
}

// Does an address (parsed or text) fall inside a rule (parsed or text)?
// Families never cross: an IPv4 address never matches an IPv6 rule.
function ipInRule(ip, rule) {
  const a = typeof ip === 'string' ? parseIp(ip) : ip;
  const r = typeof rule === 'string' ? parseRule(rule) : rule;
  if (!a || !r || a.version !== r.version) return false;
  return (a.value & maskFor(r.version, r.prefix)) === r.network;
}

// Private / loopback / link-local / CGNAT / unique-local. Used only to WARN an
// admin that the address the server sees for them looks like a proxy's -- an
// on-prem CRM can legitimately be used from a LAN, so this never blocks.
const PRIVATE_RANGES = [
  '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8',
  '169.254.0.0/16', '100.64.0.0/10', '0.0.0.0/8',
  '::1/128', '::/128', 'fc00::/7', 'fe80::/10',
].map(parseRule);

function isPrivateIp(input) {
  const a = typeof input === 'string' ? parseIp(input) : input;
  if (!a) return false;
  return PRIVATE_RANGES.some(r => ipInRule(a, r));
}

module.exports = {
  parseIp,
  normalizeIp,
  formatIp,
  parseRule,
  normalizeRule,
  ipInRule,
  isPrivateIp,
};
