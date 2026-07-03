import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, LogOut, Loader2, Headphones,
  Calendar, User, Search, RefreshCw, AudioLines, Sparkles, X, Download, Clock, Sun, Moon,
  ChevronDown, Layers,
} from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';

// ── Isolated client recording portal ─────────────────────────────────────────
// No CRM chrome. Assigned closers' sales + play the actual sale call with a live
// audio visualizer. Recording is streamed through the API as a blob (same-origin
// → the Web Audio analyser can read it; the source URL is never exposed).
const fmt = (s) => {
  if (!s && s !== 0) return '0:00';
  const m = Math.floor(s / 60); const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};
const fmtDate = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return d || ''; } };

// Business palettes (warm brown/gold). Dark = default; light mirrors the CRM
// light tokens. Both contrast-checked: cream on near-black / dark brown on cream,
// and white content only ever sits on the dark-brown button gradient.
const PAL_DARK = {
  bg: 'radial-gradient(1200px 600px at 80% -10%, #241608 0%, #0D0A07 45%, #080503 100%)',
  text: '#F0E6D8', sub: '#C0A282', muted: '#8B7355',
  accent: '#C4894A', grad: 'linear-gradient(135deg,#7A4820 0%,#5A3210 100%)',
  border: 'rgba(196,137,74,0.16)', borderOn: 'rgba(196,137,74,0.55)',
  tint: 'rgba(196,137,74,0.05)', tint2: 'rgba(196,137,74,0.10)',
  active: 'linear-gradient(90deg,rgba(196,137,74,0.22),rgba(122,72,32,0.06))',
  player: 'rgba(20,13,7,0.94)', shadow: '0 8px 24px -8px rgba(122,72,32,0.7)',
  progress: 'linear-gradient(90deg,#C4894A,#7A4820)',
};
const PAL_LIGHT = {
  bg: 'radial-gradient(1200px 600px at 80% -10%, #FBF6EE 0%, #F5EDE4 45%, #EDE2D2 100%)',
  text: '#241C11', sub: '#5A4F45', muted: '#8B7F75',
  accent: '#8B5E2E', grad: 'linear-gradient(135deg,#8B5E2E 0%,#5A3210 100%)',
  border: 'rgba(110,88,56,0.22)', borderOn: 'rgba(139,94,46,0.6)',
  tint: 'rgba(110,88,56,0.05)', tint2: 'rgba(110,88,56,0.10)',
  active: 'linear-gradient(90deg,rgba(139,94,46,0.16),rgba(110,88,56,0.05))',
  player: 'rgba(253,251,248,0.95)', shadow: '0 8px 24px -8px rgba(110,88,56,0.4)',
  progress: 'linear-gradient(90deg,#8B5E2E,#5A3210)',
};

