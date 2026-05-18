// Eastern Time (America/New_York) date-range helpers.
// DB stores UTC; date strings from the frontend represent ET calendar days.
// These helpers convert a YYYY-MM-DD ET date to the correct UTC ISO boundaries.

const ET_ZONE = 'America/New_York';

function getEtOffsetMs(dateStr) {
  // Use noon UTC on that date as a DST-safe reference point.
  const ref = new Date(`${dateStr}T12:00:00Z`);
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

module.exports = { etDateToUtcStart, etDateToUtcEnd };
