import { useState } from 'react';
import { Shield, ShieldAlert, ShieldCheck, Search, Loader2, Phone, Building2, RefreshCw } from 'lucide-react';
import client from '../../api/client';
import { verdictOf, statusText, groupCodes } from '../../utils/dncStatus';

// Dedicated DNC / blacklist lookup page (closer + compliance). Type a number,
// get the Good / Blacklisted verdict + the matched lists + carrier. Uses the same
// cached, server-side-keyed endpoint as the inline badge.
// Status names, colours and list labels come from utils/dncStatus -- the same
// ones the inline badge uses. Whatever the Alliance answers is shown under its
// own name (Good / Suppressed / Blacklisted / anything new), grouped by the KIND
// of list it matched, so an agent can see WHICH rule they would break.
const fmtPhone = (d) => d && d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d;

export default function DncLookupPanel({ compact = false, onResult }) {
  const [phone, setPhone] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (refresh = false) => {
    const d = String(phone).replace(/\D/g, '').slice(-10);
    if (d.length !== 10) { setRes({ error: 'Enter a 10-digit US phone number' }); return; }
    setBusy(true); setRes(r => (refresh ? r : null));
    // every lookup lands in the shared cache — tell the parent so a cache report
    // sitting next to this panel refreshes right away.
    try { const r = await client.get(`blacklist/lookup/${d}${refresh ? '?refresh=true' : ''}`); setRes(r.data); onResult?.(r.data); }
    catch (e) { setRes({ error: e.response?.data?.error || 'Lookup failed' }); }
    finally { setBusy(false); }
  };

  const answered = res && res.ok !== false && !res.error && !!res.message;
  const v = answered ? verdictOf(res) : null;
  const clean = !!v && v.tone === 'safe';
  const color = v ? v.color : '#16a34a';
  const groups = answered ? groupCodes(res.codes || []) : [];

  return (
    <div className={compact ? '' : 'max-w-2xl mx-auto px-4 py-6'}>
      {!compact && (
        <div className="mb-4">
          <h2 className="text-2xl font-extrabold flex items-center gap-2" style={{ color: 'var(--color-text)' }}><Shield size={22} style={{ color: 'var(--color-primary-600)' }} /> DNC / Blacklist Check</h2>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Check a phone against the Federal/State DNC + litigation (attorney / plaintiff / pre-litigation) database before you call.</p>
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="Enter phone number…" inputMode="tel"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border text-sm" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
        </div>
        <button onClick={() => run()} disabled={busy}
          className="px-4 py-2.5 rounded-xl font-bold text-sm text-white inline-flex items-center gap-1.5 disabled:opacity-60" style={{ background: 'var(--gradient-sidebar)' }}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Check
        </button>
      </div>

      {res?.error && (
        <div className="mt-4 rounded-xl p-3 text-sm font-semibold" style={{ backgroundColor: '#fffbeb', border: '1px solid #fcd34d', color: '#b45309' }}>{res.error}</div>
      )}

      {answered && (
        <div className="mt-4 rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: `1px solid ${color}55` }}>
          <div className="flex items-center gap-3">
            {clean ? <ShieldCheck size={28} style={{ color }} /> : <ShieldAlert size={28} style={{ color }} />}
            <div>
              <div className="text-xl font-extrabold" style={{ color }}>{statusText(res)}</div>
              <div className="text-xs font-semibold" style={{ color }}>{v.note}</div>
              <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{fmtPhone(res.phone)}</div>
            </div>
            <button onClick={() => run(true)} disabled={busy} className="ml-auto text-xs font-semibold px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
              <RefreshCw size={13} /> Re-check
            </button>
          </div>

          {groups.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {groups.map(g => (
                <div key={g.group}>
                  <div className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{g.label}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.items.map(it => (
                      <span key={it.code} title={it.code} className="text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: `${color}14`, color, border: `1px solid ${color}44` }}>{it.label}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* An answer with no codes behind it still says something -- "Good"
              means clean, and a status we do not recognise must not look like a
              blank card. */}
          {!groups.length && !clean && (
            <div className="mt-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              The Alliance returned no list codes for this number.
            </div>
          )}

          {res.carrier && (
            <div className="mt-3 text-xs flex items-center gap-2 flex-wrap" style={{ color: 'var(--color-text-secondary)' }}>
              <Building2 size={13} />
              <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{res.carrier.name || 'Carrier'}</span>
              {res.carrier.type && <span>· {res.carrier.type}</span>}
              {res.carrier.state && <span>· {res.carrier.state}</span>}
              {res.wireless && <span className="font-semibold" style={{ color: 'var(--color-primary-600)' }}>· wireless</span>}
            </div>
          )}

          <div className="mt-3 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {res.results != null && <>Matched {res.results} list{res.results === 1 ? '' : 's'}{' '}</>}
            Checked {res.checked_at ? new Date(res.checked_at).toLocaleString() : 'now'}{res.cached ? ' · cached' : ' · live'}
          </div>
        </div>
      )}
    </div>
  );
}
