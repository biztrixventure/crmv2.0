import { FileText, RefreshCw, Download, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { ET_ZONE } from '../../utils/timezone';
import client from '../../api/client';

// Fetch EVERY page of a paginated compliance list for export — no 5,000 cap.
// Loops 5,000-row pages until the server's `total` is reached (or a short page
// signals the end). Returns the full row array. `onProgress(loaded, total)` is
// optional for a live count.
export async function fetchAllForExport(endpoint, params = {}, dataKey, onProgress) {
  const PAGE = 5000;
  const out = [];
  for (let page = 1; page <= 4000; page++) {   // safety cap (~20M rows)
    const res = await client.get(endpoint, { params: { ...params, limit: PAGE, page } });
    const rows = res.data?.[dataKey] || [];
    out.push(...rows);
    const total = res.data?.total;
    if (onProgress) onProgress(out.length, typeof total === 'number' ? total : out.length);
    if (rows.length < PAGE) break;                        // last (short) page
    if (typeof total === 'number' && out.length >= total) break;
  }
  return out;
}

// ── Status maps ───────────────────────────────────────────────────────────────

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

export const ALL_SALE_STATUSES = [
  'open','sold','cancelled','follow_up','closed_won','closed_lost',
  'compliance_cancelled','dispute','chargeback','pending_review','needs_revision',
];
export const COMPLIANCE_EDIT_STATUSES = [
  'open','sold','cancelled','follow_up','closed_won','closed_lost',
  'compliance_cancelled','dispute','chargeback',
];
export const TRANSFER_STATUSES = ['pending','accepted','completed','rejected','cancelled'];
export const CALLBACK_STATUSES = ['pending','completed','no_answer','answering_machine','cancelled'];
export const LIMIT = 30;

// ── Formatters ────────────────────────────────────────────────────────────────

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

export const downloadCSV = (rows, headers, filename) => {
  const csv = [headers, ...rows]
    .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
};

// ── Shared UI atoms ───────────────────────────────────────────────────────────

export const Spinner = () => (
  <div className="flex justify-center py-16">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2"
      style={{ borderColor: 'var(--color-primary-600)' }} />
  </div>
);

export const Empty = ({ icon: Icon = FileText, msg = 'No records found.' }) => (
  <div className="text-center py-16">
    <Icon size={36} className="mx-auto mb-3"
      style={{ color: 'var(--color-text-tertiary)', opacity: 0.4 }} />
    <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{msg}</p>
  </div>
);

export const Pagination = ({ page, total, limit, onPage }) => {
  if (!total || total <= limit) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3"
      style={{ borderTop: '1px solid var(--color-border)' }}>
      <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
      </span>
      <div className="flex gap-2">
        <button disabled={page === 1} onClick={() => onPage(p => p - 1)}
          className="px-3 py-1 rounded text-sm font-semibold disabled:opacity-40"
          style={{ color: 'var(--color-text-secondary)' }}>Prev</button>
        <button disabled={page * limit >= total} onClick={() => onPage(p => p + 1)}
          className="px-3 py-1 rounded text-sm font-semibold disabled:opacity-40"
          style={{ color: 'var(--color-text-secondary)' }}>Next</button>
      </div>
    </div>
  );
};

export const Th = ({ children, className = '' }) => (
  <th className={`px-4 py-3 text-left text-xs font-bold uppercase tracking-wider ${className}`}
    style={{ color: 'var(--color-text-secondary)' }}>{children}</th>
);

// Sortable header. `sort` = { col, dir }; clicking calls onSort(col).
// Sorting is applied server-side across the whole dataset (see applySort).
export const SortIcon = ({ col, sort }) => {
  if (sort.col !== col) return <ChevronsUpDown size={10} className="opacity-30 ml-0.5 inline-block" />;
  return sort.dir === 'asc'
    ? <ChevronUp size={10} className="ml-0.5 inline-block" style={{ color: 'var(--color-primary-600)' }} />
    : <ChevronDown size={10} className="ml-0.5 inline-block" style={{ color: 'var(--color-primary-600)' }} />;
};

export const SortTh = ({ col, sort, onSort, children, className = '' }) => (
  <th onClick={() => onSort(col)}
    className={`px-4 py-3 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap transition-colors hover:text-primary-600 ${className}`}
    style={{ color: sort.col === col ? 'var(--color-primary-600)' : 'var(--color-text-secondary)' }}>
    {children}<SortIcon col={col} sort={sort} />
  </th>
);

export const TabHeader = ({ title, subtitle, onRefresh, onExport, extra }) => (
  <div className="flex items-start justify-between mb-5 gap-4">
    <div>
      <h2 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}>
        {title}
      </h2>
      {subtitle && (
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{subtitle}</p>
      )}
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">
      {extra}
      {onExport && (
        <button onClick={onExport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors hover:opacity-80"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
          <Download size={13} /> Export CSV
        </button>
      )}
      {onRefresh && (
        <button onClick={onRefresh} className="p-2 rounded-lg transition-colors hover:opacity-80"
          style={{ color: 'var(--color-text-secondary)' }}>
          <RefreshCw size={15} />
        </button>
      )}
    </div>
  </div>
);

export const Filters = ({ onSubmit, children }) => (
  <div className="rounded-xl p-4 mb-5"
    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
    <form onSubmit={e => { e.preventDefault(); onSubmit?.(); }}
      className="flex flex-wrap gap-3 items-end">
      {children}
      <button type="submit"
        className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
        style={{ background: 'var(--gradient-sidebar)' }}>
        Apply
      </button>
    </form>
  </div>
);

export const FInput = ({ label, ...props }) => (
  <div className="flex flex-col gap-1 min-w-[120px]">
    {label && <label className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>}
    <input className="input text-sm" {...props} />
  </div>
);

export const FSelect = ({ label, children, ...props }) => (
  <div className="flex flex-col gap-1 min-w-[140px]">
    {label && <label className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>}
    <select className="input text-sm" {...props}>{children}</select>
  </div>
);

export const Overlay = ({ children }) => (
  <div className="fixed inset-0 z-50 overflow-y-auto"
    style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
    <div className="flex min-h-full items-center justify-center p-4">
      {children}
    </div>
  </div>
);

export const ModalBox = ({ children, wide = false }) => (
  <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl shadow-2xl overflow-hidden flex flex-col`}
    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: '90vh' }}>
    {children}
  </div>
);

export const ModalHeader = ({ icon: Icon, title, subtitle, onClose }) => (
  <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
    style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--gradient-sidebar)' }}>
    <div className="flex items-center gap-3">
      {Icon && <Icon size={18} className="text-white opacity-80" />}
      <div>
        <p className="text-base font-bold text-white">{title}</p>
        {subtitle && <p className="text-xs text-white opacity-70">{subtitle}</p>}
      </div>
    </div>
    <button onClick={onClose} className="p-1 rounded-lg text-white opacity-70 hover:opacity-100">
      ✕
    </button>
  </div>
);

export const InfoTile = ({ label, value }) => (
  <div className="rounded-xl p-3"
    style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
    <p className="text-xs font-semibold mb-1 capitalize" style={{ color: 'var(--color-text-secondary)' }}>
      {label.replace(/_/g, ' ')}
    </p>
    <div className="text-sm font-medium" style={{ color: 'var(--color-text)', wordBreak: 'break-all' }}>
      {value ?? '—'}
    </div>
  </div>
);
