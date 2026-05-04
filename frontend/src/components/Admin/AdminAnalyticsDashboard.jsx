import { useState, useEffect, useCallback, useRef } from 'react';
import client from '../../api/client';
import { Badge } from '../UI';
import { useDashboardStats } from '../../hooks/useDashboardStats';
import { getTransferDisplayStatus } from '../../utils/transferStatus';
import SaleDetailDrawer from '../Shared/SaleDetailDrawer';
import TransferDetailDrawer from '../Shared/TransferDetailDrawer';
import {
  Users, Building2, Activity, DollarSign, CheckCircle, Target, Shield, Layers,
  ChevronUp, ChevronDown, ChevronsUpDown, RefreshCw, X, Filter,
  Search, ArrowRight, TrendingUp,
} from 'lucide-react';

// ─── Sort icon ───────────────────────────────────────────────────────────────
const SortIcon = ({ col, sort }) => {
  if (sort.col !== col) return <ChevronsUpDown size={11} className="opacity-30 ml-0.5 inline-block" />;
  return sort.dir === 'asc'
    ? <ChevronUp   size={11} className="ml-0.5 inline-block" style={{ color: 'var(--color-primary-600)' }} />
    : <ChevronDown size={11} className="ml-0.5 inline-block" style={{ color: 'var(--color-primary-600)' }} />;
};

const SALE_BADGE  = { open:'info', sold:'success', cancelled:'error', follow_up:'warning', closed_won:'success', closed_lost:'error', pending_review:'warning', needs_revision:'error' };
const SALE_LABEL  = { open:'Open', sold:'Sold', cancelled:'Cancelled', follow_up:'Follow Up', closed_won:'Approved', closed_lost:'Lost', pending_review:'In Review', needs_revision:'Needs Revision' };
const XFER_BADGE  = { pending:'warning', assigned:'info', completed:'success', cancelled:'error', rejected:'error' };

const Th = ({ col, sort, onSort, children }) => (
  <th onClick={() => onSort(col)}
    className="text-left py-2 px-2.5 text-xs font-bold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap transition-colors hover:text-primary-600"
    style={{ color: sort.col === col ? 'var(--color-primary-600)' : 'var(--color-text-secondary)' }}>
    {children}<SortIcon col={col} sort={sort} />
  </th>
);

// ─── Mini calendar with today's stats ────────────────────────────────────────
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_ABBR = ['S','M','T','W','T','F','S'];

