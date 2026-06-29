import { useState, useEffect, useCallback } from 'react';
import { CalendarClock, Phone, CheckCircle, AlertTriangle, XCircle, Settings2, DollarSign, RefreshCw } from 'lucide-react';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import CopyableNumber from '../UI/CopyableNumber';

// Monthly-payment retention surface. Backend role-scopes GET /upcoming:
//   closer → own due policies · manager → team · compliance → at-risk queue.
// Closers/managers log the outcome; compliance can cancel. Superadmin gets the
// settings panel (window / reminder offsets / notify roles / enable).
const STATUS = {
  pending:   { label: 'Pending',   color: '#f59e0b', bg: '#fffbeb' },
  collected: { label: 'Collected', color: '#16a34a', bg: '#f0fdf4' },
  at_risk:   { label: 'At risk',   color: '#dc2626', bg: '#fef2f2' },
  cancelled: { label: 'Cancelled', color: '#6b7280', bg: 'var(--color-bg-secondary)' },
};
const money = (n) => (n == null || n === '' || isNaN(Number(n))) ? '—' : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const daysUntil = (dueStr) => {
  const due = new Date(dueStr + 'T00:00:00Z'); const t = new Date(); t.setUTCHours(0, 0, 0, 0);
  return Math.round((due - t) / 86400000);
};

