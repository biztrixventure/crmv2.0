// Human "last seen" formatter:
//   <90s        → "just now"
//   <60 min     → "5 minutes ago"
//   same day    → "today at 2:30 PM"
//   yesterday   → "yesterday at 8:15 PM"
//   this year   → "Jun 10 at 4:00 PM"
//   older       → "Jun 10, 2025"
const timeOf = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function formatLastSeen(iso, { prefix = 'Last seen' } = {}) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const now = new Date();
  const secs = (now - d) / 1000;

  if (secs < 90) return `${prefix} just now`;
  if (secs < 3600) {
    const m = Math.round(secs / 60);
    return `${prefix} ${m} minute${m === 1 ? '' : 's'} ago`;
  }

  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `${prefix} today at ${timeOf(d)}`;

  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `${prefix} yesterday at ${timeOf(d)}`;

  if (d.getFullYear() === now.getFullYear()) {
    return `${prefix} ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeOf(d)}`;
  }
  return `${prefix} ${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
