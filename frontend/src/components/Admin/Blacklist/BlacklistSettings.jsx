import { useEffect, useState } from 'react';
import { Shield, Check, KeyRound, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../../api/client';

// Superadmin: configure the Blacklist Alliance DNC lookup. The API key is stored
// server-side only — this screen never receives it back, just a masked tail.
export default function BlacklistSettings() {
  const [cfg, setCfg] = useState(null);
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => client.get('blacklist/settings').then(r => setCfg(r.data)).catch(() => setCfg({ enabled: false, cache_days: 30, has_key: false, key_preview: null }));
  useEffect(() => { load(); }, []);

  const save = async (extra = {}) => {
    setBusy(true);
    try {
      const r = await client.put('blacklist/settings', { enabled: cfg.enabled, cache_days: cfg.cache_days, ...extra });
      setCfg(r.data);
      if (extra.api_key || extra.clear_key) setKeyInput('');
      toast.success('Saved');
    } catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
    finally { setBusy(false); }
  };

  if (!cfg) return <div className="p-8 text-center text-text-secondary">Loading…</div>;

  return (
    <div className="max-w-xl mx-auto p-1 space-y-4">
      <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <h3 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}><Shield size={18} /> Blacklist / DNC Lookup</h3>
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          Closers + compliance can check a single number against the Blacklist Alliance DNC / litigation database (on-demand, informational).
          Turn it on for specific companies in <strong>Features → Blacklist / DNC Lookup</strong> (<code>tool_blacklist_lookup</code>); the master switch + key are here.
        </p>

        {/* master enable */}
        <label className="flex items-center justify-between gap-4 py-2 cursor-pointer" style={{ borderTop: '1px solid var(--color-border)' }}>
          <span>
            <span className="block text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Enabled</span>
            <span className="block text-xs" style={{ color: 'var(--color-text-secondary)' }}>Master switch. Lookups only run when this is on and a key is set.</span>
          </span>
          <input type="checkbox" checked={!!cfg.enabled} onChange={e => setCfg({ ...cfg, enabled: e.target.checked })} className="w-5 h-5" />
        </label>

        {/* API key */}
        <div className="py-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <label className="block text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>API key</label>
          <p className="text-xs mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            {cfg.has_key ? <>A key is set (<span className="font-mono">{cfg.key_preview}</span>). Enter a new one to replace it.</> : 'No key set yet — paste your Blacklist Alliance key.'}
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
              <input type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder="Paste API key…"
                className="input text-sm pl-9 w-full" autoComplete="off" />
            </div>
            <button onClick={() => save({ api_key: keyInput })} disabled={busy || !keyInput.trim()}
              className="text-xs font-bold px-3 py-2 rounded-lg text-white disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)' }}>Save key</button>
            {cfg.has_key && (
              <button onClick={() => { if (window.confirm('Remove the saved API key?')) save({ clear_key: true }); }} disabled={busy}
                className="text-xs font-semibold px-2.5 py-2 rounded-lg border disabled:opacity-50" style={{ borderColor: '#fca5a5', color: '#dc2626' }} title="Clear key"><Trash2 size={14} /></button>
            )}
          </div>
        </div>

        {/* cache window */}
        <div className="flex items-center justify-between gap-3 py-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <span>
            <span className="block text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Re-check after</span>
            <span className="block text-xs" style={{ color: 'var(--color-text-secondary)' }}>Cached results are reused until this many days old (saves API cost).</span>
          </span>
          <span className="flex items-center gap-2">
            <input type="number" min={1} max={365} value={cfg.cache_days} onChange={e => setCfg({ ...cfg, cache_days: parseInt(e.target.value, 10) || 30 })} className="input text-sm py-1 w-20 text-right" />
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>days</span>
          </span>
        </div>

        <button onClick={() => save()} disabled={busy} className="text-sm font-bold px-4 py-2 rounded-lg text-white inline-flex items-center gap-1.5" style={{ background: 'var(--gradient-sidebar)' }}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Save settings
        </button>
      </div>
    </div>
  );
}
