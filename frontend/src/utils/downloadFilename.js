// ============================================================================
// downloadFilename — the ONE builder for every downloaded file's name.
//
// Every export (CSV/PDF) and every recording download used to build its own
// filename ad hoc — some had no date, some had no scope, a few had no
// uniqueness token at all and silently overwrote the previous download. This
// gives every site the same shape:
//   {dataset}_{scope}_{date-or-range}_{HHMMSS}.{ext}
// `scope` (company/agent/customer name) is included whenever the caller has
// it, so two files never look identical in a Downloads folder. The trailing
// HHMMSS (Eastern Time) keeps repeat same-day exports from colliding without
// looking like a meaningless random string — it's literally when it ran.
// ============================================================================
import { ET_ZONE } from './timezone';

const MAX_SLUG = 40;

// Any label → a safe filename fragment: lowercase, alnum/dash only.
export const slug = (s) => {
  const out = String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG);
  return out || null;
};

// YYYY-MM-DD in Eastern Time — matches todayET() in timezone.js.
const dateStampET = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: ET_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

// HHMMSS in Eastern Time — short, sortable, collision-safe.
const timeStampET = () => new Intl.DateTimeFormat('en-GB', {
  timeZone: ET_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(new Date()).replace(/:/g, '');

// Build "{dataset}_{scope}_{date-or-range}_{HHMMSS}.{ext}".
// dataset   — required, e.g. 'sales', 'transfers', 'qa-agent-report'.
// scope     — company/agent/customer/team name, omitted if not given.
// dateFrom/dateTo — the filter window actually applied to the data; falls
//                   back to today (ET) when neither is given.
// ext       — defaults to 'csv'.
export function buildFilename({ dataset, scope, dateFrom, dateTo, ext = 'csv' } = {}) {
  const parts = [slug(dataset) || 'export'];
  const scopeSlug = slug(scope);
  if (scopeSlug) parts.push(scopeSlug);
  if (dateFrom && dateTo && dateFrom !== dateTo) parts.push(`${dateFrom}_to_${dateTo}`);
  else parts.push(dateFrom || dateTo || dateStampET());
  parts.push(timeStampET());
  return `${parts.join('_')}.${ext}`;
}

// Recordings need their own shape (no "dataset", carries the sale/customer
// identity instead) — "{referenceNo}_{customer}_{closer}_{saleDate}[_partN].{ext}"
export function buildRecordingFilename({ referenceNo, customerName, closerName, saleDate, part, ext = 'mp3' } = {}) {
  const parts = ['recording'];
  const refSlug = slug(referenceNo);
  if (refSlug) parts.push(refSlug);
  const nameSlug = slug(customerName);
  if (nameSlug) parts.push(nameSlug);
  const closerSlug = slug(closerName);
  if (closerSlug) parts.push(closerSlug);
  if (saleDate) parts.push(String(saleDate).slice(0, 10));
  if (part) parts.push(`part${part}`);
  return `${parts.join('_')}.${ext}`;
}
