// Card validation — 100% client-side. The full card number never leaves the
// browser; only the BIN (first 6-8 digits) is later sent to the issuer lookup.

export const digitsOf = (s) => String(s || '').replace(/\D/g, '');

// Luhn checksum.
export function luhnValid(digits) {
  if (!digits || digits.length < 12) return false;
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = +digits[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

// Brand by leading digits (IIN ranges) + valid lengths + CVV length + display grouping.
const BRANDS = [
  { brand: 'American Express', re: /^3[47]/,               lengths: [15],           cvv: 4, gaps: [4, 10] },
  { brand: 'Diners Club',      re: /^(36|38|30[0-5])/,      lengths: [14, 16, 19],   cvv: 3, gaps: [4, 10] },
  { brand: 'Mastercard',       re: /^(5[1-5]|2[2-7])/,      lengths: [16],           cvv: 3, gaps: [4, 8, 12] },
  { brand: 'Visa',             re: /^4/,                    lengths: [13, 16, 19],   cvv: 3, gaps: [4, 8, 12] },
  { brand: 'Discover',         re: /^(6011|65|64[4-9]|622)/, lengths: [16, 19],      cvv: 3, gaps: [4, 8, 12] },
  { brand: 'JCB',              re: /^35(2[89]|[3-8])/,      lengths: [16, 19],       cvv: 3, gaps: [4, 8, 12] },
  { brand: 'UnionPay',         re: /^62/,                   lengths: [16, 17, 18, 19], cvv: 3, gaps: [4, 8, 12] },
  { brand: 'Maestro',          re: /^(5018|5020|5038|6304|6759|676[1-3])/, lengths: [12, 13, 14, 15, 16, 17, 18, 19], cvv: 3, gaps: [4, 8, 12] },
];

export function detectBrand(digits) {
  return BRANDS.find(b => b.re.test(digits)) || null;
}

// Space-group the number for display per its brand (Amex 4-6-5, others 4-4-4-4).
export function formatCardNumber(raw) {
  const d = digitsOf(raw).slice(0, 19);
  const brand = detectBrand(d);
  const gaps = brand ? brand.gaps : [4, 8, 12, 16];
  let out = '';
  for (let i = 0; i < d.length; i++) { if (gaps.includes(i)) out += ' '; out += d[i]; }
  return out;
}

export function validateExpiry(mm, yy) {
  const m = parseInt(mm, 10);
  if (!m || m < 1 || m > 12) return { ok: false, reason: 'Invalid month' };
  const y2 = parseInt(yy, 10);
  if (isNaN(y2)) return { ok: false, reason: 'Invalid year' };
  const year = y2 < 100 ? 2000 + y2 : y2;
  const end = new Date(year, m, 0, 23, 59, 59);          // last moment of the month
  if (end < new Date()) return { ok: false, reason: 'Card is expired' };
  return { ok: true };
}

// Full local verdict for a card number (+ optional expiry / cvv).
export function validateCard({ number, expMonth, expYear, cvv }) {
  const d = digitsOf(number);
  const brand = detectBrand(d);
  const luhn = luhnValid(d);
  const lengthOk = brand ? brand.lengths.includes(d.length) : (d.length >= 12 && d.length <= 19);
  const cvvOk = cvv == null || cvv === '' ? null : (brand ? digitsOf(cvv).length === brand.cvv : [3, 4].includes(digitsOf(cvv).length));
  const exp = (expMonth || expYear) ? validateExpiry(expMonth, expYear) : null;
  const valid = d.length >= 12 && luhn && lengthOk && (exp ? exp.ok : true) && (cvvOk !== false);
  return { digits: d, brand: brand?.brand || null, luhn, lengthOk, cvvOk, expiry: exp, valid, cvvExpected: brand?.cvv || null };
}
