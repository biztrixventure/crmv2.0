import { useState, useEffect, useCallback, useRef } from 'react';
import client from '../../api/client';
import { Badge } from '../UI';
import { useDashboardStats } from '../../hooks/useDashboardStats';
import { getTransferDisplayStatus } from '../../utils/transferStatus';
import SaleDetailDrawer from '../Shared/SaleDetailDrawer';
import TransferDetailDrawer from '../Shared/TransferDetailDrawer';
import DateRangePicker, { getPresetRange } from '../UI/DateRangePicker';
import {
  Users, Building2, Activity, DollarSign, CheckCircle, Target, Shield, Layers,
  ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight,
  RefreshCw, X, Filter, Search, TrendingUp, Download, PhoneCall, AlertCircle,
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
const CB_STATUS_BADGE  = { pending:'warning', completed:'success', cancelled:'error', no_answer:'secondary', answering_machine:'info' };
const CB_STATUS_LABEL  = { pending:'Pending', completed:'Completed', cancelled:'Cancelled', no_answer:'No Answer', answering_machine:'Ans. Machine' };
const CB_PRIORITY_CFG  = {
  High:   { dot:'#ef4444', bg:'#fef2f2', border:'#fecaca', text:'#dc2626' },
  Medium: { dot:'#f59e0b', bg:'#fffbeb', border:'#fde68a', text:'#d97706' },
  Low:    { dot:'#3b82f6', bg:'#eff6ff', border:'#bfdbfe', text:'#2563eb' },
};
const CbPriorityBadge = ({ priority }) => {
  const cfg = CB_PRIORITY_CFG[priority] || CB_PRIORITY_CFG.Medium;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border"
      style={{ backgroundColor: cfg.bg, color: cfg.text, borderColor: cfg.border }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.dot }} />
      {priority || 'Medium'}
    </span>
  );
};
const CbOverdueDot = ({ cb }) => {
  if (cb.status !== 'pending' || !cb.callback_at || new Date(cb.callback_at) >= new Date()) return null;
  return (
    <span className="inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
      style={{ backgroundColor:'#fef2f2', color:'#dc2626', border:'1px solid #fecaca' }}>
      <AlertCircle size={9} /> OD
    </span>
  );
};

const downloadCSV = (rows, headers, filename) => {
  const csv = [headers, ...rows]
    .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
};

const Th = ({ col, sort, onSort, children }) => (
  <th onClick={() => onSort(col)}
    className="text-left py-2 px-2.5 text-xs font-bold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap transition-colors hover:text-primary-600"
    style={{ color: sort.col === col ? 'var(--color-primary-600)' : 'var(--color-text-secondary)' }}>
    {children}<SortIcon col={col} sort={sort} />
  </th>
);

// ─── Interactive MiniCalendar ─────────────────────────────────────────────────
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_ABBR    = ['S','M','T','W','T','F','S'];

