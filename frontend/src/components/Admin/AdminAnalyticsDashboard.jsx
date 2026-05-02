import { useState, useEffect, useCallback, useRef } from 'react';
import client from '../../api/client';
import { Card, Badge } from '../UI';
import { useDashboardStats } from '../../hooks/useDashboardStats';
import { getTransferDisplayStatus } from '../../utils/transferStatus';
import SaleDetailDrawer from '../Shared/SaleDetailDrawer';
import TransferDetailDrawer from '../Shared/TransferDetailDrawer';
import {
  Users, Building2, Activity, DollarSign, CheckCircle, Target, Shield, Layers,
  ChevronUp, ChevronDown, ChevronsUpDown, RefreshCw, X, Filter,
  Search, ArrowRight, TrendingUp,
} from 'lucide-react';

// ── Tiny sort-icon ────────────────────────────────────────────────────────────
const SortIcon = ({ col, sort }) => {
  if (sort.col !== col) return <ChevronsUpDown size={13} className="opacity-30 ml-1 inline-block" />;
  return sort.dir === 'asc'
    ? <ChevronUp   size={13} className="ml-1 inline-block" style={{ color: 'var(--color-primary-600)' }} />
    : <ChevronDown size={13} className="ml-1 inline-block" style={{ color: 'var(--color-primary-600)' }} />;
};

// ── Status badge maps ─────────────────────────────────────────────────────────
const SALE_BADGE = {
  open: 'info', sold: 'success', cancelled: 'error', follow_up: 'warning',
  closed_won: 'success', closed_lost: 'error',
  pending_review: 'warning', needs_revision: 'error',
};
const SALE_LABEL = {
  open: 'Open', sold: 'Sold', cancelled: 'Cancelled', follow_up: 'Follow Up',
  closed_won: 'Approved', closed_lost: 'Lost',
  pending_review: 'In Review', needs_revision: 'Needs Revision',
};
const XFER_BADGE = {
  pending: 'warning', assigned: 'info', completed: 'success',
  cancelled: 'error', rejected: 'error',
};

// ── Reusable sortable th ──────────────────────────────────────────────────────
const Th = ({ col, sort, onSort, children, className = '' }) => (
  <th
    onClick={() => onSort(col)}
    className={`text-left py-3 px-3 text-xs font-bold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap transition-colors hover:text-primary-600 ${className}`}
    style={{ color: sort.col === col ? 'var(--color-primary-600)' : 'var(--color-text-secondary)' }}
  >
    {children}<SortIcon col={col} sort={sort} />
  </th>
);

const LIMIT = 25;

