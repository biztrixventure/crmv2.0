import { useState } from 'react';
import { Shield, ShieldAlert, ShieldCheck, Search, Loader2, Phone, Building2, RefreshCw } from 'lucide-react';
import client from '../../api/client';

// Dedicated DNC / blacklist lookup page (closer + compliance). Type a number,
// get the Good / Blacklisted verdict + the matched lists + carrier. Uses the same
// cached, server-side-keyed endpoint as the inline badge.
const CODE_LABEL = {
  'federal-dnc': 'Federal DNC', 'colorado-dnc': 'Colorado DNC', 'florida-dnc': 'Florida DNC',
  'indiana-dnc': 'Indiana DNC', 'pennsylvania-dnc': 'Pennsylvania DNC', 'texas-dnc': 'Texas DNC', 'wyoming-dnc': 'Wyoming DNC',
  'attorney-primary': 'Attorney (primary)', 'attorney-secondary': 'Attorney (secondary)',
  'plaintiff-primary': 'Plaintiff (primary)', 'plaintiff-secondary': 'Plaintiff (secondary)',
  'prelitigation1': 'Pre-litigation', 'prelitigation2': 'Pre-litigation (2)',
  'anti-telemarketing': 'Anti-telemarketing', 'gov': 'Government',
};
const pretty = (c) => CODE_LABEL[c] || c;
const fmtPhone = (d) => d && d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d;

export default function DncLookupPanel({ compact = false }) {
  const [phone, setPhone] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (refresh = false) => {
    const d = String(phone).replace(/\D/g, '').slice(-10);
    if (d.length !== 10) { setRes({ error: 'Enter a 10-digit US phone number' }); return; }
    setBusy(true); setRes(r => (refresh ? r : null));
    try { const r = await client.get(`blacklist/lookup/${d}${refresh ? '?refresh=true' : ''}`); setRes(r.data); }
    catch (e) { setRes({ error: e.response?.data?.error || 'Lookup failed' }); }
    finally { setBusy(false); }
  };

  const bad = res && res.ok !== false && !res.error && res.blacklisted;
  const good = res && res.ok !== false && !res.error && !res.blacklisted;
  const color = bad ? '#dc2626' : '#16a34a';

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

      {(good || bad) && (
        <div className="mt-4 rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: `1px solid ${color}55` }}>
          <div className="flex items-center gap-3">
            {bad ? <ShieldAlert size={28} style={{ color }} /> : <ShieldCheck size={28} style={{ color }} />}
            <div>
              <div className="text-xl font-extrabold" style={{ color }}>{res.message}</div>
              <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{fmtPhone(res.phone)}</div>
            </div>
            <button onClick={() => run(true)} disabled={busy} className="ml-auto text-xs font-semibold px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
              <RefreshCw size={13} /> Re-check
            </button>
          </div>

          {res.codes?.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-tertiary)' }}>On these lists</div>
              <div className="flex flex-wrap gap-1.5">
                {res.codes.map(c => <span key={c} className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${color}14`, color, border: `1px solid ${color}44` }}>{pretty(c)}</span>)}
              </div>
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
            Checked {res.checked_at ? new Date(res.checked_at).toLocaleString() : 'now'}{res.cached ? ' · cached' : ''}
          </div>
        </div>
      )}
    </div>
  );
}
