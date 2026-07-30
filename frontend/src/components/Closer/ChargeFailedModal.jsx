import { useState, useMemo } from 'react';
import { AlertTriangle, CalendarClock, X } from 'lucide-react';
import ThemedSelect from '../UI/Select';
import ThemedDate from '../UI/ThemedDate';
import client from '../../api/client';
import { usePostDateFailReasons } from '../../hooks/usePostDateFailReasons';

// ============================================================================
// ChargeFailedModal — the branch that never existed.
//
// The charge day arrives, the closer calls, and the card does not go through.
// Before this, there was nothing to do with that outcome: the record just sat
// in the Post Date tab with a date in the past, and compliance had no idea why.
//
// The closer picks WHY and WHEN to try again. Both are required — a failed
// charge always gets another date, so the record stays in the Post Date tab and
// the existing scheduler reminder re-arms for the new time (the backend clears
// charge_notified_at). Nothing is deleted and nothing silently disappears.
//
// The note is optional but is the only place free text lands, so it carries
// "customer says the 5th, after payday". Compliance reads both.
// ============================================================================

// A datetime-local value ("YYYY-MM-DDTHH:mm") for `d` in LOCAL time. Slicing an
// ISO string instead would shift by the UTC offset and pre-fill the closer's
// retry date silently a day off.
const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function ChargeFailedModal({ sale, onClose, onDone }) {
  const { activeReasons } = usePostDateFailReasons();
  const [reasonKey, setReasonKey] = useState('');
  const [note, setNote]           = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  // Default the retry to the same clock time one week out — the common case is
  // "next payday". Falls back to tomorrow if that lands in the past, because a
  // pre-filled date already behind us is worse than no default.
  const [nextAt, setNextAt] = useState(() => {
    const base = sale?.charge_at ? new Date(sale.charge_at) : new Date();
    const d = new Date(base.getTime());
    d.setDate(d.getDate() + 7);
    if (d.getTime() < Date.now()) { const n = new Date(); n.setDate(n.getDate() + 1); return toLocalInput(n); }
    return toLocalInput(d);
  });

  // Group by catalog category so the menu reads "payment / customer / other"
  // rather than one flat list of eight.
  const grouped = useMemo(() => {
    const g = new Map();
    activeReasons.forEach(r => {
      const k = r.category || 'other';
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(r);
    });
    return [...g.entries()];
  }, [activeReasons]);

  const submit = async () => {
    if (!reasonKey) { setError('Pick why the card did not go through'); return; }
    if (!nextAt)    { setError('Pick the next date to try the card');   return; }
    setSaving(true); setError('');
    try {
      await client.post(`sales/${sale.id}/charge-failed`, {
        reason_key: reasonKey,
        note: note.trim() || null,
        next_charge_at: new Date(nextAt).toISOString(),
      });
      onDone?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record the failed charge');
      setSaving(false);
    }
  };

  const amber = '#f59e0b';

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle size={18} style={{ color: amber, flexShrink: 0 }} />
            <div className="min-w-0">
              <h3 className="text-base font-bold text-text truncate">Card didn’t go through</h3>
              <p className="m-0 text-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>
                {sale?.customer_name || 'This post-date'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" aria-label="Close"
            style={{ color: 'var(--color-text-secondary)' }}>
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5"
              style={{ color: 'var(--color-text-secondary)' }}>
              Why <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <ThemedSelect value={reasonKey} onChange={e => { setReasonKey(e.target.value); setError(''); }}
              className="input text-sm w-full">
              <option value="">Select a reason…</option>
              {grouped.map(([cat, items]) => (
                <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
                  {items.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                </optgroup>
              ))}
            </ThemedSelect>
          </div>

          <div>
            <label className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide mb-1.5"
              style={{ color: 'var(--color-text-secondary)' }}>
              <CalendarClock size={12} /> Try again on <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <ThemedDate withTime value={nextAt}
              onChange={e => { setNextAt(e.target.value); setError(''); }}
              className="input text-sm" style={{ maxWidth: 280 }} />
            <p className="m-0 text-[11px] mt-1.5" style={{ color: 'var(--color-text-secondary)' }}>
              Stays in Post Date. You’ll get a fresh reminder at this time.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5"
              style={{ color: 'var(--color-text-secondary)' }}>Note</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="Optional — what the customer said (compliance sees this)"
              className="input text-sm w-full" style={{ resize: 'vertical' }} />
          </div>

          {error && (
            <p className="m-0 text-xs font-semibold flex items-center gap-1" style={{ color: '#dc2626' }}>
              <AlertTriangle size={12} /> {error}
            </p>
          )}
        </div>

        <div className="flex gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2 px-4 rounded-lg text-sm font-bold text-white"
            style={{ background: amber, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Record & reschedule'}
          </button>
        </div>
      </div>
    </div>
  );
}