export default function ClientPortal() {
  const { user, logout } = useAuth();
  const [me, setMe]           = useState({ name: '', closers: [], test_audio: { enabled: false } });
  const [closer, setCloser]   = useState('');
  const [q, setQ]             = useState('');
  const [sales, setSales]     = useState([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected]      = useState(null);
  const [audioLoading, setAudioLoad] = useState(false);
  const [audioErr, setAudioErr]      = useState('');
  const [playing, setPlaying]        = useState(false);
  const [cur, setCur]                = useState(0);
  const [dur, setDur]                = useState(0);
  const [part, setPart]              = useState(0);     // current clip index for split (multi-part) sales
  const [clipMeta, setClipMeta]      = useState([]);   // per-clip [{clip_order, duration, recording_id}] for the selected sale
  const [durations, setDurations]    = useState({});   // sale id → length (s)
  const [expandedId, setExpandedId]  = useState(null); // multi-clip sale expanded INLINE in the list
  const [clipsBySale, setClipsBySale] = useState({});  // sale id → [clips] (cached per sale)
  const [noRec, setNoRec]            = useState({});   // sale id → true once resolved with no recording (gate OFF)
  const [downloading, setDownloading] = useState(null); // sale id currently downloading
  const [dark, setDark] = useState(() => localStorage.getItem('portalTheme') !== 'light');
  const toggleTheme = () => setDark(d => { localStorage.setItem('portalTheme', d ? 'light' : 'dark'); return !d; });
  const darkRef = useRef(dark); darkRef.current = dark;   // read inside the canvas draw loop

  const audioRef    = useRef(null);
  const urlRef      = useRef(null);
  const canvasRef   = useRef(null);
  const ctxRef      = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef   = useRef(null);

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

  useEffect(() => {
    const t = setTimeout(() => { phoneMode ? loadSales({ phone: digits }) : loadSales({ scan: 120 }); }, phoneMode ? 350 : 0);
    return () => clearTimeout(t);
  }, [loadSales, phoneMode, digits]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  // Show the call length before playing. The list carries the length (confirmed
  // length when the review gate is ON, cached length when OFF). Rows the gate
  // decides (review_status present) need no further work; otherwise (gate OFF,
  // uncached) fill the length from /recording-meta, which caches it server-side.
  useEffect(() => {
    if (!sales.length) return;
    setDurations(prev => {
      const next = { ...prev };
      for (const s of sales) if (s.duration && !next[s.id]) next[s.id] = s.duration;
      return next;
    });
    let cancelled = false;
    (async () => {
      // only rows with no length AND not already decided by the gate (review_status)
      let ids = sales.filter(s => !s.isTest && !s.duration && !durations[s.id] && !noRec[s.id] && s.review_status === undefined).map(s => s.id);
      let guard = 0;
      while (ids.length && !cancelled && guard++ < 30) {
        const chunk = ids.slice(0, 40);
        let resp;
        try { resp = await client.post('portal/sales/recording-meta', { ids: chunk }); }
        catch { break; }
        if (cancelled) break;
        const meta = resp.data.meta || {};
        setDurations(prev => {
          const next = { ...prev };
          for (const [id, m] of Object.entries(meta)) if (m.available && m.duration) next[id] = m.duration;
          return next;
        });
        setNoRec(prev => {
          const next = { ...prev };
          for (const [id, m] of Object.entries(meta)) if (!m.available && m.status !== 'pending_review') next[id] = true;
          return next;
        });
        ids = [...(resp.data.pending || []), ...ids.slice(40)];
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales]);

  // ── Web Audio graph (built once) + visualizer draw loop ─────────────────────
  const ensureGraph = () => {
    if (sourceRef.current || !audioRef.current) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      const ctx = new Ctx();
      const src = ctx.createMediaElementSource(audioRef.current);
      const an = ctx.createAnalyser();
      an.fftSize = 256; an.smoothingTimeConstant = 0.82;
      src.connect(an); an.connect(ctx.destination);
      ctxRef.current = ctx; analyserRef.current = an; sourceRef.current = src;
    } catch { /* analyser unavailable — playback still works */ }
  };

  useEffect(() => {
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const canvas = canvasRef.current; if (!canvas) return;
      const c = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth, H = canvas.clientHeight;
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      const an = analyserRef.current;
      const bars = 56, gap = 2;
      const bw = (W - gap * (bars - 1)) / bars;
      let data = null;
      if (an && playing) { data = new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(data); }
      for (let i = 0; i < bars; i++) {
        // sample low→high frequencies, mirrored for a symmetric look
        const mir = i < bars / 2 ? i : bars - 1 - i;
        const idx = Math.floor((mir / (bars / 2)) * (an ? an.frequencyBinCount * 0.7 : 1));
        const v = data ? data[idx] / 255 : 0.04 + 0.03 * Math.sin((Date.now() / 400) + i / 3);
        const h = Math.max(3, v * (H - 4));
        const x = i * (bw + gap), y = (H - h) / 2;
        const g = c.createLinearGradient(0, y, 0, y + h);
        if (darkRef.current) { g.addColorStop(0, '#E0B074'); g.addColorStop(1, '#C4894A'); }
        else { g.addColorStop(0, '#A8885C'); g.addColorStop(1, '#6E5838'); }
        c.fillStyle = g; c.globalAlpha = data ? 0.55 + v * 0.45 : 0.5;
        const r = Math.min(bw / 2, 3);
        c.beginPath();
        if (c.roundRect) c.roundRect(x, y, bw, h, r); else c.rect(x, y, bw, h);
        c.fill();
      }
      c.globalAlpha = 1;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const startBlob = async (urlPromise) => {
    setAudioErr(''); setAudioLoad(true); setPlaying(false); setCur(0); setDur(0);
    try {
      const res = await urlPromise;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(res.data);
      urlRef.current = url;
      const a = audioRef.current;
      if (a) {
        a.src = url; a.load();
        ensureGraph();
        if (ctxRef.current?.state === 'suspended') { try { await ctxRef.current.resume(); } catch { /* noop */ } }
        a.play().catch(() => {});
      }
    } catch (e) {
      setAudioErr(
        e?.response?.status === 409 ? 'This recording is being verified by compliance — check back soon.'
        : e?.response?.status === 404 ? 'No recording available for this call.'
        : 'This audio could not be loaded right now.');
    } finally { setAudioLoad(false); }
  };

  // A sale confirmed by compliance can be SPLIT across several calls (clips). We
  // play them as ordered parts; `sale.clips` is the count from the list.
  const clipCount = (selected && !selected.isTest) ? Math.max(1, selected.clips || 1) : 1;
  const loadPart = (sale, idx) => {
    startBlob(sale.isTest
      ? client.get('portal/test-audio', { responseType: 'blob' })
      : client.get(`portal/sales/${sale.id}/recording`, { params: idx != null ? { clip: idx + 1 } : {}, responseType: 'blob' }));
  };
  const goPart = (idx) => { if (selected && idx >= 0 && idx < clipCount) { setPart(idx); loadPart(selected, idx); } };

  // Fetch + cache a sale's confirmed clip list (labels + stored durations).
  const fetchClips = useCallback((saleId) => {
    if (clipsBySale[saleId]) return Promise.resolve(clipsBySale[saleId]);
    return client.get(`portal/sales/${saleId}/clips`)
      .then(r => { const cl = r.data.clips || []; setClipsBySale(m => ({ ...m, [saleId]: cl })); return cl; })
      .catch(() => []);
  }, [clipsBySale]);

  const playSale = (sale) => {
    setSelected(sale);
    setPart(0);
    setClipMeta([]);
    if (!sale.isTest && (sale.clips || 0) > 1) fetchClips(sale.id).then(setClipMeta);
    loadPart(sale, sale.isTest ? null : 0);
  };

  // Multi-clip sale → expand INLINE in the list (not a dialog); lazy-load clips.
  const toggleExpand = (sale) => {
    if (expandedId === sale.id) { setExpandedId(null); return; }
    setExpandedId(sale.id);
    fetchClips(sale.id);
  };

  // Play one specific clip of a sale (from the inline expanded list).
  const playClip = (sale, i) => {
    setSelected(sale);
    setPart(i);
    fetchClips(sale.id).then(setClipMeta);
    loadPart(sale, i);
  };

  // Download one specific clip of a multi-part sale.
  const downloadClip = async (sale, i, e) => {
    e?.stopPropagation();
    if (downloading) return;
    setDownloading(`${sale.id}:${i}`);
    try {
      const res = await client.get(`portal/sales/${sale.id}/recording`, { params: { clip: i + 1 }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      const safe = String(sale.customer_name || 'recording').replace(/\W+/g, '_');
      a.href = url; a.download = `recording_${safe}_${sale.sale_date || ''}_part${i + 1}.mp3`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { /* surfaced via the player error path when played */ }
    finally { setDownloading(null); }
  };

  // Download the recording to the CLIENT'S device. It streams from the dialer
  // through the proxy into a browser blob, then Save — nothing is written on the
  // CRM/server (same stream endpoint the player uses).
  const downloadSale = async (sale, e) => {
    e?.stopPropagation();
    if (downloading) return;
    setDownloading(sale.id);
    try {
      // split sales → download each part; single → one file
      const count = (!sale.isTest && sale.clips > 1) ? sale.clips : 1;
      const safe = (sale.customer_name || 'call').replace(/[^\w]+/g, '_').slice(0, 40);
      for (let i = 0; i < count; i++) {
        const res = sale.isTest
          ? await client.get('portal/test-audio', { responseType: 'blob' })
          : await client.get(`portal/sales/${sale.id}/recording`, { params: count > 1 ? { clip: i + 1 } : {}, responseType: 'blob' });
        const url = URL.createObjectURL(res.data);
        const a = document.createElement('a');
        a.href = url; a.download = `recording_${safe}_${sale.sale_date || ''}${count > 1 ? `_part${i + 1}` : ''}.mp3`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setAudioErr(
        err?.response?.status === 409 ? 'This recording is being verified by compliance — check back soon.'
        : err?.response?.status === 404 ? 'No recording available to download.'
        : 'Could not download this recording.');
    } finally { setDownloading(null); }
  };

  const toggle = () => { const a = audioRef.current; if (!a) return; a.paused ? a.play() : a.pause(); };
  const skip   = (d) => { const a = audioRef.current; if (!a) return; a.currentTime = Math.min(Math.max(0, a.currentTime + d), dur || a.duration || 0); };
  const seek   = (e) => { const a = audioRef.current; if (!a) return; a.currentTime = Number(e.target.value); setCur(Number(e.target.value)); };

  const filtered = phoneMode ? sales : sales.filter(s => {
    const t = q.trim().toLowerCase();
    return !t || (s.customer_name || '').toLowerCase().includes(t) || (s.closer_name || '').toLowerCase().includes(t);
  });
  const pct = dur ? (cur / dur) * 100 : 0;
  const testItem = me.test_audio?.enabled ? { id: '__test__', isTest: true, customer_name: me.test_audio.label || 'Visualizer demo' } : null;

  const P = dark ? PAL_DARK : PAL_LIGHT;

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: P.bg, color: P.text }}>
      {/* header */}
      <header className="flex-shrink-0 flex items-center justify-between px-5 sm:px-8 py-4" style={{ borderBottom: `1px solid ${P.border}` }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ background: P.grad, boxShadow: P.shadow }}>
            <Headphones size={20} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-wide" style={{ color: P.text }}>Call Recordings</div>
            <div className="text-[11px]" style={{ color: P.sub }}>{me.name || user?.name || 'Client'}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleTheme} title={dark ? 'Switch to light' : 'Switch to dark'}
            className="p-2 rounded-lg transition-colors hover:opacity-80" style={{ background: P.tint2, color: P.accent }}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button onClick={logout} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-colors hover:opacity-80" style={{ background: P.tint2, color: P.text }}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-5 sm:px-8 py-6">
        <div className="max-w-5xl mx-auto">
          {/* closer chips */}
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <button onClick={() => setCloser('')} className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all" style={chip(closer === '', P)}>All closers</button>
            {me.closers.map(c => (
              <button key={c.id} onClick={() => setCloser(c.id)} className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all" style={chip(closer === c.id, P)}>{c.name}</button>
            ))}
          </div>

          {/* search */}
          <div className="flex items-center gap-2 mb-4">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: P.muted }} />
              <input value={q} onChange={e => setQ(e.target.value)} inputMode="tel" placeholder="Search by phone number, customer, or closer…"
                className="w-full text-sm rounded-xl pl-9 pr-3 py-2.5 outline-none transition-all"
                style={{ background: P.tint, border: `1px solid ${P.border}`, color: P.text }} />
            </div>
            <button onClick={() => loadSales(phoneMode ? { phone: digits } : { scan: 120 })} className="p-2.5 rounded-xl hover:bg-white/5" style={{ background: P.tint, border: `1px solid ${P.border}` }}>
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} style={{ color: P.sub }} />
            </button>
          </div>

          {/* count */}
          {!loading && (
            <div className="flex items-center gap-1.5 mb-3 text-xs font-bold" style={{ color: P.accent }}>
              <AudioLines size={14} />
              {filtered.length} recording{filtered.length === 1 ? '' : 's'}
              <span className="font-medium" style={{ color: P.muted }}>
                {closer ? ' · this closer' : ''}{phoneMode ? ` matching “${q.trim()}”` : ''}
              </span>
            </div>
          )}

          {/* test-audio banner (superadmin-broadcast demo) */}
          {testItem && !phoneMode && (
            <button onClick={() => playSale(testItem)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left mb-3 transition-all"
              style={{ background: P.active, border: `1px solid ${selected?.id === '__test__' ? P.borderOn : P.border}` }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: P.grad }}>
                <Sparkles size={15} className="text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold" style={{ color: P.text }}>{testItem.customer_name}</div>
                <div className="text-[11px]" style={{ color: P.accent }}>Tap to preview the visualizer</div>
              </div>
              <Play size={16} style={{ color: P.accent }} />
            </button>
          )}

          {/* list */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24" style={{ color: P.muted }}>
              <Loader2 size={28} className="animate-spin mb-3" /><p className="text-sm">Loading…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center" style={{ color: P.muted }}>
              <AudioLines size={32} className="mb-3" />
              <p className="text-sm">{phoneMode ? `No sale found for "${q.trim()}".` : `No recordings to show${closer ? ' for this closer' : ''}.`}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(s => {
                const on = selected?.id === s.id;
                const multi = (s.clips || 0) > 1;
                const expanded = expandedId === s.id;
                const clips = clipsBySale[s.id] || [];
                return (
                  <div key={s.id} className="rounded-xl transition-all overflow-hidden"
                    style={{ background: on || expanded ? P.active : P.tint, border: `1px solid ${on || expanded ? P.borderOn : P.border}`, transform: on ? 'translateX(2px)' : 'none' }}>
                    {/* header row — single-clip plays; multi-clip expands inline */}
                    <div className="flex items-center gap-1">
                      <button onClick={() => (multi ? toggleExpand(s) : playSale(s))} className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 text-left">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: on ? P.grad : P.tint2 }}>
                          {multi
                            ? <Layers size={15} style={{ color: on ? '#fff' : P.accent }} />
                            : on && audioLoading ? <Loader2 size={15} className="animate-spin text-white" /> : on && playing ? <Pause size={15} className="text-white" /> : <Play size={15} style={{ color: on ? '#fff' : P.sub }} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate" style={{ color: P.text }}>{s.customer_name}</div>
                          <div className="flex items-center gap-3 text-[11px] mt-0.5 flex-wrap" style={{ color: P.sub }}>
                            <span className="flex items-center gap-1"><User size={11} />{s.closer_name}</span>
                            <span className="flex items-center gap-1"><Calendar size={11} />{fmtDate(s.sale_date)}</span>
                            {durations[s.id] && !multi
                              ? <span className="flex items-center gap-1 tabular-nums font-semibold" style={{ color: P.accent }}><Clock size={11} />{fmt(durations[s.id])}</span>
                              : s.review_status === 'pending_review'
                                ? <span className="flex items-center gap-1 italic" style={{ color: P.muted }}><Clock size={11} />being verified</span>
                                : (multi || noRec[s.id] || s.review_status === 'confirmed')
                                  ? null
                                  : <span className="flex items-center gap-1" style={{ color: P.muted }}><Loader2 size={10} className="animate-spin" />length…</span>}
                            {multi ? <span className="inline-flex items-center gap-1 font-bold px-1.5 py-0.5 rounded-full" style={{ background: P.tint2, color: P.accent }}><Layers size={10} />{s.clips} recordings</span> : null}
                            {s.phone ? <span className="tabular-nums">{s.phone}</span> : null}
                          </div>
                        </div>
                      </button>
                      {/* download whole sale (single) */}
                      {!multi && (
                        <button onClick={(e) => downloadSale(s, e)} disabled={downloading === s.id}
                          className="p-2.5 rounded-lg hover:bg-white/5 flex-shrink-0" title="Download recording to your device">
                          {downloading === s.id ? <Loader2 size={16} className="animate-spin" style={{ color: P.sub }} /> : <Download size={16} style={{ color: P.accent }} />}
                        </button>
                      )}
                      {/* chevron — the "expandable" affordance for multi-clip sales */}
                      {multi && (
                        <button onClick={() => toggleExpand(s)} className="p-2.5 mr-1.5 rounded-lg hover:bg-white/5 flex-shrink-0" title={expanded ? 'Collapse' : 'Show recordings'}>
                          <ChevronDown size={18} style={{ color: P.accent, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none' }} />
                        </button>
                      )}
                    </div>

                    {/* inline expanded clip list (no dialog) */}
                    {multi && expanded && (
                      <div className="px-3 pb-3 pt-1">
                        <div className="rounded-xl p-1.5 space-y-1" style={{ background: P.tint, border: `1px solid ${P.border}` }}>
                          {clips.length === 0 ? (
                            <div className="flex items-center justify-center gap-2 py-4 text-xs" style={{ color: P.muted }}>
                              <Loader2 size={13} className="animate-spin" /> Loading recordings…
                            </div>
                          ) : clips.map((c, i) => {
                            const activeClip = on && part === i;
                            return (
                              <div key={i} className="flex items-center gap-2 rounded-lg transition-all"
                                style={{ background: activeClip ? P.active : 'transparent', border: `1px solid ${activeClip ? P.borderOn : 'transparent'}` }}>
                                <button onClick={() => playClip(s, i)} className="flex-1 min-w-0 flex items-center gap-3 px-2.5 py-2.5 text-left">
                                  <span className="flex items-center justify-center rounded-full flex-shrink-0"
                                    style={{ width: 28, height: 28, background: activeClip ? P.grad : P.tint2, color: activeClip ? '#fff' : P.accent, boxShadow: activeClip ? P.shadow : 'none' }}>
                                    {activeClip && audioLoading ? <Loader2 size={13} className="animate-spin" /> : activeClip && playing ? <Pause size={13} /> : activeClip ? <Play size={13} /> : <span className="text-[11px] font-extrabold">{i + 1}</span>}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[13px] font-semibold" style={{ color: P.text }}>Recording {i + 1}</div>
                                    <div className="text-[11px] tabular-nums" style={{ color: P.sub }}>{c.duration ? fmt(c.duration) : '—'}{activeClip ? ' · now playing' : ''}</div>
                                  </div>
                                </button>
                                <button onClick={(e) => downloadClip(s, i, e)} disabled={downloading === `${s.id}:${i}`}
                                  className="p-2 mr-1.5 rounded-lg hover:bg-white/5 flex-shrink-0" title={`Download recording ${i + 1}`}>
                                  {downloading === `${s.id}:${i}` ? <Loader2 size={15} className="animate-spin" style={{ color: P.sub }} /> : <Download size={15} style={{ color: P.accent }} />}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* now-playing player + visualizer */}
      {selected && (
        <div className="flex-shrink-0 px-5 sm:px-8 pt-3 pb-4" style={{ background: P.player, borderTop: `1px solid ${P.border}`, backdropFilter: 'blur(14px)' }}>
          <div className="max-w-5xl mx-auto">
            {/* visualizer */}
            <div className="rounded-xl mb-3 overflow-hidden" style={{ height: 64, background: P.tint, border: `1px solid ${P.border}` }}>
              <canvas ref={canvasRef} className="w-full h-full block" />
            </div>
            <div className="flex items-center gap-3 mb-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate flex items-center gap-1.5" style={{ color: P.text }}>
                  {selected.isTest && <Sparkles size={13} style={{ color: P.accent }} />}{selected.customer_name}
                </div>
                {!selected.isTest && <div className="text-[11px] truncate" style={{ color: P.sub }}>{selected.closer_name} · {fmtDate(selected.sale_date)}</div>}
                {clipCount > 1 && (
                  <div className="mt-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: P.muted }}>
                      {clipCount} recordings — tap one to play
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: clipCount }, (_, i) => {
                        const active = i === part;
                        const d = clipMeta[i]?.duration;
                        return (
                          <button key={i} onClick={() => goPart(i)} disabled={audioLoading}
                            title={`Call ${i + 1}${d ? ` · ${fmt(d)}` : ''}`}
                            className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full text-xs font-bold transition-all disabled:opacity-50 active:scale-95"
                            style={active
                              ? { background: P.grad, color: '#fff', boxShadow: P.shadow }
                              : { background: P.tint2, color: P.accent, border: `1px solid ${P.border}` }}>
                            <span className="flex items-center justify-center rounded-full flex-shrink-0"
                              style={{ width: 20, height: 20, background: active ? 'rgba(255,255,255,0.25)' : P.grad, color: '#fff' }}>
                              {active ? (playing ? <Pause size={11} /> : <Play size={11} />) : <span className="text-[10px] font-extrabold">{i + 1}</span>}
                            </span>
                            <span className="leading-none">Call {i + 1}</span>
                            {d ? <span className="tabular-nums leading-none" style={{ opacity: 0.85 }}>{fmt(d)}</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <button onClick={() => skip(-10)} className="p-2 rounded-lg hover:bg-white/5" disabled={audioLoading}><SkipBack size={18} style={{ color: P.text }} /></button>
              <button onClick={toggle} disabled={audioLoading} className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg" style={{ background: P.grad, boxShadow: P.shadow }}>
                {audioLoading ? <Loader2 size={19} className="animate-spin text-white" /> : playing ? <Pause size={19} className="text-white" /> : <Play size={19} className="text-white" />}
              </button>
              <button onClick={() => skip(10)} className="p-2 rounded-lg hover:bg-white/5" disabled={audioLoading}><SkipForward size={18} style={{ color: P.text }} /></button>
              <button onClick={(e) => downloadSale(selected, e)} disabled={downloading === selected.id} className="p-2 rounded-lg hover:bg-white/5" title="Download to your device">
                {downloading === selected.id ? <Loader2 size={18} className="animate-spin" style={{ color: P.text }} /> : <Download size={18} style={{ color: P.text }} />}
              </button>
              <button onClick={() => { audioRef.current?.pause(); setSelected(null); }} className="p-2 rounded-lg hover:bg-white/5 ml-1"><X size={16} style={{ color: P.sub }} /></button>
            </div>
            {audioErr ? (
              <p className="text-xs text-center py-1" style={{ color: '#F87171' }}>{audioErr}</p>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-[11px] tabular-nums w-10 text-right" style={{ color: P.sub }}>{fmt(cur)}</span>
                <div className="relative flex-1 h-1.5 rounded-full" style={{ background: P.tint2 }}>
                  <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${pct}%`, background: P.progress }} />
                  <input type="range" min={0} max={dur || 0} step="0.1" value={cur} onChange={seek} className="absolute inset-0 w-full opacity-0 cursor-pointer" style={{ margin: 0 }} />
                </div>
                <span className="text-[11px] tabular-nums w-10" style={{ color: P.sub }}>{fmt(dur)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <audio ref={audioRef} crossOrigin="anonymous"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { if (selected && !selected.isTest && part < clipCount - 1) { const n = part + 1; setPart(n); loadPart(selected, n); } else setPlaying(false); }}
        onTimeUpdate={() => setCur(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => {
          const d = audioRef.current?.duration || 0; setDur(d);
          // FIX 3 — only FILL the displayed length from the decoded audio when we
          // don't already have a value. A compliance-confirmed sale's duration
          // comes from the stored confirmation (server) — never overwrite it with
          // the browser-decoded length, so the portal always shows exactly what
          // compliance confirmed.
          if (selected?.id && d && isFinite(d) && clipCount === 1 && !durations[selected.id]) setDurations(m => ({ ...m, [selected.id]: d }));
        }}
        controlsList="nodownload" className="hidden" />

      <span style={{ position: 'fixed', bottom: 3, right: 6, fontSize: 8, letterSpacing: 1, color: '#8B7355', opacity: 0.06, userSelect: 'none', pointerEvents: 'none' }}>am · bv</span>
    </div>
  );
}

const chip = (active, P) => ({
  background: active ? P.grad : P.tint,
  border: `1px solid ${active ? 'transparent' : P.border}`,
  color: active ? '#fff' : P.sub,
});
