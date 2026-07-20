import { useState, useEffect, useCallback } from 'react';
import ThemedSelect from '../UI/Select';
import ThemedDate from '../UI/ThemedDate';
import {
  Phone, Plus, Clock, CheckCircle2, XCircle, PhoneOff,
  PhoneCall, AlertCircle, RefreshCw, Eye, LogIn,
  Trash2, Users, ChevronRight, Calendar, MessageSquare,
  ShieldAlert, Info, Edit2, UserCheck,
} from 'lucide-react';
import { Card, Badge, Button, Alert } from '../UI';
import { useCallbackNumbers } from '../../hooks/useCallbackNumbers';
import { ET_ZONE } from '../../utils/timezone';
import { transferPhone } from '../../utils/phone';

// ─── Constants ────────────────────────────────────────────────────────────────

const OUTCOMES = [
  { value: 'answered_sold',     label: 'Answered — Sold',           icon: CheckCircle2, color: '#16a34a' },
  { value: 'answered_no_sale',  label: 'Answered — No Sale',        icon: PhoneCall,    color: '#2563eb' },
  { value: 'answered_callback', label: 'Answered — Schedule Again', icon: Calendar,     color: '#7c3aed' },
  { value: 'no_answer',         label: 'No Answer',                 icon: PhoneOff,     color: '#d97706' },
  { value: 'voicemail',         label: 'Voicemail Left',            icon: MessageSquare,color: '#0891b2' },
  { value: 'wrong_number',      label: 'Wrong Number',              icon: AlertCircle,  color: '#ea580c' },
  { value: 'do_not_call',       label: 'Do Not Call',               icon: ShieldAlert,  color: '#dc2626' },
];

const OUTCOME_MAP = Object.fromEntries(OUTCOMES.map(o => [o.value, o]));

const STATUS_CONFIG = {
  active:    { label: 'Active',    variant: 'success',   bg: '#dcfce7', color: '#166534' },
  claimable: { label: 'Claimable', variant: 'warning',   bg: '#fef3c7', color: '#92400e' },
  released:  { label: 'Released',  variant: 'secondary', bg: '#f3f4f6', color: '#6b7280' },
};

const MANAGER_LEVELS = ['company_admin', 'manager', 'operations_manager', 'closer_manager', 'fronter_manager', 'superadmin'];
const CREATOR_LEVELS = ['fronter', 'closer', 'fronter_manager', 'closer_manager'];

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: ET_ZONE, month: 'short', day: 'numeric', year: 'numeric',
    }).format(new Date(d));
  } catch { return '—'; }
}

function fmtDateTime(d) {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: ET_ZONE, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(d));
  } catch { return '—'; }
}

function daysLeft(isoDate) {
  if (!isoDate) return null;
  const diff = new Date(isoDate) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function isOverdue(isoDate) {
  if (!isoDate) return false;
  return new Date(isoDate) < new Date();
}

// ─── Add Number Modal ─────────────────────────────────────────────────────────

const AddNumberModal = ({ onClose, onSave }) => {
  const [form, setForm]     = useState({ phone_number: '', customer_name: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.phone_number.trim()) { setErr('Phone number is required'); return; }
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (ex) {
      setErr(ex.response?.data?.error || ex.message || 'Failed to add');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="px-6 py-4 border-b flex items-center gap-3" style={{ borderColor: 'var(--color-border)' }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--gradient-sidebar)' }}>
            <Phone size={16} className="text-white" />
          </div>
          <h2 className="text-lg font-bold text-text">Add Tracked Number</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-text-secondary mb-1.5">
              Phone Number <span className="text-error-500">*</span>
            </label>
            <input value={form.phone_number} onChange={e => setForm({ ...form, phone_number: e.target.value })}
              placeholder="+1 555-000-0000" className="input" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-text-secondary mb-1.5">Customer Name</label>
            <input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })}
              placeholder="Full name (optional)" className="input" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-text-secondary mb-1.5">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="Any initial notes about this contact…" className="input" rows={3} />
          </div>
          {err && <p className="text-sm text-error-600">{err}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border font-semibold text-sm transition-colors"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white disabled:opacity-50 transition-all"
              style={{ background: 'var(--gradient-sidebar)' }}>
              {saving ? 'Adding…' : 'Add Number'}
            </button>
          </div>
        </form>
      </div>
      </div>
    </div>
  );
};

