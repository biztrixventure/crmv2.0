// ============================================================================
// dialerTime.js — turning a dialer's wall clock into a real instant.
//
// VICIdial reports times as a NAIVE local string with no zone on it:
//   recording_lookup -> "2026-09-18 17:39:50"
//   the file name    -> 20260918-173950_7139076340-all.mp3
// Both are the BOX's local time. Everything in the CRM is UTC.
//
// `new Date("2026-09-18T17:39:50")` does NOT mean what it looks like: with no
// zone suffix, JavaScript reads it in the SERVER's zone, which in a container
// is UTC. So a US-Eastern dialer's 17:39 became 17:39Z instead of 21:39Z, and
// every comparison against call_at carried four hours of error. That is what
// rotated the clips on a lead among its calls: with a four-hour skew and no
// limit on how far a match could be, a neighbouring call always looked closer
// than the right one.
//
// The offset cannot be a constant. America/New_York is -4 in September and -5
// in December, so a hardcoded -4 would break every match on the first Sunday
// of November -- the same class of bug, just dormant for six weeks. The zone
// name lives on the box (migration 328) and the offset is resolved per
// timestamp through Intl, which knows the DST rules.
// ============================================================================

// What is `tz`'s offset from UTC at this instant, in milliseconds?
// Formatting an instant in the zone and re-reading the fields as if they were
// UTC gives exactly that difference.
function zoneOffsetMs(utcMs, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs));
    const f = {};
    for (const p of parts) f[p.type] = p.value;
    // hour is "24" at midnight under hour12:false in some ICU versions.
    const asIfUtc = Date.UTC(+f.year, +f.month - 1, +f.day, (+f.hour) % 24, +f.minute, +f.second);
    return asIfUtc - utcMs;
  } catch {
    return 0;   // unknown zone: treat the wall clock as UTC rather than throw
  }
}

/**
 * A naive "YYYY-MM-DD HH:MM:SS" in `tz` -> UTC milliseconds.
 *
 * Two passes, which is what makes DST correct. The first pass reads the wall
 * clock as if it were UTC and subtracts the zone's offset AT THAT GUESS; on the
 * two days a year the offset changes, the guess can land on the wrong side of
 * the transition, so the offset is re-read at the corrected instant and applied
 * again. One refinement is enough for every real zone.
 */
function naiveToUtcMs(naive, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(naive || '').trim());
  if (!m) return NaN;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (!tz) return wall;
  let utc = wall - zoneOffsetMs(wall, tz);
  utc = wall - zoneOffsetMs(utc, tz);
  return utc;
}

/**
 * How far a recording is from the call it might belong to, in milliseconds.
 *
 * A clip is scored on BOTH ends, and the nearer one wins. `call_at` is not one
 * consistent thing across the sources that build a qa2_call: a live-ingest row
 * is stamped when the disposition fired, which is the END of the call, while a
 * row materialised from the CRM carries the transfer's own timestamp, nearer
 * the start. Scoring only against the start would put every ingest row out by
 * the length of its own call -- ten minutes on a long one, which is further
 * than the gap between two consecutive calls to the same customer.
 *
 * Returns Infinity when the clip has no readable start, so it sorts last
 * instead of being silently treated as a perfect match (NaN comparisons in a
 * sort are how a broken timestamp becomes the chosen clip).
 */
function clipDistanceMs(clip, callAt, tz) {
  const at = callAt instanceof Date ? callAt.getTime() : new Date(callAt).getTime();
  if (!Number.isFinite(at)) return Infinity;
  const start = naiveToUtcMs(clip && clip.start, tz);
  if (!Number.isFinite(start)) return Infinity;
  const dur = Number(clip && clip.duration);
  const end = Number.isFinite(dur) && dur > 0 ? start + dur * 1000 : start;
  return Math.min(Math.abs(start - at), Math.abs(end - at));
}

module.exports = { zoneOffsetMs, naiveToUtcMs, clipDistanceMs };