function MiniCalendar({ todaySales, todayXfers, todayLoading, selectedFrom, selectedTo, onRangeChange }) {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  const [viewYear,  setViewYear]  = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [tempFrom,  setTempFrom]  = useState(null);   // first click of pending range
  const [hovered,   setHovered]   = useState(null);   // hovered date while selecting range

  const padded = (n) => String(n).padStart(2, '0');
  const toDateStr = (d) => `${viewYear}-${padded(viewMonth + 1)}-${padded(d)}`;

  const firstDow    = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };
  const goToday = () => {
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setTempFrom(null);
    onRangeChange({ date_from: todayStr, date_to: todayStr });
  };

  const handleClick = (d) => {
    const ds = toDateStr(d);
    if (!tempFrom) {
      // First click: apply single-day immediately, then wait for second click
      setTempFrom(ds);
      onRangeChange({ date_from: ds, date_to: ds });
    } else {
      // Second click: complete range
      const [f, t] = ds < tempFrom ? [ds, tempFrom] : [tempFrom, ds];
      setTempFrom(null);
      setHovered(null);
      onRangeChange({ date_from: f, date_to: t });
    }
  };

  const clearSelection = () => {
    setTempFrom(null);
    setHovered(null);
    onRangeChange({ date_from: null, date_to: null });
  };

  // Visual range to highlight: pending (tempFrom + hover) or confirmed (selectedFrom/To)
  const dispFrom = tempFrom ?? selectedFrom ?? null;
  const dispTo   = tempFrom
    ? (hovered ?? tempFrom)
    : (selectedTo ?? selectedFrom ?? null);
  const rangeMin = dispFrom && dispTo ? (dispFrom < dispTo ? dispFrom : dispTo) : dispFrom;
  const rangeMax = dispFrom && dispTo ? (dispFrom < dispTo ? dispTo : dispFrom) : dispFrom;

  const inRange    = (ds) => rangeMin && rangeMax && ds >= rangeMin && ds <= rangeMax;
  const isRangeMin = (ds) => ds === rangeMin;
  const isRangeMax = (ds) => ds === rangeMax;
  const isSingle   = rangeMin && rangeMin === rangeMax;

  // Format label for range info bar
  const fmtShort = (iso) => {
    if (!iso) return '';
    const [, m, d] = iso.split('-');
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${mo[parseInt(m,10)-1]} ${parseInt(d,10)}`;
  };

  const rangeLabel = selectedFrom
    ? (selectedTo && selectedTo !== selectedFrom
        ? `${fmtShort(selectedFrom)} – ${fmtShort(selectedTo)}`
        : fmtShort(selectedFrom))
    : null;

  return (
    <div className="rounded-xl p-3 h-full flex flex-col select-none"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

      {/* Month navigation */}
      <div className="flex items-center justify-between mb-1.5">
        <button onClick={prevMonth}
          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-bg-secondary transition-colors">
          <ChevronLeft size={12} style={{ color: 'var(--color-text-secondary)' }} />
        </button>
        <button onClick={goToday}
          className="text-xs font-bold text-text hover:text-primary-600 transition-colors px-1">
          {MONTH_NAMES[viewMonth].slice(0,3)} {viewYear}
        </button>
        <button onClick={nextMonth}
          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-bg-secondary transition-colors">
          <ChevronRight size={12} style={{ color: 'var(--color-text-secondary)' }} />
        </button>
      </div>

      {/* Day-of-week labels */}
      <div className="grid grid-cols-7 mb-0.5">
        {DAY_ABBR.map((d, i) => (
          <span key={i} className="text-center text-[9px] font-bold"
            style={{ color: 'var(--color-text-tertiary)' }}>{d}</span>
        ))}
      </div>

      {/* Date grid */}
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="aspect-square" />;
          const ds    = toDateStr(d);
          const inR   = inRange(ds);
          const isMin = inR && isRangeMin(ds);
          const isMax = inR && isRangeMax(ds);
          const isOne = isSingle && ds === rangeMin;
          const isToday = ds === todayStr;
          const isPending = tempFrom && ds === tempFrom && !hovered;

          // Border-radius for range pill shape
          let br = '5px';
          if (isOne || isPending) br = '50%';
          else if (inR) {
            if (isMin) br = '50% 0 0 50%';
            else if (isMax) br = '0 50% 50% 0';
            else br = '0';
          }

          const bg = (isMin || isMax || isOne || isPending)
            ? 'var(--gradient-sidebar)'
            : inR ? 'var(--color-primary-100, #dbeafe)' : 'transparent';

          const color = (isMin || isMax || isOne || isPending) ? '#fff'
            : isToday && !inR ? 'var(--color-primary-600)'
            : inR ? 'var(--color-primary-800, #1e3a8a)'
            : 'var(--color-text-secondary)';

          return (
            <button key={i}
              onClick={() => handleClick(d)}
              onMouseEnter={() => tempFrom && setHovered(ds)}
              onMouseLeave={() => tempFrom && setHovered(null)}
              className="aspect-square flex items-center justify-center text-[11px] transition-all cursor-pointer"
              style={{
                background: bg,
                color,
                borderRadius: br,
                fontWeight: (isMin || isMax || isOne || isToday) ? 700 : 400,
                outline: isToday && !inR ? '1px solid var(--color-primary-300)' : 'none',
                outlineOffset: '-1px',
              }}>
              {d}
            </button>
          );
        })}
      </div>

      {/* Selection info + clear */}
      <div className="mt-1.5 flex items-center justify-between min-h-[16px]">
        {tempFrom ? (
          <span className="text-[10px]" style={{ color: 'var(--color-primary-600)' }}>
            Click end date…
          </span>
        ) : rangeLabel ? (
          <span className="text-[10px] text-text-secondary truncate">{rangeLabel}</span>
        ) : (
          <span className="text-[10px] text-text-tertiary">Click to filter</span>
        )}
        {(selectedFrom || tempFrom) && (
          <button onClick={clearSelection}
            className="text-[10px] font-semibold ml-1 flex-shrink-0"
            style={{ color: 'var(--color-error-500)' }}>
            Clear
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="my-2 border-t" style={{ borderColor: 'var(--color-border)' }} />

      {/* Today stats */}
      <div className="space-y-1">
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

  // Date range — shared source of truth for both DateRangePicker and MiniCalendar
  const [dateRange, setDateRange] = useState(() => getPresetRange('30d'));
  const { date_from, date_to } = dateRange;

  // Other filters
  const [filters, setFilters]     = useState({ companyId: '', closerId: '', status: '', search: '', priority: '' });
  const [dataTab, setDataTab]     = useState('sales');
  const [cbType,  setCbType]      = useState('fronter');
  const [fronters, setFronters]   = useState([]);
  const [sort, setSort]           = useState({ col: 'created_at', dir: 'desc' });
  const [page, setPage]           = useState(1);
  const [rows, setRows]           = useState([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [companies, setCompanies] = useState([]);
  const [closers, setClosers]     = useState([]);
  const [detailSale, setDetailSale]         = useState(null);
  const [detailTransfer, setDetailTransfer] = useState(null);
  const [todaySales, setTodaySales]         = useState(0);
  const [todayXfers, setTodayXfers]         = useState(0);
  const [todayLoading, setTodayLoading]     = useState(true);
  const [exportLoading, setExportLoading]   = useState(false);
  const debounceRef = useRef(null);

  // Bootstrap
  useEffect(() => {
    fetchStats();
    client.get('compliance/companies').then(r => setCompanies(r.data.companies || [])).catch(() => {});
    client.get('compliance/users').then(r => {
      const all = r.data.users || [];
      setClosers(all.filter(u => ['closer','closer_manager','compliance_manager','company_admin'].includes(u.role_level)));
      setFronters(all.filter(u => ['fronter','fronter_manager'].includes(u.role_level)));
    }).catch(() => {});
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
          ...(date_from         && { date_from }),
          ...(date_to           && { date_to }),
          ...(filters.search    && { search: filters.search }),
        };
        const r = await client.get('compliance/sales', { params });
        setRows(r.data.sales || []); setTotal(r.data.total || 0);
      } else if (dataTab === 'transfers') {
        const params = { page: p, limit: LIMIT,
          ...(filters.companyId && { company_id: filters.companyId }),
          ...(filters.closerId  && { closer_id: filters.closerId }),
          ...(filters.status    && { status: filters.status }),
          ...(date_from         && { date_from }),
          ...(date_to           && { date_to }),
        };
        const r = await client.get('compliance/transfers', { params });
        setRows(r.data.transfers || []); setTotal(r.data.total || 0);
      } else {
        const params = { page: p, limit: LIMIT,
          company_type: filters.companyId ? undefined : cbType,
          ...(filters.companyId && { company_id: filters.companyId }),
          ...(filters.closerId  && { user_ids: filters.closerId }),
          ...(filters.status    && { status: filters.status }),
          ...(filters.priority  && { priority: filters.priority }),
          ...(filters.search    && { search: filters.search }),
          ...(date_from         && { date_from }),
          ...(date_to           && { date_to }),
        };
        const r = await client.get('compliance/callbacks', { params });
        setRows(r.data.callbacks || []); setTotal(r.data.total || 0);
      }
    } catch { setRows([]); setTotal(0); }
    finally { setLoading(false); }
  }, [dataTab, filters, cbType, page, date_from, date_to]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); fetchRows(1); }, filters.search ? 350 : 0);
  }, [filters, dataTab, date_from, date_to]);

  useEffect(() => { fetchRows(); }, [page]);

  const toggleSort = col => setSort(p => ({ col, dir: p.col === col && p.dir === 'desc' ? 'asc' : 'desc' }));

  const sorted = [...rows].sort((a, b) => {
    if (dataTab === 'callbacks' && sort.col === 'priority') {
      const W = { High: 3, Medium: 2, Low: 1 };
      const av = W[a.priority] || 0, bv = W[b.priority] || 0;
      return sort.dir === 'asc' ? av - bv : bv - av;
    }
    let av = a[sort.col] ?? '', bv = b[sort.col] ?? '';
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  const setFilter     = (k, v) => setFilters(p => ({ ...p, [k]: v }));
  const clearFilters  = () => {
    setFilters({ companyId: '', closerId: '', status: '', search: '', priority: '' });
    setDateRange(getPresetRange('30d'));
  };
  const hasActiveFilters = Object.values(filters).some(Boolean) || !!(date_from || date_to);
  const totalPages = Math.ceil(total / LIMIT);

  const handleDateRangeChange = (range) => {
    setDateRange({ date_from: range.date_from || null, date_to: range.date_to || null });
    setPage(1);
  };

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      if (dataTab === 'sales') {
        const params = {
          limit: 5000, page: 1,
          ...(filters.companyId && { company_id: filters.companyId }),
          ...(filters.closerId  && { user_ids: filters.closerId }),
          ...(filters.status    && { status: filters.status }),
          ...(date_from         && { date_from }),
          ...(date_to           && { date_to }),
          ...(filters.search    && { search: filters.search }),
        };
        const r = await client.get('compliance/sales', { params });
        const rows = (r.data.sales || []).map(s => [
          s.customer_name || '', s.customer_phone || '', s.customer_email || '',
          s.reference_no || '',
          SALE_LABEL[s.status] || s.status || '',
          s.closer_name || (s.user_profiles ? `${s.user_profiles.first_name||''} ${s.user_profiles.last_name||''}`.trim() : '') || '',
          s.companies?.name || '',
          s.plan || '',
          s.monthly_payment ? `$${s.monthly_payment}` : '',
          s.sale_date ? new Date(s.sale_date).toLocaleDateString() : '',
          new Date(s.created_at).toLocaleDateString(),
        ]);
        downloadCSV(rows,
          ['Customer','Phone','Email','Reference','Status','Closer','Company','Plan','Monthly','Sale Date','Created'],
          `sales_export_${today}.csv`);
      } else if (dataTab === 'transfers') {
        const params = {
          limit: 5000, page: 1,
          ...(filters.companyId && { company_id: filters.companyId }),
          ...(filters.closerId  && { closer_id: filters.closerId }),
          ...(filters.status    && { status: filters.status }),
          ...(date_from         && { date_from }),
          ...(date_to           && { date_to }),
        };
        const r = await client.get('compliance/transfers', { params });
        const rows = (r.data.transfers || []).map(t => {
          const fd = t.form_data || {};
          const name = fd.customer_name || (fd.FirstName ? `${fd.FirstName} ${fd.LastName||''}`.trim() : '') || '';
          const phone = fd.customer_phone || fd.Phone || '';
          return [
            name, phone, t.status || '', t.sale_status || '',
            t.created_by_name || '', t.assigned_closer_name || '',
            t.company_name || '', t.sale_reference_no || '',
            new Date(t.created_at).toLocaleDateString(),
          ];
        });
        downloadCSV(rows,
          ['Customer','Phone','Transfer Status','Sale Status','Fronter','Closer','Company','Sale Ref','Created'],
          `transfers_export_${today}.csv`);
      } else {
        const params = {
          limit: 5000, page: 1,
          company_type: filters.companyId ? undefined : cbType,
          ...(filters.companyId && { company_id: filters.companyId }),
          ...(filters.closerId  && { user_ids: filters.closerId }),
          ...(filters.status    && { status: filters.status }),
          ...(filters.priority  && { priority: filters.priority }),
          ...(filters.search    && { search: filters.search }),
          ...(date_from         && { date_from }),
          ...(date_to           && { date_to }),
        };
        const r = await client.get('compliance/callbacks', { params });
        const rows = (r.data.callbacks || []).map(c => [
          c.customer_name || '', c.customer_phone || '',
          c.callback_at ? new Date(c.callback_at).toLocaleString() : '',
          CB_STATUS_LABEL[c.status] || c.status || '',
          c.priority || 'Medium',
          c.notes || '', c.user_name || '', c.company_name || '',
          new Date(c.created_at).toLocaleDateString(),
        ]);
        downloadCSV(rows,
          ['Customer','Phone','Scheduled At','Status','Priority','Notes','Agent','Company','Created'],
          `callbacks_${cbType}_export_${today}.csv`);
      }
    } catch { /* silent — user retries */ } finally {
      setExportLoading(false);
    }
  };

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
  const CB_STATUSES_OPTS = [
    {v:'',l:'All'},{v:'pending',l:'Pending'},{v:'completed',l:'Completed'},
    {v:'no_answer',l:'No Answer'},{v:'answering_machine',l:'Ans. Machine'},{v:'cancelled',l:'Cancelled'},
  ];

  const sel = {
    height: 30, padding: '0 8px', borderRadius: 7, fontSize: 12, fontWeight: 500,
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)', outline: 'none', cursor: 'pointer',
  };

  return (
    <div className="animate-fade-in space-y-3">

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
          <h2 className="text-base font-bold text-text">Good day, {user?.first_name || 'Admin'}</h2>
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
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_210px] gap-3">

        {/* Metric cards */}
        <div className="grid grid-cols-4 gap-2">
          {metrics.map((m, i) => (
            <div key={i}
              className="rounded-xl p-3 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
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

        {/* Interactive mini calendar */}
        <MiniCalendar
          todaySales={todaySales}
          todayXfers={todayXfers}
          todayLoading={todayLoading}
          selectedFrom={date_from}
          selectedTo={date_to}
          onRangeChange={handleDateRangeChange}
        />
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

          {/* Date range picker — synced with MiniCalendar */}
          <DateRangePicker
            onChange={handleDateRangeChange}
            defaultPreset="30d"
            value={dateRange}
          />

          {/* Company */}
          <select value={filters.companyId} onChange={e => setFilter('companyId', e.target.value)}
            style={{ ...sel, minWidth: 140 }}>
            <option value="">All Companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name} ({c.company_type})</option>)}
          </select>

          {/* Callbacks: Fronter / Closer toggle */}
          {dataTab === 'callbacks' && (
            <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              {[{k:'fronter',l:'Fronters'},{k:'closer',l:'Closers'}].map(t => (
                <button key={t.k} onClick={() => { setCbType(t.k); setFilter('closerId',''); setPage(1); }}
                  className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all"
                  style={{
                    background: cbType===t.k ? 'var(--gradient-sidebar)' : 'transparent',
                    color: cbType===t.k ? 'white' : 'var(--color-text-secondary)',
                  }}>
                  {t.l}
                </button>
              ))}
            </div>
          )}

          {/* Agent / Closer */}
          <select value={filters.closerId} onChange={e => setFilter('closerId', e.target.value)}
            style={{ ...sel, minWidth: 140 }}>
            <option value="">{dataTab === 'callbacks' ? 'All Agents' : 'All Closers'}</option>
            {(dataTab === 'callbacks'
              ? (cbType === 'fronter' ? fronters : closers)
              : closers
            ).map(u => <option key={u.user_id} value={u.user_id}>{u.full_name} — {u.company_name||'?'}</option>)}
          </select>

          {/* Status */}
          <select value={filters.status} onChange={e => setFilter('status', e.target.value)}
            style={{ ...sel, minWidth: 110 }}>
            {(dataTab==='sales' ? SALE_STATUSES : dataTab==='transfers' ? XFER_STATUSES : CB_STATUSES_OPTS)
              .map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>

          {/* Priority (callbacks only) */}
          {dataTab === 'callbacks' && (
            <select value={filters.priority} onChange={e => setFilter('priority', e.target.value)}
              style={{ ...sel, minWidth: 100 }}>
              <option value="">All Priority</option>
              <option value="High">🔴 High</option>
              <option value="Medium">🟡 Medium</option>
              <option value="Low">🔵 Low</option>
            </select>
          )}

          {/* Search (sales + callbacks) */}
          {dataTab !== 'transfers' && (
            <div className="relative flex items-center">
              <Search size={11} className="absolute left-2 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />
              <input type="text" value={filters.search} onChange={e => setFilter('search', e.target.value)}
                placeholder="Search…"
                style={{ ...sel, paddingLeft: 22, minWidth: 150, cursor: 'text' }} />
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
              <X size={10} /> Clear all
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
              { key:'callbacks', label:'Callbacks', icon: PhoneCall  },
            ].map(t => (
              <button key={t.key}
                onClick={() => { setDataTab(t.key); setPage(1); setSort({col:'created_at',dir:'desc'}); setFilter('status',''); setFilter('priority',''); }}
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
            {total > 0 && (
              <button
                onClick={handleExport}
                disabled={exportLoading}
                title="Export to CSV"
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all hover:scale-105 disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-success-50)', color: 'var(--color-success-700)', border: '1px solid var(--color-success-200)' }}>
                <Download size={11} className={exportLoading ? 'animate-spin' : ''} />
                {exportLoading ? 'Exporting…' : 'CSV'}
              </button>
            )}
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
          ) : dataTab === 'transfers' ? (
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
          ) : (
            /* ── Callbacks table ─────────────────────────────────────────── */
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom:'1px solid var(--color-border)', backgroundColor:'var(--color-bg-secondary)' }}>
                  <Th col="customer_name" sort={sort} onSort={toggleSort}>Customer</Th>
                  <Th col="priority"      sort={sort} onSort={toggleSort}>Priority</Th>
                  <Th col="callback_at"   sort={sort} onSort={toggleSort}>Scheduled At</Th>
                  <Th col="user_name"     sort={sort} onSort={toggleSort}>Agent</Th>
                  <th className="py-2 px-2.5 text-left text-xs font-bold uppercase tracking-wide" style={{ color:'var(--color-text-secondary)' }}>Company</th>
                  <Th col="status"        sort={sort} onSort={toggleSort}>Status</Th>
                  <th className="py-2 px-2.5 text-left text-xs font-bold uppercase tracking-wide" style={{ color:'var(--color-text-secondary)' }}>Notes</th>
                  <Th col="created_at"    sort={sort} onSort={toggleSort}>Created</Th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length===0 ? (
                  Array.from({length:8}).map((_,i) => (
                    <tr key={i} style={{ borderBottom:'1px solid var(--color-border)' }}>
                      {Array.from({length:8}).map((_,j) => (
                        <td key={j} className="py-2 px-2.5">
                          <div className="h-2.5 rounded animate-pulse" style={{ backgroundColor:'var(--color-border)', width:j===0?100:60 }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : sorted.length===0 ? (
                  <tr><td colSpan={8} className="py-10 text-center text-text-secondary text-xs">No callbacks match the current filters.</td></tr>
                ) : (
                  sorted.map(c => (
                    <tr key={c.id}
                      className="transition-colors hover:bg-bg-secondary"
                      style={{ borderBottom:'1px solid var(--color-border)' }}>
                      <td className="py-2 px-2.5">
                        <p className="font-semibold text-text leading-tight">{c.customer_name||'—'}</p>
                        {c.customer_phone && <p className="text-[10px] text-text-tertiary">{c.customer_phone}</p>}
                      </td>
                      <td className="py-2 px-2.5">
                        <CbPriorityBadge priority={c.priority} />
                      </td>
                      <td className="py-2 px-2.5 whitespace-nowrap" style={{ color:'var(--color-text-secondary)' }}>
                        <span className="flex items-center gap-1">
                          {c.callback_at ? new Date(c.callback_at).toLocaleString() : '—'}
                          <CbOverdueDot cb={c} />
                        </span>
                      </td>
                      <td className="py-2 px-2.5 text-text-secondary">{c.user_name||'—'}</td>
                      <td className="py-2 px-2.5 text-text-secondary">{c.company_name||'—'}</td>
                      <td className="py-2 px-2.5">
                        <Badge variant={CB_STATUS_BADGE[c.status]||'secondary'} size="sm">
                          {CB_STATUS_LABEL[c.status]||c.status||'—'}
                        </Badge>
                      </td>
                      <td className="py-2 px-2.5 max-w-[180px] truncate text-text-secondary">{c.notes||'—'}</td>
                      <td className="py-2 px-2.5 text-text-secondary whitespace-nowrap">
                        {new Date(c.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
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