function MiniCalendar({ todaySales, todayXfers, todayLoading }) {
  const now   = new Date();
  const yr    = now.getFullYear();
  const mo    = now.getMonth();
  const today = now.getDate();

  const firstDow     = new Date(yr, mo, 1).getDay();
  const daysInMonth  = new Date(yr, mo + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="rounded-xl p-3 h-full flex flex-col"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

      {/* Month header */}
      <p className="text-xs font-bold text-center mb-2 text-text">
        {MONTHS[mo]} {yr}
      </p>

      {/* Day-of-week labels */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_ABBR.map((d, i) => (
          <span key={i} className="text-center text-[10px] font-semibold"
            style={{ color: 'var(--color-text-tertiary)' }}>{d}</span>
        ))}
      </div>

      {/* Date grid */}
      <div className="grid grid-cols-7 gap-px flex-1">
        {cells.map((d, i) => (
          <div key={i}
            className="flex items-center justify-center rounded-md text-[11px] transition-colors"
            style={{
              aspectRatio: '1',
              background: d === today ? 'var(--gradient-sidebar)' : 'transparent',
              color: d === today ? '#fff' : d ? 'var(--color-text-secondary)' : 'transparent',
              fontWeight: d === today ? 700 : 400,
            }}>
            {d || ''}
          </div>
        ))}
      </div>

      {/* Divider */}
      <div className="my-2.5 border-t" style={{ borderColor: 'var(--color-border)' }} />

      {/* Today stats */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
          Today · {now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </p>
        {[
          { label: 'New Sales',     val: todaySales, color: '#8b5cf6' },
          { label: 'New Transfers', val: todayXfers,  color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">{s.label}</span>
            <span className="text-xs font-bold tabular-nums"
              style={{ color: todayLoading ? 'var(--color-text-tertiary)' : s.color }}>
              {todayLoading ? '…' : s.val}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const LIMIT = 25;
const TODAY = new Date().toISOString().split('T')[0];

// ─── Main ────────────────────────────────────────────────────────────────────
export default function AdminAnalyticsDashboard({ isReadOnly, user }) {
  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();

  const [filters, setFilters]       = useState({ dateFrom: '', dateTo: '', companyId: '', closerId: '', status: '', search: '' });
  const [dataTab, setDataTab]       = useState('sales');
  const [sort, setSort]             = useState({ col: 'created_at', dir: 'desc' });
  const [page, setPage]             = useState(1);
  const [rows, setRows]             = useState([]);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(false);
  const [companies, setCompanies]   = useState([]);
  const [closers, setClosers]       = useState([]);
  const [detailSale, setDetailSale]             = useState(null);
  const [detailTransfer, setDetailTransfer]     = useState(null);
  const [todaySales, setTodaySales]             = useState(0);
  const [todayXfers, setTodayXfers]             = useState(0);
  const [todayLoading, setTodayLoading]         = useState(true);
  const debounceRef = useRef(null);

  // Bootstrap
  useEffect(() => {
    fetchStats();
    client.get('compliance/companies').then(r => setCompanies(r.data.companies || [])).catch(() => {});
    client.get('compliance/users').then(r => {
      const all = r.data.users || [];
      setClosers(all.filter(u => ['closer','closer_manager','compliance_manager','company_admin'].includes(u.role_level)));
    }).catch(() => {});

    // Today's counts
    const todayParams = { date_from: TODAY, date_to: TODAY, limit: 1, page: 1 };
    Promise.all([
      client.get('compliance/sales',     { params: todayParams }),
      client.get('compliance/transfers', { params: todayParams }),
    ]).then(([sr, tr]) => {
      setTodaySales(sr.data.total || 0);
      setTodayXfers(tr.data.total || 0);
    }).catch(() => {}).finally(() => setTodayLoading(false));
  }, []);

  const fetchRows = useCallback(async (overridePage) => {
    const p = overridePage ?? page;
    setLoading(true);
    try {
      if (dataTab === 'sales') {
        const params = { page: p, limit: LIMIT,
          ...(filters.companyId && { company_id: filters.companyId }),
          ...(filters.closerId  && { user_ids: filters.closerId }),
          ...(filters.status    && { status: filters.status }),
          ...(filters.dateFrom  && { date_from: filters.dateFrom }),
          ...(filters.dateTo    && { date_to: filters.dateTo }),
          ...(filters.search    && { search: filters.search }),
        };
        const r = await client.get('compliance/sales', { params });
        setRows(r.data.sales || []); setTotal(r.data.total || 0);
      } else {
        const params = { page: p, limit: LIMIT,
          ...(filters.companyId && { company_id: filters.companyId }),
          ...(filters.closerId  && { closer_id: filters.closerId }),
          ...(filters.status    && { status: filters.status }),
          ...(filters.dateFrom  && { date_from: filters.dateFrom }),
          ...(filters.dateTo    && { date_to: filters.dateTo }),
        };
        const r = await client.get('compliance/transfers', { params });
        setRows(r.data.transfers || []); setTotal(r.data.total || 0);
      }
    } catch { setRows([]); setTotal(0); }
    finally { setLoading(false); }
  }, [dataTab, filters, page]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); fetchRows(1); }, filters.search ? 350 : 0);
  }, [filters, dataTab]);

  useEffect(() => { fetchRows(); }, [page]);

  const toggleSort = col => setSort(p => ({ col, dir: p.col === col && p.dir === 'desc' ? 'asc' : 'desc' }));

  const sorted = [...rows].sort((a, b) => {
    let av = a[sort.col] ?? '', bv = b[sort.col] ?? '';
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  const setFilter = (k, v) => setFilters(p => ({ ...p, [k]: v }));
  const clearFilters = () => setFilters({ dateFrom:'', dateTo:'', companyId:'', closerId:'', status:'', search:'' });
  const hasActiveFilters = Object.values(filters).some(Boolean);
  const totalPages = Math.ceil(total / LIMIT);

  const metrics = [
    { icon: Users,       label: 'Users',           value: stats.totalUsers,      accent: '#6366f1' },
    { icon: Building2,   label: 'Companies',        value: stats.totalCompanies,  accent: '#10b981' },
    { icon: Activity,    label: 'Transfers',        value: stats.totalTransfers,  accent: '#f59e0b' },
    { icon: DollarSign,  label: 'Total Sales',      value: stats.totalSales,      accent: '#8b5cf6' },
    { icon: CheckCircle, label: 'Approved',         value: stats.closedWon,       accent: '#10b981' },
    { icon: Target,      label: 'Conversion',       value: stats.conversionRate ? `${stats.conversionRate}%` : '0%', accent: '#3b82f6' },
    { icon: TrendingUp,  label: 'In Review',        value: stats.awaitingCompliance, accent: '#f59e0b' },
    { icon: Layers,      label: 'Pending Xfers',    value: stats.pendingTransfers, accent: '#ef4444' },
  ];

  const SALE_STATUSES = [
    {v:'',l:'All'},{v:'open',l:'Open'},{v:'pending_review',l:'In Review'},
    {v:'needs_revision',l:'Needs Revision'},{v:'closed_won',l:'Approved'},
    {v:'closed_lost',l:'Lost'},{v:'cancelled',l:'Cancelled'},{v:'follow_up',l:'Follow Up'},
  ];
  const XFER_STATUSES = [
    {v:'',l:'All'},{v:'pending',l:'Pending'},{v:'assigned',l:'Assigned'},
    {v:'completed',l:'Completed'},{v:'rejected',l:'Rejected'},{v:'cancelled',l:'Cancelled'},
  ];

  const inp = {
    height: 30, padding: '0 8px', borderRadius: 7, fontSize: 12, fontWeight: 500,
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)', outline: 'none',
  };
  const sel = { ...inp, paddingRight: 22, cursor: 'pointer' };

  return (
    <div className="animate-fade-in space-y-4">

      {isReadOnly && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
          style={{ backgroundColor: 'var(--color-warning-50)', border: '1px solid var(--color-warning-200)', color: 'var(--color-warning-700)' }}>
          <Shield size={13} />
          Read-only admin — view only, no modifications.
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-text">Good day, {user?.first_name || 'Admin'}</h2>
          <p className="text-text-secondary text-xs mt-0.5">System overview across all companies</p>
        </div>
        <button onClick={() => { fetchStats(); fetchRows(1); }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105"
          style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
          <RefreshCw size={12} className={loading || statsLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* ── Metrics + Calendar row ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-3">

        {/* Metric cards */}
        <div className="grid grid-cols-4 gap-2">
          {metrics.map((m, i) => (
            <div key={i}
              className="rounded-xl p-3 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 cursor-default"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${m.accent}18` }}>
                  <m.icon size={13} style={{ color: m.accent }} />
                </div>
                {!statsLoading && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.accent }} />}
              </div>
              <p className="text-lg font-bold text-text leading-none mb-0.5">
                {statsLoading ? <span className="opacity-30">—</span> : (m.value ?? 0)}
              </p>
              <p className="text-[11px] text-text-secondary truncate">{m.label}</p>
            </div>
          ))}
        </div>

        {/* Mini calendar */}
        <MiniCalendar todaySales={todaySales} todayXfers={todayXfers} todayLoading={todayLoading} />
      </div>

      {/* ── Pipeline bar ────────────────────────────────────────────────── */}
      {!statsLoading && ((stats.closedWon || 0) + (stats.closedLost || 0)) > 0 && (
        <div className="rounded-xl p-3 flex items-center gap-4"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex-shrink-0">
            <p className="text-xs font-bold text-text">Pipeline</p>
            <p className="text-[10px] text-text-tertiary">Won · Open · Lost</p>
          </div>
          <div className="flex items-center gap-3 text-[11px] flex-shrink-0">
            {[
              { l:'Won',  v: stats.closedWon  ||0, cls:'bg-success-500', c:'var(--color-success-600)' },
              { l:'Open', v: stats.openSales  ||0, cls:'bg-info-500',    c:'var(--color-info-600)'    },
              { l:'Lost', v: stats.closedLost ||0, cls:'bg-error-500',   c:'var(--color-error-600)'   },
            ].map(s => (
              <span key={s.l} className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${s.cls}`} />
                <span className="text-text-secondary">{s.l} <strong style={{ color: s.c }}>{s.v}</strong></span>
              </span>
            ))}
          </div>
          <div className="flex-1 h-2 rounded-full overflow-hidden flex gap-px"
            style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            {(() => {
              const t = (stats.closedWon||0)+(stats.closedLost||0)+(stats.openSales||0);
              return t > 0 ? (
                <>
                  <div className="h-full rounded-l-full bg-success-500" style={{ width:`${((stats.closedWon||0)/t)*100}%` }} />
                  <div className="h-full bg-info-500"                   style={{ width:`${((stats.openSales||0)/t)*100}%` }} />
                  <div className="h-full rounded-r-full bg-error-500"   style={{ width:`${((stats.closedLost||0)/t)*100}%` }} />
                </>
              ) : <div className="h-full w-full rounded-full" style={{ backgroundColor: 'var(--color-border)' }} />;
            })()}
          </div>
        </div>
      )}

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="rounded-xl px-3 py-2.5"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={12} style={{ color: 'var(--color-primary-600)', flexShrink: 0 }} />

          {/* Date range */}
          <input type="date" value={filters.dateFrom} onChange={e => setFilter('dateFrom', e.target.value)} style={inp} />
          <ArrowRight size={10} style={{ color: 'var(--color-text-tertiary)' }} />
          <input type="date" value={filters.dateTo} onChange={e => setFilter('dateTo', e.target.value)} style={inp} />

          {/* Company */}
          <select value={filters.companyId} onChange={e => setFilter('companyId', e.target.value)}
            style={{ ...sel, minWidth: 140 }}>
            <option value="">All Companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name} ({c.company_type})</option>)}
          </select>

          {/* Closer */}
          <select value={filters.closerId} onChange={e => setFilter('closerId', e.target.value)}
            style={{ ...sel, minWidth: 140 }}>
            <option value="">All Closers</option>
            {closers.map(u => <option key={u.user_id} value={u.user_id}>{u.full_name} — {u.company_name||'?'}</option>)}
          </select>

          {/* Status */}
          <select value={filters.status} onChange={e => setFilter('status', e.target.value)}
            style={{ ...sel, minWidth: 110 }}>
            {(dataTab==='sales' ? SALE_STATUSES : XFER_STATUSES).map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>

          {/* Search */}
          {dataTab === 'sales' && (
            <div className="relative flex items-center">
              <Search size={11} className="absolute left-2 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />
              <input type="text" value={filters.search} onChange={e => setFilter('search', e.target.value)}
                placeholder="Search…" style={{ ...inp, paddingLeft: 22, minWidth: 150 }} />
              {filters.search && (
                <button onClick={() => setFilter('search', '')} className="absolute right-1.5"
                  style={{ color: 'var(--color-text-tertiary)' }}><X size={10} /></button>
              )}
            </div>
          )}

          {hasActiveFilters && (
            <button onClick={clearFilters}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold ml-auto transition-all hover:scale-105"
              style={{ backgroundColor: 'var(--color-error-50)', color: 'var(--color-error-600)', border: '1px solid var(--color-error-200)' }}>
              <X size={10} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Data table ──────────────────────────────────────────────────── */}
      <div className="rounded-xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

        {/* Tab bar */}
        <div className="flex items-center justify-between px-3 py-2 border-b"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <div className="flex gap-1">
            {[
              { key:'sales',     label:'Sales',     icon: DollarSign },
              { key:'transfers', label:'Transfers', icon: Activity   },
            ].map(t => (
              <button key={t.key}
                onClick={() => { setDataTab(t.key); setPage(1); setSort({col:'created_at',dir:'desc'}); setFilter('status',''); }}
                className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: dataTab===t.key ? 'var(--gradient-sidebar)' : 'transparent',
                  color: dataTab===t.key ? 'white' : 'var(--color-text-secondary)',
                }}>
                <t.icon size={12} />{t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {loading && <RefreshCw size={12} className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />}
            <span className="text-[11px] text-text-tertiary">
              {total.toLocaleString()} record{total!==1?'s':''}
              {total > LIMIT ? ` · p${page}/${totalPages}` : ''}
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {dataTab === 'sales' ? (
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <Th col="customer_name"   sort={sort} onSort={toggleSort}>Customer</Th>
                  <Th col="reference_no"    sort={sort} onSort={toggleSort}>Ref</Th>
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
                {loading && rows.length===0 ? (
                  Array.from({length:8}).map((_,i) => (
                    <tr key={i} style={{ borderBottom:'1px solid var(--color-border)' }}>
                      {Array.from({length:9}).map((_,j) => (
                        <td key={j} className="py-2 px-2.5">
                          <div className="h-2.5 rounded animate-pulse" style={{ backgroundColor:'var(--color-border)', width: j===0?100:60 }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : sorted.length===0 ? (
                  <tr><td colSpan={9} className="py-10 text-center text-text-secondary text-xs">No sales match the current filters.</td></tr>
                ) : (
                  sorted.map(s => (
                    <tr key={s.id} onClick={() => setDetailSale(s)}
                      className="cursor-pointer transition-colors hover:bg-bg-secondary group"
                      style={{ borderBottom:'1px solid var(--color-border)' }}>
                      <td className="py-2 px-2.5">
                        <p className="font-semibold text-text group-hover:text-primary-600 transition-colors leading-tight">{s.customer_name||'—'}</p>
                        {s.customer_phone && <p className="text-[10px] text-text-tertiary">{s.customer_phone}</p>}
                      </td>
                      <td className="py-2 px-2.5 font-mono text-[10px] text-text-tertiary">{s.reference_no||'—'}</td>
                      <td className="py-2 px-2.5">
                        <Badge variant={SALE_BADGE[s.status]||'secondary'} size="sm">{SALE_LABEL[s.status]||s.status||'—'}</Badge>
                      </td>
                      <td className="py-2 px-2.5 text-text-secondary">{s.closer_name||(s.user_profiles?`${s.user_profiles.first_name||''} ${s.user_profiles.last_name||''}`.trim():'—')}</td>
                      <td className="py-2 px-2.5 text-text-secondary">
                        {s.companies?.name||'—'}
                        {s.companies?.company_type && <span className="ml-1 opacity-40">({s.companies.company_type})</span>}
                      </td>
                      <td className="py-2 px-2.5 text-text-secondary">{s.plan||'—'}</td>
                      <td className="py-2 px-2.5 font-semibold" style={{ color: s.monthly_payment?'var(--color-success-600)':'var(--color-text-tertiary)' }}>
                        {s.monthly_payment ? `$${Number(s.monthly_payment).toLocaleString()}/mo` : '—'}
                      </td>
                      <td className="py-2 px-2.5 text-text-secondary whitespace-nowrap">
                        {s.sale_date ? new Date(s.sale_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-2 px-2.5 text-text-secondary whitespace-nowrap">
                        {new Date(s.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom:'1px solid var(--color-border)', backgroundColor:'var(--color-bg-secondary)' }}>
                  <Th col="form_data"            sort={sort} onSort={toggleSort}>Customer</Th>
                  <Th col="status"               sort={sort} onSort={toggleSort}>Transfer</Th>
                  <Th col="sale_status"          sort={sort} onSort={toggleSort}>Sale</Th>
                  <Th col="created_by_name"      sort={sort} onSort={toggleSort}>Fronter</Th>
                  <Th col="assigned_closer_name" sort={sort} onSort={toggleSort}>Closer</Th>
                  <Th col="company_name"         sort={sort} onSort={toggleSort}>Company</Th>
                  <Th col="sale_reference_no"    sort={sort} onSort={toggleSort}>Sale Ref</Th>
                  <Th col="created_at"           sort={sort} onSort={toggleSort}>Created</Th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length===0 ? (
                  Array.from({length:8}).map((_,i) => (
                    <tr key={i} style={{ borderBottom:'1px solid var(--color-border)' }}>
                      {Array.from({length:8}).map((_,j) => (
                        <td key={j} className="py-2 px-2.5">
                          <div className="h-2.5 rounded animate-pulse" style={{ backgroundColor:'var(--color-border)', width: j===0?100:60 }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : sorted.length===0 ? (
                  <tr><td colSpan={8} className="py-10 text-center text-text-secondary text-xs">No transfers match the current filters.</td></tr>
                ) : (
                  sorted.map(t => {
                    const fd = t.form_data||{};
                    const name = fd.customer_name||(fd.FirstName?`${fd.FirstName} ${fd.LastName||''}`.trim():null)||'—';
                    const phone = fd.customer_phone||fd.Phone||null;
                    const ds = getTransferDisplayStatus(t);
                    return (
                      <tr key={t.id} onClick={() => setDetailTransfer(t)}
                        className="cursor-pointer transition-colors hover:bg-bg-secondary group"
                        style={{ borderBottom:'1px solid var(--color-border)' }}>
                        <td className="py-2 px-2.5">
                          <p className="font-semibold text-text group-hover:text-primary-600 transition-colors leading-tight">{name}</p>
                          {phone && <p className="text-[10px] text-text-tertiary">{phone}</p>}
                        </td>
                        <td className="py-2 px-2.5">
                          <Badge variant={XFER_BADGE[t.status]||'secondary'} size="sm">{t.status||'—'}</Badge>
                        </td>
                        <td className="py-2 px-2.5">
                          {t.sale_status
                            ? <Badge variant={ds.variant} size="sm">{ds.label}</Badge>
                            : <span className="text-text-tertiary text-[10px]">—</span>}
                        </td>
                        <td className="py-2 px-2.5 text-text-secondary">{t.created_by_name||'—'}</td>
                        <td className="py-2 px-2.5 text-text-secondary">{t.assigned_closer_name||<span className="text-text-tertiary">—</span>}</td>
                        <td className="py-2 px-2.5 text-text-secondary">{t.company_name||'—'}</td>
                        <td className="py-2 px-2.5 font-mono text-[10px] text-text-tertiary">{t.sale_reference_no||'—'}</td>
                        <td className="py-2 px-2.5 text-text-secondary whitespace-nowrap">{new Date(t.created_at).toLocaleDateString()}</td>
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
          <div className="flex items-center justify-between px-3 py-2 border-t"
            style={{ borderColor:'var(--color-border)', backgroundColor:'var(--color-bg-secondary)' }}>
            <button onClick={() => setPage(p=>Math.max(1,p-1))} disabled={page===1}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ borderColor:'var(--color-border)', color:'var(--color-text-secondary)' }}>
              ← Prev
            </button>
            <div className="flex items-center gap-0.5">
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                let p;
                if (totalPages<=7) p=i+1;
                else if (page<=4) p=i+1;
                else if (page>=totalPages-3) p=totalPages-6+i;
                else p=page-3+i;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className="w-6 h-6 rounded-md text-[11px] font-semibold transition-all"
                    style={{
                      background: p===page ? 'var(--gradient-sidebar)' : 'transparent',
                      color: p===page ? 'white' : 'var(--color-text-secondary)',
                      border: p===page ? 'none' : '1px solid var(--color-border)',
                    }}>
                    {p}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ borderColor:'var(--color-border)', color:'var(--color-text-secondary)' }}>
              Next →
            </button>
          </div>
        )}
      </div>

      {/* ── Drawers ─────────────────────────────────────────────────────── */}
      {detailSale     && <SaleDetailDrawer     sale={detailSale}         onClose={() => setDetailSale(null)}     />}
      {detailTransfer && <TransferDetailDrawer transfer={detailTransfer} onClose={() => setDetailTransfer(null)} />}
    </div>
  );
}
