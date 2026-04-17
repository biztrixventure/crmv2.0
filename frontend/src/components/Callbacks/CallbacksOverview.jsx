/**
 * CallbacksOverview — manager/admin read-only team view.
 * Shows all company callbacks with who scheduled them, when, and status.
 * Filter by team member and status. Managers can update status.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Phone, Clock, CheckCircle, XCircle, PhoneOff,
  Calendar, User, Filter, RefreshCw,
} from 'lucide-react';
import client from '../../api/client';

const STATUS_CONFIG = {
  pending:   { label: 'Pending',   color: '#f59e0b', bg: '#fef3c7', icon: Clock      },
  completed: { label: 'Completed', color: '#10b981', bg: '#d1fae5', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: '#ef4444', bg: '#fee2e2', icon: XCircle     },
  no_answer: { label: 'No Answer', color: '#6b7280', bg: '#f3f4f6', icon: PhoneOff    },
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

const CallbacksOverview = ({ user }) => {
  const [callbacks,     setCallbacks]     = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [statusFilter,  setStatusFilter]  = useState('all');
  const [memberFilter,  setMemberFilter]  = useState('all');
  const [updatingId,    setUpdatingId]    = useState(null);

  // Derived list of unique team members from loaded callbacks
  const members = useCallback(() => {
    const map = {};
    callbacks.forEach(c => {
      if (c.user_id && !map[c.user_id]) map[c.user_id] = c.user_name || 'Unknown';
    });
    return Object.entries(map).map(([id, name]) => ({ id, name }));
  }, [callbacks]);

  const fetchCallbacks = useCallback(async () => {
    if (!user?.company_id) return;
    setLoading(true);
    try {
      const params = { company_id: user.company_id };
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await client.get('callbacks', { params });
      setCallbacks(res.data.callbacks || []);
    } catch { /* non-critical */ } finally {
      setLoading(false);
    }
  }, [user?.company_id, statusFilter]);

  useEffect(() => { fetchCallbacks(); }, [fetchCallbacks]);

  const handleStatusUpdate = async (id, status) => {
    setUpdatingId(id);
    try {
      const res = await client.put(`callbacks/${id}`, { status });
      setCallbacks(prev => prev.map(c => c.id === id ? { ...c, ...res.data.callback } : c));
    } catch { /* non-critical */ } finally {
      setUpdatingId(null);
    }
  };

  const visible = callbacks.filter(c =>
    memberFilter === 'all' || c.user_id === memberFilter
  );

  const counts = {
    pending:   callbacks.filter(c => c.status === 'pending').length,
    overdue:   callbacks.filter(c => c.status === 'pending' && isPast(c.callback_at)).length,
    completed: callbacks.filter(c => c.status === 'completed').length,
  };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Phone size={22} style={{ color: 'var(--color-primary-600)' }} />
            Team Callbacks
            {counts.overdue > 0 && (
              <span className="ml-1 text-xs font-bold px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: '#ef4444' }}>
                {counts.overdue} overdue
              </span>
            )}
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Scheduled callbacks across your team — when to call and current status.
          </p>
        </div>
        <button onClick={fetchCallbacks} disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-colors hover:bg-bg-secondary"
          style={{ color: 'var(--color-text-secondary)' }}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Pending',    value: counts.pending,   color: '#f59e0b', bg: '#fef3c7'  },
          { label: 'Overdue',    value: counts.overdue,   color: '#ef4444', bg: '#fee2e2'  },
          { label: 'Completed',  value: counts.completed, color: '#10b981', bg: '#d1fae5'  },
        ].map(s => (
          <div key={s.label} className="rounded-2xl p-4 text-center"
            style={{ backgroundColor: s.bg, border: `1px solid ${s.color}30` }}>
            <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-xs font-semibold mt-0.5" style={{ color: s.color }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        {/* Status filter */}
        <div className="flex gap-1 p-1 rounded-xl"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {[
            { key: 'all',       label: 'All'       },
            { key: 'pending',   label: 'Pending'   },
            { key: 'completed', label: 'Completed' },
            { key: 'no_answer', label: 'No Answer' },
          ].map(f => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
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

        {/* Member filter */}
        {members().length > 0 && (
          <div className="flex items-center gap-2">
            <Filter size={14} style={{ color: 'var(--color-text-tertiary)' }} />
            <select
              value={memberFilter}
              onChange={e => setMemberFilter(e.target.value)}
              className="input py-1.5 text-sm h-auto"
              style={{ minWidth: 160 }}>
              <option value="all">All team members</option>
              {members().map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <Phone size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
          <p className="font-semibold" style={{ color: 'var(--color-text)' }}>No callbacks found</p>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            No callbacks match the current filters.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(cb => {
            const past = isPast(cb.callback_at) && cb.status === 'pending';
            const soon = isDueSoon(cb.callback_at);
            return (
              <div key={cb.id}
                className="rounded-2xl border p-4 transition-all duration-150 hover:shadow-md"
                style={{
                  borderColor: past ? '#fca5a5' : soon ? '#fde68a' : 'var(--color-border)',
                  backgroundColor: past ? '#fff5f5' : soon ? '#fffbeb' : 'var(--color-surface)',
                }}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">

                    {/* Name + status */}
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="font-bold text-text">{cb.customer_name}</p>
                      <StatusBadge status={cb.status} />
                      {past && <span className="text-xs font-bold text-red-600">Overdue</span>}
                      {soon && !past && <span className="text-xs font-bold" style={{ color: '#b45309' }}>Due soon</span>}
                    </div>

                    {/* Assigned to (who scheduled this callback) */}
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: 'var(--gradient-sidebar)' }}>
                        <User size={11} className="text-white" />
                      </div>
                      <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                        {cb.user_name || 'Unknown'}
                      </span>
                    </div>

                    {/* Contact details */}
                    <div className="flex flex-wrap gap-x-3 text-xs mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                      {cb.customer_phone && <span>📞 {cb.customer_phone}</span>}
                      {cb.customer_email && <span>✉ {cb.customer_email}</span>}
                    </div>

                    {/* Callback time */}
                    <div className="flex items-center gap-1.5 text-xs font-medium"
                      style={{ color: past ? '#dc2626' : soon ? '#b45309' : 'var(--color-text-tertiary)' }}>
                      <Calendar size={12} />
                      <span>Call scheduled: <strong>{fmt(cb.callback_at)}</strong></span>
                    </div>

                    {cb.notes && (
                      <p className="text-xs italic mt-1.5 px-2 py-1 rounded-lg"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                        {cb.notes}
                      </p>
                    )}
                  </div>

                  {/* Manager: update status */}
                  {cb.status === 'pending' && (
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => handleStatusUpdate(cb.id, 'completed')}
                        disabled={updatingId === cb.id}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:scale-105 disabled:opacity-50"
                        style={{ backgroundColor: '#d1fae5', color: '#065f46' }}>
                        <CheckCircle size={12} /> Mark Done
                      </button>
                      <button
                        onClick={() => handleStatusUpdate(cb.id, 'no_answer')}
                        disabled={updatingId === cb.id}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:scale-105 disabled:opacity-50"
                        style={{ backgroundColor: '#f3f4f6', color: '#374151' }}>
                        <PhoneOff size={12} /> No Answer
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CallbacksOverview;