// ─── Attempt Modal ────────────────────────────────────────────────────────────

const AttemptModal = ({ number, onClose, onSave }) => {
  const [outcome,      setOutcome]      = useState('no_answer');
  const [remarks,      setRemarks]      = useState('');
  const [callbackAt,   setCallbackAt]   = useState('');
  const [saving,       setSaving]       = useState(false);
  const [err,          setErr]          = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (outcome === 'answered_callback' && !callbackAt) { setErr('Please set a callback date/time'); return; }
    setSaving(true);
    try {
      await onSave({ outcome, remarks: remarks || undefined, scheduled_callback_at: callbackAt || undefined });
      onClose();
    } catch (ex) {
      setErr(ex.response?.data?.error || ex.message || 'Failed to log attempt');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="px-6 py-4 border-b flex items-center gap-3" style={{ borderColor: 'var(--color-border)' }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--gradient-sidebar)' }}>
            <PhoneCall size={16} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-text">Log Call Attempt</h2>
            <p className="text-xs text-text-secondary">{number.phone_number}{number.customer_name ? ` · ${number.customer_name}` : ''}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Outcome selector */}
          <div>
            <label className="block text-sm font-semibold text-text-secondary mb-3">Call Outcome</label>
            <div className="grid grid-cols-1 gap-2">
              {OUTCOMES.map(o => {
                const Icon = o.icon;
                const active = outcome === o.value;
                return (
                  <button key={o.value} type="button" onClick={() => setOutcome(o.value)}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left"
                    style={{
                      borderColor:       active ? o.color : 'var(--color-border)',
                      backgroundColor:   active ? `${o.color}12` : 'transparent',
                    }}>
                    <Icon size={16} style={{ color: active ? o.color : 'var(--color-text-tertiary)', flexShrink: 0 }} />
                    <span className="text-sm font-semibold" style={{ color: active ? o.color : 'var(--color-text)' }}>
                      {o.label}
                    </span>
                    {active && <div className="ml-auto w-2 h-2 rounded-full" style={{ backgroundColor: o.color }} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scheduled callback datetime — only when outcome = answered_callback */}
          {outcome === 'answered_callback' && (
            <div>
              <label className="block text-sm font-semibold text-text-secondary mb-1.5">
                Schedule Next Call <span className="text-error-500">*</span>
              </label>
              <ThemedDate withTime value={callbackAt} onChange={e => setCallbackAt(e.target.value)}
                className="input" min={new Date().toISOString().slice(0, 16)} />
            </div>
          )}

          {/* Remarks */}
          <div>
            <label className="block text-sm font-semibold text-text-secondary mb-1.5">Remarks</label>
            <textarea value={remarks} onChange={e => setRemarks(e.target.value)}
              placeholder="Notes about this call attempt…" className="input" rows={3} />
          </div>

          {err && <p className="text-sm text-error-600">{err}</p>}

          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border font-semibold text-sm"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white disabled:opacity-50"
              style={{ background: 'var(--gradient-sidebar)' }}>
              {saving ? 'Saving…' : 'Log Attempt'}
            </button>
          </div>
        </form>
      </div>
      </div>
    </div>
  );
};

// ─── Number Detail Modal ──────────────────────────────────────────────────────

const NumberDetailModal = ({ numberId, isManager, onClose }) => {
  const [detail,   setDetail]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const { getDetail } = useCallbackNumbers();

  useEffect(() => {
    getDetail(numberId)
      .then(setDetail)
      .finally(() => setLoading(false));
  }, [numberId]);

  if (loading) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl p-10" style={{ backgroundColor: 'var(--color-surface)' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" />
      </div>
    </div>
  );

  if (!detail) return null;
  const { number, attempts, claims, transfer } = detail;
  const sc = STATUS_CONFIG[number.status] || STATUS_CONFIG.released;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

        {/* Header */}
        <div className="px-6 py-5 border-b flex items-start justify-between gap-4" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--gradient-sidebar)' }}>
              <Phone size={20} className="text-white" />
            </div>
            <div>
              <p className="text-xl font-bold text-text tracking-wide">{number.phone_number}</p>
              {number.customer_name && <p className="text-sm text-text-secondary mt-0.5">{number.customer_name}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="px-3 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: sc.bg, color: sc.color }}>
              {sc.label}
            </span>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-secondary transition-colors"
              style={{ color: 'var(--color-text-secondary)' }}>
              <XCircle size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Number Info */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[
              { label: 'Owner',       value: number.owner_name || 'Unassigned' },
              { label: 'Status',      value: sc.label },
              { label: 'Attempts',    value: attempts.length },
              { label: 'Assigned',    value: fmtDate(number.assigned_at) },
              { label: 'Lock Expires',value: number.locked_until ? (isOverdue(number.locked_until) ? 'Expired' : `${daysLeft(number.locked_until)}d left`) : '—' },
              { label: 'Auto-Release',value: number.release_at ? `${fmtDate(number.release_at)}` : '—' },
            ].map(item => (
              <div key={item.label} className="p-3 rounded-xl" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                <p className="text-xs text-text-tertiary mb-0.5">{item.label}</p>
                <p className="text-sm font-semibold text-text">{item.value}</p>
              </div>
            ))}
          </div>

          {/* Notes */}
          {number.notes && (
            <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <p className="text-xs font-semibold text-text-tertiary mb-1">Notes</p>
              <p className="text-sm text-text">{number.notes}</p>
            </div>
          )}

          {/* Transfer details if linked */}
          {transfer && (
            <div className="p-4 rounded-xl border-2" style={{ borderColor: 'var(--color-primary-200)', backgroundColor: 'var(--color-primary-50, rgba(99,102,241,0.05))' }}>
              <p className="text-xs font-bold text-primary-600 mb-2 uppercase tracking-wide">Linked Transfer</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {transfer.form_data?.FirstName && (
                  <div><span className="text-text-tertiary">Name: </span>
                    <span className="font-semibold text-text">{transfer.form_data.FirstName} {transfer.form_data.LastName || ''}</span>
                  </div>
                )}
                {transferPhone(transfer) && (
                  <div><span className="text-text-tertiary">Phone: </span>
                    <span className="font-semibold text-text">{transferPhone(transfer)}</span>
                  </div>
                )}
                {(transfer.form_data?.car_year || transfer.form_data?.car_make) && (
                  <div className="col-span-2"><span className="text-text-tertiary">Vehicle: </span>
                    <span className="font-semibold text-text">
                      {[transfer.form_data.car_year, transfer.form_data.car_make, transfer.form_data.car_model].filter(Boolean).join(' ')}
                    </span>
                  </div>
                )}
                <div><span className="text-text-tertiary">Status: </span>
                  <Badge variant={transfer.status === 'completed' ? 'success' : 'warning'} size="sm">{transfer.status}</Badge>
                </div>
              </div>
            </div>
          )}

          {/* Previous owner summary (non-manager only) */}
          {!isManager && claims.length > 0 && claims[0].attempt_count > 0 && (
            <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--color-warning-50)', border: '1px solid var(--color-warning-200)' }}>
              <p className="text-xs font-bold text-warning-700 mb-1 flex items-center gap-1.5">
                <Info size={12} /> Previous Owner Summary
              </p>
              <p className="text-sm text-warning-700">
                {claims[0].attempt_count} attempt{claims[0].attempt_count !== 1 ? 's' : ''} made
                {claims[0].last_outcome && ` · Last: ${OUTCOME_MAP[claims[0].last_outcome]?.label || claims[0].last_outcome}`}
              </p>
            </div>
          )}

          {/* Ownership History (manager only) */}
          {isManager && claims.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-text mb-3 flex items-center gap-2"><Users size={14} /> Ownership History</h4>
              <div className="space-y-2">
                {claims.map((c, i) => (
                  <div key={c.id || i} className="flex items-center gap-3 p-3 rounded-xl"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ background: 'var(--gradient-sidebar)' }}>
                      {(c.owner_name || '?')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text">{c.owner_name || 'Unknown'}</p>
                      <p className="text-xs text-text-tertiary">
                        {fmtDate(c.owned_from)} → {c.owned_until ? fmtDate(c.owned_until) : 'Present'}
                        {c.release_reason && ` · ${c.release_reason.replace(/_/g, ' ')}`}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-text">{c.attempt_count} call{c.attempt_count !== 1 ? 's' : ''}</p>
                      {c.last_outcome && (
                        <p className="text-xs" style={{ color: OUTCOME_MAP[c.last_outcome]?.color || 'var(--color-text-tertiary)' }}>
                          {OUTCOME_MAP[c.last_outcome]?.label || c.last_outcome}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Call Attempt Timeline */}
          <div>
            <h4 className="text-sm font-bold text-text mb-3 flex items-center gap-2">
              <Clock size={14} /> Call Attempt Log ({attempts.length})
            </h4>
            {attempts.length === 0 ? (
              <p className="text-sm text-text-secondary text-center py-4">No attempts logged yet.</p>
            ) : (
              <div className="space-y-3">
                {attempts.map((a, i) => {
                  const oc = OUTCOME_MAP[a.outcome];
                  const Icon = oc?.icon || PhoneCall;
                  return (
                    <div key={a.id || i} className="flex gap-3 p-4 rounded-xl border"
                      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: `${oc?.color || '#6b7280'}15` }}>
                        <Icon size={15} style={{ color: oc?.color || '#6b7280' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-sm font-bold" style={{ color: oc?.color || 'var(--color-text)' }}>
                            {oc?.label || a.outcome}
                          </span>
                          <span className="text-xs text-text-tertiary flex-shrink-0 ml-2">{fmtDateTime(a.attempted_at)}</span>
                        </div>
                        {isManager && a.caller_name && (
                          <p className="text-xs text-text-secondary mb-0.5">by {a.caller_name}</p>
                        )}
                        {a.remarks && (
                          <p className="text-sm text-text-secondary mt-1 italic">"{a.remarks}"</p>
                        )}
                        {a.scheduled_callback_at && (
                          <p className="text-xs text-primary-600 mt-1 font-semibold flex items-center gap-1">
                            <Calendar size={10} /> Next call: {fmtDateTime(a.scheduled_callback_at)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={onClose}
            className="w-full py-2.5 rounded-xl font-semibold text-sm border transition-colors"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            Close
          </button>
        </div>
      </div>
      </div>
    </div>
  );
};

// ─── Number Card (individual view) ───────────────────────────────────────────

const NumberCard = ({ number, onLogAttempt, onViewDetail, onRelease }) => {
  const sc = STATUS_CONFIG[number.status] || STATUS_CONFIG.released;
  const oc = number.last_outcome ? OUTCOME_MAP[number.last_outcome] : null;
  const lockDays = number.locked_until ? daysLeft(number.locked_until) : null;
  const lockExpired = number.locked_until ? isOverdue(number.locked_until) : false;

  return (
    <div className="p-5 rounded-2xl border transition-all hover:shadow-md"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${sc.color}15` }}>
            <Phone size={16} style={{ color: sc.color }} />
          </div>
          <div>
            <p className="text-base font-bold text-text tracking-wide">{number.phone_number}</p>
            {number.customer_name && (
              <p className="text-xs text-text-secondary mt-0.5">{number.customer_name}</p>
            )}
          </div>
        </div>
        <span className="px-2.5 py-1 rounded-full text-xs font-bold flex-shrink-0"
          style={{ backgroundColor: sc.bg, color: sc.color }}>
          {sc.label}
        </span>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 mb-3 text-xs text-text-secondary">
        <span className="flex items-center gap-1">
          <PhoneCall size={11} /> {number.count || 0} attempt{(number.count || 0) !== 1 ? 's' : ''}
        </span>
        {oc && (
          <span className="flex items-center gap-1" style={{ color: oc.color }}>
            <oc.icon size={11} /> {oc.label}
          </span>
        )}
        {number.last_attempted_at && (
          <span className="flex items-center gap-1">
            <Clock size={11} /> {fmtDate(number.last_attempted_at)}
          </span>
        )}
      </div>

      {/* Lock status bar */}
      {number.status === 'active' && number.locked_until && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-text-tertiary">Lock expires</span>
            <span className={lockExpired ? 'text-error-600 font-semibold' : 'font-semibold text-text'}>
              {lockExpired ? 'Expired — log attempt to re-lock' : `${lockDays}d remaining`}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            {!lockExpired && lockDays !== null && (
              <div className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (lockDays / 7) * 100)}%`,
                  backgroundColor: lockDays <= 2 ? '#ef4444' : lockDays <= 4 ? '#f59e0b' : '#16a34a',
                }} />
            )}
          </div>
        </div>
      )}

      {/* Release date */}
      {number.release_at && number.status === 'active' && (
        <p className="text-xs text-text-tertiary mb-3 flex items-center gap-1">
          <AlertCircle size={10} /> Auto-releases {fmtDate(number.release_at)}
        </p>
      )}

      {number.notes && (
        <p className="text-xs text-text-secondary italic mb-3 line-clamp-1">"{number.notes}"</p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {number.status !== 'released' && (
          <button onClick={() => onLogAttempt(number)}
            className="flex-1 py-2 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 transition-all hover:scale-[1.02]"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <PhoneCall size={12} /> Log Attempt
          </button>
        )}
        <button onClick={() => onViewDetail(number.id)}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
          <Eye size={12} /> Details
        </button>
        <button onClick={() => onRelease(number.id)}
          className="flex items-center justify-center p-2 rounded-xl border transition-colors hover:bg-error-50"
          title="Release number"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
};

// ─── Claimable Card ───────────────────────────────────────────────────────────

const ClaimableCard = ({ number, onClaim, onViewDetail }) => (
  <div className="p-4 rounded-2xl border-2 transition-all hover:shadow-md"
    style={{ borderColor: '#fef3c7', backgroundColor: '#fffbeb' }}>
    <div className="flex items-start justify-between mb-2">
      <div>
        <p className="text-base font-bold text-text">{number.phone_number}</p>
        {number.customer_name && <p className="text-xs text-text-secondary">{number.customer_name}</p>}
      </div>
      <span className="px-2.5 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
        Available
      </span>
    </div>

    {/* Previous owner summary */}
    {(number.prev_attempts > 0 || number.count > 0) && (
      <div className="text-xs text-warning-700 mb-2 flex items-center gap-1">
        <Info size={11} />
        Previous: {number.prev_attempts || number.count || 0} attempt{(number.prev_attempts || number.count || 0) !== 1 ? 's' : ''}
        {(number.prev_last_outcome || number.last_outcome) && (
          <> · {OUTCOME_MAP[number.prev_last_outcome || number.last_outcome]?.label}</>
        )}
      </div>
    )}

    {number.notes && (
      <p className="text-xs text-text-secondary italic mb-2 line-clamp-1">"{number.notes}"</p>
    )}

    <div className="flex gap-2">
      <button onClick={() => onClaim(number.id)}
        className="flex-1 py-2 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5"
        style={{ backgroundColor: '#d97706' }}>
        <LogIn size={12} /> Claim Number
      </button>
      <button onClick={() => onViewDetail(number.id)}
        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border"
        style={{ borderColor: '#fcd34d', color: '#92400e' }}>
        <Eye size={12} />
      </button>
    </div>
  </div>
);

// ─── Manager Row ──────────────────────────────────────────────────────────────

const ManagerNumberRow = ({ number, onViewDetail, onReassign, onRelease }) => {
  const sc = STATUS_CONFIG[number.status] || STATUS_CONFIG.released;
  const oc = number.last_outcome ? OUTCOME_MAP[number.last_outcome] : null;

  return (
    <tr className="hover:bg-bg-secondary transition-colors" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <td className="px-4 py-3">
        <p className="font-bold text-text text-sm">{number.phone_number}</p>
        {number.customer_name && <p className="text-xs text-text-secondary">{number.customer_name}</p>}
      </td>
      <td className="px-4 py-3">
        <span className="text-sm font-semibold text-text">{number.owner_name || '—'}</span>
      </td>
      <td className="px-4 py-3">
        <span className="px-2.5 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: sc.bg, color: sc.color }}>
          {sc.label}
        </span>
      </td>
      <td className="px-4 py-3 text-center">
        <span className="text-sm font-bold text-text">{number.count || 0}</span>
      </td>
      <td className="px-4 py-3">
        {oc ? (
          <span className="text-xs font-semibold flex items-center gap-1" style={{ color: oc.color }}>
            <oc.icon size={11} /> {oc.label}
          </span>
        ) : <span className="text-xs text-text-tertiary">—</span>}
        {number.last_attempted_at && (
          <p className="text-xs text-text-tertiary mt-0.5">{fmtDate(number.last_attempted_at)}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-text-secondary">{number.locked_until
          ? (isOverdue(number.locked_until) ? <span className="text-error-600 font-semibold">Expired</span> : `${daysLeft(number.locked_until)}d`)
          : '—'}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <button onClick={() => onViewDetail(number.id)} title="View detail"
            className="p-1.5 rounded-lg hover:bg-bg-secondary transition-colors"
            style={{ color: 'var(--color-primary-600)' }}>
            <Eye size={14} />
          </button>
          {number.status !== 'released' && (
            <button onClick={() => onReassign(number)} title="Reassign"
              className="p-1.5 rounded-lg hover:bg-bg-secondary transition-colors"
              style={{ color: 'var(--color-text-secondary)' }}>
              <UserCheck size={14} />
            </button>
          )}
          <button onClick={() => onRelease(number.id)} title="Release"
            className="p-1.5 rounded-lg hover:bg-error-50 transition-colors"
            style={{ color: 'var(--color-error-500)' }}>
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
};

// ─── Reassign Modal ───────────────────────────────────────────────────────────

const ReassignModal = ({ number, onClose, onSave }) => {
  const [members,   setMembers]   = useState([]);
  const [selected,  setSelected]  = useState('');
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState('');
  const { getTeamMembers } = useCallbackNumbers();

  useEffect(() => {
    getTeamMembers(number.id)
      .then(setMembers)
      .finally(() => setLoading(false));
  }, [number.id]);

  const handleSave = async () => {
    if (!selected) { setErr('Select a team member'); return; }
    setSaving(true);
    try {
      await onSave(number.id, selected);
      onClose();
    } catch (ex) {
      setErr(ex.response?.data?.error || ex.message || 'Failed to reassign');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h3 className="font-bold text-text flex items-center gap-2"><UserCheck size={16} /> Reassign Number</h3>
          <p className="text-xs text-text-secondary mt-0.5">{number.phone_number}</p>
        </div>
        <div className="p-5 space-y-4">
          {loading ? (
            <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
          ) : (
            <ThemedSelect value={selected} onChange={e => setSelected(e.target.value)} className="input">
              <option value="">— Select team member —</option>
              {members.map(m => (
                <option key={m.user_id} value={m.user_id}>{m.name} ({m.role})</option>
              ))}
            </ThemedSelect>
          )}
          {err && <p className="text-sm text-error-600">{err}</p>}
          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 py-2 rounded-xl border font-semibold text-sm"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || loading}
              className="flex-1 py-2 rounded-xl font-semibold text-sm text-white disabled:opacity-50"
              style={{ background: 'var(--gradient-sidebar)' }}>
              {saving ? 'Reassigning…' : 'Reassign'}
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const CallbackNumbers = ({ user }) => {
  const companyId  = user?.company_id;
  const roleLevel  = user?.role_level || '';
  const userId     = user?.user_id || user?.id;

  const isManager  = MANAGER_LEVELS.includes(roleLevel);
  const canCreate  = CREATOR_LEVELS.includes(roleLevel) || isManager;

  const hook = useCallbackNumbers(companyId);
  const { numbers, claimable, loading, error, fetchNumbers, fetchClaimable,
    createNumber, logAttempt, claimNumber, reassign, releaseNumber } = hook;

  const [tab,         setTab]         = useState(isManager ? 'all' : 'mine');
  const [statusFilter,setStatusFilter]= useState('all');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [search,      setSearch]      = useState('');
  const [msg,         setMsg]         = useState(null);

  // Modals
  const [addModal,      setAddModal]      = useState(false);
  const [attemptTarget, setAttemptTarget] = useState(null);
  const [detailId,      setDetailId]      = useState(null);
  const [reassignTarget,setReassignTarget]= useState(null);

  const load = useCallback(() => {
    const filters = {};
    if (statusFilter !== 'all') filters.status = statusFilter;
    if (search.trim()) filters.search = search.trim();
    fetchNumbers(filters);
    fetchClaimable();
  }, [fetchNumbers, fetchClaimable, statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  const showMsg = (type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const handleCreate = async (form) => {
    await createNumber(form);
    showMsg('success', 'Number added and locked to you for 7 days.');
    load();
  };

  const handleAttempt = async (payload) => {
    await logAttempt(attemptTarget.id, payload);
    showMsg('success', 'Call attempt logged. Lock reset to 7 days.');
    setAttemptTarget(null);
    load();
  };

  const handleClaim = async (id) => {
    try {
      await claimNumber(id);
      showMsg('success', 'Number claimed! You have 7 days before it becomes claimable again.');
      load();
    } catch (ex) {
      showMsg('error', ex.response?.data?.error || 'Failed to claim');
    }
  };

  const handleReassign = async (id, newOwnerId) => {
    await reassign(id, newOwnerId);
    showMsg('success', 'Number reassigned.');
    setReassignTarget(null);
    load();
  };

  const handleRelease = async (id) => {
    if (!window.confirm('Release this number? It will be available for others to claim.')) return;
    try {
      await releaseNumber(id);
      showMsg('success', 'Number released.');
      load();
    } catch (ex) {
      showMsg('error', ex.response?.data?.error || 'Failed to release');
    }
  };

  // Build unique owner list for manager filter
  const ownerOptions = [...new Map(numbers.filter(n => n.owner_id && n.owner_name).map(n => [n.owner_id, n.owner_name])).entries()];

  // Filtered numbers for manager view
  const filteredNumbers = numbers.filter(n => {
    if (statusFilter !== 'all' && n.status !== statusFilter) return false;
    if (ownerFilter && n.owner_id !== ownerFilter) return false;
    return true;
  });

  // My numbers for individual view
  const myNumbers = numbers.filter(n => n.owner_id === userId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-text flex items-center gap-2"><Phone size={18} /> Tracked Numbers</h3>
          <p className="text-sm text-text-secondary mt-0.5">
            {isManager ? 'Monitor all tracked numbers, full call logs, and reassign ownership.' : 'Manage your tracked numbers and log call attempts.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-bg-secondary transition-colors" title="Refresh">
            <RefreshCw size={16} style={{ color: 'var(--color-text-secondary)' }} />
          </button>
          {canCreate && (
            <Button variant="primary" size="sm" onClick={() => setAddModal(true)} className="flex items-center gap-1.5">
              <Plus size={15} /> Add Number
            </Button>
          )}
        </div>
      </div>

      {msg && <Alert type={msg.type} message={msg.text} dismissible onDismiss={() => setMsg(null)} />}
      {error && <Alert type="error" message={error} />}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl w-fit"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        {!isManager && (
          <>
            <TabBtn active={tab === 'mine'}      onClick={() => setTab('mine')}      label={`My Numbers (${myNumbers.length})`} />
            <TabBtn active={tab === 'claimable'} onClick={() => setTab('claimable')} label={`Available (${claimable.length})`}  />
          </>
        )}
        {isManager && (
          <>
            <TabBtn active={tab === 'all'}       onClick={() => setTab('all')}       label="All Numbers" />
            {canCreate && <TabBtn active={tab === 'mine'} onClick={() => setTab('mine')} label={`My Numbers (${myNumbers.length})`} />}
            <TabBtn active={tab === 'claimable'} onClick={() => setTab('claimable')} label={`Claimable (${claimable.length})`} />
          </>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : (
        <>
          {/* ── MY NUMBERS (individual view) ── */}
          {tab === 'mine' && (
            <div>
              {myNumbers.length === 0 ? (
                <Card className="p-12 text-center">
                  <Phone size={40} className="mx-auto mb-3 text-text-tertiary" />
                  <p className="text-text-secondary font-semibold mb-1">No tracked numbers yet</p>
                  <p className="text-sm text-text-tertiary mb-4">Add a number to start tracking call attempts.</p>
                  {canCreate && (
                    <Button variant="primary" size="sm" onClick={() => setAddModal(true)} className="mx-auto flex items-center gap-1.5">
                      <Plus size={14} /> Add Your First Number
                    </Button>
                  )}
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {myNumbers.map(n => (
                    <NumberCard key={n.id} number={n}
                      onLogAttempt={setAttemptTarget}
                      onViewDetail={setDetailId}
                      onRelease={handleRelease} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── CLAIMABLE ── */}
          {tab === 'claimable' && (
            <div>
              {claimable.length === 0 ? (
                <Card className="p-12 text-center">
                  <CheckCircle2 size={40} className="mx-auto mb-3 text-text-tertiary" />
                  <p className="text-text-secondary">No numbers available to claim right now.</p>
                </Card>
              ) : (
                <>
                  <div className="p-3 rounded-xl mb-4 text-sm flex items-center gap-2"
                    style={{ backgroundColor: 'var(--color-warning-50)', border: '1px solid var(--color-warning-200)', color: 'var(--color-warning-700)' }}>
                    <Info size={14} />
                    These numbers had no activity for 7+ days. Claim one to start tracking it. You'll own it for 7 days per attempt.
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {claimable.map(n => (
                      <ClaimableCard key={n.id} number={n}
                        onClaim={handleClaim}
                        onViewDetail={setDetailId} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── MANAGER ALL NUMBERS TABLE ── */}
          {tab === 'all' && isManager && (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Total',     value: numbers.length,                               color: 'var(--color-text)'       },
                  { label: 'Active',    value: numbers.filter(n => n.status === 'active').length,    color: '#16a34a' },
                  { label: 'Claimable',value: numbers.filter(n => n.status === 'claimable').length,  color: '#d97706' },
                  { label: 'Released', value: numbers.filter(n => n.status === 'released').length,   color: '#6b7280' },
                ].map(s => (
                  <Card key={s.label} className="p-4">
                    <p className="text-xs text-text-secondary mb-1">{s.label}</p>
                    <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
                  </Card>
                ))}
              </div>

              {/* Filters */}
              <div className="flex flex-wrap gap-3">
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search phone or customer…"
                  className="input w-56"
                />
                <ThemedSelect value={statusFilter} onChange={e => { setStatusFilter(e.target.value); }} className="input w-auto">
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="claimable">Claimable</option>
                  <option value="released">Released</option>
                </ThemedSelect>
                <ThemedSelect value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} className="input w-auto">
                  <option value="">All members</option>
                  {ownerOptions.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </ThemedSelect>
              </div>

              {/* Table */}
              {filteredNumbers.length === 0 ? (
                <Card className="p-10 text-center">
                  <p className="text-text-secondary">No numbers match the current filters.</p>
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                          {['Number / Customer', 'Owner', 'Status', 'Attempts', 'Last Attempt', 'Lock', 'Actions'].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredNumbers.map(n => (
                          <ManagerNumberRow key={n.id} number={n}
                            onViewDetail={setDetailId}
                            onReassign={setReassignTarget}
                            onRelease={handleRelease} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {addModal      && <AddNumberModal onClose={() => setAddModal(false)} onSave={handleCreate} />}
      {attemptTarget && <AttemptModal   number={attemptTarget} onClose={() => setAttemptTarget(null)} onSave={handleAttempt} />}
      {detailId      && <NumberDetailModal numberId={detailId} isManager={isManager} onClose={() => setDetailId(null)} />}
      {reassignTarget && <ReassignModal number={reassignTarget} onClose={() => setReassignTarget(null)} onSave={handleReassign} />}
    </div>
  );
};

// Small helper tab button
const TabBtn = ({ active, onClick, label }) => (
  <button onClick={onClick}
    className="px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150"
    style={{
      backgroundColor: active ? 'var(--color-surface)' : 'transparent',
      color:            active ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
      boxShadow:        active ? 'var(--shadow-sm)' : 'none',
    }}>
    {label}
  </button>
);

export default CallbackNumbers;
