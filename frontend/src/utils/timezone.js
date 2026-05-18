// ── Timezone utilities — no external library required ──────────────────────────
// All conversion uses native Intl.DateTimeFormat (universal browser support).
// Storage is always UTC. These helpers handle display and input conversion only.

// ── Eastern Time (Florida / USA) ─────────────────────────────────────────────
export const ET_ZONE = 'America/New_York';

// Today's date string (YYYY-MM-DD) in Eastern Time
export function todayET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// Format a UTC ISO string as a short date in Eastern Time ("Jan 15, 2024")
export function fmtDateET(utcIso) {
  if (!utcIso) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: ET_ZONE, month: 'short', day: 'numeric', year: 'numeric',
    }).format(new Date(utcIso));
  } catch { return '—'; }
}

// Format a UTC ISO string as date + time in Eastern Time ("Jan 15, 2:30 PM")
export function fmtDateTimeET(utcIso) {
  if (!utcIso) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: ET_ZONE, month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(utcIso));
  } catch { return '—'; }
}

// US state abbreviation → primary IANA timezone
export const STATE_TIMEZONE = {
  AL: 'America/Chicago',    AK: 'America/Anchorage',  AZ: 'America/Phoenix',
  AR: 'America/Chicago',    CA: 'America/Los_Angeles', CO: 'America/Denver',
  CT: 'America/New_York',   DE: 'America/New_York',    FL: 'America/New_York',
  GA: 'America/New_York',   HI: 'Pacific/Honolulu',    ID: 'America/Boise',
  IL: 'America/Chicago',    IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago',    KY: 'America/New_York',    LA: 'America/Chicago',
  ME: 'America/New_York',   MD: 'America/New_York',    MA: 'America/New_York',
  MI: 'America/Detroit',    MN: 'America/Chicago',     MS: 'America/Chicago',
  MO: 'America/Chicago',    MT: 'America/Denver',      NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York',   NJ: 'America/New_York',
  NM: 'America/Denver',     NY: 'America/New_York',    NC: 'America/New_York',
  ND: 'America/Chicago',    OH: 'America/New_York',    OK: 'America/Chicago',
  OR: 'America/Los_Angeles', PA: 'America/New_York',   RI: 'America/New_York',
  SC: 'America/New_York',   SD: 'America/Chicago',     TN: 'America/Chicago',
  TX: 'America/Chicago',    UT: 'America/Denver',      VT: 'America/New_York',
  VA: 'America/New_York',   WA: 'America/Los_Angeles', WV: 'America/New_York',
  WI: 'America/Chicago',    WY: 'America/Denver',      DC: 'America/New_York',
  PR: 'America/Puerto_Rico', VI: 'America/St_Thomas',
};

// Timezone options for the company internal_timezone dropdown
export const WORLD_TIMEZONES = [
  { label: 'Pakistan (PKT, UTC+5)',     value: 'Asia/Karachi'        },
  { label: 'India (IST, UTC+5:30)',     value: 'Asia/Kolkata'        },
  { label: 'UAE / Dubai (GST, UTC+4)', value: 'Asia/Dubai'          },
  { label: 'Bangladesh (BST, UTC+6)',   value: 'Asia/Dhaka'          },
  { label: 'Eastern Time (ET)',         value: 'America/New_York'    },
  { label: 'Central Time (CT)',         value: 'America/Chicago'     },
  { label: 'Mountain Time (MT)',        value: 'America/Denver'      },
  { label: 'Pacific Time (PT)',         value: 'America/Los_Angeles' },
  { label: 'Alaska (AKT)',              value: 'America/Anchorage'   },
  { label: 'Hawaii (HST)',              value: 'Pacific/Honolulu'    },
  { label: 'UK (GMT/BST)',              value: 'Europe/London'       },
  { label: 'UTC',                       value: 'UTC'                 },
];

export const getTimezoneFromState = (stateAbbr) =>
  STATE_TIMEZONE[stateAbbr?.toUpperCase()] || null;

// Format a UTC ISO string for display in any IANA timezone.
// opts mirrors Intl.DateTimeFormat options — can override any part.
export function formatInTz(utcIso, tz, opts = {}) {
  if (!utcIso) return '—';
  const safeZone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: safeZone,
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      ...opts,
    }).format(new Date(utcIso));
  } catch {
    return new Date(utcIso).toLocaleString();
  }
}

// Short timezone abbreviation: "PST", "EST", "PKT", "IST", etc.
export function getTzAbbr(tz) {
  if (!tz) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value || '';
  } catch { return ''; }
}

// Current local time in a given timezone, formatted for display.
export function nowInTz(tz) {
  if (!tz) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true,
    }).format(new Date());
  } catch { return '—'; }
}

// Format a UTC ms/ISO value as "YYYY-MM-DDTHH:MM" in the given timezone.
// This is what goes into a <input type="datetime-local"> when the UI wants
// the agent to see/enter times in a specific timezone.
export function formatForInput(utcMsOrIso, tz) {
  const safeZone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const d = new Date(utcMsOrIso);
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: safeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const p = {};
    parts.forEach(({ type, value }) => { p[type] = value; });
    const hr = p.hour === '24' ? '00' : p.hour;
    return `${p.year}-${p.month}-${p.day}T${hr}:${p.minute}`;
  } catch {
    const d = new Date(utcMsOrIso);
    const offsetMs = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
  }
}

// Convert a datetime-local string entered IN a specific timezone to UTC ISO.
// Example: "2024-12-01T12:00" in "America/Los_Angeles" → "2024-12-01T20:00:00.000Z"
// Handles DST correctly via iterative adjustment (no library needed).
export function convertToUtc(localDateTimeStr, tz) {
  if (!localDateTimeStr) return null;
  const safeZone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const [datePart, timePart] = localDateTimeStr.split('T');
    const [year, month, day]   = datePart.split('-').map(Number);
    const [hour, minute]       = (timePart || '00:00').split(':').map(Number);
    const targetMinutes        = hour * 60 + minute;

    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: safeZone, hour: '2-digit', minute: '2-digit', hour12: false,
    });

    const getLocalMinutes = (ms) => {
      const parts = fmt.formatToParts(new Date(ms));
      const h = parseInt(parts.find(p => p.type === 'hour')?.value  || '0');
      const m = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
      return (h === 24 ? 0 : h) * 60 + m;
    };

    let utcMs = Date.UTC(year, month - 1, day, hour, minute); // naive guess

    for (let i = 0; i < 3; i++) {
      const localMinutes = getLocalMinutes(utcMs);
      let diff = targetMinutes - localMinutes;
      // Wrap midnight: if diff > 12h, we crossed midnight the wrong way
      if (diff >  720) diff -= 1440;
      if (diff < -720) diff += 1440;
      if (Math.abs(diff) < 1) break;
      utcMs += diff * 60000;
    }

    return new Date(utcMs).toISOString();
  } catch {
    return new Date(localDateTimeStr).toISOString();
  }
}
