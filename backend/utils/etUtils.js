// Eastern Time (America/New_York) date-range helpers.
// DB stores UTC; date strings from the frontend represent ET calendar days.
// These helpers convert a YYYY-MM-DD ET date to the correct UTC ISO boundaries.

const ET_ZONE = 'America/New_York';

function getEtOffsetMs(dateStr) {
  // Use noon UTC on that date as a DST-safe reference point.
  const ref = new Date(`${dateStr}T12:00:00Z`);
  // Never throw on a malformed date — a bad uploaded value must fall back, not
  // crash the whole bulk insert. Intl.format() raises RangeError on Invalid Date.
  if (isNaN(ref.getTime())) return 0;
  const etHour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: ET_ZONE, hour: '2-digit', hourCycle: 'h23',
    }).format(ref),
    10
  );
  // ET = UTC - offset  →  offset = UTC_hour - ET_hour  (4 for EDT, 5 for EST)
  return (ref.getUTCHours() - etHour) * 3600000;
}

// Start of an ET calendar day expressed as UTC ISO string.
// e.g. '2024-01-15' (EST) → '2024-01-15T05:00:00.000Z'
function etDateToUtcStart(dateStr) {
  if (!dateStr) return null;
  const base = Date.UTC(
    parseInt(dateStr.slice(0, 4), 10),
    parseInt(dateStr.slice(5, 7), 10) - 1,
    parseInt(dateStr.slice(8, 10), 10)
  );
  return new Date(base + getEtOffsetMs(dateStr)).toISOString();
}

// End of an ET calendar day expressed as UTC ISO string (last millisecond).
// e.g. '2024-01-15' (EST) → '2024-01-16T04:59:59.999Z'
function etDateToUtcEnd(dateStr) {
  if (!dateStr) return null;
  const base = Date.UTC(
    parseInt(dateStr.slice(0, 4), 10),
    parseInt(dateStr.slice(5, 7), 10) - 1,
    parseInt(dateStr.slice(8, 10), 10)
  );
  return new Date(base + getEtOffsetMs(dateStr) + 86400000 - 1).toISOString();
}

// ── Uploaded date/time → UTC, interpreting the value as ET wall-clock ──────────
// Bulk-uploaded dates are bare wall-clock strings ("2026-05-01" or
// "2026-05-01 11:48") with no timezone. The app displays transfer dates in ET
// (fmtDateET / fmtDateTime), so we MUST interpret the uploaded value as ET and
// convert to the matching UTC instant — otherwise a date-only value becomes
// midnight UTC and renders as the previous day in ET, and times drift by the
// server's offset.
const pad2 = (n) => String(n).padStart(2, '0');

// Reject impossible calendar parts so a misread format falls back instead of
// producing an Invalid Date (which used to crash the bulk insert downstream).
function validParts(p) {
  return p && p.mo >= 1 && p.mo <= 12 && p.d >= 1 && p.d <= 31
    && p.h >= 0 && p.h <= 23 && p.mi >= 0 && p.mi <= 59 && p.s >= 0 && p.s <= 59;
}

// Tolerant parse of common spreadsheet formats → { y, mo, d, h, mi, s }.
function parseDateParts(input) {
  const s = String(input).trim();
  // ISO-ish: 2026-05-01 [ or T] 11:48[:30]
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const p = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
    return validParts(p) ? p : null;
  }
  // Slash format: 5/1/2026 or 21/05/2026 [11:48[:30]] [AM|PM]. Excel exports are
  // locale-dependent — the same file can mix US (M/D) and intl (D/M). Disambiguate
  // by value: if the first number can't be a month (>12), it's the day (D/M/Y).
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (m) {
    let h = +(m[4] || 0);
    const ap = (m[7] || '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const a = +m[1], b = +m[2];
    // a>12 → D/M/Y; else default to US M/D/Y (matches prior behavior).
    const mo = (a > 12 && b <= 12) ? b : a;
    const d  = (a > 12 && b <= 12) ? a : b;
    const p = { y, mo, d, h, mi: +(m[5] || 0), s: +(m[6] || 0) };
    return validParts(p) ? p : null;
  }
  return null;
}

function etWallClockToUtc(input) {
  if (input == null || String(input).trim() === '') return null;
  const s = String(input).trim();
  // Already absolute (has Z or ±hh:mm offset) → trust as-is.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const p = parseDateParts(s);
  if (!p) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const dateStr = `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`;
  const base = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  if (isNaN(base)) return null;
  // ET wall-clock = UTC(base) shifted forward by ET's offset (4h EDT / 5h EST).
  const out = new Date(base + getEtOffsetMs(dateStr));
  return isNaN(out.getTime()) ? null : out.toISOString();
}

// A UTC timestamp / ISO string → the ET calendar date ('YYYY-MM-DD') it falls
// on. Inverse of etDateToUtcStart. Use this to window a DATE column (stored as
// the ET business day, e.g. sales.sale_date) by absolute timestamptz bounds.
// Replaces the naive `String(ts).slice(0,10)`, which read the UTC date and so
// leaked the next calendar day for evening-UTC instants (2026-06-17T00:00Z is
// 8pm ET on the 16th, not the 17th).
function utcToEtDate(ts, zone = ET_ZONE) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone || ET_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: ET_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  }
}

// Current ET calendar day as 'YYYY-MM-DD'. Default zone is America/New_York
// (the app's display zone). Pass an explicit zone to honor business_config's
// kpi.today_timezone setting per company.
function todayEt(zone = ET_ZONE) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone || ET_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: ET_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }
}

module.exports = { etDateToUtcStart, etDateToUtcEnd, etWallClockToUtc, todayEt, utcToEtDate };
