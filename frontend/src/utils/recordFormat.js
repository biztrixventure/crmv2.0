// ============================================================================
// recordFormat — the record formatters + CSV writer shared by every shell.
//
// These lived inline in components/Compliance/shared.jsx, which imports React,
// AuthContext and FeatureFlagsContext. utils/exportSpec.js needs them and
// shared.jsx needs exportSpec, so leaving them there would be an import cycle.
// shared.jsx now re-exports everything here, so every existing
// `import { fmtDate, downloadCSV } from './shared'` keeps working untouched.
// ============================================================================
import { ET_ZONE } from './timezone';

/**
 * A count's share of a total, for the sub-label under a stat box.
 *
 * Never prints "0%" for a NON-ZERO count. Measured live: 2 pending out of
 * 5,976 transfers rounds to 0%, so the box read "2" above "0% of total" —
 * which says the opposite of the number it sits under. "<1%" is both accurate
 * and non-contradictory. A genuine zero still reads "0%".
 *
 * Returns null when there is no total to divide by, so callers can omit the
 * sub-label entirely rather than render "NaN%".
 */
export const sharePct = (n, total) => {
  const c = Number(n), t = Number(total);
  if (!Number.isFinite(c) || !Number.isFinite(t) || t <= 0) return null;
  if (c === 0) return '0%';
  const p = (c / t) * 100;
  return p < 1 ? '<1%' : `${Math.round(p)}%`;
};

/**
 * One-decimal percentage, for a COLUMN of rates.
 *
 * `${7.9}%` and `${3}%` render as "7.9%" and "3%", so a column reads
 * 7.9 / 7.2 / 3.5 / 3 / 2.5 and the whole number looks like a different unit.
 * Single tiles keep whole numbers on purpose — this is for tabular use.
 */
export const pct1 = (v) => {
  const n = Number(v);
  return (v === null || v === undefined || !Number.isFinite(n)) ? '—' : `${n.toFixed(1)}%`;
};

export const STATUS_BADGE = {
  open: 'info', sold: 'success', closed_won: 'success', closed_lost: 'error',
  cancelled: 'error', compliance_cancelled: 'error', follow_up: 'warning',
  dispute: 'warning', chargeback: 'error', pending_review: 'warning',
  needs_revision: 'error', pending: 'warning', completed: 'success', missed: 'error',
  accepted: 'success', rejected: 'error',
  no_answer: 'secondary', answering_machine: 'secondary',
};

export const STATUS_LABEL = {
  open: 'Open', sold: 'Sold', closed_won: 'Approved', closed_lost: 'Lost',
  cancelled: 'Cancelled', compliance_cancelled: 'Comp. Cancelled',
  follow_up: 'Follow Up', dispute: 'Dispute', chargeback: 'Chargeback',
  pending_review: 'Pending Review', needs_revision: 'Needs Revision',
  pending: 'Pending', completed: 'Completed', missed: 'Missed',
  accepted: 'Accepted', rejected: 'Rejected',
  no_answer: 'No Answer', answering_machine: 'Ans. Machine',
};

export const fmtDate = (d) => {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: ET_ZONE, month: 'short', day: 'numeric', year: 'numeric',
    }).format(new Date(d));
  } catch { return '—'; }
};

export const fmtDateTime = (d) => {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: ET_ZONE, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(d));
  } catch { return '—'; }
};

export const timeAgo = (d) => {
  if (!d) return '—';
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export const customerName = (t) => {
  const fd = t?.form_data || {};
  if (fd.FirstName || fd.LastName) return [fd.FirstName, fd.LastName].filter(Boolean).join(' ');
  return fd.customer_name || t?.customer_name || '—';
};

export const closerName = (s) =>
  s.closer_name ||
  (s.user_profiles ? `${s.user_profiles.first_name || ''} ${s.user_profiles.last_name || ''}`.trim() : '') ||
  '—';

// The ONE CSV writer. Four near-identical copies existed (Compliance/shared,
// ManagerExportModal, ReportsPanel, NumbersIntelligence). They differed only in
// whether the <a> was appended to the document before clicking, which Firefox
// needs — this keeps the appending version.
export const downloadCSV = (rows, headers, filename) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};
