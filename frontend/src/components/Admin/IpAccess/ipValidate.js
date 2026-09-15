// ============================================================================
// ipValidate.js -- browser copy of backend/utils/ipAddress.js normalizeRule(),
// so the rule form can say "that is not an address" while the admin types.
// The server re-validates everything; this only saves a round-trip. Keep the
// two in step if either changes.
//
//   validateIpOrCidr('203.0.113.44/24') -> { ok: true, value: '203.0.113.0/24', masked: true }
//   validateIpOrCidr('300.1.1.1')       -> { ok: false, error: '...' }
// ============================================================================

function parseIPv4(s) {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let v = 0n;
  for (const p of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    v = (v << 8n) | BigInt(n);
  }
  return v;
}

function parseIPv6(s) {
  if (!s || s.length > 45) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part, last) => {
    if (part === '') return [];
    const raw = part.split(':');
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const g = raw[i];
      if (g.includes('.')) {
        if (!last || i !== raw.length - 1) return null;
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
    if (missing < 1) return null;
    groups = [...head, ...new Array(missing).fill(0), ...tail];
  } else {
    groups = toGroups(halves[0], true);
    if (groups === null) return null;
  }
  if (groups.length !== 8) return null;
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
}

const fmt4 = (v) => [24n, 16n, 8n, 0n].map(sh => String((v >> sh) & 0xffn)).join('.');
function fmt6(v) {
  const g = [];
  for (let i = 7; i >= 0; i--) g.push(Number((v >> BigInt(i * 16)) & 0xffffn));
  let bs = -1, bl = 0;
  for (let i = 0; i < 8;) {
    if (g[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bl) { bs = i; bl = j - i; }
    i = j;
  }
  const hex = g.map(x => x.toString(16));
  if (bl < 2) return hex.join(':');
  return `${hex.slice(0, bs).join(':')}::${hex.slice(bs + bl).join(':')}`;
}

export function validateIpOrCidr(input) {
  let s = String(input ?? '').trim();
  if (s.startsWith('[') && s.includes(']')) s = s.slice(1, s.indexOf(']'));
  if (s.includes('%')) s = s.slice(0, s.indexOf('%'));
  if (!s) return { ok: false, error: 'Enter an IP address or a CIDR range.' };
  if (s.length > 64) return { ok: false, error: 'That is too long to be an IP address or range.' };

  const slash = s.indexOf('/');
  const addr = slash === -1 ? s : s.slice(0, slash);
  const pfx = slash === -1 ? null : s.slice(slash + 1);
  let version, value;
  if (addr.includes(':')) { value = parseIPv6(addr); version = 6; } else { value = parseIPv4(addr); version = 4; }
  const bad = { ok: false, error: `"${s}" is not a valid IPv4/IPv6 address or CIDR range (e.g. 203.0.113.44, 203.0.113.0/24, 2001:db8::/32).` };
  if (value === null) return bad;

  let bits = version === 4 ? 32 : 128;
  let prefix = bits;
  if (pfx !== null) {
    if (!/^(0|[1-9]\d{0,2})$/.test(pfx)) return bad;
    prefix = Number(pfx);
    if (prefix > bits) return bad;
  }
  if (version === 6 && prefix >= 96 && (value >> 32n) === 0xffffn) {
    version = 4; value &= 0xffffffffn; prefix -= 96; bits = 32;
  }
  const mask = prefix === 0 ? 0n : (((1n << BigInt(bits)) - 1n) >> BigInt(bits - prefix)) << BigInt(bits - prefix);
  const net = value & mask;
  const text = version === 4 ? fmt4(net) : fmt6(net);
  return { ok: true, value: prefix === bits ? text : `${text}/${prefix}`, masked: net !== value, version };
}
