import { useState, useCallback, useEffect, useMemo } from 'react';
import { PhoneCall, ArrowRight, Trash2, AlertCircle, BarChart3, User, ChevronUp, ChevronDown, ChevronsUpDown, X } from 'lucide-react';
import CallbackPhoneHistoryDrawer from '../Shared/CallbackPhoneHistoryDrawer';
import { Badge } from '../UI';
import client from '../../api/client';
import ExportModal from './ExportModal';
import {
  STATUS_BADGE, STATUS_LABEL, CALLBACK_STATUSES, LIMIT,
  fmtDate, fmtDateTime, downloadCSV,
  TabHeader, Spinner, Empty, Pagination, Th, Filters, FInput, FSelect,
  Overlay, ModalBox, ModalHeader, InfoTile,
} from './shared';

// ── Priority config ────────────────────────────────────────────────────────────
const PRIORITY_CFG = {
  High:   { dot: '#ef4444', bg: '#fef2f2', border: '#fecaca', text: '#dc2626' },
  Medium: { dot: '#f59e0b', bg: '#fffbeb', border: '#fde68a', text: '#d97706' },
  Low:    { dot: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe', text: '#2563eb' },
};

const PriorityBadge = ({ priority }) => {
  if (!priority) return <span className="text-xs text-text-secondary">—</span>;
  const cfg = PRIORITY_CFG[priority] || PRIORITY_CFG.Medium;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border"
      style={{ backgroundColor: cfg.bg, color: cfg.text, borderColor: cfg.border }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.dot }} />
      {priority}
    </span>
  );
};

