/**
 * CallbacksPage — shared for Fronter and Closer dashboards.
 * Lists scheduled callbacks with status, allows create/edit/delete.
 * When a callback is due, the server sends both an in-app notification
 * and a browser push (OS notification center).
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Phone, Plus, Clock, CheckCircle, XCircle, PhoneOff,
  Trash2, Edit2, Bell, X, Calendar, Voicemail,
} from 'lucide-react';
import client from '../../api/client';
import { supabase } from '../../api/supabase';
import { usePushNotifications } from '../../hooks/usePushNotifications';

const STATUS_CONFIG = {
  pending:           { label: 'Pending',          color: '#f59e0b', bg: '#fef3c7', icon: Clock       },
  completed:         { label: 'Completed',         color: '#10b981', bg: '#d1fae5', icon: CheckCircle  },
  cancelled:         { label: 'Cancelled',         color: '#ef4444', bg: '#fee2e2', icon: XCircle      },
  no_answer:         { label: 'No Answer',         color: '#6b7280', bg: '#f3f4f6', icon: PhoneOff     },
  answering_machine: { label: 'Answering Machine', color: '#8b5cf6', bg: '#ede9fe', icon: Voicemail    },
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

const formatDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const isPast = (iso) => iso && new Date(iso) < new Date();
const isDueSoon = (iso) => {
  if (!iso) return false;
  const diff = new Date(iso) - new Date();
  return diff > 0 && diff < 30 * 60 * 1000;
};

const toLocalInputValue = (utcIso) => {
  const d = new Date(utcIso);
  const offsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
};

// ── Outcome Notes Modal — shown when agent clicks a quick-status button ────────
const StatusOutcomeModal = ({ pendingStatus, customerName, onConfirm, onClose }) => {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const cfg = STATUS_CONFIG[pendingStatus] || STATUS_CONFIG.pending;

  const submit = async (withNotes) => {
    setSaving(true);
    await onConfirm(pendingStatus, withNotes ? notes.trim() : '');
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
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
            className="input resize-none"
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
          <button
            onClick={() => submit(false)}
            disabled={saving}
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
            Skip
          </button>
          <button
            onClick={() => submit(true)}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
            style={{ background: 'var(--gradient-sidebar)' }}>
            {saving
              ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              : <CheckCircle size={14} />}
            Save & Submit
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Create / Edit Modal ──────────────────────────────────────────────────────
const CallbackModal = ({ callback, companyId, onSave, onClose }) => {
  const isEdit = !!callback;
  const [form, setForm] = useState({
    customer_name:  callback?.customer_name  || '',
    customer_phone: callback?.customer_phone || '',
    customer_email: callback?.customer_email || '',
    notes:          callback?.notes          || '',
    callback_at:    callback?.callback_at
      ? toLocalInputValue(callback.callback_at)
      : toLocalInputValue(Date.now() + 30 * 60000),
    status: callback?.status || 'pending',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customer_name.trim()) return setErr('Customer name required');
    setSaving(true); setErr('');
    try {
      const payload = {
        ...form,
        callback_at: new Date(form.callback_at).toISOString(),
        user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      if (isEdit) {
        const res = await client.put(`callbacks/${callback.id}`, payload);
        onSave(res.data.callback, 'edit');
      } else {
        const res = await client.post('callbacks', { ...payload, company_id: companyId });
        onSave(res.data.callback, 'create');
      }
      onClose();
    } catch (ex) {
      setErr(ex.response?.data?.error || ex.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--gradient-sidebar)' }}>
              <Phone size={16} className="text-white" />
            </div>
            <h3 className="font-bold text-lg" style={{ color: 'var(--color-text)' }}>
              {isEdit ? 'Edit Callback' : 'Schedule Callback'}
            </h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-bg-secondary transition-colors">
            <X size={16} style={{ color: 'var(--color-text-tertiary)' }} />
          </button>
        </div>

        {err && <div className="mb-4 p-3 rounded-xl text-sm font-medium"
          style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>{err}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
                Customer Name <span className="text-red-500">*</span>
              </label>
              <input value={form.customer_name} onChange={e => setForm(p => ({...p, customer_name: e.target.value}))}
                className="input" placeholder="John Smith" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>Phone</label>
                <input value={form.customer_phone} onChange={e => setForm(p => ({...p, customer_phone: e.target.value}))}
                  className="input" placeholder="(555) 000-0000" type="tel" />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>Email</label>
                <input value={form.customer_email} onChange={e => setForm(p => ({...p, customer_email: e.target.value}))}
                  className="input" placeholder="john@email.com" type="email" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
                Callback Date & Time <span className="text-red-500">*</span>
              </label>
              <input value={form.callback_at} onChange={e => setForm(p => ({...p, callback_at: e.target.value}))}
                className="input" type="datetime-local" required />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[
                  { label: '+5 min',   ms: 5  * 60 * 1000 },
                  { label: '+10 min',  ms: 10 * 60 * 1000 },
                  { label: '+15 min',  ms: 15 * 60 * 1000 },
                  { label: '+1 hour',  ms: 60 * 60 * 1000 },
                  { label: 'Tomorrow', ms: 24 * 60 * 60 * 1000 },
                ].map(({ label, ms }) => (
                  <button key={label} type="button"
                    onClick={() => setForm(p => ({ ...p, callback_at: toLocalInputValue(Date.now() + ms) }))}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors hover:opacity-80"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>Notes</label>
              <textarea value={form.notes} onChange={e => setForm(p => ({...p, notes: e.target.value}))}
                className="input resize-none" rows={2} placeholder="What to discuss…" />
            </div>
            {isEdit && (
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>Status</label>
                <select value={form.status} onChange={e => setForm(p => ({...p, status: e.target.value}))} className="input">
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
              style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
              style={{ background: 'var(--gradient-sidebar)' }}>
              {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Phone size={14} />}
              {isEdit ? 'Save Changes' : 'Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Push Permission Banner ───────────────────────────────────────────────────
const PushBanner = ({ onEnable, onDismiss, loading, alreadyGranted }) => (
  <div className="mb-5 p-4 rounded-2xl flex items-start gap-4 justify-between"
    style={{ backgroundColor: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)' }}>
    <div className="flex items-center gap-3">
      <Bell size={20} style={{ color: '#6366f1' }} className="flex-shrink-0 mt-0.5" />
      <div>
        <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
          {alreadyGranted ? 'Re-enable callback reminders' : 'Enable callback reminders'}
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {alreadyGranted
            ? 'Your notification subscription was reset. Click Enable to receive Windows notifications when a callback is due.'
            : 'Get Windows/browser notifications when a callback is due — even when the tab is in the background.'}
        </p>
      </div>
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">
      <button onClick={onEnable} disabled={loading}
        className="px-3 py-1.5 rounded-xl text-xs font-bold text-white flex items-center gap-1.5 disabled:opacity-60"
        style={{ background: 'var(--gradient-sidebar)' }}>
        {loading ? <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" /> : <Bell size={12} />}
        Enable
      </button>
      <button onClick={onDismiss} className="p-1.5 rounded-lg hover:bg-bg-secondary transition-colors">
        <X size={13} style={{ color: 'var(--color-text-tertiary)' }} />
      </button>
    </div>
  </div>
);

// ── Main CallbacksPage ───────────────────────────────────────────────────────
const CallbacksPage = ({ user }) => {
  const [callbacks,    setCallbacks]    = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [filter,       setFilter]       = useState('pending');
  const [modal,        setModal]        = useState(null);
  const [deleting,     setDeleting]     = useState(null);
  const [showPushBanner, setShowPushBanner] = useState(false);
  // { id, status, customerName } — pending outcome-notes prompt
  const [outcomeModal, setOutcomeModal] = useState(null);

  const { permission, subscribed, loading: pushLoading, isSupported, subscribe } =
    usePushNotifications();

  useEffect(() => {
    if (isSupported && !subscribed && permission !== 'denied') {
      setShowPushBanner(true);
    } else {
      setShowPushBanner(false);
    }
  }, [isSupported, permission, subscribed]);

  const fetchCallbacks = useCallback(async () => {
    setLoading(true);
    try {
      const params = { company_id: user?.company_id };
      if (filter !== 'all') params.status = filter;
      const res = await client.get('callbacks', { params });
      setCallbacks(res.data.callbacks || []);
    } catch {} finally { setLoading(false); }
  }, [user?.company_id, filter]);

  useEffect(() => {
    fetchCallbacks();
    if (!user?.id) return;
    const channel = supabase
      .channel('callbacks-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'callbacks', filter: `user_id=eq.${user.id}` },
        () => { fetchCallbacks(); })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchCallbacks, user?.id]);

  const handleSave = (cb, action) => {
    if (action === 'create') setCallbacks(prev => [cb, ...prev]);
    if (action === 'edit')   setCallbacks(prev => prev.map(x => x.id === cb.id ? cb : x));
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this callback? The audit history will be preserved for compliance.')) return;
    setDeleting(id);
    try {
      await client.delete(`callbacks/${id}`);
      setCallbacks(prev => prev.filter(x => x.id !== id));
    } catch {} finally { setDeleting(null); }
  };

  // Called from outcome modal — submits status + optional notes
  const handleStatusConfirm = async (status, notes) => {
    if (!outcomeModal) return;
    const { id } = outcomeModal;
    try {
      const payload = { status };
      if (notes) payload.notes = notes;
      const res = await client.put(`callbacks/${id}`, payload);
      setCallbacks(prev => prev.map(x => x.id === id ? res.data.callback : x));
    } catch {}
    setOutcomeModal(null);
  };

  // Quick-status buttons open the outcome modal instead of firing immediately
  const handleStatusQuick = (id, status, customerName) => {
    setOutcomeModal({ id, status, customerName });
  };

  const pendingCount = callbacks.filter(c => c.status === 'pending').length;

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Phone size={22} style={{ color: 'var(--color-primary-600)' }} />
            Callbacks
            {pendingCount > 0 && (
              <span className="ml-1 text-xs font-bold px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: '#ef4444' }}>
                {pendingCount}
              </span>
            )}
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Schedule and track customer callbacks. You'll be notified when it's time.
          </p>
        </div>
        <button onClick={() => setModal('create')}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm text-white transition-all hover:-translate-y-0.5"
          style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}>
          <Plus size={16} />
          Schedule Callback
        </button>
      </div>

      {showPushBanner && (
        <PushBanner
          onEnable={async () => { const ok = await subscribe(); if (ok) setShowPushBanner(false); }}
          onDismiss={() => setShowPushBanner(false)}
          loading={pushLoading}
          alreadyGranted={permission === 'granted'}
        />
      )}

      {subscribed && (
        <div className="mb-4 flex items-center gap-2 text-xs font-medium" style={{ color: '#10b981' }}>
          <Bell size={13} />
          Browser notifications enabled
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-5 p-1 rounded-xl w-fit"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        {[
          { key: 'pending',   label: 'Pending'   },
          { key: 'all',       label: 'All'        },
          { key: 'completed', label: 'Completed'  },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
            style={{
              backgroundColor: filter === f.key ? 'var(--color-surface)' : 'transparent',
              color: filter === f.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
              boxShadow: filter === f.key ? 'var(--shadow-sm)' : 'none',
            }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : callbacks.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <Phone size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
          <p className="font-semibold" style={{ color: 'var(--color-text)' }}>No callbacks yet</p>
          <p className="text-sm mt-1 mb-4" style={{ color: 'var(--color-text-secondary)' }}>
            Schedule your first callback to get started
          </p>
          <button onClick={() => setModal('create')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <Plus size={14} /> Schedule Callback
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {callbacks.map(cb => {
            const past = isPast(cb.callback_at) && cb.status === 'pending';
            const soon = isDueSoon(cb.callback_at);
            return (
              <div key={cb.id}
                className="rounded-2xl border p-4 transition-all duration-150 hover:shadow-md group"
                style={{
                  borderColor: past ? '#fca5a5' : soon ? '#fde68a' : 'var(--color-border)',
                  backgroundColor: past ? '#fff5f5' : soon ? '#fffbeb' : 'var(--color-surface)',
                }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="font-bold text-text truncate">{cb.customer_name}</p>
                      <StatusBadge status={cb.status} />
                      {past && <span className="text-xs font-bold text-red-600">Overdue</span>}
                      {soon && !past && <span className="text-xs font-bold" style={{ color: '#b45309' }}>Due soon</span>}
                    </div>
                    <div className="flex flex-wrap gap-x-3 text-xs mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                      {cb.customer_phone && <span>📞 {cb.customer_phone}</span>}
                      {cb.customer_email && <span>✉ {cb.customer_email}</span>}
                    </div>
                    <div className="flex items-center gap-1 text-xs mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                      <Calendar size={11} />
                      {formatDateTime(cb.callback_at)}
                    </div>
                    {cb.notes && <p className="text-xs italic" style={{ color: 'var(--color-text-secondary)' }}>{cb.notes}</p>}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1.5 flex-shrink-0 items-end">
                    {cb.status === 'pending' && (
                      <>
                        <button onClick={() => handleStatusQuick(cb.id, 'completed', cb.customer_name)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:scale-105"
                          style={{ backgroundColor: '#d1fae5', color: '#065f46' }}>
                          <CheckCircle size={12} /> Done
                        </button>
                        <button onClick={() => handleStatusQuick(cb.id, 'no_answer', cb.customer_name)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:scale-105"
                          style={{ backgroundColor: '#f3f4f6', color: '#374151' }}>
                          <PhoneOff size={12} /> No Answer
                        </button>
                        <button onClick={() => handleStatusQuick(cb.id, 'answering_machine', cb.customer_name)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:scale-105"
                          style={{ backgroundColor: '#ede9fe', color: '#6d28d9' }}>
                          <Voicemail size={12} /> Ans. Machine
                        </button>
                      </>
                    )}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setModal(cb)}
                        className="p-1.5 rounded-lg transition-colors hover:bg-primary-100" title="Edit">
                        <Edit2 size={13} style={{ color: 'var(--color-primary-600)' }} />
                      </button>
                      <button onClick={() => handleDelete(cb.id)} disabled={deleting === cb.id}
                        className="p-1.5 rounded-lg transition-colors hover:bg-red-100" title="Delete">
                        {deleting === cb.id
                          ? <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-red-500" />
                          : <Trash2 size={13} style={{ color: '#ef4444' }} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      {modal && (
        <CallbackModal
          callback={modal === 'create' ? null : modal}
          companyId={user?.company_id}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {/* Outcome Notes Modal */}
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

export default CallbacksPage;
