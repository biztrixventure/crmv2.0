/**
 * NumbersIntelligence — superadmin cross-company numbers view.
 * Full visibility: all companies, all fronters, all dates, transfer linkage.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import ThemedSelect from '../UI/Select';
import ThemedDate from '../UI/ThemedDate';
import {
  Phone, Search, Filter, RefreshCw, X, Calendar, Building2, Users,
  Link2, ChevronDown, Download, BarChart3, TrendingUp, Hash,
} from 'lucide-react';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

const STATUS_CFG = {
  new:       { label: 'New',       bg: '#eff6ff', color: '#2563eb' },
  called:    { label: 'Called',    bg: '#fef3c7', color: '#d97706' },
  callback:  { label: 'Callback',  bg: '#f3e8ff', color: '#7c3aed' },
  completed: { label: 'Done',      bg: '#d1fae5', color: '#059669' },
  skip:      { label: 'Skip',      bg: '#f3f4f6', color: '#6b7280' },
};

const StatusBadge = ({ status }) => {
  const cfg = STATUS_CFG[status] || { label: status || '—', bg: '#f3f4f6', color: '#6b7280' };
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
};

const fmt = (iso) => iso
  ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
  : '—';

// CSV download helper
const downloadCSV = (rows, headers, filename) => {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

// ─────────────────────────────────────────────────────────────────────────────
const NumbersIntelligence = () => {
  const { roExportAllowed } = useAuth();
  const [numbers,    setNumbers]    = useState([]);
  const [stats,      setStats]      = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [companies,  setCompanies]  = useState([]);
  const [fronters,   setFronters]   = useState([]);

  // Filters
  const [companyId,  setCompanyId]  = useState('');
  const [fronterIdF, setFronterIdF] = useState('');
  const [statusF,    setStatusF]    = useState('');
  const [dateFrom,   setDateFrom]   = useState('');
  const [dateTo,     setDateTo]     = useState('');
  const [search,     setSearch]     = useState('');
  const [listNameF,  setListNameF]  = useState('');

  // UI
  const [page,       setPage]       = useState(1);
  const [expanded,   setExpanded]   = useState(null);
  const PAGE_SIZE = 50;

  const searchRef = useRef(null);
  const debRef    = useRef(null);

  // Load companies once
  useEffect(() => {
    client.get('number-lists/companies').then(r => setCompanies(r.data.companies || [])).catch(() => {});
  }, []);

  // Load fronters when company changes
  useEffect(() => {
    setFronterIdF('');
    if (!companyId) { setFronters([]); return; }
    client.get('number-lists/fronters', { params: { company_id: companyId } })
      .then(r => setFronters(r.data.fronters || []))
      .catch(() => setFronters([]));
  }, [companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (companyId)  params.company_id = companyId;
      if (fronterIdF) params.fronter_id = fronterIdF;
      if (statusF)    params.status     = statusF;
      if (dateFrom)   params.date_from  = dateFrom;
      if (dateTo)     params.date_to    = dateTo;
      if (listNameF)  params.list_name  = listNameF;
      if (search.trim()) params.search  = search.trim();

      const res = await client.get('number-lists/summary', { params });
      setNumbers(res.data.numbers || []);
      setStats(res.data.stats    || null);
      setPage(1);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [companyId, fronterIdF, statusF, dateFrom, dateTo, listNameF, search]);

  useEffect(() => {
    clearTimeout(debRef.current);
    debRef.current = setTimeout(load, search ? 400 : 0);
    return () => clearTimeout(debRef.current);
  }, [load]);

  const clearFilters = () => {
    setCompanyId(''); setFronterIdF(''); setStatusF('');
    setDateFrom(''); setDateTo(''); setSearch(''); setListNameF('');
  };

  const activeFilterCount = [companyId, fronterIdF, statusF, dateFrom || dateTo, search, listNameF]
    .filter(Boolean).length;

  // Pagination
  const paged  = numbers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalP = Math.ceil(numbers.length / PAGE_SIZE);

  // Unique list names for filter
  const listNames = [...new Set(numbers.map(n => n.list_name).filter(Boolean))].sort();

  // Stats
  const totalNumbers   = numbers.length;
  const transferred    = numbers.filter(n => n.transfer_id).length;
  const conversionRate = totalNumbers > 0 ? Math.round((transferred / totalNumbers) * 100) : 0;

  const byStatus = {};
  numbers.forEach(n => { byStatus[n.status] = (byStatus[n.status] || 0) + 1; });

  const handleExport = async () => {
    // Egress governance (soft — data is already loaded): log + daily-cap check.
    try { await client.post('egress/client-log', { dataset: 'numbers', row_count: numbers.length }); }
    catch (err) { if (err?.response?.data?.code === 'EGRESS_LIMIT') { window.alert(err.response.data.error); return; } }
    const headers = ['phone_number', 'customer_name', 'status', 'list_name', 'assignment_day', 'fronter_name', 'company_name', 'transferred_at'];
    downloadCSV(numbers, headers, `numbers-intelligence-${new Date().toISOString().slice(0,10)}.csv`);
  };

  return (
    <div className="animate-fade-in space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Hash size={20} style={{ color: 'var(--color-primary-600)' }} />
            Numbers Intelligence
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Cross-company lead numbers — track assignment, status, and transfer conversion.
          </p>
        </div>
        {roExportAllowed('numbers') && (
        <button onClick={handleExport} disabled={numbers.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:-translate-y-0.5 disabled:opacity-40 flex-shrink-0"
          style={{ background: 'var(--gradient-sidebar)', color: '#fff', boxShadow: 'var(--shadow-sm)' }}>
          <Download size={14} /> Export CSV
        </button>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Numbers', value: totalNumbers, color: '#2563eb', bg: '#eff6ff', Icon: Hash },
          { label: 'Transferred',   value: transferred,  color: '#059669', bg: '#d1fae5', Icon: Link2 },
          { label: 'Conversion',    value: `${conversionRate}%`, color: '#7c3aed', bg: '#ede9fe', Icon: TrendingUp },
          { label: 'Companies',     value: stats?.by_company?.length || 0, color: '#0891b2', bg: '#cffafe', Icon: Building2 },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-3 text-center"
            style={{ backgroundColor: s.bg, border: `1px solid ${s.color}30` }}>
            <s.Icon size={16} className="mx-auto mb-1" style={{ color: s.color }} />
            <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-xs font-semibold" style={{ color: s.color }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Status breakdown */}
      {totalNumbers > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(STATUS_CFG).map(([key, cfg]) => {
            const count = byStatus[key] || 0;
            if (!count) return null;
            const pct = Math.round((count / totalNumbers) * 100);
            return (
              <div key={key} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all hover:scale-105"
                style={{ backgroundColor: statusF === key ? cfg.color : cfg.bg, color: statusF === key ? '#fff' : cfg.color, border: `1px solid ${cfg.color}30` }}
                onClick={() => setStatusF(statusF === key ? '' : key)}>
                {cfg.label}: {count} ({pct}%)
              </div>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="rounded-2xl border overflow-hidden"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <div className="flex items-center gap-2">
            <Filter size={14} style={{ color: 'var(--color-primary-600)' }} />
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
              Filters
            </span>
            {activeFilterCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-bold text-white"
                style={{ backgroundColor: 'var(--color-primary-600)' }}>
                {activeFilterCount}
              </span>
            )}
          </div>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className="text-xs font-semibold hover:underline"
              style={{ color: 'var(--color-primary-600)' }}>
              Clear all
            </button>
          )}
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--color-text-tertiary)' }} />
            <input ref={searchRef} type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search phone or name…" className="input text-sm pl-9 pr-8 w-full" />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-bg-secondary">
                <X size={12} style={{ color: 'var(--color-text-tertiary)' }} />
              </button>
            )}
          </div>

          {/* Company */}
          <ThemedSelect value={companyId} onChange={e => setCompanyId(e.target.value)} className="input text-sm">
            <option value="">All Companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name || c.slug}</option>)}
          </ThemedSelect>

          {/* Fronter */}
          <ThemedSelect value={fronterIdF} onChange={e => setFronterIdF(e.target.value)} className="input text-sm"
            disabled={!companyId}>
            <option value="">All Fronters{!companyId ? ' (select company)' : ''}</option>
            {fronters.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </ThemedSelect>

          {/* Status */}
          <ThemedSelect value={statusF} onChange={e => setStatusF(e.target.value)} className="input text-sm">
            <option value="">All Statuses</option>
            {Object.entries(STATUS_CFG).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
          </ThemedSelect>

          {/* Date range */}
          <div className="flex items-center gap-2">
            <Calendar size={13} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
            <ThemedDate value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="input text-xs flex-1" placeholder="From" />
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>—</span>
            <ThemedDate value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="input text-xs flex-1" placeholder="To" />
          </div>

          {/* List name */}
          <ThemedSelect value={listNameF} onChange={e => setListNameF(e.target.value)} className="input text-sm">
            <option value="">All Lists</option>
            {listNames.map(l => <option key={l} value={l}>{l}</option>)}
          </ThemedSelect>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border overflow-hidden"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <div className="flex items-center gap-2">
            <BarChart3 size={15} style={{ color: 'var(--color-primary-600)' }} />
            <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>
              {loading ? 'Loading…' : `${numbers.length.toLocaleString()} numbers`}
            </span>
          </div>
          <button onClick={load} disabled={loading}
            className="p-1.5 rounded-lg hover:bg-bg transition-colors">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''}
              style={{ color: 'var(--color-text-tertiary)' }} />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary-600" />
          </div>
        ) : numbers.length === 0 ? (
          <div className="text-center py-16">
            <Phone size={28} className="mx-auto mb-2" style={{ color: 'var(--color-text-tertiary)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>No numbers found</p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              {activeFilterCount > 0 ? 'Try adjusting your filters.' : 'No number lists have been uploaded yet.'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                    {['Phone', 'Customer', 'Status', 'List', 'Day', 'Fronter', 'Company', 'Transfer'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                        style={{ color: 'var(--color-text-secondary)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((n, i) => (
                    <tr key={n.id}
                      className="hover:bg-bg-secondary transition-colors cursor-pointer group"
                      style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--color-bg-secondary)0a' }}
                      onClick={() => setExpanded(expanded === n.id ? null : n.id)}>
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold text-xs" style={{ color: 'var(--color-text)' }}>
                          {n.phone_number}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs" style={{ color: 'var(--color-text)' }}>
                          {n.customer_name || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={n.status} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          {n.list_name || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          {n.assignment_day ? new Date(n.assignment_day + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Users size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                          <span className="text-xs" style={{ color: 'var(--color-text)' }}>
                            {n.fronter_name || '—'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Building2 size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                          <span className="text-xs" style={{ color: 'var(--color-text)' }}>
                            {n.company_name || '—'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {n.transfer_id ? (
                          <div>
                            <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: '#d1fae5', color: '#059669' }}>
                              <Link2 size={9} /> Transferred
                            </span>
                            {n.transferred_at && (
                              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                                {fmt(n.transferred_at)}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Pending</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalP > 1 && (
              <div className="flex items-center justify-between px-5 py-3"
                style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  {((page-1)*PAGE_SIZE)+1}–{Math.min(page*PAGE_SIZE, numbers.length)} of {numbers.length}
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page <= 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 hover:bg-bg transition-colors"
                    style={{ color: 'var(--color-text-secondary)' }}>
                    Prev
                  </button>
                  <span className="text-xs font-semibold px-2" style={{ color: 'var(--color-text)' }}>
                    {page} / {totalP}
                  </span>
                  <button onClick={() => setPage(p => Math.min(totalP, p+1))} disabled={page >= totalP}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 hover:bg-bg transition-colors"
                    style={{ color: 'var(--color-text-secondary)' }}>
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Per-company breakdown */}
      {stats?.by_company?.length > 0 && (
        <div className="rounded-2xl border overflow-hidden"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <div className="px-5 py-3 flex items-center gap-2"
            style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
            <Building2 size={14} style={{ color: 'var(--color-primary-600)' }} />
            <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>By Company</span>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {stats.by_company.sort((a, b) => b.total - a.total).map((co, i) => {
              const pct = co.total > 0 ? Math.round((co.transferred / co.total) * 100) : 0;
              return (
                <div key={i} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                    <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                      {co.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={{ backgroundColor: '#eff6ff', color: '#2563eb' }}>
                      {co.total} numbers
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={{ backgroundColor: '#d1fae5', color: '#059669' }}>
                      {co.transferred} transferred
                    </span>
                    <span className="text-xs font-bold" style={{ color: pct >= 50 ? '#059669' : pct >= 20 ? '#d97706' : '#dc2626' }}>
                      {pct}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default NumbersIntelligence;