const OverdueDot = ({ callback }) => {
  if (callback.status !== 'pending') return null;
  if (!callback.callback_at || new Date(callback.callback_at) >= new Date()) return null;
  return (
    <span title="Overdue" className="inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
      style={{ backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
      <AlertCircle size={9} /> OD
    </span>
  );
};

// ── Sort helpers ───────────────────────────────────────────────────────────────
const SORT_PRIORITY = { High: 3, Medium: 2, Low: 1 };

const SortIcon = ({ col, sort }) => {
  if (sort.col !== col) return <ChevronsUpDown size={10} className="opacity-30 ml-0.5 inline-block" />;
  return sort.dir === 'asc'
    ? <ChevronUp size={10} className="ml-0.5 inline-block" style={{ color: 'var(--color-primary-600)' }} />
    : <ChevronDown size={10} className="ml-0.5 inline-block" style={{ color: 'var(--color-primary-600)' }} />;
};

const SortTh = ({ col, sort, onSort, children }) => (
  <th onClick={() => onSort(col)}
    className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap transition-colors hover:text-primary-600"
    style={{ color: sort.col === col ? 'var(--color-primary-600)' : 'var(--color-text-secondary)' }}>
    {children}<SortIcon col={col} sort={sort} />
  </th>
);

// ── Agent stats modal ─────────────────────────────────────────────────────────
const AgentStatsModal = ({ userId, userName, companyName, onClose }) => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await client.get('compliance/callbacks', {
          params: { user_ids: userId, limit: 1000, page: 1 },
        });
        const cbs = res.data.callbacks || [];
        const byStatus = {};
        const byPriority = {};
        let overdue = 0;
        const now = new Date();
        cbs.forEach(c => {
          byStatus[c.status]     = (byStatus[c.status] || 0) + 1;
          byPriority[c.priority] = (byPriority[c.priority] || 0) + 1;
          if (c.status === 'pending' && c.callback_at && new Date(c.callback_at) < now) overdue++;
        });
        const total      = cbs.length;
        const completed  = byStatus['completed'] || 0;
        const rate       = total > 0 ? Math.round((completed / total) * 100) : 0;
        // Upcoming: pending callbacks in the future, sorted soonest first
        const upcoming = cbs
          .filter(c => c.status === 'pending' && c.callback_at && new Date(c.callback_at) >= now)
          .sort((a, b) => new Date(a.callback_at) - new Date(b.callback_at))
          .slice(0, 5);
        setStats({ total, byStatus, byPriority, rate, overdue, upcoming });
      } catch { setStats(null); }
      finally { setLoading(false); }
    };
    load();
  }, [userId]);

  const StatBar = ({ label, count, total, color }) => {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return (
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
          <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{count} <span className="opacity-50">({pct}%)</span></span>
        </div>
        <div className="rounded-full overflow-hidden" style={{ height: 4, backgroundColor: 'var(--color-border)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
      </div>
    );
  };

  return (
    <Overlay>
      <ModalBox>
        <div className="flex items-start justify-between p-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--gradient-sidebar)' }}>
              <User size={18} className="text-white" />
            </div>
            <div>
              <h3 className="font-bold text-text">{userName}</h3>
              <p className="text-xs text-text-secondary">{companyName || 'Agent callback report'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-secondary transition-colors">
            <X size={16} style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5" style={{ maxHeight: '70vh' }}>
          {loading ? (
            <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
          ) : !stats ? (
            <p className="text-center text-text-secondary text-sm py-8">Failed to load stats.</p>
          ) : (
            <>
              {/* Summary metrics */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Total',       value: stats.total,                     color: 'var(--color-text)'          },
                  { label: 'Completion',  value: `${stats.rate}%`,                color: '#10b981'                    },
                  { label: 'Overdue',     value: stats.overdue,                   color: '#ef4444'                    },
                  { label: 'Upcoming',    value: stats.upcoming.length,           color: '#f59e0b'                    },
                ].map(s => (
                  <div key={s.label} className="rounded-xl p-3 text-center"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                    <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-[10px] text-text-secondary mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Status breakdown */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-secondary)' }}>Status Breakdown</p>
                <div className="space-y-2">
                  <StatBar label="Completed"    count={stats.byStatus['completed']    || 0} total={stats.total} color="#10b981" />
                  <StatBar label="Pending"      count={stats.byStatus['pending']      || 0} total={stats.total} color="#f59e0b" />
                  <StatBar label="No Answer"    count={stats.byStatus['no_answer']    || 0} total={stats.total} color="#6b7280" />
                  <StatBar label="Ans. Machine" count={stats.byStatus['answering_machine'] || 0} total={stats.total} color="#8b5cf6" />
                  <StatBar label="Cancelled"    count={stats.byStatus['cancelled']    || 0} total={stats.total} color="#ef4444" />
                </div>
              </div>

              {/* Priority breakdown */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-secondary)' }}>Priority Distribution</p>
                <div className="space-y-2">
                  <StatBar label="High"   count={stats.byPriority['High']   || 0} total={stats.total} color="#ef4444" />
                  <StatBar label="Medium" count={stats.byPriority['Medium'] || 0} total={stats.total} color="#f59e0b" />
                  <StatBar label="Low"    count={stats.byPriority['Low']    || 0} total={stats.total} color="#3b82f6" />
                </div>
              </div>

              {/* Upcoming callbacks */}
              {stats.upcoming.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-secondary)' }}>Next Scheduled</p>
                  <div className="space-y-1.5">
                    {stats.upcoming.map(cb => (
                      <div key={cb.id} className="flex items-center justify-between rounded-lg px-3 py-2"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                        <div>
                          <p className="text-xs font-semibold text-text">{cb.customer_name || '—'}</p>
                          <p className="text-[10px] text-text-secondary">{cb.customer_phone || ''}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-text-secondary">{fmtDateTime(cb.callback_at)}</p>
                          <PriorityBadge priority={cb.priority} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 pb-5 pt-3 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button onClick={onClose}
            className="w-full py-2.5 rounded-xl border font-semibold text-sm"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            Close
          </button>
        </div>
      </ModalBox>
    </Overlay>
  );
};

// ── Priority stats bar ────────────────────────────────────────────────────────
const PriorityStatsBar = ({ callbacks }) => {
  const high   = callbacks.filter(c => c.priority === 'High').length;
  const medium = callbacks.filter(c => c.priority === 'Medium').length;
  const low    = callbacks.filter(c => c.priority === 'Low').length;
  const total  = callbacks.length;
  if (!total) return null;

  return (
    <div className="flex items-center gap-3 flex-wrap mb-4">
      <span className="text-xs font-bold text-text-secondary uppercase tracking-wide">Priority</span>
      {[
        { label: 'High',   count: high,   ...PRIORITY_CFG.High   },
        { label: 'Medium', count: medium, ...PRIORITY_CFG.Medium },
        { label: 'Low',    count: low,    ...PRIORITY_CFG.Low    },
      ].map(p => (
        <span key={p.label} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border"
          style={{ backgroundColor: p.bg, color: p.text, borderColor: p.border }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.dot }} />
          {p.label}: {p.count}
          <span className="opacity-60 text-[10px]">({total > 0 ? Math.round(p.count/total*100) : 0}%)</span>
        </span>
      ))}
      <span className="text-xs text-text-secondary ml-auto">
        {callbacks.filter(c => c.status === 'pending' && c.callback_at && new Date(c.callback_at) < new Date()).length} overdue
      </span>
    </div>
  );
};

// ── Audit Log sub-component ────────────────────────────────────────────────────
const AuditLogView = ({ companyList }) => {
  const [entries, setEntries]   = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const [page, setPage]         = useState(1);
  const [company, setCompany]   = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('compliance/callback-audit-log', {
        params: {
          company_id: company || undefined,
          date_from:  dateFrom || undefined,
          date_to:    dateTo   || undefined,
          page, limit: LIMIT,
        },
      });
      setEntries(res.data.entries || []);
      setTotal(res.data.total || 0);
    } catch { } finally { setLoading(false); }
  }, [company, dateFrom, dateTo, page]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async () => {
    const res = await client.get('compliance/callback-audit-log', {
      params: { company_id: company || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined, limit: 5000, page: 1 },
    });
    const rows = (res.data.entries || []).map(e => [
      fmtDateTime(e.created_at), e.actor_name || e.actor_id || '—',
      e.customer_name_snapshot || '—', e.customer_phone_snapshot || '—',
      STATUS_LABEL[e.old_status] || e.old_status || '—',
      STATUS_LABEL[e.new_status] || e.new_status || '—',
      e.notes || '', e.callback_deleted ? 'Yes' : 'No',
    ]);
    downloadCSV(rows, ['Timestamp','Actor','Customer','Phone','From Status','To Status','Notes','Callback Deleted'],
      `callback_audit_log_${new Date().toISOString().split('T')[0]}.csv`);
  };

  return (
    <div>
      <Filters onSubmit={() => { setPage(1); load(); }}>
        <FSelect label="Company" value={company} onChange={e => setCompany(e.target.value)}>
          <option value="">All companies</option>
          {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FSelect>
        <FInput label="From" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <FInput label="To"   type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)} />
      </Filters>

      <div className="rounded-xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {loading ? <Spinner /> : entries.length === 0 ? (
          <Empty icon={PhoneCall} msg="No audit log entries found." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <Th>Timestamp</Th><Th>Actor</Th><Th>Customer</Th><Th>Status Change</Th><Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{fmtDateTime(e.created_at)}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text)' }}>{e.actor_name || '—'}</td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                        {e.customer_name_snapshot || '—'}
                        {e.callback_deleted && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-bold"
                            style={{ backgroundColor: 'var(--color-error-50)', color: 'var(--color-error-600)', border: '1px solid var(--color-error-200)' }}>
                            <Trash2 size={9} /> Deleted
                          </span>
                        )}
                      </p>
                      {e.customer_phone_snapshot && (
                        <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--color-text-secondary)' }}>{e.customer_phone_snapshot}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant={STATUS_BADGE[e.old_status] || 'secondary'} size="sm">{STATUS_LABEL[e.old_status] || e.old_status || '—'}</Badge>
                        <ArrowRight size={12} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
                        <Badge variant={STATUS_BADGE[e.new_status] || 'secondary'} size="sm">{STATUS_LABEL[e.new_status] || e.new_status}</Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>{e.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} limit={LIMIT} onPage={setPage} />
      </div>
      <div className="mt-3 flex justify-end">
        <button onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors hover:opacity-80"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
          Export CSV
        </button>
      </div>
    </div>
  );
};

// ── Main CallbacksTab ──────────────────────────────────────────────────────────
const CallbacksTab = ({ companyList }) => {
  const [view,        setView]        = useState('callbacks'); // 'callbacks' | 'audit'
  const [callbacks,   setCallbacks]   = useState([]);
  const [total,       setTotal]       = useState(0);
  const [loading,     setLoading]     = useState(false);
  const [page,        setPage]        = useState(1);
  const [cbType,      setCbType]      = useState('fronter');
  const [status,      setStatus]      = useState('');
  const [priority,    setPriority]    = useState('');
  const [company,     setCompany]     = useState('');
  const [search,      setSearch]      = useState('');
  const [dateFrom,    setDateFrom]    = useState('');
  const [dateTo,      setDateTo]      = useState('');
  const [sort,        setSort]        = useState({ col: 'callback_at', dir: 'asc' });

  // User (agent) filter
  const [companyUsers, setCompanyUsers] = useState([]);
  const [selectedUser,  setSelectedUser]  = useState('');
  const [agentStats,    setAgentStats]    = useState(null); // { userId, userName, companyName }

  const [detail,      setDetail]      = useState(null);
  const [phoneDrawer, setPhoneDrawer] = useState(null);
  const [exportOpen,  setExportOpen]  = useState(false);

  // Fetch users when company changes
  useEffect(() => {
    setSelectedUser('');
    setCompanyUsers([]);
    if (!company) return;
    client.get('compliance/users', { params: { company_id: company } })
      .then(r => setCompanyUsers(r.data.users || []))
      .catch(() => {});
  }, [company]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('compliance/callbacks', {
        params: {
          company_type: company ? undefined : cbType,
          company_id:   company || undefined,
          status:       status   || undefined,
          priority:     priority || undefined,
          search:       search   || undefined,
          date_from:    dateFrom || undefined,
          date_to:      dateTo   || undefined,
          user_ids:     selectedUser ? selectedUser : undefined,
          page, limit: LIMIT,
        },
      });
      setCallbacks(res.data.callbacks || []);
      setTotal(res.data.total || 0);
    } catch { } finally { setLoading(false); }
  }, [cbType, company, status, priority, search, dateFrom, dateTo, page, selectedUser]);

  useEffect(() => { if (view === 'callbacks') load(); }, [load, view]);

  const switchType = (t) => { setCbType(t); setCompany(''); setSearch(''); setSelectedUser(''); setPage(1); };

  const toggleSort = (col) =>
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });

  const sorted = useMemo(() => {
    return [...callbacks].sort((a, b) => {
      let av, bv;
      const dir = sort.dir === 'asc' ? 1 : -1;
      switch (sort.col) {
        case 'priority':     av = SORT_PRIORITY[a.priority]||0; bv = SORT_PRIORITY[b.priority]||0; return (bv - av) * dir;
        case 'callback_at':  av = a.callback_at || ''; bv = b.callback_at || ''; return av.localeCompare(bv) * dir;
        case 'customer':     av = (a.customer_name||'').toLowerCase(); bv = (b.customer_name||'').toLowerCase(); return av.localeCompare(bv) * dir;
        case 'status':       av = a.status||''; bv = b.status||''; return av.localeCompare(bv) * dir;
        case 'agent':        av = (a.user_name||'').toLowerCase(); bv = (b.user_name||'').toLowerCase(); return av.localeCompare(bv) * dir;
        default:             return 0;
      }
    });
  }, [callbacks, sort]);

  const sortedCompanies = [...companyList].sort((a, b) => a.name.localeCompare(b.name));

  const handleExport = async ({ dateFrom: df, dateTo: dt, company: co, userIds }) => {
    const res = await client.get('compliance/callbacks', {
      params: {
        company_type: co ? undefined : cbType, company_id: co || undefined,
        date_from: df || undefined, date_to: dt || undefined,
        search: search || undefined, priority: priority || undefined,
        user_ids: userIds.length ? userIds.join(',') : (selectedUser || undefined),
        limit: 5000, page: 1,
      },
    });
    const rows = (res.data.callbacks || []).map(c => [
      c.customer_name || '', c.customer_phone || '',
      fmtDateTime(c.callback_at),
      STATUS_LABEL[c.status] || c.status || '',
      c.priority || 'Medium',
      c.notes || '', c.user_name || '', c.company_name || '',
    ]);
    downloadCSV(rows, ['Customer','Phone','Scheduled At','Status','Priority','Notes','Agent','Company'],
      `callbacks_${cbType}_${new Date().toISOString().split('T')[0]}.csv`);
  };

  return (
    <div>
      <TabHeader
        title="Callbacks"
        subtitle="Scheduled callbacks across all companies — read-only view"
        onRefresh={view === 'callbacks' ? () => { setPage(1); load(); } : undefined}
        onExport={view === 'callbacks' ? () => setExportOpen(true) : undefined}
        extra={
          <div className="flex gap-1 p-1 rounded-lg"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {[{ key: 'callbacks', label: 'Callbacks' }, { key: 'audit', label: 'Audit Log' }].map(v => (
              <button key={v.key} onClick={() => setView(v.key)}
                className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
                style={{
                  backgroundColor: view === v.key ? 'var(--color-surface)' : 'transparent',
                  color: view === v.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                  boxShadow: view === v.key ? 'var(--shadow-sm)' : 'none',
                }}>
                {v.label}
              </button>
            ))}
          </div>
        }
      />

      {view === 'audit' && <AuditLogView companyList={companyList} />}

      {view === 'callbacks' && <>

        {/* Fronter / Closer toggle */}
        <div className="flex gap-1 p-1 rounded-xl mb-4 w-fit"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {[{ key: 'fronter', label: 'Fronter Callbacks' }, { key: 'closer', label: 'Closer Callbacks' }].map(t => (
            <button key={t.key} onClick={() => switchType(t.key)}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                backgroundColor: cbType === t.key ? 'var(--color-surface)' : 'transparent',
                color: cbType === t.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                boxShadow: cbType === t.key ? 'var(--shadow-sm)' : 'none',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        <Filters onSubmit={() => { setPage(1); load(); }}>
          <FInput label="Search" placeholder="Name or phone…" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 160 }} />
          <FSelect label="Company" value={company} onChange={e => setCompany(e.target.value)}>
            <option value="">All companies</option>
            {sortedCompanies.map(c => <option key={c.id} value={c.id}>{c.name}{c.company_type ? ` (${c.company_type})` : ''}</option>)}
          </FSelect>
          <FSelect label="Agent" value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
            <option value="">All agents</option>
            {companyUsers.map(u => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
          </FSelect>
          <FSelect label="Status" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {CALLBACK_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
          </FSelect>
          <FSelect label="Priority" value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="">All priorities</option>
            <option value="High">🔴 High</option>
            <option value="Medium">🟡 Medium</option>
            <option value="Low">🔵 Low</option>
          </FSelect>
          <FInput label="From" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <FInput label="To"   type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)} />
        </Filters>

        {/* Priority stats bar */}
        {callbacks.length > 0 && <PriorityStatsBar callbacks={callbacks} />}

        <div className="rounded-xl overflow-hidden"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          {loading ? <Spinner /> : sorted.length === 0 ? (
            <Empty icon={PhoneCall} msg="No callbacks found." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                    <SortTh col="customer"    sort={sort} onSort={toggleSort}>Customer</SortTh>
                    <SortTh col="priority"    sort={sort} onSort={toggleSort}>Priority</SortTh>
                    <SortTh col="callback_at" sort={sort} onSort={toggleSort}>Scheduled At</SortTh>
                    <SortTh col="agent"       sort={sort} onSort={toggleSort}>Agent</SortTh>
                    <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>Company</th>
                    <SortTh col="status"      sort={sort} onSort={toggleSort}>Status</SortTh>
                    <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(c => (
                    <tr key={c.id} className="cursor-pointer"
                      style={{ borderBottom: '1px solid var(--color-border)' }}
                      onClick={() => setDetail(c)}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>

                      <td className="px-4 py-3">
                        <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{c.customer_name || '—'}</p>
                        {c.customer_phone ? (
                          <button onClick={e => { e.stopPropagation(); setPhoneDrawer({ phone: c.customer_phone, customerName: c.customer_name }); }}
                            className="text-xs mt-0.5 font-mono hover:underline text-left"
                            style={{ color: 'var(--color-primary-600)' }}
                            title="View all callbacks for this number">
                            {c.customer_phone}
                          </button>
                        ) : null}
                      </td>

                      <td className="px-4 py-3">
                        <PriorityBadge priority={c.priority} />
                      </td>

                      <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                        <div className="flex items-center gap-1">
                          {fmtDateTime(c.callback_at)}
                          <OverdueDot callback={c} />
                        </div>
                      </td>

                      <td className="px-4 py-3 text-xs">
                        <button
                          onClick={e => { e.stopPropagation(); setAgentStats({ userId: c.user_id, userName: c.user_name || '—', companyName: c.company_name }); }}
                          className="hover:underline font-medium flex items-center gap-1"
                          style={{ color: 'var(--color-primary-600)' }}
                          title="View agent report">
                          {c.user_name || '—'}
                          <BarChart3 size={10} className="opacity-60" />
                        </button>
                      </td>

                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{c.company_name || '—'}</td>

                      <td className="px-4 py-3">
                        <Badge variant={STATUS_BADGE[c.status] || 'secondary'} size="sm">
                          {STATUS_LABEL[c.status] || c.status?.replace(/_/g,' ')}
                        </Badge>
                      </td>

                      <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>
                        {c.notes || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} total={total} limit={LIMIT} onPage={setPage} />
        </div>

        {/* Callback detail modal */}
        {detail && (
          <Overlay>
            <ModalBox>
              <ModalHeader icon={PhoneCall} title="Callback Record"
                subtitle={detail.customer_name || '—'} onClose={() => setDetail(null)} />
              <div className="overflow-y-auto p-6 space-y-5">
                <section>
                  <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-secondary)' }}>Customer</p>
                  <div className="grid grid-cols-2 gap-3">
                    <InfoTile label="Name"  value={detail.customer_name} />
                    <InfoTile label="Phone" value={detail.customer_phone} />
                  </div>
                </section>

                <section>
                  <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-secondary)' }}>Callback Details</p>
                  <div className="grid grid-cols-2 gap-3">
                    <InfoTile label="Scheduled At" value={fmtDateTime(detail.callback_at)} />
                    <InfoTile label="Status"   value={<Badge variant={STATUS_BADGE[detail.status] || 'secondary'} size="sm">{STATUS_LABEL[detail.status] || detail.status}</Badge>} />
                    <InfoTile label="Priority" value={<PriorityBadge priority={detail.priority} />} />
                    <InfoTile label="Agent"    value={
                      detail.user_name ? (
                        <button onClick={() => { setDetail(null); setAgentStats({ userId: detail.user_id, userName: detail.user_name, companyName: detail.company_name }); }}
                          className="hover:underline text-left flex items-center gap-1"
                          style={{ color: 'var(--color-primary-600)' }}>
                          {detail.user_name} <BarChart3 size={10} />
                        </button>
                      ) : '—'
                    } />
                    <InfoTile label="Company"  value={detail.company_name} />
                  </div>
                </section>

                {detail.notes && (
                  <section>
                    <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-secondary)' }}>Notes</p>
                    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                      <p className="text-sm" style={{ color: 'var(--color-text)' }}>{detail.notes}</p>
                    </div>
                  </section>
                )}

                <section>
                  <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-secondary)' }}>Trace Info</p>
                  <div className="grid grid-cols-2 gap-3">
                    <InfoTile label="Record ID"  value={detail.id} />
                    <InfoTile label="Entered At" value={fmtDateTime(detail.created_at)} />
                    <InfoTile label="Push Sent"  value={detail.notified ? 'Yes — OS notification fired' : 'No — not yet notified'} />
                  </div>
                </section>
              </div>
              <div className="px-6 pb-6 pt-3 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
                <button onClick={() => setDetail(null)}
                  className="w-full py-2.5 rounded-xl border font-semibold text-sm"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  Close
                </button>
              </div>
            </ModalBox>
          </Overlay>
        )}

        {exportOpen && (
          <ExportModal tab="callbacks" companyList={sortedCompanies} cbType={cbType}
            onClose={() => setExportOpen(false)} onExport={handleExport} />
        )}

        {phoneDrawer && (
          <CallbackPhoneHistoryDrawer
            phone={phoneDrawer.phone}
            customerName={phoneDrawer.customerName}
            onClose={() => setPhoneDrawer(null)}
          />
        )}

        {agentStats && (
          <AgentStatsModal
            userId={agentStats.userId}
            userName={agentStats.userName}
            companyName={agentStats.companyName}
            onClose={() => setAgentStats(null)}
          />
        )}
      </>}
    </div>
  );
};

export default CallbacksTab;
