/**
 * CallbacksOverview — manager/admin read-only team view.
 * Self-contained: fetches its own agent list and summary stats.
 * Server-side filtering + pagination (PAGE_SIZE=25).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import ThemedSelect from '../UI/Select';
import {
  Phone, Clock, CheckCircle, XCircle, PhoneOff,
  Calendar, User, Filter, RefreshCw, Voicemail, X,
  ChevronLeft, ChevronRight, History, ArrowRight, Search, CalendarDays,
} from 'lucide-react';
import client from '../../api/client';
import { ET_ZONE, todayET } from '../../utils/timezone';

const PAGE_SIZE = 25;

const STATUS_CONFIG = {
  pending:           { label: 'Pending',          color: '#f59e0b', bg: '#fef3c7', icon: Clock       },
  completed:         { label: 'Completed',         color: '#10b981', bg: '#d1fae5', icon: CheckCircle  },
  cancelled:         { label: 'Cancelled',         color: '#ef4444', bg: '#fee2e2', icon: XCircle      },
  no_answer:         { label: 'No Answer',         color: '#6b7280', bg: '#f3f4f6', icon: PhoneOff     },
  answering_machine: { label: 'Answering Machine', color: '#8b5cf6', bg: '#ede9fe', icon: Voicemail    },
};

const PRIORITY_CONFIG = {
  High:   { color: '#dc2626', bg: '#fee2e2', dot: '#ef4444' },
  Medium: { color: '#d97706', bg: '#fef3c7', dot: '#f59e0b' },
  Low:    { color: '#2563eb', bg: '#dbeafe', dot: '#3b82f6' },
};

const PriorityBadge = ({ priority }) => {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.Medium;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
      {priority || 'Medium'}
    </span>
  );
};

const StatusBadge = ({ status }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
};

const today = () => todayET();

const fmt = (iso) => {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: ET_ZONE, month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch { return '—'; }
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: ET_ZONE, month: 'short', day: 'numeric', year: 'numeric',
    }).format(new Date(iso));
  } catch { return '—'; }
};

const isPast    = (iso) => iso && new Date(iso) < new Date();
const isDueSoon = (iso) => {
  if (!iso) return false;
  const diff = new Date(iso) - new Date();
  return diff > 0 && diff < 30 * 60 * 1000;
};

// ── Pagination ───────────────────────────────────────────────────────────────
const Pagination = ({ page, total, pageSize, onChange }) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-3 mt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
      <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(page - 1)} disabled={page <= 1}
          className="p-1.5 rounded-lg border disabled:opacity-40 hover:bg-bg-secondary transition-colors"
          style={{ borderColor: 'var(--color-border)' }}>
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{page} / {totalPages}</span>
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages}
          className="p-1.5 rounded-lg border disabled:opacity-40 hover:bg-bg-secondary transition-colors"
          style={{ borderColor: 'var(--color-border)' }}>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
};

// ── History Timeline Modal ───────────────────────────────────────────────────
const ACTION_CONFIG = {
  created:      { label: 'Created',       color: '#2563eb', bg: '#dbeafe' },
  status_change:{ label: 'Status Changed',color: '#7c3aed', bg: '#ede9fe' },
  rescheduled:  { label: 'Rescheduled',   color: '#d97706', bg: '#fef3c7' },
};

const HistoryModal = ({ callbackId, onClose }) => {
  const [loading, setLoading]   = useState(true);
  const [data,    setData]      = useState(null);

  useEffect(() => {
    client.get(`callbacks/${callbackId}/history`)
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [callbackId]);

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl shadow-2xl animate-fade-in"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 rounded-t-2xl"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <div className="flex items-center gap-2">
              <History size={16} className="text-white" />
              <h3 className="font-bold text-base text-white">
                Activity History
                {data?.callback?.customer_name && (
                  <span className="ml-2 font-normal text-white/80">— {data.callback.customer_name}</span>
                )}
              </h3>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
              <X size={15} className="text-white" />
            </button>
          </div>

          <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary-600" />
              </div>
            ) : !data ? (
              <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-secondary)' }}>
                Failed to load history.
              </p>
            ) : (
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-4 top-2 bottom-2 w-0.5"
                  style={{ backgroundColor: 'var(--color-border)' }} />

                <div className="space-y-4 pl-10">
                  {data.timeline.map((item, i) => {
                    const cfg = ACTION_CONFIG[item.action] || ACTION_CONFIG.status_change;
                    return (
                      <div key={i} className="relative">
                        {/* Dot */}
                        <div className="absolute -left-10 top-1 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center"
                          style={{ backgroundColor: cfg.color }}>
                          <div className="w-1.5 h-1.5 rounded-full bg-white" />
                        </div>

                        <div className="rounded-xl p-3"
                          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                          <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                              {cfg.label}
                            </span>
                            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                              {fmt(item.occurred_at)}
                            </span>
                          </div>

                          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
                            by {item.actor_name}
                          </p>

                          {/* Status change */}
                          {item.action === 'status_change' && item.old_status && (
                            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                              <StatusBadge status={item.old_status} />
                              <ArrowRight size={11} />
                              <StatusBadge status={item.new_status} />
                            </div>
                          )}

                          {/* Created — show scheduled time */}
                          {item.action === 'created' && item.callback_at && (
                            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                              <Calendar size={11} />
                              <span>Scheduled for <strong>{fmt(item.callback_at)}</strong></span>
                            </div>
                          )}

                          {/* Reschedule */}
                          {item.action === 'rescheduled' && (
                            <div className="text-xs space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                              <div className="flex items-center gap-1.5">
                                <span className="line-through">{fmt(item.old_callback_at)}</span>
                                <ArrowRight size={10} />
                                <span className="font-semibold" style={{ color: 'var(--color-text)' }}>
                                  {fmt(item.new_callback_at)}
                                </span>
                              </div>
                            </div>
                          )}

                          {item.notes && (
                            <p className="text-xs italic mt-1.5 px-2 py-1 rounded-lg"
                              style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                              "{item.notes}"
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Outcome Notes Modal ──────────────────────────────────────────────────────
const StatusOutcomeModal = ({ pendingStatus, customerName, onConfirm, onClose }) => {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (withNotes) => {
    setSaving(true);
    await onConfirm(pendingStatus, withNotes ? notes.trim() : '');
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-fade-in"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-base" style={{ color: 'var(--color-text)' }}>Outcome Notes</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-secondary transition-colors">
            <X size={15} style={{ color: 'var(--color-text-tertiary)' }} />
          </button>
        </div>

        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Marking <strong style={{ color: 'var(--color-text)' }}>{customerName}</strong> as
          </span>
          <StatusBadge status={pendingStatus} />
        </div>

        <div className="mb-5">
          <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
            Call outcome
            <span className="ml-1 font-normal text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              (optional but recommended)
            </span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="input"
            rows={3}
            placeholder={
              pendingStatus === 'answering_machine' ? 'Left voicemail. Will call again tomorrow...'
              : pendingStatus === 'no_answer'       ? 'No answer. Will retry in 2 hours...'
              : pendingStatus === 'completed'       ? 'Spoke with customer. Resolved / booked...'
              : 'Add notes about this call...'
            }
            autoFocus
          />
        </div>

        <div className="flex justify-end gap-3">
          <button onClick={() => submit(false)} disabled={saving}
            className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
            Skip
          </button>
          <button onClick={() => submit(true)} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{ background: 'var(--gradient-sidebar)' }}>
            {saving
              ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              : <CheckCircle size={14} />}
            Save & Submit
          </button>
        </div>
      </div>
      </div>
    </div>
  );
};

// ── Main Component ───────────────────────────────────────────────────────────
const CallbacksOverview = ({ user }) => {
  const [agentsList,     setAgentsList]     = useState([]);
  const [callbacks,      setCallbacks]      = useState([]);
  const [total,          setTotal]          = useState(0);
  const [page,           setPage]           = useState(1);
  const [loading,        setLoading]        = useState(false);
  const [statusFilter,   setStatusFilter]   = useState('all');
  const [memberFilter,   setMemberFilter]   = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [dateFrom,       setDateFrom]       = useState('');   // filters on callback_at (scheduled)
  const [dateTo,         setDateTo]         = useState('');
  const [createdFrom,    setCreatedFrom]    = useState('');   // filters on created_at
  const [createdTo,      setCreatedTo]      = useState('');
  const [search,         setSearch]         = useState('');
  const [searchInput,    setSearchInput]    = useState('');
  const [stats,          setStats]          = useState({ total: 0, pending: 0, overdue: 0, completed: 0 });
  const [updatingId,     setUpdatingId]     = useState(null);
  const [outcomeModal,   setOutcomeModal]   = useState(null);
  const [historyId,      setHistoryId]      = useState(null);
  const searchTimer = useRef(null);

  const cid = user?.company_id;

  // Load all company agents once — independent of pagination
  useEffect(() => {
    if (!cid) return;
    client.get('users', { params: { company_id: cid } })
      .then(r => setAgentsList(r.data.users || []))
      .catch(() => {});
  }, [cid]);

  // Fetch accurate total counts (independent of current page / status tab)
  const fetchStats = useCallback(async () => {
    if (!cid) return;
    try {
      const base = { company_id: cid, limit: 1, page: 1 };
      if (memberFilter)             base.user_id      = memberFilter;
      if (priorityFilter !== 'all') base.priority     = priorityFilter;
      if (dateFrom)                 base.date_from    = dateFrom;
      if (dateTo)                   base.date_to      = dateTo;
      if (createdFrom)              base.created_from = createdFrom;
      if (createdTo)                base.created_to   = createdTo;
      if (search)                   base.search       = search;
      const [totRes, pRes, cRes, oRes] = await Promise.all([
        client.get('callbacks', { params: { ...base } }),
        client.get('callbacks', { params: { ...base, status: 'pending' } }),
        client.get('callbacks', { params: { ...base, status: 'completed' } }),
        client.get('callbacks', { params: { ...base, overdue: 'true' } }),
      ]);
      setStats({
        total:     totRes.data.total || 0,
        pending:   pRes.data.total   || 0,
        completed: cRes.data.total   || 0,
        overdue:   oRes.data.total   || 0,
      });
    } catch {}
  }, [cid, memberFilter, priorityFilter, dateFrom, dateTo, createdFrom, createdTo, search]);

  // Fetch paginated callbacks list
  const fetchCallbacks = useCallback(async () => {
    if (!cid) return;
    setLoading(true);
    try {
      const params = { company_id: cid, page, limit: PAGE_SIZE };
      if (statusFilter   !== 'all') params.status       = statusFilter;
      if (priorityFilter !== 'all') params.priority     = priorityFilter;
      if (memberFilter)             params.user_id      = memberFilter;
      if (dateFrom)                 params.date_from    = dateFrom;
      if (dateTo)                   params.date_to      = dateTo;
      if (createdFrom)              params.created_from = createdFrom;
      if (createdTo)                params.created_to   = createdTo;
      if (search)                   params.search       = search;
      const res = await client.get('callbacks', { params });
      setCallbacks(res.data.callbacks || []);
      setTotal(res.data.total || 0);
    } catch {} finally { setLoading(false); }
  }, [cid, statusFilter, priorityFilter, memberFilter, dateFrom, dateTo, createdFrom, createdTo, search, page]);

  useEffect(() => { fetchCallbacks(); }, [fetchCallbacks]);
  useEffect(() => { fetchStats(); },    [fetchStats]);

  const handleStatusFilter   = (v) => { setStatusFilter(v);   setPage(1); };
  const handlePriorityFilter = (v) => { setPriorityFilter(v); setPage(1); };
  const handleMemberFilter   = (v) => { setMemberFilter(v);   setPage(1); };
  const handleDateFrom       = (v) => { setDateFrom(v);       setPage(1); };
  const handleDateTo         = (v) => { setDateTo(v);         setPage(1); };
  const handleCreatedFrom    = (v) => { setCreatedFrom(v);    setPage(1); };
  const handleCreatedTo      = (v) => { setCreatedTo(v);      setPage(1); };

  const handleCreatedToday = () => {
    const t = today();
    setCreatedFrom(t);
    setCreatedTo(t);
    setPage(1);
  };

  const handleSearchInput = (v) => {
    setSearchInput(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setSearch(v); setPage(1); }, 400);
  };

  const clearAllFilters = () => {
    setStatusFilter('all');
    setPriorityFilter('all');
    setMemberFilter('');
    setDateFrom('');
    setDateTo('');
    setCreatedFrom('');
    setCreatedTo('');
    setSearch('');
    setSearchInput('');
    setPage(1);
  };

  const hasFilters = statusFilter !== 'all' || priorityFilter !== 'all' || memberFilter || dateFrom || dateTo || createdFrom || createdTo || search;

  const handleStatusConfirm = async (status, notes) => {
    if (!outcomeModal) return;
    const { id } = outcomeModal;
    setUpdatingId(id);
    try {
      const payload = { status };
      if (notes) payload.notes = notes;
      const res = await client.put(`callbacks/${id}`, payload);
      setCallbacks(prev => prev.map(c => c.id === id ? { ...c, ...res.data.callback } : c));
      fetchStats(); // refresh totals after status change
    } catch {} finally { setUpdatingId(null); }
    setOutcomeModal(null);
  };

  const handleStatusClick = (id, status, customerName) => {
    setOutcomeModal({ id, status, customerName });
  };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Phone size={15} style={{ color: 'var(--color-primary-600)' }} />
            Team Callbacks
            {stats.overdue > 0 && (
              <span className="ml-1 text-xs font-bold px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: '#ef4444' }}>
                {stats.overdue} overdue
              </span>
            )}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Scheduled callbacks across your team — when to call and current status.
          </p>
        </div>
        <button onClick={() => { fetchCallbacks(); fetchStats(); }} disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors hover:bg-bg-secondary"
          style={{ color: 'var(--color-text-secondary)' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stats row — 4 cards, all respect active filters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {[
          { label: 'Total',     value: stats.total,     color: '#6366f1', bg: '#e0e7ff', key: null        },
          { label: 'Pending',   value: stats.pending,   color: '#f59e0b', bg: '#fef3c7', key: 'pending'   },
          { label: 'Overdue',   value: stats.overdue,   color: '#ef4444', bg: '#fee2e2', key: null        },
          { label: 'Completed', value: stats.completed, color: '#10b981', bg: '#d1fae5', key: 'completed' },
        ].map((s, i) => (
          <button key={i}
            onClick={() => s.key && handleStatusFilter(statusFilter === s.key ? 'all' : s.key)}
            className="rounded-xl p-3 text-center transition-all"
            style={{
              backgroundColor: s.bg,
              border: `1px solid ${s.color}${statusFilter === s.key ? 'cc' : '30'}`,
              boxShadow: statusFilter === s.key ? `0 0 0 2px ${s.color}40` : 'none',
              cursor: s.key ? 'pointer' : 'default',
            }}>
            <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-xs font-semibold mt-0.5" style={{ color: s.color }}>{s.label}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="space-y-2 mb-3">
        {/* Row 1: Status + Priority tabs */}
        <div className="flex flex-wrap gap-2">
          <div className="flex gap-1 p-1 rounded-xl"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {[
              { key: 'all',               label: 'All'          },
              { key: 'pending',           label: 'Pending'      },
              { key: 'completed',         label: 'Completed'    },
              { key: 'no_answer',         label: 'No Answer'    },
              { key: 'answering_machine', label: 'Ans. Machine' },
              { key: 'cancelled',         label: 'Cancelled'    },
            ].map(f => (
              <button key={f.key} onClick={() => handleStatusFilter(f.key)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  backgroundColor: statusFilter === f.key ? 'var(--color-surface)' : 'transparent',
                  color: statusFilter === f.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                  boxShadow: statusFilter === f.key ? 'var(--shadow-sm)' : 'none',
                }}>
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex gap-1 p-1 rounded-xl"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {[
              { key: 'all',    label: 'All Priority' },
              { key: 'High',   label: '🔴 High'      },
              { key: 'Medium', label: '🟡 Medium'     },
              { key: 'Low',    label: '🔵 Low'        },
            ].map(f => (
              <button key={f.key} onClick={() => handlePriorityFilter(f.key)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  backgroundColor: priorityFilter === f.key ? 'var(--color-surface)' : 'transparent',
                  color: priorityFilter === f.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                  boxShadow: priorityFilter === f.key ? 'var(--shadow-sm)' : 'none',
                }}>
                {f.label}
              </button>
            ))}
          </div>

          {hasFilters && (
            <button onClick={clearAllFilters}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold ml-auto"
              style={{ color: 'var(--color-error-600)', border: '1px solid var(--color-error-200)' }}>
              <XCircle size={11} /> Clear all
            </button>
          )}
        </div>

        {/* Row 2: Search + Agent + Member filter */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input
              value={searchInput}
              onChange={e => handleSearchInput(e.target.value)}
              placeholder="Search name, phone, notes…"
              className="input pl-8 py-1.5 text-sm h-auto"
              style={{ minWidth: 220 }}
            />
          </div>

          {/* Agent dropdown */}
          {agentsList.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Filter size={13} style={{ color: 'var(--color-text-tertiary)' }} />
              <ThemedSelect value={memberFilter} onChange={e => handleMemberFilter(e.target.value)}
                className="input py-1.5 text-sm h-auto" style={{ minWidth: 160 }}>
                <option value="">All team members</option>
                {agentsList.map(a => (
                  <option key={a.user_id} value={a.user_id}>
                    {`${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email || ''}
                  </option>
                ))}
              </ThemedSelect>
            </div>
          )}
        </div>

        {/* Row 3: Date filters */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Scheduled date range */}
          <div className="flex items-center gap-1.5">
            <Calendar size={13} style={{ color: 'var(--color-text-tertiary)' }} />
            <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Scheduled:</span>
            <input type="date" value={dateFrom} onChange={e => handleDateFrom(e.target.value)}
              className="input py-1.5 text-sm h-auto" style={{ minWidth: 130 }} />
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>–</span>
            <input type="date" value={dateTo} onChange={e => handleDateTo(e.target.value)}
              className="input py-1.5 text-sm h-auto" style={{ minWidth: 130 }} />
          </div>

          {/* Created date range + Today shortcut */}
          <div className="flex items-center gap-1.5">
            <CalendarDays size={13} style={{ color: 'var(--color-text-tertiary)' }} />
            <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Created:</span>
            <button
              onClick={handleCreatedToday}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all"
              style={{
                backgroundColor: createdFrom === today() && createdTo === today() ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)',
                color:            createdFrom === today() && createdTo === today() ? '#fff'                     : 'var(--color-primary-600)',
                border:           '1px solid var(--color-primary-300)',
              }}>
              Today
            </button>
            <input type="date" value={createdFrom} onChange={e => handleCreatedFrom(e.target.value)}
              className="input py-1.5 text-sm h-auto" style={{ minWidth: 130 }} />
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>–</span>
            <input type="date" value={createdTo} onChange={e => handleCreatedTo(e.target.value)}
              className="input py-1.5 text-sm h-auto" style={{ minWidth: 130 }} />
          </div>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : callbacks.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <Phone size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
          <p className="font-semibold" style={{ color: 'var(--color-text)' }}>No callbacks found</p>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            No callbacks match the current filters.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {callbacks.map(cb => {
              const past = isPast(cb.callback_at) && cb.status === 'pending';
              const soon = isDueSoon(cb.callback_at);
              return (
                <div key={cb.id}
                  className="rounded-xl border p-3 transition-all duration-150 hover:shadow-md"
                  style={{
                    borderColor: past ? '#fca5a5' : soon ? '#fde68a' : 'var(--color-border)',
                    backgroundColor: past ? '#fff5f5' : soon ? '#fffbeb' : 'var(--color-surface)',
                  }}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className="font-bold text-sm text-text">{cb.customer_name}</p>
                        <StatusBadge status={cb.status} />
                        <PriorityBadge priority={cb.priority} />
                        {past && <span className="text-xs font-bold text-red-600">Overdue</span>}
                        {soon && !past && <span className="text-xs font-bold" style={{ color: '#b45309' }}>Due soon</span>}
                      </div>

                      <div className="flex items-center gap-1.5 mb-1">
                        <div className="w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ background: 'var(--gradient-sidebar)' }}>
                          <User size={9} className="text-white" />
                        </div>
                        <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                          {cb.user_name || 'Unknown'}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-x-3 text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                        {cb.customer_phone && <span>📞 {cb.customer_phone}</span>}
                        {cb.customer_email && <span>✉ {cb.customer_email}</span>}
                      </div>

                      <div className="flex items-center gap-1.5 text-xs font-medium"
                        style={{ color: past ? '#dc2626' : soon ? '#b45309' : 'var(--color-text-tertiary)' }}>
                        <Calendar size={11} />
                        <span>Scheduled: <strong>{fmt(cb.callback_at)}</strong></span>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                        <CalendarDays size={10} />
                        <span>Created: {fmtDate(cb.created_at)}</span>
                      </div>

                      {cb.notes && (
                        <p className="text-xs italic mt-1 px-2 py-1 rounded-lg"
                          style={{
                            backgroundColor: 'var(--color-bg-secondary)',
                            color: 'var(--color-text-secondary)',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}>
                          {cb.notes}
                        </p>
                      )}
                    </div>

                    {/* Actions column */}
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      {cb.status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleStatusClick(cb.id, 'completed', cb.customer_name)}
                            disabled={updatingId === cb.id}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:scale-105 disabled:opacity-50"
                            style={{ backgroundColor: '#d1fae5', color: '#065f46' }}>
                            <CheckCircle size={12} /> Mark Done
                          </button>
                          <button
                            onClick={() => handleStatusClick(cb.id, 'no_answer', cb.customer_name)}
                            disabled={updatingId === cb.id}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:scale-105 disabled:opacity-50"
                            style={{ backgroundColor: '#f3f4f6', color: '#374151' }}>
                            <PhoneOff size={12} /> No Answer
                          </button>
                          <button
                            onClick={() => handleStatusClick(cb.id, 'answering_machine', cb.customer_name)}
                            disabled={updatingId === cb.id}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:scale-105 disabled:opacity-50"
                            style={{ backgroundColor: '#ede9fe', color: '#6d28d9' }}>
                            <Voicemail size={12} /> Ans. Machine
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => setHistoryId(cb.id)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:scale-105"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                        <History size={12} /> History
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}

      {outcomeModal && (
        <StatusOutcomeModal
          pendingStatus={outcomeModal.status}
          customerName={outcomeModal.customerName}
          onConfirm={handleStatusConfirm}
          onClose={() => setOutcomeModal(null)}
        />
      )}

      {historyId && (
        <HistoryModal
          callbackId={historyId}
          onClose={() => setHistoryId(null)}
        />
      )}
    </div>
  );
};

export default CallbacksOverview;
