import { useState, useEffect, useCallback } from 'react';
import { ClipboardCheck, Phone, X, Loader2, Search, Check, Hash, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';

// "Dispositions from the dialer" — the closer's VICIdial dispositions that
// couldn't be matched to a lead (VICIdial sends only dispo+agent for the
// closer's calls). The closer assigns each to the right lead from their CRM,
// mirroring the fronter's pending-transfer confirm. Self-hides when empty.
export default function CloserPendingDispos({ onChanged, refreshSignal, onOpenSaleForm }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    client.get('vicidial/closer-dispos').then(r => setItems(r.data.dispos || [])).catch(() => {});
  }, []);
  // Poll only while the tab is visible (a backgrounded tab polled forever for
  // nothing); refresh immediately on return so it's never stale. 60s cadence.
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 60000);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [load, refreshSignal]);

  const dismiss = async (it) => {
    try { await client.delete(`vicidial/closer-dispos/${it.id}`); load(); }
    catch { toast.error('Failed'); }
  };

  if (!items.length) return null;

  return (
    <>
      <div className="rounded-2xl p-4 mb-5" style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-200, #fde68a)' }}>
        <p className="text-sm font-bold flex items-center gap-2 mb-2.5" style={{ color: 'var(--color-warning-700, #b45309)' }}>
          <ClipboardCheck size={16} /> {items.length} sale{items.length > 1 ? 's' : ''} to confirm — open the sale form
        </p>
        <div className="space-y-1.5">
          {items.map(it => {
            const fd = it.transfer?.form_data || {};
            const cust = fd.customer_name || [fd.FirstName, fd.LastName].filter(Boolean).join(' ') || fd.Phone || fd.customer_phone;
            return (
            <div key={it.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="min-w-0">
                <p className="text-sm font-semibold flex items-center gap-2 flex-wrap" style={{ color: 'var(--color-text)' }}>
                  {it.disposition_name || it.raw_dispo}
                  {it.disposition_name && it.raw_dispo && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>{it.raw_dispo}</span>
                  )}
                  {!it.disposition_name && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-warning-100, #fef3c7)', color: 'var(--color-warning-700, #b45309)' }}>unmapped</span>
                  )}
                  {it.transfer && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(16,185,129,0.12)', color: '#047857' }}>needs sale form</span>
                  )}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                  {it.transfer && cust ? <span className="font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{cust} · </span> : null}
                  {new Date(it.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {it.transfer ? (
                  <button onClick={() => onOpenSaleForm?.(it)} className="text-xs font-bold px-3 py-1.5 rounded-lg text-white flex items-center gap-1" style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>
                    <DollarSign size={13} /> Open sale form
                  </button>
                ) : (
                  <button onClick={() => setOpen(it)} className="text-xs font-bold px-3 py-1.5 rounded-lg text-white" style={{ background: 'var(--gradient-sidebar)' }}>Assign</button>
                )}
                <button onClick={() => dismiss(it)} title="Dismiss" className="p-1.5 rounded-lg hover:bg-bg-secondary" style={{ color: 'var(--color-text-tertiary)' }}><X size={15} /></button>
              </div>
            </div>
            );
          })}
        </div>
      </div>
      {open && <AssignModal item={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load(); onChanged?.(); }} />}
    </>
  );
}

function AssignModal({ item, onClose, onDone }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);

  const search = useCallback((term) => {
    setLoading(true);
    client.get('vicidial/closer-assignable', { params: term ? { q: term } : {} })
      .then(r => setRows(r.data.transfers || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { search(''); }, [search]);
  useEffect(() => { const t = setTimeout(() => search(q.trim()), 350); return () => clearTimeout(t); }, [q, search]);

  const assign = async (tr) => {
    setBusy(tr.id);
    try {
      await client.post(`vicidial/closer-dispos/${item.id}/assign`, { transfer_id: tr.id });
      toast.success(`${item.disposition_name || item.raw_dispo} → ${tr.name}`);
      onDone();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg my-6 rounded-2xl" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h3 className="font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            Assign <span className="px-2 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>{item.disposition_name || item.raw_dispo}</span> to a lead
          </h3>
          <button onClick={onClose}><X size={18} style={{ color: 'var(--color-text-secondary)' }} /></button>
        </div>
        <div className="p-4">
          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search by phone or name…" className="input pl-9" />
          </div>
          <div className="max-h-[55vh] overflow-y-auto space-y-1.5">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /></div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>No recent leads. Try searching by phone.</p>
            ) : rows.map(tr => (
              <button key={tr.id} onClick={() => assign(tr)} disabled={busy === tr.id}
                className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors disabled:opacity-50 hover:bg-bg-secondary"
                style={{ border: '1px solid var(--color-border)' }}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
                    {tr.name}
                    {tr.pending && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>not confirmed</span>}
                  </p>
                  <p className="text-xs flex items-center gap-2 truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                    <span className="flex items-center gap-1"><Phone size={11} /> {tr.phone || '—'}</span>
                    {tr.code && <span className="flex items-center gap-0.5 font-mono"><Hash size={9} />{tr.code}</span>}
                  </p>
                </div>
                {busy === tr.id ? <Loader2 size={16} className="animate-spin flex-shrink-0" style={{ color: 'var(--color-primary-600)' }} />
                  : <Check size={16} className="flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
