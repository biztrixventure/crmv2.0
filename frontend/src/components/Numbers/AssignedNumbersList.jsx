/**
 * AssignedNumbersList — fronter view of their assigned phone numbers.
 * Shows each number with status and quick-action buttons.
 * Groups by list_name. Filter by status.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Phone, CheckCircle, PhoneOff, RefreshCw,
  Clock, SkipForward, PhoneCall, RotateCcw, Filter,
} from 'lucide-react';
import client from '../../api/client';

const STATUS_CONFIG = {
  new:       { label: 'New',       bg: '#eff6ff', color: '#2563eb', icon: Phone       },
  called:    { label: 'Called',    bg: '#fef3c7', color: '#d97706', icon: PhoneCall   },
  callback:  { label: 'Callback',  bg: '#f3e8ff', color: '#7c3aed', icon: Clock       },
  completed: { label: 'Done',      bg: '#d1fae5', color: '#059669', icon: CheckCircle },
  skip:      { label: 'Skip',      bg: '#f3f4f6', color: '#6b7280', icon: SkipForward },
};

const StatusBadge = ({ status }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.new;
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      <Icon size={10} />
      {cfg.label}
    </span>
  );
};

const AssignedNumbersList = ({ user }) => {
  const [numbers,     setNumbers]     = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [statusFilter,setStatusFilter] = useState('all');
  const [updatingId,  setUpdatingId]  = useState(null);

  const fetchNumbers = useCallback(async () => {
    if (!user?.company_id) return;
    setLoading(true);
    try {
      const params = { company_id: user.company_id };
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await client.get('number-lists', { params });
      setNumbers(res.data.numbers || []);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [user?.company_id, statusFilter]);

  useEffect(() => { fetchNumbers(); }, [fetchNumbers]);

  const updateStatus = async (id, status) => {
    setUpdatingId(id);
    try {
      const res = await client.put(`number-lists/${id}`, { status });
      setNumbers(prev => prev.map(n => n.id === id ? { ...n, ...res.data.number } : n));
    } catch { /* non-critical */ } finally { setUpdatingId(null); }
  };

  // Group by list_name
  const grouped = {};
  numbers.forEach(n => {
    if (!grouped[n.list_name]) grouped[n.list_name] = [];
    grouped[n.list_name].push(n);
  });

  const counts = {
    all:       numbers.length,
    new:       numbers.filter(n => n.status === 'new').length,
    called:    numbers.filter(n => n.status === 'called').length,
    callback:  numbers.filter(n => n.status === 'callback').length,
    completed: numbers.filter(n => n.status === 'completed').length,
    skip:      numbers.filter(n => n.status === 'skip').length,
  };

  return (
    <div className="animate-fade-in">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Phone size={22} style={{ color: 'var(--color-primary-600)' }} />
            My Numbers
            {counts.new > 0 && (
              <span className="ml-1 text-xs font-bold px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: '#2563eb' }}>
                {counts.new} new
              </span>
            )}
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Phone numbers assigned to you. Update status as you work through them.
          </p>
        </div>
        <button onClick={fetchNumbers} disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-colors hover:bg-bg-secondary"
          style={{ color: 'var(--color-text-secondary)' }}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-5">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
          const Icon = cfg.icon;
          return (
            <div key={key}
              className="rounded-xl p-3 text-center cursor-pointer transition-all hover:scale-105"
              style={{
                backgroundColor: statusFilter === key ? cfg.bg : 'var(--color-surface)',
                border: `1px solid ${statusFilter === key ? cfg.color + '40' : 'var(--color-border)'}`,
              }}
              onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}>
              <Icon size={16} className="mx-auto mb-1" style={{ color: cfg.color }} />
              <p className="text-lg font-bold" style={{ color: cfg.color }}>{counts[key]}</p>
              <p className="text-xs font-semibold mt-0.5" style={{ color: cfg.color }}>{cfg.label}</p>
            </div>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-5">
        <Filter size={14} style={{ color: 'var(--color-text-tertiary)' }} />
        <div className="flex gap-1 p-1 rounded-xl"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {[
            { key: 'all',       label: `All (${counts.all})`     },
            { key: 'new',       label: `New (${counts.new})`     },
            { key: 'called',    label: `Called (${counts.called})` },
            { key: 'callback',  label: `Callback (${counts.callback})` },
            { key: 'completed', label: `Done (${counts.completed})` },
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
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : numbers.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <Phone size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
          <p className="font-semibold" style={{ color: 'var(--color-text)' }}>No numbers assigned</p>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            Your manager will assign a phone number list to you.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([listName, items]) => (
            <div key={listName} className="rounded-2xl border overflow-hidden"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>

              {/* List header */}
              <div className="flex items-center justify-between px-5 py-3"
                style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                <div className="flex items-center gap-2">
                  <Phone size={15} style={{ color: 'var(--color-primary-600)' }} />
                  <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{listName}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                    style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
                    {items.length}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="font-medium" style={{ color: '#2563eb' }}>
                    {items.filter(n => n.status === 'new').length} new
                  </span>
                  <span>·</span>
                  <span className="font-medium" style={{ color: '#059669' }}>
                    {items.filter(n => n.status === 'completed').length} done
                  </span>
                </div>
              </div>

              {/* Numbers */}
              <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                {items.map(n => (
                  <div key={n.id} className="flex items-center justify-between px-4 py-3 group hover:bg-bg-secondary transition-colors gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
                          {n.phone_number}
                        </span>
                        <StatusBadge status={n.status} />
                      </div>
                      {n.customer_name && (
                        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                          {n.customer_name}
                        </p>
                      )}
                      {n.notes && (
                        <p className="text-xs italic mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                          {n.notes}
                        </p>
                      )}
                    </div>

                    {/* Quick actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {updatingId === n.id ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600" />
                      ) : (
                        <>
                          {n.status !== 'called' && n.status !== 'completed' && (
                            <button onClick={() => updateStatus(n.id, 'called')}
                              title="Mark as Called"
                              className="p-1.5 rounded-lg transition-colors hover:bg-warning-100">
                              <PhoneCall size={13} style={{ color: '#d97706' }} />
                            </button>
                          )}
                          {n.status !== 'completed' && (
                            <button onClick={() => updateStatus(n.id, 'completed')}
                              title="Mark as Done"
                              className="p-1.5 rounded-lg transition-colors hover:bg-success-100">
                              <CheckCircle size={13} style={{ color: '#059669' }} />
                            </button>
                          )}
                          {n.status !== 'callback' && n.status !== 'completed' && (
                            <button onClick={() => updateStatus(n.id, 'callback')}
                              title="Mark as Callback"
                              className="p-1.5 rounded-lg transition-colors"
                              style={{ ':hover': { backgroundColor: '#f3e8ff' } }}>
                              <Clock size={13} style={{ color: '#7c3aed' }} />
                            </button>
                          )}
                          {n.status !== 'skip' && n.status !== 'completed' && (
                            <button onClick={() => updateStatus(n.id, 'skip')}
                              title="Skip"
                              className="p-1.5 rounded-lg transition-colors hover:bg-gray-100">
                              <SkipForward size={13} style={{ color: '#6b7280' }} />
                            </button>
                          )}
                          {n.status !== 'new' && n.status !== 'completed' && (
                            <button onClick={() => updateStatus(n.id, 'new')}
                              title="Reset to New"
                              className="p-1.5 rounded-lg transition-colors hover:bg-blue-100 opacity-0 group-hover:opacity-100">
                              <RotateCcw size={12} style={{ color: '#6b7280' }} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AssignedNumbersList;