export default function PaymentRemindersPanel() {
  const { user } = useAuth();
  const role = user?.role;
  const isCompliance = role === 'compliance_manager';
  const isSuper = role === 'superadmin';

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg]         = useState(null);
  const [windowDays, setWindowDays] = useState(7);
  const [busy, setBusy]       = useState(null);
  const [selected, setSelected] = useState(null);   // row open in the detail drawer
  const [noteText, setNoteText] = useState('');

  const load = useCallback(() => {
    setLoading(true); setMsg(null);
    client.get('payment-reminders/upcoming')
      .then(r => { setRows(r.data.followups || []); setWindowDays(r.data.window_days || 7); })
      .catch(e => setMsg({ type: 'err', text: e.response?.data?.error || 'Failed to load' }))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (id, status, note) => {
    setBusy(id);
    try {
      await client.patch(`payment-reminders/${id}`, { status, ...(note !== undefined ? { note } : {}) });
      setSelected(null);
      await load();
    } catch (e) { setMsg({ type: 'err', text: e.response?.data?.error || 'Action failed' }); }
    finally { setBusy(null); }
  };

  const openDetail = (r) => { setSelected(r); setNoteText(r.note || ''); };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-extrabold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <CalendarClock size={22} style={{ color: 'var(--color-primary-600)' }} />
            {isCompliance ? 'Payments at risk' : 'Monthly payments due'}
          </h2>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {isCompliance
              ? 'Policies a closer could not collect — review for cancellation.'
              : `Active policies billing in the next ${windowDays} days. Call the customer to confirm their monthly payment.`}
          </p>
        </div>
        <button onClick={load} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {isSuper && <SuperSettings onSaved={load} />}

      {msg && <p className="text-sm font-semibold" style={{ color: msg.type === 'err' ? '#dc2626' : '#16a34a' }}>{msg.text}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ borderColor: 'var(--color-border)' }}>
          <CheckCircle size={40} className="mx-auto mb-3" style={{ color: '#16a34a' }} />
          <p style={{ color: 'var(--color-text-secondary)' }}>{isCompliance ? 'No payments flagged at risk.' : 'Nothing due in this window — all caught up.'}</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                <th className="text-left px-4 py-2.5 font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Customer</th>
                <th className="text-left px-4 py-2.5 font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Due</th>
                <th className="text-left px-4 py-2.5 font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Monthly</th>
                <th className="text-left px-4 py-2.5 font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Status</th>
                <th className="text-right px-4 py-2.5 font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const s = r.sales || {};
                const st = STATUS[r.status] || STATUS.pending;
                const d = daysUntil(r.due_date);
                return (
                  <tr key={r.id} onClick={() => openDetail(r)}
                    className="cursor-pointer transition-colors hover:bg-bg-secondary"
                    style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-4 py-3">
                      <div className="font-semibold" style={{ color: 'var(--color-text)' }}>{s.customer_name || '—'}</div>
                      {s.customer_phone && <CopyableNumber number={s.customer_phone} className="text-xs" />}
                      {s.reference_no && <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Ref {s.reference_no}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div style={{ color: 'var(--color-text)' }}>{r.due_date}</div>
                      <div className="text-[11px] font-semibold" style={{ color: d <= 1 ? '#dc2626' : d <= 3 ? '#d97706' : 'var(--color-text-tertiary)' }}>
                        {d < 0 ? `${-d}d overdue` : d === 0 ? 'due today' : `in ${d}d`}
                      </div>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-text)' }}>{money(s.monthly_payment)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold"
                        style={{ backgroundColor: st.bg, color: st.color, border: `1px solid ${st.color}44` }}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5 justify-end flex-wrap">
                        {!isCompliance && r.status !== 'cancelled' && (
                          <>
                            <button disabled={busy === r.id} onClick={() => act(r.id, 'collected')}
                              className="text-[11px] font-semibold px-2 py-1 rounded-lg inline-flex items-center gap-1 disabled:opacity-50"
                              style={{ backgroundColor: '#16a34a', color: '#fff' }}>
                              <CheckCircle size={12} /> Collected
                            </button>
                            <button disabled={busy === r.id} onClick={() => act(r.id, 'at_risk')}
                              className="text-[11px] font-semibold px-2 py-1 rounded-lg inline-flex items-center gap-1 border disabled:opacity-50"
                              style={{ borderColor: '#dc2626', color: '#dc2626' }}>
                              <AlertTriangle size={12} /> At risk
                            </button>
                          </>
                        )}
                        {isCompliance && r.status !== 'cancelled' && (
                          <button disabled={busy === r.id} onClick={() => act(r.id, 'cancelled')}
                            className="text-[11px] font-semibold px-2 py-1 rounded-lg inline-flex items-center gap-1 disabled:opacity-50"
                            style={{ backgroundColor: '#dc2626', color: '#fff' }}>
                            <XCircle size={12} /> Cancel policy
                          </button>
                        )}
                        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Details ›</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail drawer — click a row to see the full record + act with a note */}
      {selected && (() => {
        const s = selected.sales || {};
        const st = STATUS[selected.status] || STATUS.pending;
        const d = daysUntil(selected.due_date);
        const canAct = selected.status !== 'cancelled';
        return (
          <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setSelected(null)}>
            <div className="w-full max-w-md h-full overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}
              style={{ backgroundColor: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)' }}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{s.customer_name || 'Customer'}</h3>
                  {s.customer_phone && <CopyableNumber number={s.customer_phone} className="text-sm" />}
                </div>
                <button onClick={() => setSelected(null)} className="p-1 rounded hover:bg-bg-secondary"><XCircle size={18} style={{ color: 'var(--color-text-tertiary)' }} /></button>
              </div>

              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold"
                style={{ backgroundColor: st.bg, color: st.color, border: `1px solid ${st.color}44` }}>{st.label}</span>

              <div className="rounded-xl border p-3 text-sm space-y-1.5" style={{ borderColor: 'var(--color-border)' }}>
                <Row label="Payment due"   value={`${selected.due_date} · ${d < 0 ? `${-d}d overdue` : d === 0 ? 'today' : `in ${d}d`}`} />
                <Row label="Monthly"       value={money(s.monthly_payment)} />
                <Row label="Reference"     value={s.reference_no || '—'} />
                <Row label="Plan / sold"   value={s.sale_date ? `sold ${String(s.sale_date).slice(0,10)}` : '—'} />
                {selected.handled_at && <Row label="Last action" value={new Date(selected.handled_at).toLocaleString()} />}
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>Note (call outcome)</label>
                <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={3}
                  placeholder="What happened on the call?" className="input resize-none w-full text-sm" />
              </div>

              {canAct && (
                <div className="flex flex-wrap gap-2">
                  {!isCompliance && (
                    <>
                      <button disabled={busy === selected.id} onClick={() => act(selected.id, 'collected', noteText)}
                        className="flex-1 text-sm font-bold px-3 py-2 rounded-lg inline-flex items-center justify-center gap-1 text-white disabled:opacity-50" style={{ backgroundColor: '#16a34a' }}>
                        <CheckCircle size={14} /> Payment collected
                      </button>
                      <button disabled={busy === selected.id} onClick={() => act(selected.id, 'at_risk', noteText)}
                        className="flex-1 text-sm font-bold px-3 py-2 rounded-lg inline-flex items-center justify-center gap-1 border disabled:opacity-50" style={{ borderColor: '#dc2626', color: '#dc2626' }}>
                        <AlertTriangle size={14} /> Couldn't collect
                      </button>
                    </>
                  )}
                  {(isCompliance || isSuper) && (
                    <button disabled={busy === selected.id} onClick={() => act(selected.id, 'cancelled', noteText)}
                      className="flex-1 text-sm font-bold px-3 py-2 rounded-lg inline-flex items-center justify-center gap-1 text-white disabled:opacity-50" style={{ backgroundColor: '#dc2626' }}>
                      <XCircle size={14} /> Cancel policy
                    </button>
                  )}
                  <button disabled={busy === selected.id} onClick={() => act(selected.id, undefined, noteText)}
                    className="text-sm font-semibold px-3 py-2 rounded-lg border disabled:opacity-50" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                    Save note
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const Row = ({ label, value }) => (
  <div className="flex items-center justify-between gap-3">
    <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
    <span className="font-semibold text-right" style={{ color: 'var(--color-text)' }}>{value}</span>
  </div>
);

// ── Superadmin settings (window / offsets / notify roles / enable) ───────────
function SuperSettings({ onSaved }) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg]   = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open || cfg) return;
    client.get('payment-reminders/settings').then(r => setCfg(r.data)).catch(() => setCfg({ enabled: true, windowDays: 7, offsets: [7, 3, 1], notifyRoles: ['closer'] }));
  }, [open, cfg]);

  const save = async () => {
    try {
      await client.put('payment-reminders/settings', {
        enabled: cfg.enabled,
        window_days: cfg.windowDays,
        reminder_offsets: cfg.offsets,
        notify_roles: cfg.notifyRoles,
      });
      setSaved(true); setTimeout(() => setSaved(false), 1500); onSaved?.();
    } catch { /* ignore */ }
  };

  const ROLES = [['closer_manager', 'Closer managers'], ['compliance_manager', 'Compliance'], ['operations_manager', 'Operations'], ['company_admin', 'Company admin']];

  return (
    <div className="rounded-xl border" style={{ borderColor: 'var(--color-primary-200, #c7d2fe)', backgroundColor: 'var(--color-primary-50, #eef2ff)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-bold" style={{ color: 'var(--color-primary-700)' }}>
        <Settings2 size={15} /> Payment reminder settings <span className="font-normal text-xs" style={{ color: 'var(--color-text-tertiary)' }}>(superadmin)</span>
      </button>
      {open && cfg && (
        <div className="px-4 pb-4 space-y-3">
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
            <input type="checkbox" checked={!!cfg.enabled} onChange={e => setCfg({ ...cfg, enabled: e.target.checked })} />
            Enabled
          </label>
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <span style={{ color: 'var(--color-text-secondary)' }}>Look-ahead window</span>
            <input type="number" min={0} max={60} value={cfg.windowDays} onChange={e => setCfg({ ...cfg, windowDays: parseInt(e.target.value, 10) || 0 })} className="input text-sm py-1 w-20" />
            <span style={{ color: 'var(--color-text-tertiary)' }}>days</span>
          </div>
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <span style={{ color: 'var(--color-text-secondary)' }}>Remind at (days before due)</span>
            <input value={(cfg.offsets || []).join(', ')} onChange={e => setCfg({ ...cfg, offsets: e.target.value.split(',').map(x => parseInt(x.trim(), 10)).filter(n => n >= 0) })} className="input text-sm py-1 w-40" placeholder="7, 3, 1" />
          </div>
          <div className="text-sm">
            <span style={{ color: 'var(--color-text-secondary)' }}>Also notify (the closer is always notified):</span>
            <div className="flex flex-wrap gap-3 mt-1">
              {ROLES.map(([key, lbl]) => (
                <label key={key} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text)' }}>
                  <input type="checkbox" checked={(cfg.notifyRoles || []).includes(key)}
                    onChange={e => setCfg({ ...cfg, notifyRoles: e.target.checked ? [...new Set([...(cfg.notifyRoles || []), key])] : (cfg.notifyRoles || []).filter(r => r !== key) })} />
                  {lbl}
                </label>
              ))}
            </div>
          </div>
          <button onClick={save} className="text-xs font-bold px-3 py-1.5 rounded-lg text-white" style={{ background: 'var(--gradient-sidebar)' }}>
            {saved ? 'Saved ✓' : 'Save settings'}
          </button>
        </div>
      )}
    </div>
  );
}