// ── Main component ────────────────────────────────────────────────────────────
export default function AdminAnalyticsDashboard({ isReadOnly, user }) {
  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', companyId: '', closerId: '', status: '', search: '' });
  const [dataTab, setDataTab]   = useState('sales');
  const [sort, setSort]         = useState({ col: 'created_at', dir: 'desc' });
  const [page, setPage]         = useState(1);

  // ── Data state ────────────────────────────────────────────────────────────
  const [rows, setRows]         = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);

  // ── Dropdown options ─────────────────────────────────────────────────────
  const [companies, setCompanies] = useState([]);
  const [closers, setClosers]     = useState([]);

  // ── Detail drawers ────────────────────────────────────────────────────────
  const [detailSale, setDetailSale]         = useState(null);
  const [detailTransfer, setDetailTransfer] = useState(null);

  const debounceRef = useRef(null);

  // ── Bootstrap dropdowns ───────────────────────────────────────────────────
  useEffect(() => {
    fetchStats();
    client.get('compliance/companies').then(r => setCompanies(r.data.companies || [])).catch(() => {});
    client.get('compliance/users').then(r => {
      const all = r.data.users || [];
      const closerRoles = ['closer', 'closer_manager', 'compliance_manager', 'company_admin'];
      setClosers(all.filter(u => closerRoles.includes(u.role_level)));
    }).catch(() => {});
  }, []);

  // ── Fetch records ─────────────────────────────────────────────────────────
  const fetchRows = useCallback(async (overridePage) => {
    const p = overridePage ?? page;
    setLoading(true);
    try {
      if (dataTab === 'sales') {
        const params = {
          page: p, limit: LIMIT,
          ...(filters.companyId && { company_id: filters.companyId }),
          ...(filters.closerId  && { user_ids: filters.closerId }),
          ...(filters.status    && { status: filters.status }),
          ...(filters.dateFrom  && { date_from: filters.dateFrom }),
          ...(filters.dateTo    && { date_to: filters.dateTo }),
          ...(filters.search    && { search: filters.search }),
        };
        const r = await client.get('compliance/sales', { params });
        setRows(r.data.sales || []);
        setTotal(r.data.total || 0);
      } else {
        const params = {
          page: p, limit: LIMIT,
          ...(filters.companyId && { company_id: filters.companyId }),
          ...(filters.closerId  && { closer_id: filters.closerId }),
          ...(filters.status    && { status: filters.status }),
          ...(filters.dateFrom  && { date_from: filters.dateFrom }),
          ...(filters.dateTo    && { date_to: filters.dateTo }),
        };
        const r = await client.get('compliance/transfers', { params });
        setRows(r.data.transfers || []);
        setTotal(r.data.total || 0);
      }
    } catch {
      setRows([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [dataTab, filters, page]);

  // Debounce search field, immediate for others
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); fetchRows(1); }, filters.search ? 350 : 0);
  }, [filters, dataTab]);

  useEffect(() => { fetchRows(); }, [page]);

  // ── Sorting (client-side on loaded page) ─────────────────────────────────
  const toggleSort = (col) => {
    setSort(prev => ({ col, dir: prev.col === col && prev.dir === 'desc' ? 'asc' : 'desc' }));
  };

  const sorted = [...rows].sort((a, b) => {
    let av = a[sort.col], bv = b[sort.col];
    if (av == null) av = '';
    if (bv == null) bv = '';
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  const setFilter = (key, val) => setFilters(prev => ({ ...prev, [key]: val }));

  const clearFilters = () => {
    setFilters({ dateFrom: '', dateTo: '', companyId: '', closerId: '', status: '', search: '' });
  };

  const hasActiveFilters = Object.values(filters).some(Boolean);

  const totalPages = Math.ceil(total / LIMIT);

  // ── Metric cards ──────────────────────────────────────────────────────────
  const metrics = [
    { icon: Users,       label: 'Total Users',      value: stats.totalUsers,      sub: 'Active accounts',      accent: '#6366f1' },
    { icon: Building2,   label: 'Companies',         value: stats.totalCompanies,  sub: 'Registered',           accent: '#10b981' },
    { icon: Activity,    label: 'Transfers',         value: stats.totalTransfers,  sub: 'All time',             accent: '#f59e0b' },
    { icon: DollarSign,  label: 'Total Sales',       value: stats.totalSales,      sub: 'All closers',          accent: '#8b5cf6' },
    { icon: CheckCircle, label: 'Approved',          value: stats.closedWon,       sub: 'Closed won',           accent: '#10b981' },
    { icon: Target,      label: 'Conversion',        value: stats.conversionRate ? `${stats.conversionRate}%` : '0%', sub: 'Transfer → sale', accent: '#3b82f6' },
    { icon: TrendingUp,  label: 'Awaiting Review',   value: stats.awaitingCompliance, sub: 'Pending compliance', accent: '#f59e0b' },
    { icon: Layers,      label: 'Pending Transfers', value: stats.pendingTransfers, sub: 'Unassigned',          accent: '#ef4444' },
  ];

  const SALE_STATUSES = [
    { v: '',              l: 'All Statuses' },
    { v: 'open',          l: 'Open' },
    { v: 'pending_review',l: 'In Review' },
    { v: 'needs_revision',l: 'Needs Revision' },
    { v: 'closed_won',    l: 'Approved' },
    { v: 'closed_lost',   l: 'Lost' },
    { v: 'cancelled',     l: 'Cancelled' },
    { v: 'follow_up',     l: 'Follow Up' },
  ];
  const XFER_STATUSES = [
    { v: '',          l: 'All Statuses' },
    { v: 'pending',   l: 'Pending' },
    { v: 'assigned',  l: 'Assigned' },
    { v: 'completed', l: 'Completed' },
    { v: 'rejected',  l: 'Rejected' },
    { v: 'cancelled', l: 'Cancelled' },
  ];

  const inputStyle = {
    height: 36, padding: '0 10px', borderRadius: 8, fontSize: 13, fontWeight: 500,
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    outline: 'none',
  };
  const selectStyle = { ...inputStyle, paddingRight: 28, cursor: 'pointer' };

  return (
    <div className="animate-fade-in space-y-6">

      {/* ── Read-only banner ─────────────────────────────────────────────── */}
      {isReadOnly && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium"
          style={{ backgroundColor: 'var(--color-warning-50)', border: '1px solid var(--color-warning-200)', color: 'var(--color-warning-700)' }}>
          <Shield size={16} />
          Read-only admin — you can view all data but cannot create or modify records.
        </div>
      )}

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text">Good day, {user?.first_name || 'Admin'}</h2>
          <p className="text-text-secondary mt-0.5 text-sm">System overview across all companies</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { fetchStats(); fetchRows(1); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all hover:scale-105"
            style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
            <RefreshCw size={13} className={loading || statsLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <span className="text-xs text-text-tertiary hidden sm:block">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </span>
        </div>
      </div>

      {/* ── Metric cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {metrics.map((m, i) => (
          <div key={i}
            className="rounded-2xl p-5 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 cursor-default"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
            <div className="flex items-start justify-between mb-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${m.accent}18` }}>
                <m.icon size={18} style={{ color: m.accent }} />
              </div>
              {!statsLoading && <div className="w-2 h-2 rounded-full mt-1" style={{ backgroundColor: m.accent }} />}
            </div>
            <p className="text-2xl font-bold text-text mb-0.5">
              {statsLoading ? <span className="opacity-30">—</span> : (m.value ?? 0)}
            </p>
            <p className="text-xs font-semibold text-text truncate">{m.label}</p>
            <p className="text-xs text-text-tertiary truncate">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Sales pipeline bar ───────────────────────────────────────────── */}
      {!statsLoading && ((stats.closedWon || 0) + (stats.closedLost || 0)) > 0 && (
        <div className="rounded-2xl p-5"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-bold text-text text-sm">Sales Pipeline</h3>
              <p className="text-xs text-text-secondary">Won · Open · Lost breakdown</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              {[
                { label: 'Won',  val: stats.closedWon  || 0, cls: 'bg-success-500', color: 'var(--color-success-600)' },
                { label: 'Open', val: stats.openSales  || 0, cls: 'bg-info-500',    color: 'var(--color-info-600)'    },
                { label: 'Lost', val: stats.closedLost || 0, cls: 'bg-error-500',   color: 'var(--color-error-600)'   },
              ].map(s => (
                <span key={s.label} className="flex items-center gap-1.5">
                  <div className={`w-2.5 h-2.5 rounded-full ${s.cls}`} />
                  <span className="text-text-secondary">{s.label} <strong style={{ color: s.color }}>{s.val}</strong></span>
                </span>
              ))}
            </div>
          </div>
          <div className="w-full h-3 rounded-full overflow-hidden flex gap-0.5"
            style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            {(() => {
              const total = (stats.closedWon || 0) + (stats.closedLost || 0) + (stats.openSales || 0);
              return total > 0 ? (
                <>
                  <div className="h-full rounded-l-full bg-success-500 transition-all"
                    style={{ width: `${((stats.closedWon || 0) / total) * 100}%` }} />
                  <div className="h-full bg-info-500 transition-all"
                    style={{ width: `${((stats.openSales || 0) / total) * 100}%` }} />
                  <div className="h-full rounded-r-full bg-error-500 transition-all"
                    style={{ width: `${((stats.closedLost || 0) / total) * 100}%` }} />
                </>
              ) : <div className="h-full w-full rounded-full" style={{ backgroundColor: 'var(--color-border)' }} />;
            })()}
          </div>
        </div>
      )}

      {/* ── Advanced filter bar ───────────────────────────────────────────── */}
      <div className="rounded-2xl p-4"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} style={{ color: 'var(--color-primary-600)' }} />
          <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-primary-600)' }}>
            Filters
          </span>
          {hasActiveFilters && (
            <button onClick={clearFilters}
              className="flex items-center gap-1 ml-auto px-2 py-1 rounded-lg text-xs font-semibold transition-all hover:scale-105"
              style={{ backgroundColor: 'var(--color-error-50)', color: 'var(--color-error-600)', border: '1px solid var(--color-error-200)' }}>
              <X size={11} /> Clear all
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Date range */}
          <div className="flex items-center gap-1">
            <input type="date" value={filters.dateFrom} onChange={e => setFilter('dateFrom', e.target.value)}
              style={inputStyle} placeholder="From" />
            <ArrowRight size={12} style={{ color: 'var(--color-text-tertiary)' }} />
            <input type="date" value={filters.dateTo} onChange={e => setFilter('dateTo', e.target.value)}
              style={inputStyle} placeholder="To" />
          </div>

          {/* Company */}
          <select value={filters.companyId} onChange={e => setFilter('companyId', e.target.value)}
            style={{ ...selectStyle, minWidth: 160 }}>
            <option value="">All Companies</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.company_type})</option>
            ))}
          </select>

          {/* Closer */}
          <select value={filters.closerId} onChange={e => setFilter('closerId', e.target.value)}
            style={{ ...selectStyle, minWidth: 150 }}>
            <option value="">All Closers</option>
            {closers.map(u => (
              <option key={u.user_id} value={u.user_id}>{u.full_name} — {u.company_name || '?'}</option>
            ))}
          </select>

          {/* Status */}
          <select value={filters.status} onChange={e => setFilter('status', e.target.value)}
            style={{ ...selectStyle, minWidth: 130 }}>
            {(dataTab === 'sales' ? SALE_STATUSES : XFER_STATUSES).map(s => (
              <option key={s.v} value={s.v}>{s.l}</option>
            ))}
          </select>

          {/* Search (sales only) */}
          {dataTab === 'sales' && (
            <div className="relative flex items-center">
              <Search size={13} className="absolute left-2.5 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />
              <input
                type="text"
                value={filters.search}
                onChange={e => setFilter('search', e.target.value)}
                placeholder="Name / phone / ref…"
                style={{ ...inputStyle, paddingLeft: 28, minWidth: 180 }}
              />
              {filters.search && (
                <button onClick={() => setFilter('search', '')}
                  className="absolute right-2" style={{ color: 'var(--color-text-tertiary)' }}>
                  <X size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Data section ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>

        {/* Tab bar + result count */}
        <div className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <div className="flex gap-1">
            {[
              { key: 'sales',     label: 'Sales',     icon: DollarSign },
              { key: 'transfers', label: 'Transfers', icon: Activity   },
            ].map(t => (
              <button key={t.key}
                onClick={() => { setDataTab(t.key); setPage(1); setSort({ col: 'created_at', dir: 'desc' }); setFilter('status', ''); }}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
                style={{
                  background: dataTab === t.key ? 'var(--gradient-sidebar)' : 'transparent',
                  color: dataTab === t.key ? 'white' : 'var(--color-text-secondary)',
                  boxShadow: dataTab === t.key ? 'var(--shadow-sm)' : 'none',
                }}>
                <t.icon size={14} /> {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {loading && <RefreshCw size={14} className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />}
            <span className="text-xs text-text-tertiary">
              {total.toLocaleString()} record{total !== 1 ? 's' : ''}
              {total > LIMIT ? ` · page ${page} of ${totalPages}` : ''}
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {dataTab === 'sales' ? (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <Th col="customer_name"   sort={sort} onSort={toggleSort}>Customer</Th>
                  <Th col="reference_no"    sort={sort} onSort={toggleSort}>Reference</Th>
                  <Th col="status"          sort={sort} onSort={toggleSort}>Status</Th>
                  <Th col="closer_name"     sort={sort} onSort={toggleSort}>Closer</Th>
                  <Th col="company_id"      sort={sort} onSort={toggleSort}>Company</Th>
                  <Th col="plan"            sort={sort} onSort={toggleSort}>Plan</Th>
                  <Th col="monthly_payment" sort={sort} onSort={toggleSort}>Monthly</Th>
                  <Th col="sale_date"       sort={sort} onSort={toggleSort}>Sale Date</Th>
                  <Th col="created_at"      sort={sort} onSort={toggleSort}>Created</Th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      {Array.from({ length: 9 }).map((_, j) => (
                        <td key={j} className="py-3 px-3">
                          <div className="h-3 rounded animate-pulse" style={{ backgroundColor: 'var(--color-border)', width: j === 0 ? 120 : 70 }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-text-secondary text-sm">
                      No sales match the current filters.
                    </td>
                  </tr>
                ) : (
                  sorted.map(s => (
                    <tr key={s.id}
                      onClick={() => setDetailSale(s)}
                      className="cursor-pointer transition-colors hover:bg-bg-secondary group"
                      style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td className="py-3 px-3">
                        <p className="font-semibold text-text group-hover:text-primary-600 transition-colors">{s.customer_name || '—'}</p>
                        {s.customer_phone && <p className="text-xs text-text-tertiary mt-0.5">{s.customer_phone}</p>}
                      </td>
                      <td className="py-3 px-3 font-mono text-xs text-text-tertiary">{s.reference_no || '—'}</td>
                      <td className="py-3 px-3">
                        <Badge variant={SALE_BADGE[s.status] || 'secondary'} size="sm">
                          {SALE_LABEL[s.status] || s.status || '—'}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 text-text-secondary text-xs">
                        {s.closer_name || (s.user_profiles ? `${s.user_profiles.first_name || ''} ${s.user_profiles.last_name || ''}`.trim() : '—')}
                      </td>
                      <td className="py-3 px-3 text-text-secondary text-xs">
                        {s.companies?.name || '—'}
                        {s.companies?.company_type && (
                          <span className="ml-1 opacity-50 text-xs">({s.companies.company_type})</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-text-secondary text-xs">{s.plan || '—'}</td>
                      <td className="py-3 px-3 text-xs font-semibold" style={{ color: s.monthly_payment ? 'var(--color-success-600)' : 'var(--color-text-tertiary)' }}>
                        {s.monthly_payment ? `$${Number(s.monthly_payment).toLocaleString()}/mo` : '—'}
                      </td>
                      <td className="py-3 px-3 text-xs text-text-secondary">
                        {s.sale_date ? new Date(s.sale_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 px-3 text-xs text-text-secondary whitespace-nowrap">
                        {new Date(s.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <Th col="form_data"            sort={sort} onSort={toggleSort}>Customer</Th>
                  <Th col="status"               sort={sort} onSort={toggleSort}>Transfer</Th>
                  <Th col="sale_status"          sort={sort} onSort={toggleSort}>Sale Status</Th>
                  <Th col="created_by_name"      sort={sort} onSort={toggleSort}>Fronter</Th>
                  <Th col="assigned_closer_name" sort={sort} onSort={toggleSort}>Closer</Th>
                  <Th col="company_name"         sort={sort} onSort={toggleSort}>Company</Th>
                  <Th col="sale_reference_no"    sort={sort} onSort={toggleSort}>Sale Ref</Th>
                  <Th col="created_at"           sort={sort} onSort={toggleSort}>Created</Th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="py-3 px-3">
                          <div className="h-3 rounded animate-pulse" style={{ backgroundColor: 'var(--color-border)', width: j === 0 ? 120 : 70 }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-text-secondary text-sm">
                      No transfers match the current filters.
                    </td>
                  </tr>
                ) : (
                  sorted.map(t => {
                    const fd = t.form_data || {};
                    const name = fd.customer_name || (fd.FirstName ? `${fd.FirstName} ${fd.LastName || ''}`.trim() : null) || '—';
                    const phone = fd.customer_phone || fd.Phone || null;
                    const ds = getTransferDisplayStatus(t);
                    return (
                      <tr key={t.id}
                        onClick={() => setDetailTransfer(t)}
                        className="cursor-pointer transition-colors hover:bg-bg-secondary group"
                        style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="py-3 px-3">
                          <p className="font-semibold text-text group-hover:text-primary-600 transition-colors">{name}</p>
                          {phone && <p className="text-xs text-text-tertiary mt-0.5">{phone}</p>}
                        </td>
                        <td className="py-3 px-3">
                          <Badge variant={XFER_BADGE[t.status] || 'secondary'} size="sm">
                            {t.status || '—'}
                          </Badge>
                        </td>
                        <td className="py-3 px-3">
                          {t.sale_status
                            ? <Badge variant={ds.variant} size="sm">{ds.label}</Badge>
                            : <span className="text-xs text-text-tertiary">No sale</span>}
                        </td>
                        <td className="py-3 px-3 text-xs text-text-secondary">{t.created_by_name || '—'}</td>
                        <td className="py-3 px-3 text-xs text-text-secondary">{t.assigned_closer_name || <span className="text-text-tertiary">Unassigned</span>}</td>
                        <td className="py-3 px-3 text-xs text-text-secondary">{t.company_name || '—'}</td>
                        <td className="py-3 px-3 font-mono text-xs text-text-tertiary">{t.sale_reference_no || '—'}</td>
                        <td className="py-3 px-3 text-xs text-text-secondary whitespace-nowrap">
                          {new Date(t.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-bg-secondary"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
              ← Previous
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                let p;
                if (totalPages <= 7) { p = i + 1; }
                else if (page <= 4) { p = i + 1; }
                else if (page >= totalPages - 3) { p = totalPages - 6 + i; }
                else { p = page - 3 + i; }
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className="w-7 h-7 rounded-lg text-xs font-semibold transition-all"
                    style={{
                      background: p === page ? 'var(--gradient-sidebar)' : 'transparent',
                      color: p === page ? 'white' : 'var(--color-text-secondary)',
                      border: p === page ? 'none' : '1px solid var(--color-border)',
                    }}>
                    {p}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-bg-secondary"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
              Next →
            </button>
          </div>
        )}
      </div>

      {/* ── Quick Actions ─────────────────────────────────────────────────── */}
      {!isReadOnly && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'Companies',    desc: 'Manage companies, members & roles', accent: '#10b981', tab: 'companies'   },
            { label: 'Form Builder', desc: 'Customize transfer & sale fields',   accent: '#8b5cf6', tab: 'forms'       },
            { label: 'Sale Search',  desc: 'Search all sale records by any field',accent: '#6366f1', tab: 'sale-search' },
          ].map(a => (
            <button key={a.tab} className="text-left p-4 rounded-2xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 group"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
              onClick={() => { document.dispatchEvent(new CustomEvent('admin-nav', { detail: a.tab })); }}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-2 transition-transform group-hover:scale-110"
                style={{ backgroundColor: `${a.accent}18` }}>
                <DollarSign size={16} style={{ color: a.accent }} />
              </div>
              <p className="font-semibold text-sm text-text">{a.label}</p>
              <p className="text-xs text-text-secondary mt-0.5 leading-snug">{a.desc}</p>
            </button>
          ))}
        </div>
      )}

      {/* ── Detail drawers ────────────────────────────────────────────────── */}
      {detailSale     && <SaleDetailDrawer     sale={detailSale}         onClose={() => setDetailSale(null)}     />}
      {detailTransfer && <TransferDetailDrawer transfer={detailTransfer} onClose={() => setDetailTransfer(null)} />}
    </div>
  );
}
