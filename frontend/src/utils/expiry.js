// ── how long numbers stay with the person holding them ───────────────────────
// A lent assignment carries a deadline (mig 322). Four surfaces show the same
// countdown — the fronter's floating My Numbers, the batch list, the batch
// workspace and the number report — so the wording lives in one place instead
// of drifting into "2h", "2 hrs" and "in about 2 hours" across the app.
//
// The stored value is always a UTC ISO instant; everything here compares it to
// the viewer's own clock, which is the clock they are working against.

export function timeLeft(iso) {
  if (!iso) return { ms: null, text: '', expired: false, urgent: false, soon: false };
  const ms = new Date(iso).getTime() - Date.now();
  if (isNaN(ms)) return { ms: null, text: '', expired: false, urgent: false, soon: false };
  if (ms <= 0) return { ms, text: 'time up', expired: true, urgent: true, soon: true };

  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const text = mins < 60 ? `${Math.max(1, mins)}m left`
    : hours < 24 ? `${hours}h ${mins % 60}m left`
      : days < 7 ? `${days}d ${hours % 24}h left`
        : `${days}d left`;
  // urgent is what turns the badge red: under an hour is the point at which a
  // fronter has to decide what to finish, not just notice a date.
  return { ms, text, expired: false, urgent: ms < 60 * 60 * 1000, soon: ms < 6 * 60 * 60 * 1000 };
}

// The deadline itself, in the viewer's locale — "Sep 24, 5:30 PM".
export function fmtDeadline(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return ''; }
}

// A datetime-local input speaks bare LOCAL time, so a deadline picked in the UI
// is converted before it is stored, and back when it is loaded. Same rule as
// callback_at — see CLAUDE.md, "Callback Timezone Rule".
export function toLocalInputValue(utcIso) {
  if (!utcIso) return '';
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInputValue(local) {
  if (!local) return null;
  const d = new Date(local);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// The presets the assign panel offers. Hours, because that is what the API
// takes; the custom option is the "pick the exact day and time" case.
export const EXPIRY_PRESETS = [
  { key: 'none',   label: 'No limit',   hours: null },
  { key: '4h',     label: '4 hours',    hours: 4 },
  { key: '8h',     label: '8 hours',    hours: 8 },
  { key: '24h',    label: '1 day',      hours: 24 },
  { key: '48h',    label: '2 days',     hours: 48 },
  { key: '168h',   label: '1 week',     hours: 168 },
  { key: 'custom', label: 'Day & time', hours: null },
];
