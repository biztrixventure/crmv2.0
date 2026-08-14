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
  // Poll only while the tab is visible; refresh on return so it's never stale.
  // Tight 10s loop so the Confirm button shows up fast after an XFER — the
  // realtime notification also bumps refreshSignal for a near-instant appearance.
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 10000);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [load, refreshSignal]);

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
          const name = fd.customer_name || [fd.FirstName, fd.LastName].filter(Boolean).join(' ') || null;
          const vehicle = [fd.CarYear, fd.CarMake, fd.CarModel].filter(Boolean).join(' ') || null;
          const location = [fd.City, fd.State].filter(Boolean).join(', ') || null;
          return (
            <div key={it.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="min-w-0">
                <p className="text-sm font-semibold flex items-center gap-2 flex-wrap" style={{ color: 'var(--color-text)' }}>
                  {name || phone || '—'}
                  {it.vicidial_vendor_code && (
                    <span className="text-[11px] sm:text-[10px] font-mono px-1.5 py-0.5 rounded inline-flex items-center gap-0.5" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}><Hash size={8} /> Lead {it.vicidial_vendor_code}</span>
                  )}
                </p>
                <p className="text-xs mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: 'var(--color-text-secondary)' }}>
                  {name && phone && (<span className="inline-flex items-center gap-1"><Phone size={11} /> {phone}</span>)}
                  {vehicle && <span>{vehicle}</span>}
                  {location && <span>{location}</span>}
                </p>
                {it.closer_disposition ? (
                  <p className="text-xs mt-1 flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--color-text-secondary)' }}>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ backgroundColor: (it.closer_disposition_color || '#6b7280') + '22', color: it.closer_disposition_color || '#6b7280', border: `1px solid ${(it.closer_disposition_color || '#6b7280')}44` }}>{it.closer_disposition}</span>
                    {it.closer_name && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>by {it.closer_name}</span>}
                    {/* WHEN it was set. Without this a disposition from weeks ago
                        looked identical to one from a minute ago, so a closer who
                        wasn't even working appeared to have just handled the
                        call. Anything not from today is called out explicitly. */}
                    {it.closer_disposition_at && (() => {
                      const d = new Date(it.closer_disposition_at);
                      const isToday = d.toDateString() === new Date().toDateString();
                      const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
                      return (
                        <span className="text-[11px] px-1.5 py-0.5 rounded font-semibold"
                          title={d.toLocaleString()}
                          style={isToday
                            ? { color: 'var(--color-text-tertiary)' }
                            : { color: 'var(--color-warning-700, #b45309)', backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-200, #fde68a)' }}>
                          {isToday
                            ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                            : `${d.toLocaleDateString()} · ${days <= 1 ? 'yesterday' : `${days} days ago`}`}
                        </span>
                      );
                    })()}
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
