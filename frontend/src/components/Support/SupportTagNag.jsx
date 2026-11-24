// ============================================================================
// SupportTagNag -- keeps a closer's open support requests in front of them.
//
// When a support agent tags a closer, the closer has to answer: say what
// happened and close the request. Until they do, this pops up -- straight
// away when the tag arrives, and again every 5 minutes while any request is
// still open. It also owns the open-request COUNT the shell draws as the red
// badge on the Support Requests tab.
//
// It renders nothing and asks the server nothing for a closer with no open
// request: the 5-minute tick re-checks only when the last answer was "some
// are open", and a new tag announces itself through the notification channel
// (useLiveRefresh), never by polling.
//
// The popup is held back while the closer is already on the Support Requests
// tab -- that is them doing what it asks.
// ============================================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { Headset, Phone, Clock } from 'lucide-react';
import client from '../../api/client';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';

const NAG_MS = 5 * 60 * 1000;
const SHOWN = 4;

const waited = (iso) => {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} h ${mins % 60} min ago` : `${Math.floor(h / 24)} d ago`;
};

export default function SupportTagNag({ count, onCount, onTab, onOpen }) {
  const [tags, setTags] = useState([]);
  const [show, setShow] = useState(false);
  const countRef = useRef(count);
  useEffect(() => { countRef.current = count; }, [count]);
  const onTabRef = useRef(onTab);
  useEffect(() => { onTabRef.current = onTab; }, [onTab]);

  // `pop` = raise the popup if anything is open.
  const check = useCallback(async (pop) => {
    try {
      const r = await client.get('support/tags/mine', { params: { status: 'open' } });
      const open = r.data.tags || [];
      setTags(open);
      onCount(r.data.open_count || 0);
      if (pop && open.length > 0 && !onTabRef.current) setShow(true);
      if (open.length === 0) setShow(false);
    } catch { /* a failed check must never break the dashboard; the next tick retries */ }
  }, [onCount]);

  // On arrival at the dashboard: open requests are shown at once.
  useEffect(() => { check(true); }, [check]);
  // A new tag: the bell rings and this pops with it.
  const onNewTag = useCallback(() => check(true), [check]);
  useLiveRefresh(['support_tag'], onNewTag);
  // Every 5 minutes, only while something is open.
  useEffect(() => {
    const t = setInterval(() => { if (countRef.current > 0) check(true); }, NAG_MS);
    return () => clearInterval(t);
  }, [check]);
  // Closing the last one on the Requests tab drops the count: put the popup away.
  useEffect(() => { if (count === 0) setShow(false); }, [count]);

  if (!show || tags.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}
      role="alertdialog" aria-modal="true" aria-labelledby="stn-title">
      <div className="w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-3 px-5 py-4" style={{ background: 'var(--color-error-500)' }}>
          <Headset size={20} className="text-white" />
          <h2 id="stn-title" className="text-base font-bold text-white m-0">
            {tags.length === 1 ? 'Support is waiting on you' : `Support is waiting on you: ${tags.length} requests`}
          </h2>
        </div>

        <div className="px-5 py-4 grid gap-3 max-h-[55vh] overflow-y-auto">
          <p className="text-sm m-0" style={{ color: 'var(--color-text-secondary)' }}>
            Call the customer, then say what happened and close the request. This reminder comes back every 5 minutes until you do.
          </p>
          {tags.slice(0, SHOWN).map((t) => (
            <div key={t.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)' }}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                  {t.customer_name || t.sale?.customer_name || 'Customer'}
                  {t.client_name && <span className="font-normal" style={{ color: 'var(--color-text-tertiary)' }}> - {t.client_name}</span>}
                </span>
                <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  <Clock size={12} /> {waited(t.created_at)}
                </span>
              </div>
              {t.sale?.customer_phone && (
                <a href={`tel:${t.sale.customer_phone}`} className="inline-flex items-center gap-1 text-xs font-semibold mt-1" style={{ color: 'var(--color-primary-600)' }}>
                  <Phone size={12} /> {t.sale.customer_phone}
                </a>
              )}
              <div className="text-sm mt-1.5 whitespace-pre-wrap break-words" style={{ color: 'var(--color-text)' }}>{t.note}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>from {t.tagged_by_name}</div>
            </div>
          ))}
          {tags.length > SHOWN && (
            <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>and {tags.length - SHOWN} more.</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <button type="button" onClick={() => setShow(false)}
            className="px-3 py-2 rounded-lg text-sm font-semibold border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            Remind me in 5 minutes
          </button>
          <button type="button" autoFocus onClick={() => { setShow(false); onOpen(); }}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--color-primary-600)' }}>
            Open Support Requests
          </button>
        </div>
      </div>
    </div>
  );
}
