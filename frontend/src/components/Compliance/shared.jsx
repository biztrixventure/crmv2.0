import { FileText, RefreshCw, Download, ChevronUp, ChevronDown, ChevronsUpDown, Search } from 'lucide-react';
import { useFeatureFlags } from '../../contexts/FeatureFlagsContext';
import { useAuth } from '../../contexts/AuthContext';
import ThemedSelect from '../UI/Select';
import ThemedDate from '../UI/ThemedDate';

// The formatters, the CSV writer and the paged export fetch now live in
// utils/recordFormat.js + utils/exportSpec.js so every shell shares one copy
// (there were four separate downloadCSVs). They are re-exported here unchanged,
// so every `import { fmtDate, downloadCSV, fetchAllForExport } from './shared'`
// across the compliance tabs keeps working exactly as before.
export {
  STATUS_BADGE, STATUS_LABEL, fmtDate, fmtDateTime, timeAgo,
  customerName, closerName, downloadCSV,
} from '../../utils/recordFormat';
export { fetchAllForExport } from '../../utils/exportSpec';

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
  <th className={`px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider ${className}`}
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
    className={`px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap transition-colors hover:text-primary-600 ${className}`}
    style={{ color: sort.col === col ? 'var(--color-primary-600)' : 'var(--color-text-secondary)' }}>
    {children}<SortIcon col={col} sort={sort} />
  </th>
);

export const TabHeader = ({ title, subtitle, onRefresh, onExport, extra, exportArea }) => {
  const { isEnabled } = useFeatureFlags();
  const { canExport } = useAuth();
  return (
    /* Stacked below `sm`: side-by-side, the actions squeeze the title into a
       ~200px column and "All Sales" wraps across four lines at 390px. */
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-4 gap-3 sm:gap-4">
      <div className="min-w-0">
        <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}>
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm mt-1 max-w-2xl leading-relaxed m-0" style={{ color: 'var(--color-text-secondary)' }}>{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:flex-shrink-0">
        {extra}
        {onExport && isEnabled('exports') && canExport(exportArea) && (
          <button onClick={onExport}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold border transition-colors"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)' }}>
            <Download size={13} /> Export CSV
          </button>
        )}
        {onRefresh && (
          <button onClick={onRefresh} aria-label="Refresh"
            className="p-2 rounded-full border transition-colors"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)' }}>
            <RefreshCw size={15} />
          </button>
        )}
      </div>
    </div>
  );
};

// Filter/search bar — matches the FilterBar toolbar card so every tab (whether
// on the new FilterBar or this legacy Filters form) reads as one design.
export const Filters = ({ onSubmit, children }) => (
  <div className="rounded-2xl px-3 py-2.5 mb-4"
    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
    <form onSubmit={e => { e.preventDefault(); onSubmit?.(); }}
      className="flex flex-wrap gap-2.5 items-end">
      {children}
      <button type="submit"
        className="px-4 py-2 rounded-full text-sm font-bold text-white transition-transform active:scale-95"
        style={{ background: 'var(--gradient-sidebar)' }}>
        Apply
      </button>
    </form>
  </div>
);

// A filter text input. Pass `search` to get the pill + magnifier treatment
// used by the modern FilterBar; otherwise a plain labelled field.
export const FInput = ({ label, search = false, type, ...props }) => {
  const isDate = type === 'date' || type === 'datetime-local';
  return (
    <div className="flex flex-col gap-1 min-w-[140px]">
      {label && <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>}
      {isDate ? (
        <ThemedDate {...props} withTime={type === 'datetime-local'}
          style={{ borderRadius: 999, backgroundColor: 'var(--color-bg-secondary)', ...(props.style || {}) }} />
      ) : search ? (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />
          <input type={type} {...props} className="text-sm w-full outline-none"
            style={{ padding: '8px 12px 8px 34px', borderRadius: 999, backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
        </div>
      ) : (
        <input type={type} {...props} className="text-sm outline-none"
          style={{ padding: '8px 12px', borderRadius: 999, backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
      )}
    </div>
  );
};

export const FSelect = ({ label, children, ...props }) => (
  <div className="flex flex-col gap-1 min-w-[150px]">
    {label && <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>}
    <ThemedSelect variant="pill" {...props}>{children}</ThemedSelect>
  </div>
);

export const Overlay = ({ children }) => (
  <div className="fixed inset-0 z-50 overflow-y-auto"
    style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
    {/* No padding below `sm` — the box goes full-screen there. */}
    <div className="flex min-h-full items-center justify-center p-0 sm:p-4">
      {children}
    </div>
  </div>
);

// Full-screen sheet below `sm`, dialog at `sm`+ — same rule as UI/Modal, so the
// legacy Compliance modals and the kit ones behave identically on a phone.
export const ModalBox = ({ children, wide = false }) => (
  <div className={`w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} h-dvh sm:h-auto rounded-none sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col`}
    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: '100dvh' }}>
    {children}
  </div>
);

export const ModalHeader = ({ icon: Icon, title, subtitle, onClose }) => (
  <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 gap-3 flex-shrink-0"
    style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--gradient-sidebar)' }}>
    <div className="flex items-center gap-3 min-w-0">
      {Icon && <Icon size={18} className="text-white opacity-80 flex-shrink-0" />}
      <div className="min-w-0">
        <p className="text-base font-bold text-white truncate m-0">{title}</p>
        {subtitle && <p className="text-xs text-white opacity-70 truncate m-0">{subtitle}</p>}
      </div>
    </div>
    <button onClick={onClose} aria-label="Close"
      className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center flex-shrink-0 rounded-lg text-white opacity-70 hover:opacity-100">
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
