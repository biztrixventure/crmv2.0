import { useState, useEffect, useCallback } from 'react';
import { PhoneIncoming, Phone, Hash } from 'lucide-react';
import client from '../../api/client';

// "Pending from dialer" — transfers VICIdial captured on XFER (lead_id + phone).
// Clicking Confirm opens the fronter's normal create-transfer form (prefilled
// with the phone) via onPick; submitting there confirms this pending row.
// Renders nothing when there's nothing pending (safe to mount anywhere).
export default function PendingFromDialer({ onPick, refreshSignal }) {
  const [items, setItems] = useState([]);

  const load = useCallback(() => {
    client.get('vicidial/pending').then(r => setItems(r.data.pending || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load, refreshSignal]);

  if (!items.length) return null;

  return (
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
                {it.closer_disposition ? (
                  <p className="text-xs mt-1 flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--color-text-secondary)' }}>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ backgroundColor: (it.closer_disposition_color || '#6b7280') + '22', color: it.closer_disposition_color || '#6b7280', border: `1px solid ${(it.closer_disposition_color || '#6b7280')}44` }}>{it.closer_disposition}</span>
                    {it.closer_name && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>by {it.closer_name}</span>}
                  </p>
                ) : it.vicidial_dispo && <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>Closer disposition: <strong style={{ color: 'var(--color-text)' }}>{it.vicidial_dispo}</strong></p>}
              </div>
              <button onClick={() => onPick?.(it)} className="text-xs font-bold px-3 py-1.5 rounded-lg text-white flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>Confirm</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
