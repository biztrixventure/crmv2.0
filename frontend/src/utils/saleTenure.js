// ── Sale "paid tenure" ───────────────────────────────────────────────────────
// How long a customer kept paying before a sale was cancelled: the span between
// the SALE date and the CANCELLATION date. Surfaced in the sale drawer, the
// customer profile, and anywhere a cancelled sale is shown so compliance can see
// e.g. "paid ~3 months" at a glance.
//
// Returns null unless BOTH dates are present and the cancel date is on/after the
// sale date. Otherwise: { days, months, remDays, monthsFloat, from, to, label,
// short }.

const toDate = (v) => {
  if (!v) return null;
  // Accept 'YYYY-MM-DD' (treat as local calendar day) and full ISO strings.
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Whole calendar months from → to (day-of-month aware), plus the leftover days.
function calendarMonths(from, to) {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  // anchor = from + `months` months; remaining days = to - anchor
  const anchor = new Date(from.getFullYear(), from.getMonth() + months, from.getDate());
  const remDays = Math.max(0, Math.round((to - anchor) / 86400000));
  return { months: Math.max(0, months), remDays };
}

export function salePaidTenure(sale) {
  if (!sale) return null;
  const from = toDate(sale.sale_date);
  const to = toDate(sale.cancellation_date);
  if (!from || !to) return null;
  const days = Math.round((to - from) / 86400000);
  if (days < 0) return null;                       // cancel before sale → not meaningful

  const { months, remDays } = calendarMonths(from, to);
  const monthsFloat = Math.round((days / 30.4375) * 10) / 10;

  // Human label — lead with months once there's at least one, else days.
  let label;
  if (months >= 1) label = `${months} month${months === 1 ? '' : 's'}${remDays ? ` ${remDays}d` : ''}`;
  else label = `${days} day${days === 1 ? '' : 's'}`;

  const short = months >= 1 ? `${months} mo` : `${days} d`;
  return { days, months, remDays, monthsFloat, from, to, label, short };
}

// One-liner for tooltips / secondary text: "Paid 3 months (Jan 5 → Apr 12, 2026)".
export function salePaidTenureLine(sale) {
  const t = salePaidTenure(sale);
  if (!t) return null;
  const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `Paid ${t.label} · ${fmt(t.from)} → ${fmt(t.to)}`;
}
