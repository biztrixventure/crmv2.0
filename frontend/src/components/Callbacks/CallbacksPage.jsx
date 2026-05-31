/**
 * CallbacksPage — shared for Fronter and Closer dashboards.
 * Compact list with click-to-drawer for full details.
 * Priority (High / Medium / Low) shown as colored badges.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Phone, Plus, Clock, CheckCircle, XCircle, PhoneOff,
  Trash2, Edit2, Bell, X, Calendar, Voicemail, ChevronRight,
  AlertTriangle, ArrowRight, MapPin, Globe,
} from 'lucide-react';
import client from '../../api/client';
import { supabase } from '../../api/supabase';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { formatInTz, getTzAbbr, formatForInput, convertToUtc, nowInTz, ET_ZONE } from '../../utils/timezone';
import CopyableNumber from '../UI/CopyableNumber';
import CopyableText from '../UI/CopyableText';

const STATUS_CONFIG = {
  pending:           { label: 'Pending',          color: '#f59e0b', bg: '#fef3c7', icon: Clock       },
  completed:         { label: 'Completed',         color: '#10b981', bg: '#d1fae5', icon: CheckCircle  },
  cancelled:         { label: 'Cancelled',         color: '#ef4444', bg: '#fee2e2', icon: XCircle      },
  no_answer:         { label: 'No Answer',         color: '#6b7280', bg: '#f3f4f6', icon: PhoneOff     },
  answering_machine: { label: 'Ans. Machine',      color: '#8b5cf6', bg: '#ede9fe', icon: Voicemail    },
};

const PRIORITY_CONFIG = {
  High:   { label: 'High',   color: '#dc2626', bg: '#fee2e2', dot: '#ef4444' },
  Medium: { label: 'Medium', color: '#d97706', bg: '#fef3c7', dot: '#f59e0b' },
  Low:    { label: 'Low',    color: '#2563eb', bg: '#dbeafe', dot: '#3b82f6' },
};

const StatusBadge = ({ status }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      <Icon size={10} />
      {cfg.label}
    </span>
  );
};

const PriorityBadge = ({ priority }) => {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.Medium;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.dot }} />
      {cfg.label}
    </span>
  );
};

// formatDateTime: shows customer's local time if known, else company/browser time
const formatDateTime = (iso, customerTz) => {
  if (!iso) return '—';
  const tz = customerTz || ET_ZONE;
  return `${formatInTz(iso, tz)} ${getTzAbbr(tz)}`;
};

const isPast    = (iso) => iso && new Date(iso) < new Date();
const isDueSoon = (iso) => {
  if (!iso) return false;
  const diff = new Date(iso) - new Date();
  return diff > 0 && diff < 30 * 60 * 1000;
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
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-secondary">
            <X size={15} style={{ color: 'var(--color-text-tertiary)' }} />
          </button>
        </div>
        <div className="mb-4 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Marking <strong style={{ color: 'var(--color-text)' }}>{customerName}</strong> as&nbsp;
          <StatusBadge status={pendingStatus} />
        </div>
        <div className="mb-5">
          <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
            Call outcome <span className="ml-1 font-normal text-xs" style={{ color: 'var(--color-text-tertiary)' }}>(optional)</span>
          </label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className="input" rows={3}
            placeholder={
              pendingStatus === 'answering_machine' ? 'Left voicemail. Will call again tomorrow...'
              : pendingStatus === 'no_answer'       ? 'No answer. Will retry in 2 hours...'
              : 'Spoke with customer. Resolved / booked...'
            } autoFocus />
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
            {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              : <CheckCircle size={14} />}
            Save & Submit
          </button>
        </div>
      </div>
      </div>
    </div>
  );
};

// ── Create / Edit Modal ──────────────────────────────────────────────────────
const CallbackModal = ({ callback, companyId, companyTimezone, onSave, onClose }) => {
  const isEdit   = !!callback;
  const agentTz  = ET_ZONE;

  const initCustomerTz = callback?.customer_timezone || null;

  const [zipInput,   setZipInput]   = useState('');
  const [zipInfo,    setZipInfo]    = useState(
    callback?.customer_state
      ? { city: callback.customer_city || '', state: callback.customer_state || '', timezone: callback.customer_timezone || '' }
      : null
  );
  const [zipLoading, setZipLoading] = useState(false);
  const [zipErr,     setZipErr]     = useState('');

  const customerTz = zipInfo?.timezone || initCustomerTz || null;
  const displayTz  = customerTz || agentTz;

  const [form, setForm] = useState({
    customer_name:  callback?.customer_name  || '',
    customer_phone: callback?.customer_phone || '',
    customer_email: callback?.customer_email || '',
    notes:          callback?.notes          || '',
    priority:       callback?.priority       || 'Medium',
    callback_at:    callback?.callback_at
      ? formatForInput(callback.callback_at, displayTz)
      : formatForInput(Date.now() + 30 * 60000, displayTz),
    status: callback?.status || 'pending',
  });
  const [saving, setSaving]   = useState(false);
  const [err,    setErr]      = useState('');
  const [now,    setNow]      = useState(() => new Date());
  const prevTzRef             = useRef(displayTz);
  const zipTimerRef           = useRef(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Re-derive input value when customer timezone changes
  useEffect(() => {
    if (prevTzRef.current === displayTz) return;
    if (!form.callback_at) return;
    const utcIso = convertToUtc(form.callback_at, prevTzRef.current);
    setForm(p => ({ ...p, callback_at: formatForInput(utcIso, displayTz) }));
    prevTzRef.current = displayTz;
  }, [displayTz]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleZipChange = (raw) => {
    // Strip non-digits + clip to 5 here (not via HTML maxLength) so a paste
    // like "(845) 587-6504" lands as "8455" → "84558" not "(845)" → "845".
    const val = String(raw || '').replace(/\D/g, '').slice(0, 5);
    setZipInput(val);
    setZipErr('');
    clearTimeout(zipTimerRef.current);
    if (val.length < 5) { setZipInfo(null); return; }
    zipTimerRef.current = setTimeout(async () => {
      setZipLoading(true);
      try {
        const res = await client.get(`zipcode/${val}`);
        setZipInfo(res.data);
      } catch {
        setZipErr('ZIP not found');
        setZipInfo(null);
      } finally { setZipLoading(false); }
    }, 500);
  };

  const quickTime = (ms) =>
    setForm(p => ({ ...p, callback_at: formatForInput(Date.now() + ms, displayTz) }));

  // Dual-time preview
  const previewUtc   = form.callback_at ? convertToUtc(form.callback_at, displayTz) : null;
  const custPreview  = previewUtc && customerTz
    ? `${formatInTz(previewUtc, customerTz, { hour: '2-digit', minute: '2-digit', hour12: true })} ${getTzAbbr(customerTz)}`
    : null;
  const agentPreview = previewUtc
    ? `${formatInTz(previewUtc, agentTz, { hour: '2-digit', minute: '2-digit', hour12: true })} ${getTzAbbr(agentTz)}`
    : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customer_name.trim()) return setErr('Customer name required');
    if (!form.callback_at) return setErr('Callback time required');
    setSaving(true); setErr('');
    try {
      const utcCallbackAt = convertToUtc(form.callback_at, displayTz);
      const payload = {
        ...form,
        callback_at:       utcCallbackAt,
        user_timezone:     agentTz,
        customer_timezone: customerTz || null,
        customer_state:    zipInfo?.state || null,
        customer_city:     zipInfo?.city  || null,
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
    <div className="fixed inset-0 z-50 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="flex min-h-full items-center justify-center p-4">
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
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-bg-secondary">
            <X size={16} style={{ color: 'var(--color-text-tertiary)' }} />
          </button>
        </div>

        {err && <div className="mb-4 p-3 rounded-xl text-sm font-medium"
          style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>{err}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
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
              <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>Priority</label>
              <select value={form.priority} onChange={e => setForm(p => ({...p, priority: e.target.value}))} className="input">
                <option value="High">🔴 High</option>
                <option value="Medium">🟡 Medium</option>
                <option value="Low">🔵 Low</option>
              </select>
            </div>
          </div>

          {/* ZIP lookup → auto-detect state + timezone */}
          <div>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
              <MapPin size={12} className="inline mr-1" />
              Customer ZIP Code
            </label>
            <div className="relative">
              <input value={zipInput} onChange={e => handleZipChange(e.target.value)}
                inputMode="numeric"
                className="input pr-8" placeholder="e.g. 90210" />
              {zipLoading && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2"
                    style={{ borderColor: 'var(--color-primary-600)' }} />
                </div>
              )}
            </div>
            {zipErr && <p className="text-xs mt-1 text-red-500">{zipErr}</p>}
            {zipInfo && (
              <div className="mt-1.5 flex items-center gap-2 text-xs font-medium"
                style={{ color: 'var(--color-text-secondary)' }}>
                <Globe size={11} />
                {zipInfo.city}, {zipInfo.state} · {getTzAbbr(zipInfo.timezone)}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>Email</label>
            <input value={form.customer_email} onChange={e => setForm(p => ({...p, customer_email: e.target.value}))}
              className="input" placeholder="john@email.com" type="email" />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
              Callback Date & Time
              {customerTz
                ? <span className="ml-1 font-normal text-xs" style={{ color: 'var(--color-text-tertiary)' }}>customer's time ({getTzAbbr(customerTz)})</span>
                : <span className="ml-1 font-normal text-xs" style={{ color: 'var(--color-text-tertiary)' }}>your time ({getTzAbbr(agentTz)})</span>}
              <span className="text-red-500 ml-1">*</span>
            </label>
            <input value={form.callback_at} onChange={e => setForm(p => ({...p, callback_at: e.target.value}))}
              className="input" type="datetime-local" required />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[
                { label: '+5 min',   ms: 5  * 60 * 1000 },
                { label: '+15 min',  ms: 15 * 60 * 1000 },
                { label: '+1 hour',  ms: 60 * 60 * 1000 },
                { label: 'Tomorrow', ms: 24 * 60 * 60 * 1000 },
              ].map(({ label, ms }) => (
                <button key={label} type="button" onClick={() => quickTime(ms)}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors hover:opacity-80"
                  style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Dual-time preview */}
          {previewUtc && (
            <div className="rounded-xl p-3 grid grid-cols-2 gap-3"
              style={{ backgroundColor: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)' }}>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: '#6366f1' }}>
                  Customer hears
                </p>
                <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                  {custPreview || agentPreview}
                </p>
                {zipInfo && (
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                    {zipInfo.city}, {zipInfo.state}
                  </p>
                )}
                {customerTz && (
                  <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                    {new Intl.DateTimeFormat('en-US', { timeZone: customerTz, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(now)}
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: '#10b981' }}>
                  You get notified at
                </p>
                <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                  {agentPreview}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                  {new Intl.DateTimeFormat('en-US', { timeZone: agentTz, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(now)}
                </p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>Notes</label>
            <textarea value={form.notes} onChange={e => setForm(p => ({...p, notes: e.target.value}))}
              className="input" rows={2} placeholder="What to discuss…" />
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

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-semibold"
              style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
              style={{ background: 'var(--gradient-sidebar)' }}>
              {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Phone size={14} />}
              {isEdit ? 'Save Changes' : 'Schedule'}
            </button>
          </div>
        </form>
      </div>
      </div>
    </div>
  );
};

// ── Detail Drawer ────────────────────────────────────────────────────────────
const CallbackDrawer = ({ callback: cb, companyTimezone, onEdit, onDelete, onStatusChange, deleting, onClose }) => {
  if (!cb) return null;
  const past = isPast(cb.callback_at) && cb.status === 'pending';
  const soon = isDueSoon(cb.callback_at);

  return (
    <div className="fixed inset-0 z-40 flex" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ml-auto w-full max-w-sm h-full overflow-y-auto shadow-2xl flex flex-col"
        style={{ backgroundColor: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)' }}>

        {/* Drawer header */}
        <div className="flex items-center justify-between p-4 border-b"
          style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--gradient-sidebar)' }}>
              <Phone size={14} className="text-white" />
            </div>
            <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>Callback Detail</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-secondary">
            <X size={15} style={{ color: 'var(--color-text-tertiary)' }} />
          </button>
        </div>

        <div className="flex-1 p-4 space-y-4">
          {/* Urgency flags */}
          {past && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl text-sm font-semibold"
              style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
              <AlertTriangle size={14} /> Overdue
            </div>
          )}
          {soon && !past && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl text-sm font-semibold"
              style={{ backgroundColor: '#fef3c7', color: '#b45309' }}>
              <Clock size={14} /> Due in &lt;30 min
            </div>
          )}

          {/* Name + badges */}
          <div>
            <p className="font-bold text-lg leading-tight mb-2" style={{ color: 'var(--color-text)' }}>
              {cb.customer_name}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <PriorityBadge priority={cb.priority} />
              <StatusBadge status={cb.status} />
            </div>
          </div>

          {/* Details grid */}
          <div className="space-y-2.5">
            {cb.customer_phone && (
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                <Phone size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                <CopyableNumber value={cb.customer_phone} />
              </div>
            )}
            {cb.customer_email && (
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                <span style={{ color: 'var(--color-text-tertiary)' }}>✉</span>
                {cb.customer_email}
              </div>
            )}
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
              <Calendar size={13} style={{ color: 'var(--color-text-tertiary)' }} />
              {formatDateTime(cb.callback_at, cb.customer_timezone)}
            </div>
            {cb.customer_timezone && cb.customer_timezone !== companyTimezone && (
              <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                <Globe size={11} />
                Customer: {getTzAbbr(cb.customer_timezone)}
                {companyTimezone && ` · You: ${getTzAbbr(companyTimezone)}`}
              </div>
            )}
            {(cb.customer_city || cb.customer_state) && (
              <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                <MapPin size={11} />
                {[cb.customer_city, cb.customer_state].filter(Boolean).join(', ')}
              </div>
            )}
            {cb.user_name && (
              <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                Scheduled by: {cb.user_name}
              </div>
            )}
          </div>

          {cb.notes && (
            <div className="p-3 rounded-xl text-sm"
              style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>NOTES</p>
              </div>
              {/* Notes are explicitly opt-in to selection + copy via CopyableText so
                  the shell-wide .bsx-no-select doesn't block this one block. */}
              <CopyableText value={cb.notes} />
            </div>
          )}

          {/* Quick status actions */}
          {cb.status === 'pending' && (
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-tertiary)' }}>MARK AS</p>
              <div className="flex flex-col gap-1.5">
                <button onClick={() => onStatusChange(cb.id, 'completed', cb.customer_name)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold transition-all hover:scale-[1.02]"
                  style={{ backgroundColor: '#d1fae5', color: '#065f46' }}>
                  <CheckCircle size={13} /> Done
                </button>
                <button onClick={() => onStatusChange(cb.id, 'no_answer', cb.customer_name)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold transition-all hover:scale-[1.02]"
                  style={{ backgroundColor: '#f3f4f6', color: '#374151' }}>
                  <PhoneOff size={13} /> No Answer
                </button>
                <button onClick={() => onStatusChange(cb.id, 'answering_machine', cb.customer_name)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold transition-all hover:scale-[1.02]"
                  style={{ backgroundColor: '#ede9fe', color: '#6d28d9' }}>
                  <Voicemail size={13} /> Answering Machine
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t flex gap-2" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={() => { onClose(); onEdit(cb); }}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold border transition-colors hover:bg-bg-secondary"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            <Edit2 size={13} /> Edit
          </button>
          <button onClick={() => { onClose(); onDelete(cb.id); }} disabled={deleting === cb.id}
            className="flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-sm font-semibold transition-colors hover:bg-red-50 disabled:opacity-50"
            style={{ color: '#dc2626', border: '1px solid #fca5a5' }}>
            {deleting === cb.id
              ? <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-red-500" />
              : <Trash2 size={13} />}
          </button>
        </div>
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
            ? 'Your notification subscription was reset. Click Enable to receive notifications.'
            : 'Get browser notifications when a callback is due — even when the tab is in the background.'}
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
      <button onClick={onDismiss} className="p-1.5 rounded-lg hover:bg-bg-secondary">
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
  const [drawerCb,     setDrawerCb]     = useState(null);
  const [deleting,     setDeleting]     = useState(null);
  const [showPushBanner, setShowPushBanner] = useState(false);
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
    if (action === 'edit') {
      setCallbacks(prev => prev.map(x => x.id === cb.id ? cb : x));
      if (drawerCb?.id === cb.id) setDrawerCb(cb);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this callback? The audit history will be preserved for compliance.')) return;
    setDeleting(id);
    try {
      await client.delete(`callbacks/${id}`);
      setCallbacks(prev => prev.filter(x => x.id !== id));
      if (drawerCb?.id === id) setDrawerCb(null);
    } catch {} finally { setDeleting(null); }
  };

  const handleStatusConfirm = async (status, notes) => {
    if (!outcomeModal) return;
    const { id } = outcomeModal;
    try {
      const payload = { status };
      if (notes) payload.notes = notes;
      const res = await client.put(`callbacks/${id}`, payload);
      setCallbacks(prev => prev.map(x => x.id === id ? res.data.callback : x));
      if (drawerCb?.id === id) setDrawerCb(res.data.callback);
    } catch {}
    setOutcomeModal(null);
  };

  const handleStatusQuick = (id, status, customerName) => {
    setOutcomeModal({ id, status, customerName });
  };

  const pendingCount = callbacks.filter(c => c.status === 'pending').length;

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Phone size={15} style={{ color: 'var(--color-primary-600)' }} />
            Callbacks
            {pendingCount > 0 && (
              <span className="ml-1 text-xs font-bold px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: '#ef4444' }}>
                {pendingCount}
              </span>
            )}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Schedule and track customer callbacks. Click any row for details.
          </p>
        </div>
        <button onClick={() => setModal('create')}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl font-bold text-xs text-white transition-all hover:-translate-y-0.5"
          style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}>
          <Plus size={13} /> Schedule Callback
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
        <div className="mb-2 flex items-center gap-2 text-xs font-medium" style={{ color: '#10b981' }}>
          <Bell size={13} /> Browser notifications enabled
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-3 p-1 rounded-xl w-fit"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        {[
          { key: 'pending',   label: 'Pending'  },
          { key: 'all',       label: 'All'       },
          { key: 'completed', label: 'Completed' },
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

      {/* Compact list */}
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
        <div className="rounded-2xl border overflow-hidden"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          {callbacks.map((cb, idx) => {
            const past = isPast(cb.callback_at) && cb.status === 'pending';
            const soon = isDueSoon(cb.callback_at);
            const isLast = idx === callbacks.length - 1;
            return (
              <div key={cb.id}
                onClick={() => setDrawerCb(cb)}
                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-bg-secondary group"
                style={{
                  borderBottom: isLast ? 'none' : '1px solid var(--color-border)',
                  backgroundColor: past ? 'rgba(254,242,242,0.5)' : soon ? 'rgba(255,251,235,0.5)' : undefined,
                }}>

                {/* Priority dot */}
                <span className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: PRIORITY_CONFIG[cb.priority]?.dot || '#f59e0b' }} />

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate" style={{ color: 'var(--color-text)' }}>
                      {cb.customer_name}
                    </span>
                    <PriorityBadge priority={cb.priority} />
                    <StatusBadge status={cb.status} />
                    {past  && <span className="text-xs font-bold text-red-600">Overdue</span>}
                    {soon && !past && <span className="text-xs font-bold" style={{ color: '#b45309' }}>Due soon</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    <span className="flex items-center gap-1">
                      <Calendar size={10} /> {formatDateTime(cb.callback_at, cb.customer_timezone)}
                    </span>
                    {cb.customer_phone && <span className="flex items-center gap-1">📞 <CopyableNumber value={cb.customer_phone} size={10} /></span>}
                  </div>
                  {cb.notes && (
                    <p className="text-[11px] mt-0.5 italic truncate"
                      style={{ color: 'var(--color-text-tertiary)' }}>
                      {cb.notes}
                    </p>
                  )}
                </div>

                {/* Quick actions (pending only, shown on hover) */}
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  onClick={e => e.stopPropagation()}>
                  {cb.status === 'pending' && (
                    <>
                      <button onClick={() => handleStatusQuick(cb.id, 'completed', cb.customer_name)}
                        className="px-2 py-1 rounded-lg text-xs font-bold transition-all hover:scale-105"
                        style={{ backgroundColor: '#d1fae5', color: '#065f46' }} title="Done">
                        <CheckCircle size={12} />
                      </button>
                      <button onClick={() => handleStatusQuick(cb.id, 'no_answer', cb.customer_name)}
                        className="px-2 py-1 rounded-lg text-xs font-bold transition-all hover:scale-105"
                        style={{ backgroundColor: '#f3f4f6', color: '#374151' }} title="No Answer">
                        <PhoneOff size={12} />
                      </button>
                      <button onClick={() => handleStatusQuick(cb.id, 'answering_machine', cb.customer_name)}
                        className="px-2 py-1 rounded-lg text-xs font-bold transition-all hover:scale-105"
                        style={{ backgroundColor: '#ede9fe', color: '#6d28d9' }} title="Ans. Machine">
                        <Voicemail size={12} />
                      </button>
                    </>
                  )}
                </div>

                <ChevronRight size={14} className="flex-shrink-0 opacity-30 group-hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--color-text-secondary)' }} />
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Drawer */}
      {drawerCb && (
        <CallbackDrawer
          callback={drawerCb}
          companyTimezone={user?.company_timezone}
          onEdit={(cb) => setModal(cb)}
          onDelete={handleDelete}
          onStatusChange={handleStatusQuick}
          deleting={deleting}
          onClose={() => setDrawerCb(null)}
        />
      )}

      {/* Create/Edit Modal */}
      {modal && (
        <CallbackModal
          callback={modal === 'create' ? null : modal}
          companyId={user?.company_id}
          companyTimezone={user?.company_timezone}
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
