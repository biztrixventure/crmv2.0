import { useState, useEffect, useCallback } from 'react';
import { PhoneIncoming, Phone, Check, X, Loader2, Hash } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import { useFormFields } from '../../hooks/useFormFields';

// "Pending from dialer" — transfers VICIdial captured on XFER (lead_id + phone).
// The fronter fills the rest + confirms → it becomes a normal transfer. Also
// surfaces the closer's returned disposition once it's come back. Renders
// nothing when there's nothing pending (so it's safe to mount anywhere).
const SKIP = new Set(['cli_number', 'customer_phone', 'manual_entry_by', 'transfer_date', 'last_redial_at', 'state_abbr']);

export default function PendingFromDialer({ onConfirmed }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    client.get('vicidial/pending').then(r => setItems(r.data.pending || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  if (!items.length) return null;

  return (
    <>
      <div className="rounded-2xl p-4 mb-5" style={{ backgroundColor: 'var(--color-primary-50, #eef2ff)', border: '1px solid var(--color-primary-200, #c7d2fe)' }}>
        <p className="text-sm font-bold flex items-center gap-2 mb-2.5" style={{ color: 'var(--color-primary-700)' }}>
          <PhoneIncoming size={16} /> {items.length} transfer{items.length > 1 ? 's' : ''} from the dialer — confirm to send
        </p>
        <div className="space-y-1.5">
          {items.map(it => {
            const fd = it.form_data || {};
            const phone = fd.customer_phone || fd.Phone || it.normalized_phone || '';
            return (
              <div key={it.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold flex items-center gap-2 flex-wrap" style={{ color: 'var(--color-text)' }}>
                    <Phone size={13} /> {phone || '—'}
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded inline-flex items-center gap-0.5" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}><Hash size={8} /> {it.vicidial_vendor_code}</span>
                  </p>
                  {it.vicidial_dispo && <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>Closer disposition: <strong style={{ color: 'var(--color-text)' }}>{it.vicidial_dispo}</strong></p>}
                </div>
                <button onClick={() => setOpen(it)} className="text-xs font-bold px-3 py-1.5 rounded-lg text-white flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>Confirm</button>
              </div>
            );
          })}
        </div>
      </div>
      {open && <ConfirmModal item={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load(); onConfirmed?.(); }} />}
    </>
  );
}

function ConfirmModal({ item, onClose, onDone }) {
  const { fields, fetchFields } = useFormFields();
  useEffect(() => { fetchFields(); }, [fetchFields]);

  const fd0 = item.form_data || {};
  const editable = (fields || []).filter(f =>
    f && f.name && f.show_to_fronter !== false && !String(f.field_type || '').startsWith('sale_') && !SKIP.has(f.name));

  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  // Seed the form once fields load (prefill known values + the captured phone).
  useEffect(() => {
    if (!editable.length) return;
    const phone = fd0.customer_phone || fd0.Phone || item.normalized_phone || '';
    setForm(prev => {
      if (Object.keys(prev).length) return prev;
      const init = {};
      editable.forEach(f => { init[f.name] = fd0[f.name] || (/phone|cli|mobile/i.test(f.name) ? phone : ''); });
      return init;
    });
  }, [fields.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));
  const save = async () => {
    setBusy(true);
    try { await client.post(`vicidial/pending/${item.id}/confirm`, { form_data: form }); toast.success('Transfer confirmed'); onDone(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not confirm'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg my-6 rounded-2xl" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h3 className="font-bold" style={{ color: 'var(--color-text)' }}>Confirm transfer from dialer</h3>
          <button onClick={onClose}><X size={18} style={{ color: 'var(--color-text-secondary)' }} /></button>
        </div>
        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            Code <span className="font-mono">{item.vicidial_vendor_code}</span>. Fill the lead details, then confirm to send it as a normal transfer.
          </p>
          {editable.map(f => (
            <div key={f.name}>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-secondary)' }}>{f.label || f.name}{f.is_required && ' *'}</label>
              <input value={form[f.name] || ''} onChange={e => set(f.name, e.target.value)} className="input" />
            </div>
          ))}
        </div>
        <div className="flex gap-3 p-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button onClick={onClose} className="flex-1 py-2 rounded-lg font-semibold" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
          <button onClick={save} disabled={busy} className="flex-1 py-2 rounded-lg font-bold text-white flex items-center justify-center gap-1.5 disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)' }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Confirm transfer
          </button>
        </div>
      </div>
    </div>
  );
}
