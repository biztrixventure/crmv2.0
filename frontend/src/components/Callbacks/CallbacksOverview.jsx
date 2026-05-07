/**
 * CallbacksOverview — manager/admin read-only team view.
 * Self-contained: fetches its own agent list and summary stats.
 * Server-side filtering + pagination (PAGE_SIZE=25).
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Phone, Clock, CheckCircle, XCircle, PhoneOff,
  Calendar, User, Filter, RefreshCw, Voicemail, X,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import client from '../../api/client';

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

const fmt = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
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
  const [stats,          setStats]          = useState({ pending: 0, overdue: 0, completed: 0 });
  const [updatingId,     setUpdatingId]     = useState(null);
  const [outcomeModal,   setOutcomeModal]   = useState(null);

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
      if (memberFilter)             base.user_id  = memberFilter;
      if (priorityFilter !== 'all') base.priority = priorityFilter;
      const [pRes, cRes, oRes] = await Promise.all([
        client.get('callbacks', { params: { ...base, status: 'pending' } }),
        client.get('callbacks', { params: { ...base, status: 'completed' } }),
        client.get('callbacks', { params: { ...base, overdue: 'true' } }),
      ]);
      setStats({
        pending:   pRes.data.total || 0,
        completed: cRes.data.total || 0,
        overdue:   oRes.data.total || 0,
      });
    } catch {}
  }, [cid, memberFilter, priorityFilter]);

  // Fetch paginated callbacks list
  const fetchCallbacks = useCallback(async () => {
    if (!cid) return;
    setLoading(true);
    try {
      const params = { company_id: cid, page, limit: PAGE_SIZE };
      if (statusFilter   !== 'all') params.status   = statusFilter;
      if (priorityFilter !== 'all') params.priority = priorityFilter;
      if (memberFilter)             params.user_id  = memberFilter;
      const res = await client.get('callbacks', { params });
      setCallbacks(res.data.callbacks || []);
      setTotal(res.data.total || 0);
    } catch {} finally { setLoading(false); }
  }, [cid, statusFilter, priorityFilter, memberFilter, page]);

  useEffect(() => { fetchCallbacks(); }, [fetchCallbacks]);
  useEffect(() => { fetchStats(); },    [fetchStats]);

  const handleStatusFilter   = (v) => { setStatusFilter(v);   setPage(1); };
  const handlePriorityFilter = (v) => { setPriorityFilter(v); setPage(1); };
  const handleMemberFilter   = (v) => { setMemberFilter(v);   setPage(1); };

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

      {/* Stats row — accurate totals, not page counts */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: 'Pending',   value: stats.pending,   color: '#f59e0b', bg: '#fef3c7', key: 'pending'   },
          { label: 'Overdue',   value: stats.overdue,   color: '#ef4444', bg: '#fee2e2', key: 'overdue'   },
          { label: 'Completed', value: stats.completed, color: '#10b981', bg: '#d1fae5', key: 'completed' },
        ].map(s => (
          <button key={s.key} onClick={() => s.key !== 'overdue' && handleStatusFilter(statusFilter === s.key ? 'all' : s.key)}
            className="rounded-xl p-3 text-center transition-all"
            style={{
              backgroundColor: s.bg,
              border: `1px solid ${s.color}${statusFilter === s.key ? 'cc' : '30'}`,
              boxShadow: statusFilter === s.key ? `0 0 0 2px ${s.color}40` : 'none',
              cursor: s.key !== 'overdue' ? 'pointer' : 'default',
            }}>
            <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-xs font-semibold mt-0.5" style={{ color: s.color }}>{s.label}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        {/* Status tabs */}
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

        {/* Priority tabs */}
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

        {/* Agent dropdown — all company agents, not page-derived */}
        {agentsList.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter size={14} style={{ color: 'var(--color-text-tertiary)' }} />
            <select value={memberFilter} onChange={e => handleMemberFilter(e.target.value)}
              className="input py-1.5 text-sm h-auto" style={{ minWidth: 160 }}>
              <option value="">All team members</option>
              {agentsList.map(a => (
                <option key={a.user_id} value={a.user_id}>
                  {`${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email || ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Clear filters */}
        {(statusFilter !== 'all' || priorityFilter !== 'all' || memberFilter) && (
          <button onClick={() => { setStatusFilter('all'); setPriorityFilter('all'); setMemberFilter(''); setPage(1); }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{ color: 'var(--color-error-600)', border: '1px solid var(--color-error-200)' }}>
            <XCircle size={11} /> Clear filters
          </button>
        )}
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
                        <span>Call scheduled: <strong>{fmt(cb.callback_at)}</strong></span>
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

                    {/* Manager status actions */}
                    {cb.status === 'pending' && (
                      <div className="flex flex-col gap-1.5 flex-shrink-0">
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
                      </div>
                    )}
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
    </div>
  );
};

export default CallbacksOverview;
