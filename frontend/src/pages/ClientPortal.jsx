import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, LogOut, Loader2, Headphones,
  Calendar, User, Search, RefreshCw, AudioLines,
} from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';

// ── The isolated client recording portal ─────────────────────────────────────
// No CRM chrome. Client sees ONLY their assigned closers + those closers' sales
// that have a real recording, and plays the actual sale call. The recording is
// streamed through the API (Bearer) as a blob — the source URL is never exposed.
const fmt = (s) => {
  if (!s && s !== 0) return '0:00';
  const m = Math.floor(s / 60); const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};
const fmtDate = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return d || ''; } };

export default function ClientPortal() {
  const { user, logout } = useAuth();
  const [me, setMe]           = useState({ name: '', closers: [] });
  const [closer, setCloser]   = useState('');     // '' = all assigned
  const [q, setQ]             = useState('');
  const [sales, setSales]     = useState([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected]       = useState(null);
  const [audioLoading, setAudioLoad]  = useState(false);
  const [audioErr, setAudioErr]       = useState('');
  const [playing, setPlaying]         = useState(false);
  const [cur, setCur]                 = useState(0);
  const [dur, setDur]                 = useState(0);
  const audioRef = useRef(null);
  const urlRef   = useRef(null);

  useEffect(() => { client.get('portal/me').then(r => setMe(r.data)).catch(() => {}); }, []);

  const digits = q.replace(/\D/g, '');
  const phoneMode = digits.length >= 4 && /^[\d\s()+.\-]+$/.test(q.trim());

  const loadSales = useCallback(async (params) => {
    setLoading(true);
    try {
      const r = await client.get('portal/sales', { params: { closer_id: closer || undefined, ...params } });
      setSales(r.data.sales || []);
    } catch { setSales([]); } finally { setLoading(false); }
  }, [closer]);

  // Browse recent, OR search by phone (debounced) when the query is a number.
  useEffect(() => {
    const t = setTimeout(() => {
      if (phoneMode) loadSales({ phone: digits });
      else loadSales({ scan: 120 });
    }, phoneMode ? 350 : 0);
    return () => clearTimeout(t);
  }, [loadSales, phoneMode, digits]);

  // cleanup blob on unmount
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const playSale = async (sale) => {
    setSelected(sale); setAudioErr(''); setAudioLoad(true); setPlaying(false); setCur(0); setDur(0);
    try {
      const res = await client.get(`portal/sales/${sale.id}/recording`, { responseType: 'blob' });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(res.data);
      urlRef.current = url;
      const a = audioRef.current;
      if (a) { a.src = url; a.load(); a.play().catch(() => {}); }
    } catch {
      setAudioErr('This recording could not be loaded right now.');
    } finally { setAudioLoad(false); }
  };

  const toggle = () => { const a = audioRef.current; if (!a) return; a.paused ? a.play() : a.pause(); };
  const skip   = (d) => { const a = audioRef.current; if (!a) return; a.currentTime = Math.min(Math.max(0, a.currentTime + d), dur || a.duration || 0); };
  const seek   = (e) => { const a = audioRef.current; if (!a) return; a.currentTime = Number(e.target.value); setCur(Number(e.target.value)); };

  // In phone mode the backend already matched; otherwise name-filter locally.
  const filtered = phoneMode ? sales : sales.filter(s => {
    const t = q.trim().toLowerCase();
    return !t || (s.customer_name || '').toLowerCase().includes(t) || (s.closer_name || '').toLowerCase().includes(t);
  });

  const pct = dur ? (cur / dur) * 100 : 0;

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'radial-gradient(1200px 600px at 80% -10%, #1e293b 0%, #0b1120 45%, #060912 100%)', color: '#e2e8f0' }}>
      {/* header */}
      <header className="flex-shrink-0 flex items-center justify-between px-5 sm:px-8 py-4"
        style={{ borderBottom: '1px solid rgba(148,163,184,0.12)', backdropFilter: 'blur(8px)' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
            <Headphones size={20} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-wide">Call Recordings</div>
            <div className="text-[11px]" style={{ color: '#64748b' }}>{me.name || user?.name || 'Client'}</div>
          </div>
        </div>
        <button onClick={logout}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
          style={{ background: 'rgba(148,163,184,0.08)', color: '#cbd5e1' }}>
          <LogOut size={14} /> Sign out
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-5 sm:px-8 py-6">
        <div className="max-w-5xl mx-auto">
        {/* closer chips */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <button onClick={() => setCloser('')}
            className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
            style={chip(closer === '')}>All closers</button>
          {me.closers.map(c => (
            <button key={c.id} onClick={() => setCloser(c.id)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
              style={chip(closer === c.id)}>{c.name}</button>
          ))}
        </div>

        {/* search + refresh */}
        <div className="flex items-center gap-2 mb-5">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#475569' }} />
            <input value={q} onChange={e => setQ(e.target.value)} inputMode="tel" placeholder="Search by phone number, customer, or closer…"
              className="w-full text-sm rounded-xl pl-9 pr-3 py-2.5 outline-none"
              style={{ background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.14)', color: '#e2e8f0' }} />
          </div>
          <button onClick={() => loadSales(phoneMode ? { phone: digits } : { scan: 120 })} className="p-2.5 rounded-xl" style={{ background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.14)' }}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} style={{ color: '#94a3b8' }} />
          </button>
        </div>

        {/* list */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24" style={{ color: '#475569' }}>
            <Loader2 size={28} className="animate-spin mb-3" />
            <p className="text-sm">Finding recordings…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center" style={{ color: '#475569' }}>
            <AudioLines size={32} className="mb-3" />
            <p className="text-sm">{phoneMode ? `No sale found for “${q.trim()}”.` : `No recordings to show${closer ? ' for this closer' : ''}.`}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(s => {
              const on = selected?.id === s.id;
              const noRec = s.has_recording === false;
              return (
                <button key={s.id} onClick={() => !noRec && playSale(s)} disabled={noRec}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all group"
                  style={{
                    background: on ? 'linear-gradient(90deg,rgba(99,102,241,0.18),rgba(139,92,246,0.06))' : 'rgba(148,163,184,0.04)',
                    border: `1px solid ${on ? 'rgba(99,102,241,0.5)' : 'rgba(148,163,184,0.1)'}`,
                    cursor: noRec ? 'default' : 'pointer', opacity: noRec ? 0.55 : 1,
                  }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: on ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'rgba(148,163,184,0.1)' }}>
                    {noRec ? <AudioLines size={15} style={{ color: '#64748b' }} /> : on && playing ? <Pause size={15} className="text-white" /> : <Play size={15} style={{ color: on ? '#fff' : '#94a3b8' }} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate" style={{ color: '#f1f5f9' }}>{s.customer_name}</div>
                    <div className="flex items-center gap-3 text-[11px] mt-0.5 flex-wrap" style={{ color: '#64748b' }}>
                      <span className="flex items-center gap-1"><User size={11} />{s.closer_name}</span>
                      <span className="flex items-center gap-1"><Calendar size={11} />{fmtDate(s.sale_date)}</span>
                      {phoneMode && s.phone ? <span className="tabular-nums">{s.phone}</span> : null}
                      {noRec
                        ? <span style={{ color: '#94a3b8' }}>· Recording not available</span>
                        : s.duration ? <span className="flex items-center gap-1"><AudioLines size={11} />{fmt(s.duration)}</span> : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        </div>
      </main>

      {/* player bar — in-flow at the column bottom (page never grows past one screen) */}
      {selected && (
        <div className="flex-shrink-0 px-5 sm:px-8 py-4"
          style={{ background: 'rgba(8,12,22,0.92)', borderTop: '1px solid rgba(148,163,184,0.14)', backdropFilter: 'blur(14px)' }}>
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center gap-3 mb-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate" style={{ color: '#f1f5f9' }}>{selected.customer_name}</div>
                <div className="text-[11px] truncate" style={{ color: '#64748b' }}>{selected.closer_name} · {fmtDate(selected.sale_date)}</div>
              </div>
              <button onClick={() => skip(-10)} className="p-2 rounded-lg hover:bg-white/5" disabled={audioLoading}><SkipBack size={18} style={{ color: '#cbd5e1' }} /></button>
              <button onClick={toggle} disabled={audioLoading}
                className="w-11 h-11 rounded-full flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                {audioLoading ? <Loader2 size={18} className="animate-spin text-white" /> : playing ? <Pause size={18} className="text-white" /> : <Play size={18} className="text-white" />}
              </button>
              <button onClick={() => skip(10)} className="p-2 rounded-lg hover:bg-white/5" disabled={audioLoading}><SkipForward size={18} style={{ color: '#cbd5e1' }} /></button>
            </div>
            {audioErr ? (
              <p className="text-xs text-center py-1" style={{ color: '#f87171' }}>{audioErr}</p>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-[11px] tabular-nums w-10 text-right" style={{ color: '#64748b' }}>{fmt(cur)}</span>
                <div className="relative flex-1 h-1.5 rounded-full" style={{ background: 'rgba(148,163,184,0.18)' }}>
                  <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#6366f1,#8b5cf6)' }} />
                  <input type="range" min={0} max={dur || 0} step="0.1" value={cur} onChange={seek}
                    className="absolute inset-0 w-full opacity-0 cursor-pointer" style={{ margin: 0 }} />
                </div>
                <span className="text-[11px] tabular-nums w-10" style={{ color: '#64748b' }}>{fmt(dur)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <audio ref={audioRef}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setCur(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDur(audioRef.current?.duration || 0)}
        controlsList="nodownload" className="hidden" />

      {/* — */}
      <span style={{ position: 'fixed', bottom: 3, right: 6, fontSize: 8, letterSpacing: 1, color: '#94a3b8', opacity: 0.05, userSelect: 'none', pointerEvents: 'none' }}>am · bv</span>
    </div>
  );
}

const chip = (active) => ({
  background: active ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'rgba(148,163,184,0.06)',
  border: `1px solid ${active ? 'transparent' : 'rgba(148,163,184,0.14)'}`,
  color: active ? '#fff' : '#94a3b8',
});
