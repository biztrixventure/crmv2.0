import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { createPortal } from 'react-dom';
import ThemedDate from '../components/UI/ThemedDate';
import {
  Moon, Sun,
  ClipboardCheck, ListChecks, BarChart3, Settings2, Play, Pause, Loader2,
  LogOut, RefreshCw, User, Calendar, CheckCircle2, XCircle,
  ChevronRight, ChevronDown, Send, Shield, Star, Search, Headphones,
  UserPlus, CheckSquare, Square, ArrowRightLeft, Plus, DollarSign, Info, Building2,
  Download, Award, TrendingUp, Table2, CalendarDays, Shuffle, PhoneOff, Trash2, Mic, LayoutDashboard, Radio, MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import client from '../api/client';
import DotGridBg from '../components/UI/DotGridBg';
import SheetScoreRow, { clearSheetDraft } from '../components/QA/SheetScoreRow';
import { QAAgentDashboard, QAManagerDashboard } from '../components/QA/QADashboard';
import { Donut, Bars, Lines, PALETTE } from '../components/QA/Charts';
import { isSheetConfig, resolveSheetFields, projectSheetFields, defaultInputFor } from '../utils/qaSheetFormula';
import { SHEET_PRESETS, applyPresetFields, WAVETECH_OUTCOMES } from '../utils/qaSheetPresets';
import ThemedSelect from '../components/UI/Select';
import FilterBar, { FilterSelect } from '../components/UI/FilterBar';
// Chat reached every other shell through AppHeader / AdminHeader. QA is an
// isolated shell with its own header, so it was the one place the launcher was
// never mounted — the feature was live for the QA team, just unreachable.
import ChatLauncher from '../components/Chat/ChatLauncher';
import ProfileModal from '../components/Profile/ProfileModal';
import { getClip, putClip, clipKey, cachedKeys, cacheStats, clearCache } from '../utils/audioCache';
import { useHistoryTab } from '../hooks/useHistoryTab';
import { useNavFocus } from '../contexts/FocusContext';

// ============================================================================
// QA Shell — isolated shell for qa_manager / qa_agent (mirrors ComplianceShell).
// Tabs: Queue (listen + score), Scorecards & Config (qa_manager), Reports.
// Recording playback reuses the shared dialer library via /qa/recordings/stream.
// ============================================================================

const isoDay   = (d) => { const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return t.toISOString().slice(0, 10); };
const todayISO = () => isoDay(new Date());
const addDays  = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
const dayOfDate = (v) => (v ? String(v).slice(0, 10) : '');   // any date/ts → 'YYYY-MM-DD'
const fmtDur = (s) => { if (s == null) return '—'; const m = Math.floor(s / 60), r = Math.floor(s % 60); return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`; };
const fmtDate = (d) => { try { return d ? new Date(String(d).length <= 10 ? d + 'T00:00:00' : d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''; } catch { return d || ''; } };
const fmtTime = (s) => { try { return s ? new Date(String(s).replace(' ', 'T')).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; } catch { return s || ''; } };
// width:'auto' so filter ThemedSelects size to their content and flow several per
// row (not one dropdown per line). Controls needing a set width still pass it
// explicitly (e.g. {...inp, width: 70} / width:'100%'), which overrides this.
const inp = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '6px 10px', fontSize: 13, width: 'auto' };
// Renders a method OR a work-type slot (tra | rcm | closer_sales | closer_dispo).
const SLOT_PILL = {
  tra:          { label: 'TRA',  tint: '#2563eb' },
  rcm:          { label: 'RCM',  tint: '#d97706' },
  closer_sales: { label: 'SALE', tint: '#059669' },
  closer_dispo: { label: 'UNCL', tint: '#dc2626' },
};
const MethodPill = ({ m }) => {
  const p = SLOT_PILL[m] || { label: String(m || '—'), tint: '#6b7280' };
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: `${p.tint}1f`, color: p.tint }}>{p.label}</span>;
};
const SLOT_LABEL = { tra: 'TRA · Transfers', rcm: 'RCM · Random', closer_sales: 'Closed Sale', closer_dispo: 'Unclosed Sale' };
// [slot, short toggle label, tint] — the 4 sections an agent can be bound to.
const AGENT_METHODS = [['tra', 'TRA', '#2563eb'], ['closer_sales', 'SALE', '#059669'], ['closer_dispo', 'UNCL', '#dc2626'], ['rcm', 'RCM', '#d97706']];
const StatusPill = ({ s }) => {
  const map = { pending: ['Pending', 'var(--color-text-tertiary)'], in_review: ['In review', 'var(--color-warning-600)'], scored: ['Scored', 'var(--color-success-600)'], skipped: ['Skipped', 'var(--color-text-tertiary)'] };
  const [label, color] = map[s] || [s, 'var(--color-text-tertiary)'];
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color }}>{label}</span>;
};

// Company access for a QA user — only the companies assigned to them (superadmin
// / view-all get all, with an "All my companies" option). Drives the header
// picker + scopes every data pull. Selection persists across sessions.
const ALL_CO = '__all__';
function useQaCompanies() {
  const [companies, setCompanies] = useState(null);
  const [all, setAll] = useState(false);
  const [companyId, setCompanyId] = useState('');
  useEffect(() => {
    client.get('qa/my-companies').then(r => {
      const list = r.data.companies || [];
      setCompanies(list); setAll(!!r.data.all);
      let saved = null; try { saved = localStorage.getItem('qa_company'); } catch { /* ignore */ }
      const valid = saved && (saved === ALL_CO ? r.data.all : list.some(c => c.id === saved));
      // default to a company that actually has QA running (else the first)
      const preferred = list.find(c => c.qa_enabled) || list[0];
      setCompanyId(valid ? saved : (preferred?.id || (r.data.all ? ALL_CO : '')));
    }).catch(() => setCompanies([]));
  }, []);
  const choose = (id) => { setCompanyId(id); try { localStorage.setItem('qa_company', id); } catch { /* ignore */ } };
  return { companies, all, companyId, setCompanyId: choose };
}

// Header dropdown: pick which assigned company's data to view. Only ever lists
// companies the API would allow, so it can't leak another company's data.
function CompanyPicker({ companies, all, companyId, onChange }) {
  if (companies === null) return <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />;
  if (!companies.length && !all) return <span className="text-xs font-semibold" style={{ color: 'var(--color-warning-600)' }}><Building2 size={12} className="inline mr-1" />No company assigned</span>;
  const optLabel = (c) => `${c.name}${c.pending ? ` · ${c.pending} to do` : ''}${c.qa_enabled === false ? ' · no review types on' : ''}`;
  if (companies.length === 1 && !all) return <span className="text-xs font-bold inline-flex items-center gap-1" style={{ color: 'var(--color-text)' }} title={optLabel(companies[0])}><Building2 size={13} style={{ color: 'var(--color-text-tertiary)' }} />{companies[0].name}{companies[0].pending ? <span className="text-[10px] font-bold px-1.5 rounded-full" style={{ background: 'rgba(217,119,6,0.14)', color: 'var(--color-warning-600)' }}>{companies[0].pending}</span> : null}</span>;
  return (
    <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }} title="You only see data for the companies assigned to you">
      <Building2 size={14} style={{ color: 'var(--color-text-tertiary)' }} />
      <ThemedSelect value={companyId} onChange={e => onChange(e.target.value)} style={{ ...inp, fontWeight: 700, padding: '5px 8px' }}>
        {all && <option value={ALL_CO}>All my companies</option>}
        {companies.map(c => <option key={c.id} value={c.id}>{optLabel(c)}</option>)}
      </ThemedSelect>
    </label>
  );
}

// Small "i" helper — hover or tap to reveal a plain-language explanation of the
// option it sits next to. Used across the QA config so nothing is a mystery.
function InfoTip({ text, side = 'left', w = 250 }) {
  const [open, setOpen] = useState(false);
  const pos = side === 'right' ? { right: 0 } : { left: 0 };
  return (
    <span className="relative inline-flex" style={{ verticalAlign: 'middle' }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(o => !o); }}
        className="inline-flex items-center justify-center rounded-full cursor-help"
        style={{ width: 15, height: 15, background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)', flexShrink: 0 }}
        aria-label="What does this do?">
        <Info size={10} />
      </button>
      {open && (
        <span className="absolute z-[60] text-[11px] font-normal normal-case tracking-normal leading-snug p-2.5 rounded-lg"
          onClick={(e) => e.stopPropagation()}
          style={{ width: w, top: 'calc(100% + 5px)', ...pos, background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', boxShadow: '0 8px 24px rgba(0,0,0,0.20)', whiteSpace: 'normal' }}>
          {text}
        </span>
      )}
    </span>
  );
}

// Transcript with karaoke-style word highlighting. Words carry start/end (from
// the whisper worker); as the recording plays we highlight the current word and
// auto-scroll it into view. Click any word to jump the audio there. Falls back
// to plain text for older transcripts saved without word timestamps.
function TranscriptView({ tx, active, curTime, onSeek }) {
  const activeRef = useRef(null);
  const words = [];
  (Array.isArray(tx?.segments) ? tx.segments : []).forEach((s, si) =>
    (s.words || []).forEach((w, wi) => words.push({ ...w, key: si + '-' + wi })));
  const activeIdx = active ? words.findIndex(w => curTime >= w.start && curTime < w.end) : -1;
  useEffect(() => { if (activeRef.current) activeRef.current.scrollIntoView({ block: 'nearest' }); }, [activeIdx]);

  const box = { background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' };
  if (!words.length) {
    return (
      <div className="text-xs whitespace-pre-wrap rounded-lg p-2.5 max-h-60 overflow-y-auto leading-relaxed" style={box}>
        {tx?.text ? tx.text : <span className="italic" style={{ color: 'var(--color-text-tertiary)' }}>No speech detected in this clip.</span>}
      </div>
    );
  }
  return (
    <div className="text-xs rounded-lg p-2.5 max-h-60 overflow-y-auto leading-relaxed" style={box}>
      {words.map((w, i) => {
        const on = i === activeIdx;
        return (
          <span key={w.key} ref={on ? activeRef : null} onClick={() => onSeek(w.start)} title="Jump to this word"
            className="cursor-pointer rounded transition-colors"
            style={{ backgroundColor: on ? 'var(--color-primary-500, #6366f1)' : 'transparent', color: on ? '#fff' : 'inherit', padding: on ? '0 2px' : 0 }}>
            {w.text}
          </span>
        );
      })}
    </div>
  );
}

// Live audio spectrum visualizer — hooks the shared <audio> via Web Audio and
// draws mirrored frequency bars while playing. Themed to the CRM accent.
function WaveViz({ audioRef, active }) {
  const canvasRef = useRef(null);
  const setup = useRef(null);
  const raf = useRef(0);
  useEffect(() => {
    if (!active) return;
    const a = audioRef.current, canvas = canvasRef.current; if (!a || !canvas) return;
    let analyser, ac;
    try {
      if (!setup.current) {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        const src = ac.createMediaElementSource(a);
        analyser = ac.createAnalyser(); analyser.fftSize = 256;
        src.connect(analyser); analyser.connect(ac.destination);
        setup.current = { ac, analyser };
      } else { ({ ac, analyser } = setup.current); }
      ac.resume?.();
    } catch { return; }
    const g = canvas.getContext('2d');
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      raf.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(bins);
      const w = canvas.width = canvas.offsetWidth || 600, h = canvas.height;
      g.clearRect(0, 0, w, h);
      const n = 56, bw = w / n;
      for (let i = 0; i < n; i++) {
        const v = bins[Math.floor(i * bins.length / n)] / 255;
        const bh = Math.max(3, v * h);
        g.fillStyle = `hsl(${255 - v * 95} 78% 56%)`;
        g.fillRect(i * bw + 1.5, (h - bh) / 2, bw - 3, bh);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf.current);
  }, [active, audioRef]);
  useEffect(() => () => { try { setup.current?.ac.close(); } catch {} setup.current = null; }, []);
  return <canvas ref={canvasRef} height={46} style={{ width: '100%', height: 46, display: 'block', borderRadius: 8, background: 'var(--color-bg-secondary)' }} />;
}

// The QA shell draws its own header instead of AppHeader — which is also why it
// never had a profile block, so a reviewer saw their ROLE ("qa_agent") where
// every other shell shows their name. Same ProfileModal the rest of the CRM uses.
function ProfileChip({ user }) {
  const [open, setOpen] = useState(false);
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || user?.email || 'My profile';
  const initial = (user?.first_name?.[0] || user?.email?.[0] || '?').toUpperCase();
  return (
    <>
      <button onClick={() => setOpen(true)} type="button" title="My profile"
        className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg max-w-[190px]"
        style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)' }}>
        <span className="inline-flex items-center justify-center rounded-full flex-shrink-0 text-[11px] font-bold text-white"
          style={{ width: 24, height: 24, background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' }}>{initial}</span>
        <span className="min-w-0 text-left leading-tight">
          <span className="block text-[11px] font-bold truncate" style={{ color: 'var(--color-text)' }}>{name}</span>
          <span className="block text-[9px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>{user?.role_name || user?.role || ''}</span>
        </span>
      </button>
      {/* PORTALLED to <body>. The modal is `fixed z-50`, but it lives inside a
          header that is `relative z-10` — and a positioned ancestor creates a
          stacking context, so that z-50 only ever competed INSIDE the header.
          <main> (also z-10, later in the DOM) painted straight over it, which is
          why the profile opened behind the page. */}
      {user && open && createPortal(
        <ProfileModal isOpen onClose={() => setOpen(false)} user={user} />,
        document.body,
      )}
    </>
  );
}

// The QA shell draws its own header instead of AppHeader, which is why it was the
// only shell with no light/dark control — reviewers stared at whichever theme
// they happened to be left in. Same ThemeContext every other shell uses.
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === 'dark';
  return (
    <button onClick={toggleTheme} type="button" title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
      style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)' }}>
      {dark ? <Sun size={15} style={{ color: 'var(--color-accent)' }} /> : <Moon size={15} style={{ color: 'var(--color-text-secondary)' }} />}
    </button>
  );
}

// ── candidate audio player (blob-streamed with auth, like RecordingReviewTab) ──
function Candidates({ assignmentId }) {
  const [rows, setRows] = useState(null);
  const [diag, setDiag] = useState(null);   // what the dialer search actually looked for
  const audioRef = useRef(null); const urlRef = useRef(null);
  const [loadingId, setLoadingId] = useState(null);
  const [playingRid, setPlayingRid] = useState(null);
  const [rate, setRate] = useState(1);
  const [canTranscribe, setCanTranscribe] = useState(false);   // qa.transcription flag
  const [txById, setTxById]   = useState({});   // recording_id → transcript
  const [txBusy, setTxBusy]   = useState(null); // recording_id being transcribed
  const [txOpen, setTxOpen]   = useState({});   // recording_id → panel open
  const [curTime, setCurTime] = useState(0);    // player position → drives word highlight
  const [audioRid, setAudioRid] = useState(null); // rid currently loaded in the <audio>
  const [cachedRid, setCachedRid] = useState(null); // rid held in IndexedDB (plays with no network)
  const [savedRids, setSavedRids] = useState(() => new Set());   // every clip in this list already held locally
  const [cacheInfo, setCacheInfo] = useState({ count: 0, bytes: 0 });
  const refreshCacheInfo = useCallback(() => { cacheStats().then(setCacheInfo).catch(() => {}); }, []);

  useEffect(() => {
    let dead = false;
    setRows(null); setDiag(null); setTxById({}); setTxOpen({}); setAudioRid(null); setCurTime(0);
    client.get(`qa/assignments/${assignmentId}/candidates`)
      .then(r => { if (!dead) { setRows(r.data.candidates || []); setDiag(r.data.diag || null); } })
      .catch(() => { if (!dead) { setRows([]); setDiag(null); } });
    // Is on-demand transcription enabled FOR THIS USER? (per-user, default OFF —
    // superadmin/compliance grants it in QA config → Transcription access.)
    client.get('qa/config').then(r => { if (!dead) setCanTranscribe(!!r.data?.can_transcribe); }).catch(() => {});
    return () => { dead = true; if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, [assignmentId]);

  // On-demand: transcribe THIS clip (cache-first on the server). Toggle the panel
  // if we already have it.
  const transcribe = async (c) => {
    if (txById[c.recording_id]) { setTxOpen(o => ({ ...o, [c.recording_id]: !o[c.recording_id] })); return; }
    setTxBusy(c.recording_id);
    try {
      const r = await client.post('qa/recordings/transcribe', { assignment_id: assignmentId, box_id: c.box_id, lead_id: c.lead_id, recording_id: c.recording_id, location: c.location });
      setTxById(m => ({ ...m, [c.recording_id]: r.data?.transcript || { text: '' } }));
      setTxOpen(o => ({ ...o, [c.recording_id]: true }));
    } catch (e) { toast.error(e.response?.data?.error || 'Transcription failed'); }
    finally { setTxBusy(null); }
  };

  // seekTo (seconds) lets a transcript word click jump the audio to that word.
  // A ticket per recording, kept for the life of the panel. Cheap JSON, and the
  // reviewer only pays for it once per clip.
  const ticketRef = useRef({});          // recording_id → { url, at }
  // A ticket is a signed permission with an expiry, and the <audio> element keeps
  // whatever src it was given for as long as the panel is open — issuing a new
  // Range request for EVERY seek. A URL cached forever therefore stops being
  // accepted part-way through a session, and the reviewer sees the playhead
  // refuse to move. Re-issue anything older than half an hour, and on demand.
  const TICKET_FRESH_MS = 30 * 60 * 1000;
  const ticketFor = useCallback(async (c, { force = false } = {}) => {
    const hit = ticketRef.current[c.recording_id];
    if (!force && hit && Date.now() - hit.at < TICKET_FRESH_MS) return hit.url;
    const r = await client.post('qa/recordings/ticket', {
      assignment_id: assignmentId, box_id: c.box_id, lead_id: c.lead_id, recording_id: c.recording_id,
    });
    // The API can live on another origin (VITE_API_URL), and the server returns
    // a root-relative path — resolve it against the API base or the <audio> would
    // ask the FRONTEND host for a route that only exists on the backend.
    const apiBase = String(client.defaults.baseURL || '').replace(/\/api\/?$/, '');
    const url = apiBase + r.data.url;
    ticketRef.current[c.recording_id] = { url, at: Date.now() };
    return url;
  }, [assignmentId]);

  // PROGRESSIVE playback. This used to pull the whole mp3 down as a blob before
  // the first note played — on a long call that is a very long stare at a
  // spinner, and seeking did nothing until the download finished. Handing the
  // <audio> element a real URL lets the browser start on the first chunk and
  // seek with Range requests, so playback begins in about a second regardless of
  // how long the call is.
  const play = async (c, seekTo = null) => {
    const a = audioRef.current; if (!a) return;
    if (a.dataset.rid === c.recording_id) {
      if (seekTo != null) { a.currentTime = seekTo; a.play().catch(() => {}); }
      else { a.paused ? a.play() : a.pause(); }
      return;
    }
    setLoadingId(c.recording_id);
    const startAt = (src, cached) => {
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
      if (cached) urlRef.current = src;
      a.src = src; a.dataset.rid = c.recording_id; setAudioRid(c.recording_id); setCurTime(0);
      setCachedRid(cached ? c.recording_id : null);
      if (seekTo != null) { const onMeta = () => { a.currentTime = seekTo; a.removeEventListener('loadedmetadata', onMeta); }; a.addEventListener('loadedmetadata', onMeta); }
      a.play().catch(() => {});
    };
    try {
      // 1. Already in the browser? Play the local Blob: nothing crosses the
      //    network, and because it is a COMPLETE file the reviewer can scrub
      //    anywhere instantly — streaming can only seek as far as the recording
      //    host is willing to serve by Range.
      const key = clipKey(c.box_id, c.recording_id);
      const hit = await getClip(key);
      if (hit) { startAt(URL.createObjectURL(hit), true); return; }

      // 2. First time: stream it so playback starts in about a second…
      const url = await ticketFor(c);
      startAt(url, false);

      // 3. …and keep a copy, so the next open — after a tab switch, a refresh,
      //    tomorrow — costs the dialer nothing at all.
      //
      //    Started only ONCE PLAYBACK IS UNDER WAY. Firing it immediately made
      //    the copy compete for bandwidth with the audio it was copying, which
      //    is the one moment the reviewer is actually waiting. The response is
      //    served from the browser's HTTP cache in the normal case, so this is
      //    usually not a second trip over the network at all.
      const a2 = a;
      const startCopy = () => {
        a2.removeEventListener('playing', startCopy);
        fetch(url).then(r => (r.ok ? r.blob() : null)).then(b => {
          if (!b) return;
          putClip(key, b).then(ok => {
            if (!ok) return;
            setSavedRids(prev => new Set(prev).add(c.recording_id));
            refreshCacheInfo();
            if (audioRef.current?.dataset.rid === c.recording_id) setCachedRid(c.recording_id);
          });
        }).catch(() => { /* streaming already works; caching is a bonus */ });
      };
      a2.addEventListener('playing', startCopy);
    } catch { toast.error('Could not load that recording'); }
    finally { setLoadingId(null); }
  };

  // ── keeping a call scrubbable after it has been played through ─────────────
  // Two things left the playhead stuck once a reviewer had listened to the end
  // and started again. A STREAMED source can only seek where the recording host
  // is willing to serve a Range — and the signed ticket in that URL expires,
  // after which every seek is refused outright and the position snaps back.
  //
  // So: the moment the local copy exists, hand the element the COMPLETE file —
  // it seeks anywhere, instantly, with no network at all — and if a stream does
  // fail, mint a fresh ticket and put the playhead back where it was.
  const rowFor = useCallback((rid) => (rows || []).find(x => String(x.recording_id) === String(rid)) || null, [rows]);
  const reload = (a, src, at, resume) => {
    a.src = src;
    const onMeta = () => {
      a.removeEventListener('loadedmetadata', onMeta);
      try { a.currentTime = at; } catch { /* browser refused the seek */ }
      if (resume) a.play().catch(() => {});
    };
    a.addEventListener('loadedmetadata', onMeta);
    a.load();
  };
  const swapToLocal = useCallback(async () => {
    const a = audioRef.current;
    if (!a || urlRef.current) return;                 // already playing the local file
    const rid = a.dataset.rid; const c = rowFor(rid);
    if (!c) return;
    const hit = await getClip(clipKey(c.box_id, c.recording_id)).catch(() => null);
    if (!hit || audioRef.current?.dataset.rid !== rid) return;
    urlRef.current = URL.createObjectURL(hit);
    reload(a, urlRef.current, a.currentTime || 0, false);
    setCachedRid(rid);
  }, [rowFor]);
  const recovering = useRef(false);
  const recoverStream = useCallback(async () => {
    const a = audioRef.current;
    if (!a || urlRef.current || recovering.current) return;   // a local Blob cannot expire
    const rid = a.dataset.rid; const c = rowFor(rid);
    if (!c) return;
    recovering.current = true;
    const at = a.currentTime || 0, resume = !a.paused;
    try { reload(a, await ticketFor(c, { force: true }), at, resume); }
    catch { toast.error('That recording link expired — press play again'); }
    finally { recovering.current = false; }
  }, [rowFor, ticketFor]);

  // Fetch the first clip's ticket as soon as the list lands, so the very first
  // Play is a click with nothing to wait for.
  useEffect(() => {
    const first = (rows || [])[0];
    if (first) ticketFor(first).catch(() => {});
  }, [rows, ticketFor]);

  // Which of these are already in the browser? One read for the whole list, so
  // the reviewer can see at a glance which clips play instantly with no dialer
  // round-trip — and which are still going to cost one.
  useEffect(() => {
    const list = rows || [];
    if (!list.length) { setSavedRids(new Set()); return; }
    let alive = true;
    cachedKeys(list.map(c => clipKey(c.box_id, c.recording_id)))
      .then(keys => {
        if (!alive) return;
        setSavedRids(new Set(list.filter(c => keys.has(clipKey(c.box_id, c.recording_id))).map(c => c.recording_id)));
      })
      .catch(() => {});
    refreshCacheInfo();
    return () => { alive = false; };
  }, [rows, refreshCacheInfo]);

  if (rows === null) return <div className="text-center py-6"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /><div className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Loading recordings…</div></div>;
  if (!rows.length) return (
    <div className="text-center py-6 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
      <p className="m-0">No recordings found on the dialer for this call.</p>
      {/* Say WHAT was searched. "None found" alone gives a reviewer nothing to
          act on — knowing it searched a phone with no date, or had no phone at
          all, is the difference between a data gap and a dialer problem. */}
      {diag && (
        <p className="text-[11px] mt-1.5 mb-0" style={{ color: 'var(--color-text-tertiary)' }}>
          Searched {diag.phone ? <>phone <b>{diag.phone}</b></> : <b>no phone on this record</b>}
          {diag.date ? <> around <b>{diag.date}</b></> : <> with <b>no call date</b></>}
          {diag.lead_code ? ', lead code linked' : ', no dialer lead code'}
          {diag.mapped_agents ? `, ${diag.mapped_agents} mapped agent id(s)` : ', no mapped agent ids'}.
        </p>
      )}
    </div>
  );
  return (
    <div className="space-y-2">
      {rows.some(c => c.leg) && (
        <div className="text-[10px] flex items-center gap-3 px-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--color-primary-600)' }} />Fronter = the transfer call</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#059669' }} />Closer = the call after transfer</span>
        </div>
      )}
      {rows.map(c => {
        const tx = txById[c.recording_id];
        const open = !!txOpen[c.recording_id];
        return (
        <div key={c.box_id + c.recording_id} className="rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3 p-2.5">
            <button onClick={() => play(c)} className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' }}>
              {loadingId === c.recording_id ? <Loader2 size={15} className="animate-spin" color="#fff" /> : playingRid === c.recording_id ? <Pause size={15} color="#fff" /> : <Play size={15} color="#fff" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold tabular-nums flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>{fmtDur(c.duration)}
                {c.leg && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase" style={c.leg === 'fronter' ? { background: 'rgba(37,99,235,0.16)', color: 'var(--color-primary-600)' } : { background: 'rgba(5,150,105,0.16)', color: '#059669' }}>{c.leg}</span>}
                {/* the PERSON, not their dialer login — the id is a lookup key,
                    not something a reviewer can recognise mid-call */}
                <span className="text-xs font-normal" style={{ color: 'var(--color-text-secondary)' }} title={c.agent_user ? `Dialer id ${c.agent_user}` : undefined}>· {c.agent_name || c.agent_user || 'agent ?'}</span>
                {/* WHO HUNG UP — visible before the clip is even played, because
                    it changes how the call should be read. Red when the agent
                    dropped it, neutral when the customer did. */}
                {c.hangup_label ? (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                    title={`Dialer hangup reason: ${c.hangup_reason}${c.call_status ? ` · status ${c.call_status}` : ''}`}
                    style={/^AGENT/i.test(c.hangup_reason || '')
                      ? { background: 'rgba(220,38,38,0.14)', color: 'var(--color-error-600)' }
                      : { background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
                    {c.hangup_label}
                  </span>
                ) : c.hangup_unavailable ? (
                  // an older call whose log rows the dialer no longer serves —
                  // say that, instead of a blank the reviewer reads as "nobody"
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                    title="The dialer's call log no longer holds this call, so who hung up cannot be read for it."
                    style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)' }}>
                    hangup n/a
                  </span>
                ) : null}
              </div>
              <div className="text-[11px] flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--color-text-tertiary)' }}>
                <span>{fmtTime(c.start_time)} · box {c.box_id} · rec {c.recording_id}</span>
                {/* already in this browser → pressing play costs the dialer
                    nothing and starts immediately */}
                {savedRids.has(c.recording_id) && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    title="Saved in your browser — this plays instantly and is never fetched from the dialer again."
                    style={{ background: 'color-mix(in srgb, var(--color-success-600) 14%, transparent)', color: 'var(--color-success-600)' }}>saved</span>
                )}
              </div>
            </div>
            {canTranscribe && (
              <button onClick={() => transcribe(c)} disabled={txBusy === c.recording_id}
                className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg flex-shrink-0 inline-flex items-center gap-1 disabled:opacity-60"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', background: 'var(--color-bg-secondary)' }}
                title="Transcribe this recording">
                {txBusy === c.recording_id
                  ? <><Loader2 size={12} className="animate-spin" /> Transcribing…</>
                  : tx ? (open ? 'Hide transcript' : 'View transcript') : 'Transcribe'}
              </button>
            )}
          </div>
          {tx && open && (
            <div className="px-3 pb-3">
              <TranscriptView tx={tx} active={audioRid === c.recording_id} curTime={curTime} onSeek={(t) => play(c, t)} />
            </div>
          )}
        </div>
        );
      })}
      <div className="mt-2 rounded-xl p-2.5 sticky bottom-0" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', display: audioRid ? 'block' : 'none', boxShadow: '0 -2px 10px rgba(0,0,0,0.06)' }}>
        <WaveViz audioRef={audioRef} active={!!playingRid} />
        <audio ref={audioRef} controls className="w-full mt-2"
          onPlay={() => setPlayingRid(audioRef.current?.dataset.rid || null)}
          onPause={() => setPlayingRid(null)}
          // the end of the first listen is exactly when the reviewer starts
          // dragging around the call, so that is when we switch to the complete
          // local file — from here every seek is instant and cannot be refused
          onEnded={() => { setPlayingRid(null); swapToLocal(); }}
          onError={recoverStream}
          onTimeUpdate={() => setCurTime(audioRef.current?.currentTime || 0)} />
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Speed</span>
          {[0.75, 1, 1.5, 2].map(s => (
            <button key={s} onClick={() => { if (audioRef.current) audioRef.current.playbackRate = s; setRate(s); }}
              className="text-[11px] px-2 py-0.5 rounded font-bold transition-colors"
              style={{ background: rate === s ? 'var(--color-primary-600)' : 'var(--color-surface-hover)', color: rate === s ? '#fff' : 'var(--color-text-secondary)' }}>{s}×</button>
          ))}
          {/* Jump controls. The scrub bar handles fine seeking; these are for
              working through a call — skip the hold, re-hear the disclosure. */}
          {[-30, -10, 10, 30].map(n => (
            <button key={n}
              onClick={() => { const a = audioRef.current; if (a) a.currentTime = Math.max(0, Math.min(a.duration || Infinity, a.currentTime + n)); }}
              className="text-[11px] px-2 py-0.5 rounded font-bold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}
              title={n < 0 ? `Back ${-n} seconds` : `Forward ${n} seconds`}>
              {n < 0 ? `« ${-n}s` : `${n}s »`}
            </button>
          ))}
          {/* Held in the browser: replays cost the dialer nothing and scrubbing
              is instant because the whole file is local. */}
          {cachedRid && cachedRid === audioRid && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded ml-auto"
              title="This recording is saved in your browser — replaying it does not re-fetch from the dialer, and you can jump anywhere in it instantly."
              style={{ background: 'color-mix(in srgb, var(--color-success-600) 14%, transparent)', color: 'var(--color-success-600)' }}>
              playing from your browser
            </span>
          )}
          {/* What is being held, and a way out of it. Cached audio is the
              reviewer's disk — they should be able to see it and drop it. */}
          {cacheInfo.count > 0 && (
            <span className={`text-[10px] flex items-center gap-1 ${cachedRid && cachedRid === audioRid ? '' : 'ml-auto'}`} style={{ color: 'var(--color-text-tertiary)' }}>
              {cacheInfo.count} saved · {(cacheInfo.bytes / (1024 * 1024)).toFixed(0)} MB
              <button onClick={() => { clearCache().then(() => { setSavedRids(new Set()); setCachedRid(null); refreshCacheInfo(); }); }}
                className="font-bold" style={{ color: 'var(--color-text-secondary)', textDecoration: 'underline' }}
                title="Delete every recording saved in this browser. They will be fetched again next time they are played.">clear</button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Pre-fill a sheet scorecard's meta columns from what we already know about the
// call, so the agent doesn't retype it (the cells stay editable). Fuzzy-matches
// the config's meta_field keys → assignment data.
// The detail columns, wherever they now sit. A column's GROUP no longer decides
// where it renders, so "the meta fields" is a role, not an array — and the fuzzy
// and CRM passes stay restricted to that role on purpose: guessing an answer to
// a compliance question from a column name would be a scored value invented by
// string matching.
const metaFieldsOf = (cfg) => resolveSheetFields(cfg).filter(f => f.role === 'meta');

// A date CELL wants ISO yyyy-mm-dd — that is what the date picker reads and what
// gets stored. Every auto-fill source hands back a display string
// (toLocaleDateString → "8/2/2026"), and dropping that into a date column shows
// an EMPTY cell: fetched, then invisible. Coerce on the way in, and leave
// anything unparseable alone rather than blanking a value the reviewer can fix.
const toDateInput = (v) => {
  const s = String(v ?? '').trim();
  if (!s || /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const forInput = (f, v) => (f?.input?.kind === 'date' ? toDateInput(v) : v);

// ── DATE COLUMNS ARE NEVER AUTO-FILLED ──────────────────────────────────────
// Every source we have for "the day of this call" turned out to be wrong for
// some task, and each fix only moved the error somewhere else:
//   created_at        — when the row reached the CRM, months after a
//                       bulk-imported or late-entered lead was dialled
//   a recording       — a task whose own day has no clip falls back to any call
//                       on that number, which for a repeat customer is old
//   recording_date    — simply absent on anything the materializer created
// A wrong date that looks filled in is worse than an empty one: it is copied
// into the sheet without a second glance. So the reviewer picks it — the call is
// in front of them, with its timestamp on the recording they just played.
const callDateOf = () => '';

function metaAutoFill(cfg, a, extra = {}) {
  const out = {};
  const rec = a.recording_ref || {};
  // The disposition, from wherever this task actually has one. A LIVE task
  // carries it on the row itself (it came off the dialer call) — which is why it
  // showed there and nowhere else. A My-Task row has none, and the value that
  // DOES exist arrives in the CRM payload as `disposition`, under a name no
  // column is called: "Closer Disposition" never matches "disposition", so the
  // name-matching pass could not fill it either. Read both here.
  const dispo = a.disposition || a.dispo || rec.disposition || extra.disposition || '';
  // TRA reviews the FRONTER, so its "Company" is the fronter's centre; a closer
  // card wants the evaluated party's own. Both are resolved server-side by
  // /crm-fields — this just picks the right one per card instead of relying on a
  // column being named exactly like the field.
  const fronterSide = a.subject_role === 'fronter' || a.method === 'tra' || a.work_type === 'tra';
  const centre = fronterSide
    ? (extra.fronter_center || extra.center_name || '')
    : (extra.center_name || extra.fronter_center || '');
  for (const f of metaFieldsOf(cfg)) {
    const k = `${f.key} ${f.label || ''}`.toLowerCase();
    // Center stays out of the fuzzy pass — it is RESOLVED, not guessed:
    // /qa/assignments/:id/crm-fields returns fronter_center (the linked
    // transfer's company) and center_name (the evaluated party's company), and
    // crmAutoFill below fills them by exact normalized-name match. No link → the
    // cell stays blank rather than naming the wrong center.
    if (/cent(er|re)|company/.test(k)) { if (centre) out[f.key] = centre; }
    else if (/call.?id|lead.?id|call_id/.test(k)) out[f.key] = rec.lead_id || a.lead_id || a.call_id || '';
    else if (/date/.test(k)) { const d = callDateOf(a); out[f.key] = forInput(f, d ? new Date(d).toLocaleDateString() : ''); }
    else if (/agent/.test(k)) out[f.key] = a.agent_name || a.agent_display || a.subject_name || '';   // BEFORE the /name/ rule
    else if (/cli|phone|number|caller/.test(k)) out[f.key] = a.customer_phone || rec.phone || '';
    else if (/actual/.test(k)) continue;            // "Call Disposition Actual" — the QA agent enters the real one
    else if (/disposition|dispo/.test(k)) out[f.key] = dispo;
    else if (/name/.test(k)) out[f.key] = a.customer_name || '';
    else if (/zip|postal/.test(k)) out[f.key] = a.customer_zip || '';
    else if (/state/.test(k)) out[f.key] = a.customer_state || '';
    else if (/duration/.test(k)) out[f.key] = a.duration != null ? fmtDur(a.duration) : (rec.duration != null ? fmtDur(rec.duration) : '');
    // a column literally called "hangup" / "hung up" fills itself
    else if (/hang.?up/.test(k)) out[f.key] = rec.hangup_label || rec.hangup_reason || '';
  }
  return out;
}

// Auto-fill scorecard fields from the CRM fields the fronter/closer actually
// entered (transfer/sale form_data + typed extras). Matches a scorecard
// meta_field to a CRM field by normalized name (case/spacing/underscore-agnostic).
// This is the AUTHENTIC source, so it takes precedence over metaAutoFill guesses.
const normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function crmAutoFill(cfg, fields, extra) {
  const src = { ...(extra || {}), ...(fields || {}) };   // form_data overrides typed extras
  const byNorm = {};
  for (const [k, v] of Object.entries(src)) if (v != null && v !== '' && typeof v !== 'object') byNorm[normKey(k)] = v;
  const out = {};
  for (const f of metaFieldsOf(cfg)) {
    // NEVER let a CRM row's own timestamp fill a Date column. /crm-fields returns
    // extra.date = the transfer's created_at, and this pass runs AFTER the one
    // that put the CALL's day there — so a bulk-imported or late-entered
    // transfer (dialled long before it reached the CRM) overwrote a correct date
    // with one months out. The call's day is decided upstream; leave it alone.
    if (/date/.test(`${f.key} ${f.label || ''}`.toLowerCase())) continue;
    for (const cand of [normKey(f.key), normKey(f.label)]) { if (byNorm[cand] != null) { out[f.key] = forInput(f, String(byNorm[cand])); break; } }
  }
  return out;
}

// Pre-fill the Call_Outcome column from the disposition the CLOSER recorded on
// the sale (sales.closer_disposition, surfaced as crm-fields extra.disposition;
// falls back to the disposition already on the queue row).
//
// EXACT MATCH ONLY, on purpose. call_outcome is a fixed option list and
// SheetScoreRow renders a <select>: a value that isn't in the list renders as
// blank while still being submitted, and the outcome formula would score it 0.
// A silent 0 on a real call is worse than an empty cell the agent has to fill,
// so anything that isn't literally one of the configured options is left alone.
// Case/whitespace are normalised — that's still an exact match, not a mapping.
// The cell stays fully editable either way; the QA agent has the last word.
function outcomeAutoFill(cfg, a, extra) {
  const co = cfg?.call_outcome;
  if (!co?.key) return {};
  const dispo = String(extra?.disposition ?? a?.disposition ?? a?.dispo ?? '').trim();
  if (!dispo) return {};
  const hit = (co.options || []).find(o => String(o).trim().toLowerCase() === dispo.toLowerCase());
  return hit ? { [co.key]: hit } : {};
}

// Where a header column fetches its value from, chosen explicitly in the
// Scorecards editor. The fuzzy name-matching in metaAutoFill is a guess that
// holds only until somebody renames a header — and renaming headers is now the
// point of the editor, so the guess would break silently. A column may name its
// own source, and an explicit source always beats the guess.
const AUTOFILL_SOURCES = [
  { v: '',               label: 'Auto — match by name' },
  { v: 'none',           label: 'Leave blank (reviewer types it)' },
  { v: 'agent_name',     label: 'Agent name' },
  { v: 'duration',       label: 'Call duration' },
  { v: 'call_id',        label: 'Call / Lead ID' },
  { v: 'phone',          label: 'Customer phone (CLI)' },
  { v: 'disposition',    label: 'Disposition' },
  { v: 'customer_name',  label: 'Customer name' },
  { v: 'zip',            label: 'ZIP' },
  { v: 'state',          label: 'State' },
  { v: 'fronter_center', label: 'Fronter center' },
  { v: 'center_name',    label: 'Center (evaluated party)' },
  // "Evaluated by" had no token at all, so that column could only ever be typed
  // by hand on every single call. It is the one value the browser always knows.
  { v: 'reviewer_name',  label: 'Evaluated by — me (the reviewer)' },
  // straight off the dialer's call log — 'Agent hung up' / 'Customer hung up'
  { v: 'hangup_reason',  label: 'Who hung up (dialer)' },
];

// ── VICIdial STANDARD lead fields ────────────────────────────────────────────
// The vehicle data is NOT in this dialer's custom fields — it is written into
// standard lead columns that the campaign repurposes. Straight off the agent
// screen: Address2 = VOLKSWAGEN (make), Address3 = PASSAT SE (model),
// Province = 2012 (year), while Address1/City/State/PostCode stay the real
// address.
//
// So the mapping menu must offer the standard columns, not only custom fields —
// otherwise the exact data being asked for is unmappable. This list is static on
// purpose: standard columns exist on every VICIdial box, so the menu is never
// empty and never waits on a dialer round-trip to render.
const VICI_STANDARD_FIELDS = [
  ['address2',    'Address 2 — car MAKE on your dialer'],
  ['address3',    'Address 3 — car MODEL on your dialer'],
  ['province',    'Province — car YEAR on your dialer'],
  ['first_name',  'First name'],
  ['last_name',   'Last name'],
  ['middle_initial', 'Middle initial'],
  ['address1',    'Address 1'],
  ['city',        'City'],
  ['state',       'State'],
  ['postal_code', 'Post code / ZIP'],
  ['phone_number', 'Phone number'],
  ['alt_phone',   'Alt. phone'],
  ['email',       'Email'],
  ['comments',    'Comments'],
  ['security_phrase', 'Security phrase'],
  ['title',       'Title'],
  ['gender',      'Gender'],
  ['date_of_birth', 'Date of birth'],
  ['vendor_lead_code', 'Vendor lead code'],
  ['source_id',   'Source ID'],
  ['status',      'Lead status'],
  ['user',        'Dialer user'],
  ['list_id',     'List ID'],
  ['called_count', 'Times called'],
  ['entry_date',  'Lead entry date'],
];

// Fields whose source is a dialer field, so ScoreForm knows what to ask for.
// `vici:<field>` — a VICIdial lead field (standard or a list custom field, which
// is where the vehicle data lives). One HTTP round-trip per field, so we only
// ever request the ones this scorecard actually maps.
const viciSourcesOf = (cfg) => [...new Set(resolveSheetFields(cfg)
  .map(f => (typeof f.source === 'string' && f.source.startsWith('vici:')) ? f.source.slice(5) : null)
  .filter(Boolean))];

// `me` — the signed-in reviewer's display name, for the reviewer_name source.
function sourceAutoFill(cfg, a, crm, vici, me) {
  const out = {};
  const rec = a?.recording_ref || {};
  const ex = crm?.extra || {};
  const crmFields = crm?.fields || {};
  // CRM lookups are name-based and case/spacing-agnostic, matching crmAutoFill.
  const crmByNorm = {};
  for (const [k, v] of Object.entries({ ...ex, ...crmFields })) {
    if (v != null && v !== '' && typeof v !== 'object') crmByNorm[normKey(k)] = v;
  }
  const pick = {
    agent_name:     () => a?.agent_name || a?.agent_display || a?.subject_name || '',
    duration:       () => ((a?.duration ?? rec.duration) != null ? fmtDur(a?.duration ?? rec.duration) : ''),
    call_id:        () => rec.lead_id || a?.lead_id || a?.call_id || '',
    phone:          () => a?.customer_phone || rec.phone || ex.customer_phone || '',
    date:           () => { const d = callDateOf(a); return d ? new Date(d).toLocaleDateString() : ''; },
    disposition:    () => ex.disposition || a?.disposition || a?.dispo || rec.disposition || '',
    customer_name:  () => a?.customer_name || ex.customer_name || '',
    zip:            () => a?.customer_zip || '',
    state:          () => a?.customer_state || '',
    fronter_center: () => ex.fronter_center || '',
    center_name:    () => ex.center_name || ex.fronter_center || '',
    reviewer_name:  () => me || '',
    hangup_reason:  () => rec.hangup_label || rec.hangup_reason || '',
  };
  // EVERY field, not just the details: a dropdown or a Y/N column can name a
  // source too, and an explicitly-mapped column must fill wherever it now sits.
  for (const f of resolveSheetFields(cfg)) {
    const s = f.source;
    if (!s) continue;                       // '' / undefined → leave the fuzzy pass in charge
    if (s === 'none') { out[f.key] = ''; continue; }
    if (s.startsWith('vici:')) {            // a dialer lead field (vehicle data etc.)
      const v = vici?.[s.slice(5)];
      if (v != null && v !== '') out[f.key] = forInput(f, String(v));
      continue;
    }
    if (s.startsWith('crm:')) {             // a field the fronter/closer typed
      const v = crmByNorm[normKey(s.slice(4))];
      if (v != null && v !== '') out[f.key] = forInput(f, String(v));
      continue;
    }
    const fn = pick[s];
    if (fn) out[f.key] = forInput(f, fn());
  }
  return out;
}

// ── scorecard form ────────────────────────────────────────────────────────────
function ScoreForm({ assignment, onScored }) {
  const [scorecard, setScorecard] = useState(null);   // null = loading, false = none, obj = loaded
  const [loadErr, setLoadErr] = useState('');
  const [scores, setScores] = useState({});      // key → points (legacy weighted only)
  const [notes, setNotes] = useState({});         // key → note
  const [overall, setOverall] = useState('');
  const [busy, setBusy] = useState(false);
  const [crm, setCrm] = useState(null);           // { fields, extra } the fronter/closer entered
  const [vici, setVici] = useState(null);         // dialer lead fields this card maps
  const [viciNote, setViciNote] = useState('');   // why they're blank, when they are
  // A dialer that was unreachable for two seconds used to cost the reviewer the
  // whole task — the only way to ask again was to close and reopen it. This is
  // the retry, and it never touches a cell the reviewer already typed.
  const [refetch, setRefetch] = useState(0);
  const { user: me } = useAuth();
  const reviewerName = [me?.first_name, me?.last_name].filter(Boolean).join(' ').trim() || me?.email || '';

  useEffect(() => {
    setScorecard(null); setLoadErr(''); setScores({}); setNotes({}); setOverall(''); setCrm(null); setVici(null);
    // fetch by WORK TYPE slot (tra | rcm | closer_sales | closer_dispo) so each
    // section uses its own scorecard; fall back to method for legacy tasks.
    client.get('qa/scorecards', { params: { method: assignment.work_type || assignment.method, company_id: assignment.company_id } })
      .then(r => {
        const list = r.data.scorecards || [];
        // company-scoped active first, else global template
        // ONLY an active card — never fall back to list[0], which could be an
        // inactive/old card the backend rejects on submit ("no scorecard").
        const pick = list.find(s => s.company_id === assignment.company_id && s.is_active) || list.find(s => !s.company_id && s.is_active) || null;
        setScorecard(pick || false);
        // legacy weighted cards use an ARRAY of criteria — prefill max_points.
        // sheet_v2 cards use an OBJECT (SheetScoreRow handles its own defaults),
        // so DON'T call .forEach on it (that threw → infinite spinner before).
        if (pick && Array.isArray(pick.criteria)) { const init = {}; pick.criteria.forEach(c => { init[c.key] = c.max_points; }); setScores(init); }
      })
      .catch(e => setLoadErr(e.response?.data?.error || 'Could not load the scorecard (check QA permissions).'));
  }, [assignment.id]);

  // The call itself. A CRM-sourced task has no recording_ref, so Duration and
  // Date had nothing to read and stayed blank on every method — the reviewer
  // typed what the player was already showing them. The candidates endpoint
  // knows: take the reviewed leg's longest clip (the substantive call, not a
  // redial) and let it stand in as this task's recording.
  const [bestRec, setBestRec] = useState(null);
  useEffect(() => {
    let alive = true;
    client.get(`qa/assignments/${assignment.id}/candidates`)
      .then(r => {
        if (!alive) return;
        const all = r.data.candidates || [];
        const leg = assignment.subject_role === 'fronter' ? 'fronter' : 'closer';
        const mine = all.filter(c => c.leg === leg);
        let pool = mine.length ? mine : all;
        // Prefer a clip from THIS TASK'S DAY. The phone search widens to every
        // call ever made to that number when the narrow window finds nothing, so
        // a repeat customer can drag in a recording from months ago — and that
        // clip's timestamp then fills the Date column with the wrong date
        // entirely. Same day first; only fall back if the day has nothing.
        const day = dayOfDate(assignment.subject_date || assignment.recording_date || assignment.created_at);
        const sameDay = day ? pool.filter(c => dayOfDate(c.start_time) === day) : [];
        if (sameDay.length) pool = sameDay;
        setBestRec(pool.slice().sort((x, y) => (y.duration || 0) - (x.duration || 0))[0] || null);
      })
      .catch(() => { if (alive) setBestRec(null); });
    return () => { alive = false; };
  }, [assignment.id, assignment.subject_role, refetch]);

  // What the auto-fill passes see as "the call": the task's own recording when it
  // has one, otherwise the clip resolved above.
  const callCtx = {
    ...assignment,
    recording_ref: (assignment.recording_ref && assignment.recording_ref.recording_id) ? assignment.recording_ref : (bestRec || assignment.recording_ref),
    duration: assignment.duration ?? bestRec?.duration ?? null,
    // The day this task is FOR, decided here rather than left to whichever
    // fallback a fill rule reaches first. recording_date is the day the manager
    // loaded; a recording's timestamp is only a fallback, and a CRM row's
    // created_at is never the call time.
    subject_date: bestRec?.start_time || assignment.recording_date || null,
  };

  // The CRM fields the fronter/closer already entered → auto-fill matching
  // columns. Its OWN effect (not the scorecard one) so "Re-fetch details" can
  // re-run it without resetting the card, which would remount the form and throw
  // away everything already typed.
  useEffect(() => {
    let alive = true;
    client.get(`qa/assignments/${assignment.id}/crm-fields`)
      .then(r => { if (alive) setCrm({ fields: r.data.fields || {}, extra: r.data.extra || {} }); })
      .catch(() => { if (alive) setCrm({ fields: {}, extra: {} }); });
    return () => { alive = false; };
  }, [assignment.id, refetch]);

  // Dialer lead fields — only the ones this card actually maps, and only once the
  // card is known. Never blocks scoring: an unreachable box resolves to {} and
  // those cells stay editable and empty.
  const viciWanted = scorecard ? viciSourcesOf(scorecard.criteria) : [];
  const viciKey = viciWanted.join(',');
  useEffect(() => {
    if (!viciKey) { setVici({}); setViciNote(''); return; }
    let alive = true;
    client.get(`qa/assignments/${assignment.id}/vici-fields`, { params: { fields: viciKey } })
      .then(r => {
        if (!alive) return;
        const values = r.data.values || {};
        setVici(values);
        // A mapped column that comes back empty must SAY why. Silently blank is
        // what made this look broken rather than "this call has no dialer lead".
        const got = Object.keys(values).length;
        // Each reason names the NEXT step. "No lead is linked" was the same
        // sentence whether the call had no phone, the dialer had never seen the
        // number, or the number belonged to several leads — three different
        // problems, one dead end.
        setViciNote(
          r.data.reason === 'no_lead' ? 'This task has no phone number and no linked transfer, so there is nothing to look the lead up by — type the dialer columns in.'
            : r.data.reason === 'no_lead_for_phone' ? 'The dialer has no lead for this customer’s number, so the dialer-mapped columns stay blank — type them in.'
              : r.data.reason === 'lead_ambiguous' ? `This number matches ${r.data.matches || 'several'} different dialer leads and none of them is this agent’s, so none was attached — type the dialer columns in.`
                : r.data.reason === 'dialer_unreachable' ? 'The dialer could not be reached — dialer-mapped columns are blank; type them in, or use Re-fetch details.'
                  : got === 0 ? 'The dialer returned no value for the mapped fields on this lead.'
                    : '',
        );
      })
      .catch(() => { if (alive) { setVici({}); setViciNote('Could not reach the dialer for this call.'); } });
    return () => { alive = false; };
  }, [assignment.id, viciKey, refetch]);

  if (loadErr) return <div className="py-4 text-sm text-center" style={{ color: 'var(--color-error-600)' }}>{loadErr}</div>;
  if (scorecard === null) return <div className="py-4 text-center"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>;
  if (!scorecard) return <div className="py-4 text-sm text-center" style={{ color: 'var(--color-error-600)' }}>No active scorecard for {SLOT_LABEL[assignment.work_type || assignment.method] || (assignment.method || '').toUpperCase()} yet. Ask a QA manager to set one up in Scorecards &amp; Config.</div>;

  // sheet_v2 (WaveTech replication) → horizontal spreadsheet-row scoring UI
  if (isSheetConfig(scorecard.criteria)) {
    return (
      <>
      {viciNote && (
        <div className="text-[11px] font-semibold mb-2 px-2.5 py-1.5 rounded-lg m-0 flex items-center gap-2 flex-wrap"
          style={{ background: 'color-mix(in srgb, var(--color-warning-600) 10%, transparent)', color: 'var(--color-warning-700)' }}>
          <span>{viciNote}</span>
        </div>
      )}
      <SheetScoreRow
        key={assignment.id + (crm ? ':crm' : '') + (vici ? ':v' : '')}
        /* keeps a half-scored call alive if the task is closed and reopened */
        draftKey={assignment.id}
        config={scorecard.criteria}
        initialValues={{
          // callCtx, not the bare assignment: it carries the resolved recording,
          // so Duration / Date / who-hung-up fill from the actual dialer call.
          ...metaAutoFill(scorecard.criteria, callCtx, crm?.extra || {}),
          ...crmAutoFill(scorecard.criteria, crm?.fields, crm?.extra),
          // An explicitly-configured source wins over both guesses above.
          ...sourceAutoFill(scorecard.criteria, callCtx, crm, vici, reviewerName),
          ...outcomeAutoFill(scorecard.criteria, callCtx, crm?.extra),
        }}
        headerRight={
          <button onClick={() => setRefetch(n => n + 1)} type="button"
            title="Ask the CRM and the dialer for this call's details again. Anything you have already typed is kept."
            className="text-[10px] font-bold px-2 py-0.5 rounded"
            style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
            Re-fetch details
          </button>
        }
        busy={busy}
        onSubmit={async (payload) => {
          setBusy(true);
          try {
            const r = await client.post('qa/reviews', { assignment_id: assignment.id, ...payload });
            clearSheetDraft(assignment.id);   // submitted — the draft has done its job
            const c = r.data.computed || {};
            toast.success(c.final_score != null
              ? `Review submitted — ${c.passed ? 'Pass' : 'FAIL'} (Final ${c.final_score})`
              : `Review submitted — Quality ${c.quality_score == null ? 'N/A' : `${c.quality_score}%`}`);
            onScored?.();
          } catch (e) { toast.error(e.response?.data?.error || 'Could not submit review'); }
          finally { setBusy(false); }
        }}
      />
      </>
    );
  }

  const criteria = scorecard.criteria || [];
  const max = criteria.reduce((s, c) => s + (+c.max_points || 0), 0);
  const total = criteria.reduce((s, c) => s + (Math.max(0, Math.min(+c.max_points || 0, +scores[c.key] || 0))), 0);
  const pct = max ? Math.round((total / max) * 100) : 0;
  const autoFailed = criteria.some(c => c.auto_fail && (+scores[c.key] || 0) <= 0);
  const willPass = !autoFailed && pct >= (+scorecard.pass_threshold || 80);

  const submit = async () => {
    setBusy(true);
    try {
      const payload = { assignment_id: assignment.id, overall_notes: overall, scores: criteria.map(c => ({ criterion_key: c.key, points: Math.max(0, Math.min(+c.max_points || 0, +scores[c.key] || 0)), note: notes[c.key] || '' })) };
      const r = await client.post('qa/reviews', payload);
      toast.success(`Review submitted — ${r.data.passed ? 'Passed' : 'Failed'} (${r.data.score_pct}%)`);
      onScored?.();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not submit review'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{scorecard.name}</div>
        <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>pass ≥ {scorecard.pass_threshold}%</div>
      </div>
      {criteria.map(c => (
        <div key={c.key} className="p-2.5 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{c.label} {c.auto_fail && <span className="text-[10px] font-bold px-1 rounded" style={{ background: 'var(--color-error-50, rgba(220,38,38,0.12))', color: 'var(--color-error-600)' }}>AUTO-FAIL</span>}</div>
            </div>
            <input type="number" min={0} max={c.max_points} value={scores[c.key] ?? ''} onChange={e => setScores(s => ({ ...s, [c.key]: e.target.value }))} style={{ ...inp, width: 70 }} />
            <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>/ {c.max_points}</span>
          </div>
          <input placeholder="Note (optional)" value={notes[c.key] || ''} onChange={e => setNotes(n => ({ ...n, [c.key]: e.target.value }))} style={{ ...inp, width: '100%', marginTop: 6 }} />
        </div>
      ))}
      <textarea placeholder="Overall notes / coaching feedback" value={overall} onChange={e => setOverall(e.target.value)} rows={2} style={{ ...inp, width: '100%' }} />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-extrabold tabular-nums" style={{ color: willPass ? 'var(--color-success-600)' : 'var(--color-error-600)' }}>{pct}%</span>
          {willPass ? <span className="flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--color-success-600)' }}><CheckCircle2 size={15} />Pass</span> : <span className="flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--color-error-600)' }}><XCircle size={15} />Fail</span>}
        </div>
        <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-bold text-white flex items-center gap-1.5" style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', opacity: busy ? 0.6 : 1 }}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Submit review
        </button>
      </div>
    </div>
  );
}

// ── Review editor — view/edit a SUBMITTED review (agent: own while submitted;
// qa_manager with override_qa_review: any field of any review, fully audited) ──
function ReviewEditor({ assignment, selfId, canOverride, onSaved }) {
  const [data, setData] = useState(null);   // { review, scores, scorecard }
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setData(null);
    client.get(`qa/reviews/by-assignment/${assignment.id}`)
      .then(r => setData(r.data))
      .catch(() => setData({ error: true }));
  }, [assignment.id]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="py-4 text-center"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>;
  if (data.error || !data.review) return <div className="py-3 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Could not load the review.</div>;

  const { review, scores, scorecard } = data;
  const sheet = scorecard && isSheetConfig(scorecard.criteria);
  const editable = canOverride || (review.reviewer_id === selfId && review.status === 'submitted');
  const initialValues = {
    ...Object.fromEntries((scores || []).map(s => [s.criterion_key, s.raw_value ?? ''])),
    ...(review.meta || {}),
  };

  const save = async (payload) => {
    setBusy(true);
    try {
      const r = await client.put(`qa/reviews/${review.id}`, payload);
      toast.success(r.data.changed ? 'Review updated' : 'No changes to save');
      load(); onSaved?.();
    } catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        <span className="font-bold px-1.5 py-0.5 rounded uppercase"
          style={{ background: 'var(--color-surface-hover)', color: review.status === 'finalized' ? 'var(--color-success-600)' : 'var(--color-warning-600)' }}>{review.status}</span>
        {review.final_score != null && <span className="font-bold tabular-nums">Final {review.final_score}</span>}
        {review.quality_score != null && <span className="font-bold tabular-nums">Quality {review.quality_score}%</span>}
        {review.autofail_result && <span>Auto-Fail: {review.autofail_result}</span>}
        {!editable && <span className="italic">read-only{review.status === 'finalized' ? ' (finalized)' : ''}</span>}
        {canOverride && review.status === 'submitted' && (
          <button onClick={() => save({ status: 'finalized' })} disabled={busy}
            className="ml-auto text-[11px] font-bold px-2 py-1 rounded"
            style={{ background: 'var(--color-surface-hover)', color: 'var(--color-success-600)' }}>Finalize (lock)</button>
        )}
      </div>
      {sheet ? (
        <SheetScoreRow key={review.id + review.status + (review.edit_history || []).length}
          config={scorecard.criteria} initialValues={initialValues} initialNotes={review.overall_notes || ''}
          readOnly={!editable} busy={busy} submitLabel="Save changes" onSubmit={save} />
      ) : (
        <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Legacy scorecard review — editing is available for sheet-model reviews only.</div>
      )}
      {(review.edit_history || []).length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Edit history</div>
          <div className="space-y-1 max-h-40 overflow-auto">
            {[...review.edit_history].reverse().map((h, i) => (
              <div key={i} className="text-[11px] p-1.5 rounded" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                <span className="font-bold">{new Date(h.edited_at).toLocaleString()}</span>{h.override ? ' · OVERRIDE' : ''} — {Object.entries(h.changes || {}).map(([k, c]) => `${k}: ${c.from ?? '—'} → ${c.to ?? '—'}`).join(' · ')}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// The "scoreboard" cell shown per queue row: the computed result once scored.
function ScoreCell({ a }) {
  const r = a.review;
  if (a.status !== 'scored' || !r) return <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
  // Fronter/TRA → Final + Pass/Fail; Closer/RCM → Quality %
  if (r.final_score != null) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-sm font-extrabold tabular-nums" style={{ color: r.passed ? 'var(--color-success-600)' : 'var(--color-error-600)' }}>{r.final_score}</span>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={r.passed ? { background: 'rgba(16,185,129,0.12)', color: '#059669' } : { background: 'rgba(220,38,38,0.12)', color: '#dc2626' }}>{r.passed ? 'PASS' : 'FAIL'}</span>
      </span>
    );
  }
  if (r.quality_score != null) return <span className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--color-text)' }}>{r.quality_score}%<span className="text-[10px] font-normal ml-1" style={{ color: 'var(--color-text-tertiary)' }}>quality</span></span>;
  return <span className="text-[11px] font-bold" style={{ color: r.autofail_result === 'Fail' ? 'var(--color-error-600)' : 'var(--color-text-secondary)' }}>{r.autofail_result || 'scored'}</span>;
}

// ── Queue tab ─────────────────────────────────────────────────────────────────
// Manager view: browse the ACTUAL CRM transfers / sales (not the sampled queue),
// split into two sections. Open a record → its QA assignment is found-or-created
// so recordings resolve and the scorecard saves exactly like the queue.
function QueueTab({ canOverride, canManage, selfId, companyId }) {
  const [kind, setKind]       = useState('transfer');   // 'transfer' | 'sale'
  const [items, setItems]     = useState([]);
  const [totals, setTotals]   = useState({ transfer: null, sale: null });
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState('');
  const [q, setQ]             = useState('');            // committed phone search
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(null);          // record_id being opened
  const [open, setOpen]       = useState(null);          // review panel (assignment-shaped)
  const [pulling, setPulling] = useState(false);
  const LIMIT = 50;

  const load = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoading(true);   // silent refresh (after scoring) never blanks
    try {
      const params = { kind, limit: LIMIT, page };
      if (q) params.search = q;
      if (companyId) params.company_id = companyId;
      const r = await client.get('qa/crm-records', { params });
      setItems(r.data.items || []);
      if (r.data.total != null) { setTotal(r.data.total); setTotals(t => ({ ...t, [kind]: r.data.total })); }
    } catch { if (!silent) setItems([]); }
    finally { setLoading(false); }
  }, [kind, page, q, companyId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); setTotals({ transfer: null, sale: null }); }, [kind, q, companyId]);   // reset paging + counts on section / search / company change

  // Light count for the OTHER section so both tabs show a badge — same search
  // filter as the active section, so the two badges always mean the same thing.
  useEffect(() => {
    const other = kind === 'transfer' ? 'sale' : 'transfer';
    if (totals[other] != null) return;
    client.get('qa/crm-records', { params: { kind: other, limit: 1, page: 1, ...(q ? { search: q } : {}), ...(companyId ? { company_id: companyId } : {}) } })
      .then(r => { if (r.data.total != null) setTotals(t => ({ ...t, [other]: r.data.total })); })
      .catch(() => {});
  }, [kind, totals, companyId, q]);

  // Build the assignment-shaped object the review panel + scorecard expect.
  const toOpen = (it, assignmentId, qaStatus, review, meta) => ({
    ...it, id: assignmentId,
    method: meta?.method || (it.record_kind === 'sale' ? 'rcm' : 'tra'),
    subject_role: meta?.subject_role || (it.record_kind === 'sale' ? 'closer' : 'fronter'),
    company_id: meta?.company_id || it.company_id,
    status: qaStatus || 'pending', review: review || null,
  });

  const openRecord = async (it) => {
    if (it.assignment_id) { setOpen(toOpen(it, it.assignment_id, it.qa_status, it.review)); return; }
    setOpening(it.record_id);
    try {
      const r = await client.post(`qa/crm-records/${it.record_kind}/${it.record_id}/open`);
      setOpen(toOpen(it, r.data.assignment_id, 'pending', null, r.data));
    } catch (e) { toast.error(e.response?.data?.error || 'Could not open record'); }
    finally { setOpening(null); }
  };

  const pullNow = async () => {
    setPulling(true);
    try {
      const r = await client.post('qa/materialize', companyId ? { company_id: companyId } : {});
      toast.success(`Pulled ${r.data.tra || 0} TRA + ${r.data.rcm || 0} RCM call(s) into agents' queues`);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not pull calls'); }
    finally { setPulling(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const label = kind === 'sale' ? 'sales' : 'transfers';

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Queue</span>
        <InfoTip text="Browse every real CRM transfer and sale for your companies. Click any row to open it, listen to the recording, and score it. Opening a record automatically creates its QA task — no need to pull first." />
      </div>
      {/* Transfers vs Sales — CRM record sections */}
      <div className="flex items-center gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)' }}>
        {[['transfer', 'Transfers', totals.transfer, ArrowRightLeft], ['sale', 'Sales', totals.sale, DollarSign]].map(([k, lbl, n, Icon]) => (
          <button key={k} onClick={() => { setKind(k); setOpen(null); }}
            className="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5"
            style={{ background: kind === k ? 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' : 'transparent', color: kind === k ? '#fff' : 'var(--color-text-secondary)' }}>
            <Icon size={13} /> {lbl}
            {n != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: kind === k ? 'rgba(255,255,255,0.25)' : 'var(--color-surface)', color: kind === k ? '#fff' : 'var(--color-text-tertiary)' }}>{n}</span>}
          </button>
        ))}
      </div>

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className="relative">
            <Search size={13} style={{ position: 'absolute', left: 8, top: 9, color: 'var(--color-text-tertiary)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && setQ(search.trim())}
              placeholder="Search phone…" style={{ ...inp, paddingLeft: 26, width: 180 }} />
          </div>
          <button onClick={() => setQ(search.trim())} className="px-3 py-2 rounded-lg text-xs font-bold text-white" style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' }}>Search</button>
          {q && <button onClick={() => { setSearch(''); setQ(''); }} className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>clear</button>}
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{total.toLocaleString()} {label}</span>
          <button onClick={load} className="p-2 rounded-lg" style={{ background: 'var(--color-surface-hover)' }} title="Refresh"><RefreshCw size={14} style={{ color: 'var(--color-text-secondary)' }} /></button>
          {canManage && (
            <span className="ml-auto inline-flex items-center gap-1">
              <button onClick={pullNow} disabled={pulling} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
                style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text)', opacity: pulling ? 0.6 : 1 }}>
                {pulling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Pull agent queue
              </button>
              <InfoTip side="right" text="Runs the sampler now: builds the TRA (full-coverage) + RCM (random-sample) worklist and drops those tasks into your agents' queues. Normally this runs automatically on a schedule — use this to pull immediately." />
            </span>
          )}
        </div>

        {loading && !items.length ? <div className="text-center py-10"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>
          : items.length === 0 ? (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
              {q ? `No ${label} match that phone.` : `No ${label} in the CRM for your companies yet.`}
            </div>
          )
          : <>
            <div className="flex-1 overflow-auto rounded-xl" style={{ border: '1px solid var(--color-border)' }}>
              <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                <thead className="sticky top-0 z-10" style={{ background: 'var(--color-surface-hover)' }}>
                  <tr>{['Customer / Phone', 'Date', 'Disposition', kind === 'sale' ? 'Plan' : '', 'QA', 'Score', ''].filter((h, i) => i !== 3 || kind === 'sale').map(h => <th key={h || 'x'} className="text-left px-3 py-2 text-[11px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr key={it.record_id} onClick={() => openRecord(it)} className="cursor-pointer"
                      style={{ borderTop: '1px solid var(--color-border)', background: open?.record_id === it.record_id ? 'var(--color-surface-hover)' : 'transparent' }}>
                      <td className="px-3 py-2">
                        <div className="font-semibold truncate" style={{ color: 'var(--color-text)', maxWidth: 200 }}>{it.customer_name || '—'}</div>
                        {it.customer_phone && <div className="text-[11px] tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>{it.customer_phone}</div>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(it.subject_date)}</td>
                      <td className="px-3 py-2 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>{it.disposition || '—'}</td>
                      {kind === 'sale' && <td className="px-3 py-2 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>{[it.client_name, it.plan].filter(Boolean).join(' · ') || '—'}</td>}
                      <td className="px-3 py-2">{it.qa_status ? <StatusPill s={it.qa_status} /> : <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>not reviewed</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><ScoreCell a={{ status: it.qa_status, review: it.review }} /></td>
                      <td className="px-2 py-2">{opening === it.record_id ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} /> : <ChevronRight size={15} style={{ color: 'var(--color-text-tertiary)' }} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > LIMIT && (
              <div className="flex items-center justify-between mt-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                <span>Page {page} of {totalPages}</span>
                <div className="flex gap-1.5">
                  <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 rounded-lg font-bold disabled:opacity-40" style={{ background: 'var(--color-surface-hover)' }}>Prev</button>
                  <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 rounded-lg font-bold disabled:opacity-40" style={{ background: 'var(--color-surface-hover)' }}>Next</button>
                </div>
              </div>
            )}
          </>}
      </div>

      <ScoreModal open={open} onClose={() => setOpen(null)} selfId={selfId} canOverride={canOverride}
        onScored={() => { setOpen(null); toast.success('Scored'); load({ silent: true }); }}
        onEdited={() => load({ silent: true })} />
    </div>
  );
}

// ── Live tab ──────────────────────────────────────────────────────────────────
// Near-real-time feed of transfers + sales the moment they land from the dialer
// (the VICIdial webhooks write them; we just read the CRM rows on a short rolling
// window — NO "load day", NO dialer re-fetch, NO materialize). INCLUDES transfers
// the fronter hasn't completed yet — QA can still hear the call. Click a row to
// listen + score; an agent self-claims it. Company-scoped via the header picker.
const LIVE_POLL_MS = 25000;
const LIVE_WINDOWS = [
  { key: 'today', label: 'Today' },
  { key: '4h',    label: 'Last 4h' },
  { key: '48h',   label: '48h' },
];
// Start of the current business day (US Eastern — the dialer reports by Eastern
// calendar day) as a UTC ISO. Live defaults to this so its TRA/Sales totals match
// the dialer's XFER/SALE counts (and the CRM Day report), not a rolling 4h slice.
function tzOffsetMinutes(tz, at) {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(at).find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(s);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
}
function businessDayStartISO(tz = 'America/New_York') {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const off = tzOffsetMinutes(tz, new Date(ymd + 'T12:00:00Z'));
  return new Date(new Date(ymd + 'T00:00:00Z').getTime() - off * 60000).toISOString();
}
function liveTimeAgo(ts) {
  if (!ts) return '';
  const then = new Date(String(ts).replace(' ', 'T')).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function liveBeep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = new AC(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.04;
    o.start(); setTimeout(() => { try { o.stop(); ctx.close(); } catch { /* ignore */ } }, 130);
  } catch { /* ignore */ }
}
// Composite identity for a feed row — a transfer appears as up to TWO legs (TRA +
// Unclosed) sharing one record_id, so the key must include the work type.
const liveKey = (it) => `${it.record_kind}:${it.work_type}:${it.record_id}`;

function LiveTab({ scoped, selfId, canOverride, isManager, allowedWt }) {
  const [items, setItems]     = useState(null);   // null = loading
  const [open, setOpen]       = useState(null);
  const [opening, setOpening] = useState(null);
  const [paused, setPaused]   = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [freshIds, setFreshIds] = useState(() => new Set());
  const [kindFilter, setKindFilter] = useState('all');   // all | transfer | sale | live
  const [win, setWin] = useState('today');               // today | 4h | 48h — 'today' matches the dialer's day
  const seenRef  = useRef(new Set());
  const firstRef = useRef(true);
  const scopedRef = useRef(scoped);   // latest selected company — to drop stale responses
  scopedRef.current = scoped;
  const [, tick] = useState(0);   // re-render so "Xs ago" stays fresh

  const load = useCallback(async ({ silent } = {}) => {
    const reqScope = scoped;   // capture at call time
    try {
      const params = { limit: 500 };
      if (win === 'today') params.since = businessDayStartISO();     // full business day (matches dialer)
      else params.window_min = win === '4h' ? 240 : 2880;            // rolling 4h / 48h
      if (scoped) params.company_id = scoped;   // '' = All my companies → server uses full allowed set
      const r = await client.get('qa/live', { params });
      if (reqScope !== scopedRef.current) return;   // company switched mid-request → drop this stale response
      const next = r.data.items || [];
      if (!firstRef.current) {   // don't flag everything as "new" on the first paint
        const fresh = new Set();
        for (const it of next) { const k = liveKey(it); if (!seenRef.current.has(k)) fresh.add(k); }
        if (fresh.size) { setFreshIds(fresh); liveBeep(); setTimeout(() => setFreshIds(new Set()), 12000); }
      }
      for (const it of next) seenRef.current.add(liveKey(it));
      firstRef.current = false;
      setItems(next);
      setLastSync(new Date());
    } catch { if (!silent) setItems([]); }
  }, [scoped, win]);

  // reset + reload when the company or the time-range switches
  useEffect(() => { firstRef.current = true; seenRef.current = new Set(); setItems(null); setFreshIds(new Set()); load(); }, [scoped, win]); // eslint-disable-line react-hooks/exhaustive-deps
  // poll while not paused
  useEffect(() => { if (paused) return undefined; const t = setInterval(() => load({ silent: true }), LIVE_POLL_MS); return () => clearInterval(t); }, [paused, load]);
  // tick relative times
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 12000); return () => clearInterval(t); }, []);
  // if the agent's selected filter is a work type their manager unchecked, snap to All
  useEffect(() => { if (wtGate && kindFilter !== 'all') { const ok = kindFilter === 'incomplete' ? wtGate.has('tra') : wtGate.has(kindFilter); if (!ok) setKindFilter('all'); } }, [allowedWt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build the assignment-shaped object the review panel + scorecard expect.
  const shape = (it, assignmentId, status, review, meta) => ({
    ...it, id: assignmentId,
    method: meta?.method || (it.work_type === 'tra' ? 'tra' : 'rcm'),
    subject_role: meta?.subject_role || (it.work_type === 'tra' ? 'fronter' : 'closer'),
    company_id: meta?.company_id || it.company_id,
    status: status || 'pending', review: review || null,
  });

  const openRow = async (it) => {
    // already reviewed → open in read/edit mode (managers or the owner only)
    if (it.assignment_id && it.qa_status === 'scored') {
      if (isManager || it.mine) setOpen(shape(it, it.assignment_id, 'scored', it.review));
      else toast.info(`Already reviewed${it.assignee_name ? ` by ${it.assignee_name}` : ''}`);
      return;
    }
    setOpening(it.record_id);
    try {
      const r = await client.post('qa/live/open', { kind: it.record_kind, id: it.record_id, work_type: it.work_type });
      setOpen(shape(it, r.data.assignment_id, it.qa_status || 'pending', it.review, r.data));
    } catch (e) {
      if (e.response?.status === 409) toast.error(`Being reviewed by ${e.response.data?.reviewer_name || 'another reviewer'}`);
      else toast.error(e.response?.data?.error || 'Could not open this record');
    } finally { setOpening(null); }
  };

  const wtGate = Array.isArray(allowedWt) ? new Set(allowedWt) : null;   // agent: only the work types their manager checked
  const all = (items || []).filter(it => !wtGate || wtGate.has(it.work_type));
  const shown = all.filter(it => kindFilter === 'all' ? true : kindFilter === 'incomplete' ? it.pending_fronter : it.work_type === kindFilter);
  const nTra  = all.filter(i => i.work_type === 'tra').length;
  const nUncl = all.filter(i => i.work_type === 'closer_dispo').length;
  const nSale = all.filter(i => i.work_type === 'closer_sales').length;
  const nInc  = all.filter(i => i.pending_fronter).length;

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--color-text)' }}>
          <span style={{ position: 'relative', display: 'inline-flex', width: 10, height: 10 }}>
            {!paused && <span className="animate-ping" style={{ position: 'absolute', inset: 0, borderRadius: 999, background: '#10b981', opacity: 0.7 }} />}
            <span style={{ position: 'relative', width: 10, height: 10, borderRadius: 999, background: paused ? 'var(--color-text-tertiary)' : '#10b981' }} />
          </span>
          Live
        </span>
        <InfoTip text="Everything punched on the dialer shows here within seconds — no loading a day. Defaults to the whole business day, so the counts match the dialer's totals; switch the range at the right. Includes transfers the fronter hasn't finished yet; you can still hear the call. Click any row to listen and score." />
        <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)' }}>
          {[['all', 'All', all.length], ['tra', 'TRA', nTra], ['closer_dispo', 'Unclosed', nUncl], ['closer_sales', 'Sales', nSale], ['incomplete', 'Incomplete', nInc]]
            .filter(([k]) => !wtGate || k === 'all' || (k === 'incomplete' ? wtGate.has('tra') : wtGate.has(k)))
            .map(([k, lbl, n]) => (
            <button key={k} onClick={() => setKindFilter(k)}
              className="px-3 py-1 rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5"
              style={{ background: kindFilter === k ? 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' : 'transparent', color: kindFilter === k ? '#fff' : 'var(--color-text-secondary)' }}>
              {lbl}<span className="text-[10px] px-1.5 rounded-full" style={{ background: kindFilter === k ? 'rgba(255,255,255,0.25)' : 'var(--color-surface)', color: kindFilter === k ? '#fff' : 'var(--color-text-tertiary)' }}>{n}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)' }}>
            {LIVE_WINDOWS.map(w => (
              <button key={w.key} onClick={() => setWin(w.key)}
                title={w.key === 'today' ? 'Full business day — matches the dialer totals' : `Rolling ${w.label}`}
                className="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors"
                style={{ background: win === w.key ? 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' : 'transparent', color: win === w.key ? '#fff' : 'var(--color-text-secondary)' }}>
                {w.label}
              </button>
            ))}
          </div>
          {lastSync && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>updated {liveTimeAgo(lastSync)}</span>}
          <button onClick={() => setPaused(p => !p)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }} title={paused ? 'Resume live updates' : 'Pause live updates'}>
            {paused ? <><Play size={13} /> Resume</> : <><Pause size={13} /> Pause</>}
          </button>
          <button onClick={() => load()} className="p-2 rounded-lg" style={{ background: 'var(--color-surface-hover)' }} title="Refresh now"><RefreshCw size={14} style={{ color: 'var(--color-text-secondary)' }} /></button>
        </div>
      </div>

      {items === null ? <div className="text-center py-10"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>
        : shown.length === 0 ? (
          <div className="text-center py-14 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            <Headphones size={22} className="inline mb-2" style={{ opacity: 0.5 }} /><br />
            Nothing here yet. New transfers and sales appear the moment they come off the dialer.
          </div>
        ) : (
          <div className="flex-1 overflow-auto rounded-xl" style={{ border: '1px solid var(--color-border)' }}>
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead className="sticky top-0 z-10" style={{ background: 'var(--color-surface-hover)' }}>
                <tr>{['', 'Customer / Phone', 'When', 'Disposition', 'QA', 'Score', ''].map((h, idx) => <th key={idx} className="text-left px-3 py-2 text-[11px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {shown.map(it => {
                  const fresh = freshIds.has(liveKey(it));
                  const active = open?.record_id === it.record_id && open?.work_type === it.work_type;
                  return (
                  <tr key={liveKey(it)} onClick={() => openRow(it)} className="cursor-pointer"
                    style={{ borderTop: '1px solid var(--color-border)', background: fresh ? 'color-mix(in srgb, #10b981 12%, var(--color-surface))' : (active ? 'var(--color-surface-hover)' : 'transparent'), transition: 'background .4s' }}>
                    <td className="px-3 py-2"><div className="inline-flex items-center gap-1.5"><MethodPill m={it.work_type} />{fresh && <span className="text-[9px] font-black px-1 py-0.5 rounded" style={{ background: '#10b981', color: '#fff' }}>NEW</span>}</div></td>
                    <td className="px-3 py-2">
                      <div className="font-semibold truncate inline-flex items-center gap-1.5" style={{ color: 'var(--color-text)', maxWidth: 240 }}>
                        {it.customer_name || <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                        {it.pending_fronter && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(217,119,6,0.16)', color: 'var(--color-warning-600)' }} title="The fronter hasn't completed this transfer yet — you can still hear the call">INCOMPLETE</span>}
                      </div>
                      {it.customer_phone && <div className="text-[11px] tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>{it.customer_phone}</div>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" title={fmtTime(it.created_at)}><span className="font-semibold" style={{ color: fresh ? '#059669' : 'var(--color-text-secondary)' }}>{liveTimeAgo(it.created_at)}</span></td>
                    <td className="px-3 py-2 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>{it.disposition || '—'}</td>
                    <td className="px-3 py-2">{it.qa_status
                      ? <span className="inline-flex items-center gap-1"><StatusPill s={it.qa_status} />{it.assignee_name && !it.mine && <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{it.assignee_name}</span>}</span>
                      : <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>new</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><ScoreCell a={{ status: it.qa_status, review: it.review }} /></td>
                    <td className="px-2 py-2">{opening === it.record_id ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} /> : <ChevronRight size={15} style={{ color: 'var(--color-text-tertiary)' }} />}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      <ScoreModal open={open} onClose={() => setOpen(null)} selfId={selfId} canOverride={canOverride}
        onScored={() => { setOpen(null); toast.success('Scored'); load({ silent: true }); }}
        onEdited={() => load({ silent: true })} />
    </div>
  );
}

// ── Reports tab ─────────────────────────────────────────────────────────────────
const ChartCard = ({ title, hint, children, className = '' }) => (
  <div className={`p-4 rounded-2xl ${className}`} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
    <div className="text-[11px] font-bold uppercase tracking-wide mb-3 flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>{title}{hint && <InfoTip text={hint} />}</div>
    {children}
  </div>
);
const SectionTitle = ({ children }) => (
  <div className="text-[11px] font-bold uppercase tracking-wider mb-2 mt-1" style={{ color: 'var(--color-text-secondary)' }}>{children}</div>
);
const NoData = () => <div className="text-xs py-6 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No data in this range.</div>;

// ── single-agent deep report — pick one reviewed fronter/closer, see their full
// scorecard-driven performance: KPIs w/ vs-previous delta, rank among peers, score
// trend, per-criterion weak spots compared to the team, and outcome mix. ──────────
function AgentReport({ subjectId, subjectName, companyId, from, to }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!subjectId) return;
    setLoading(true);
    const params = { subject_user_id: subjectId, from, to };
    if (companyId) params.company_id = companyId;
    client.get('qa/reports/agent', { params }).then(r => setD(r.data)).catch(() => setD(null)).finally(() => setLoading(false));
  }, [subjectId, companyId, from, to]);

  if (loading) return <div className="text-center py-16"><Loader2 className="animate-spin inline" size={22} style={{ color: 'var(--color-text-tertiary)' }} /></div>;
  if (!d || !(d.summary?.reviews)) return <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No scored reviews of {subjectName || 'this agent'} in this range.</div>;
  const s = d.summary, p = d.prev || {}, r = d.rank || {};
  const Delta = ({ cur, prev, higherBetter = true, unit = '' }) => {
    if (cur == null || prev == null) return <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>no prior data</span>;
    const dv = Math.round((cur - prev) * 10) / 10;
    if (dv === 0) return <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>= vs prev</span>;
    const good = higherBetter ? dv > 0 : dv < 0;
    return <span className="text-[10px] font-bold" style={{ color: good ? '#059669' : '#dc2626' }}>{dv > 0 ? '▲' : '▼'} {Math.abs(dv)}{unit} vs prev</span>;
  };
  const KPI = ({ label, value, tint, children }) => (
    <div className="p-3 rounded-xl flex-1" style={{ minWidth: 118, background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{label}</div>
      <div className="text-2xl font-extrabold leading-tight" style={{ color: tint || 'var(--color-text)' }}>{value}</div>
      {children}
    </div>
  );
  const trendPts = (d.trend || []).map(t => ({ x: t.x, y: t.score }));
  const worst = (d.criteria || []).filter(c => c.agent_miss_rate > 0).slice(0, 12);
  const outcomes = (d.outcomes || []).map((o, i) => ({ label: o.label, value: o.n, color: PALETTE[i % PALETTE.length] }));

  return (
    <div>
      <div className="flex items-stretch gap-2 flex-wrap mb-3">
        <KPI label="Reviews" value={s.reviews}><Delta cur={s.reviews} prev={p.reviews} /></KPI>
        <KPI label="Avg score" value={s.avg_score ?? '—'} tint={s.avg_score == null ? undefined : s.avg_score >= 80 ? '#059669' : s.avg_score >= 60 ? '#d97706' : '#dc2626'}><Delta cur={s.avg_score} prev={p.avg_score} /></KPI>
        <KPI label="Pass rate" value={s.pass_rate == null ? '—' : `${s.pass_rate}%`} tint="#059669"><Delta cur={s.pass_rate} prev={p.pass_rate} unit="%" /></KPI>
        <KPI label="Auto-fails" value={s.autofails} tint="#dc2626"><Delta cur={s.autofails} prev={p.autofails} higherBetter={false} /></KPI>
        <div className="p-3 rounded-xl flex-1" style={{ minWidth: 168, background: 'var(--color-surface)', border: '1px solid var(--color-primary-600)' }}>
          <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>Rank in team</div>
          <div className="text-2xl font-extrabold leading-tight" style={{ color: 'var(--color-primary-600)' }}>{r.rank ? `#${r.rank}` : '—'}<span className="text-sm font-bold" style={{ color: 'var(--color-text-tertiary)' }}> of {r.of || 0}</span></div>
          <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{r.percentile != null ? `top ${r.percentile}% · ` : ''}you {r.agent_avg ?? '—'} vs team {r.team_avg ?? '—'}</div>
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: outcomes.length ? '3fr 2fr' : '1fr' }}>
        <div className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Score trend (this window)</div>
          {trendPts.length >= 2 ? <Lines series={[{ name: 'Avg score', color: PALETTE[0], points: trendPts }]} yMax={100} yUnit="%" /> : <div className="text-xs py-6 text-center" style={{ color: 'var(--color-text-tertiary)' }}>Not enough days to chart a trend.</div>}
        </div>
        {outcomes.length > 0 && (
          <div className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Call outcomes</div>
            <Donut data={outcomes} centerValue={s.reviews} centerLabel="calls" />
          </div>
        )}
        <div className="p-3 rounded-xl col-span-full" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="text-[10px] font-bold uppercase tracking-wide mb-2 flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Where to improve — vs the team <InfoTip side="right" text="The scorecard questions this agent fails most, and how their miss-rate compares to the team. The bar is the agent's miss-rate; the vertical mark is the team average. Red = worse than the team (coach these first)." />
          </div>
          {!worst.length ? <div className="text-xs py-3" style={{ color: 'var(--color-text-tertiary)' }}>No recurring issues — clean reviews in this range. 🎉</div>
            : <div className="space-y-1.5">
                {worst.map(c => {
                  const worse = c.delta != null && c.delta > 0;
                  return (
                    <div key={c.key} className="flex items-center gap-2">
                      <span className="text-xs truncate" style={{ color: 'var(--color-text-secondary)', width: 210 }} title={c.label}>{c.label}</span>
                      <div className="flex-1 h-2.5 rounded-full overflow-hidden relative" style={{ background: 'var(--color-surface-hover)' }}>
                        <div className="h-full rounded-full" style={{ width: `${c.agent_miss_rate}%`, background: worse ? '#dc2626' : '#d97706' }} />
                        {c.team_miss_rate != null && <div className="absolute top-0 bottom-0" style={{ left: `${Math.min(100, c.team_miss_rate)}%`, width: 2, background: 'var(--color-text)', opacity: 0.55 }} title={`team ${c.team_miss_rate}%`} />}
                      </div>
                      <span className="text-[11px] font-bold tabular-nums whitespace-nowrap" style={{ color: worse ? '#dc2626' : 'var(--color-text-secondary)', width: 128, textAlign: 'right' }}>
                        {c.agent_miss_rate}%{c.team_miss_rate != null && <span className="font-normal" style={{ color: 'var(--color-text-tertiary)' }}> · team {c.team_miss_rate}%</span>}
                      </span>
                    </div>
                  );
                })}
              </div>}
        </div>
      </div>
    </div>
  );
}

// ── the marking sheet ────────────────────────────────────────────────────────
// The scored rows exactly as the QA agent filled them in: one row per review,
// one column per scorecard field, grouped by scorecard (each card has its own
// columns, so TRA and RCM can never share a table). Reads GET /qa/reviews — the
// same endpoint, and the same raw per-field values, that the scoring UI writes.
//
// Column order mirrors SheetScoreRow so the sheet reads like the form that
// produced it: meta → ratings → auto-fail → penalties → tracking → sale
// compliance → outcome → verdict, then the computed columns off the review row.
function sheetColumns(card) {
  const c = card?.criteria;
  if (!c) return [];
  if (Array.isArray(c)) return c.map(x => ({ key: x.key, label: x.label || x.key }));   // legacy weighted card
  // resolveSheetFields IS the sheet's left-to-right order, for both the v1
  // six-array cards and the v2 flat ones — so this table can never drift from
  // the form that produced it.
  const cols = [];
  const seen = new Set();
  const push = (key, label) => { if (!key || seen.has(key)) return; seen.add(key); cols.push({ key, label: label || key }); };
  for (const f of resolveSheetFields(c)) {
    if (f.role === 'outcome')  { push(c.call_outcome?.key,  c.call_outcome?.label  || 'Call_Outcome'); continue; }
    if (f.role === 'verdict')  { push(c.manual_status?.key, c.manual_status?.label || 'QA Overall Status'); continue; }
    push(f.key, f.label);
  }
  if (c.call_outcome)  push(c.call_outcome.key,  c.call_outcome.label  || 'Call_Outcome');
  if (c.manual_status) push(c.manual_status.key, c.manual_status.label || 'QA Overall Status');
  return cols;
}
// computed columns live on the review row itself, not in `values`
const COMPUTED = [
  { key: 'base_score',      label: 'Base_Score' },
  { key: 'autofail_result', label: 'Auto_Fail' },
  { key: 'total_penalty',   label: 'Total_Penalty' },
  { key: 'final_score',     label: 'Final_Score' },
  { key: 'quality_score',   label: 'Quality_Score' },
];

// ── By column ────────────────────────────────────────────────────────────────
// The report that answers "what is the team actually getting wrong". The score
// charts say a call went badly; only this says WHICH question it went badly on.
// Sorted worst-first, because that is the coaching order.
function ColumnReport({ rows, loading, canExportQa, from, to }) {
  const [sortKey, setSortKey] = useState('miss_rate');
  const [dir, setDir] = useState('desc');
  const sortBy = (k) => { if (k === sortKey) setDir(d => (d === 'asc' ? 'desc' : 'asc')); else { setSortKey(k); setDir('desc'); } };
  const sorted = useMemo(() => {
    const v = (r) => {
      const x = r[sortKey];
      return typeof x === 'string' ? x.toLowerCase() : (x ?? -1);
    };
    return [...(rows || [])].sort((a, b) => {
      const A = v(a), B = v(b);
      if (A === B) return String(a.label).localeCompare(String(b.label));
      return (A < B ? -1 : 1) * (dir === 'asc' ? 1 : -1);
    });
  }, [rows, sortKey, dir]);

  if (loading && !rows?.length) return <div className="text-center py-16"><Loader2 className="animate-spin inline" size={22} style={{ color: 'var(--color-text-tertiary)' }} /></div>;
  if (!rows?.length) return <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No column marks in this range. This view builds from the individual scorecard answers your QA team recorded.</div>;

  const COLS = [
    ['label', 'Scorecard column', 'left'],
    ['answered', 'Marked', 'right'],
    ['yes', 'Pass', 'right'],
    ['no', 'Miss', 'right'],
    ['na', 'N/A', 'right'],
    ['miss_rate', 'Miss rate', 'right'],
    ['avg_points', 'Avg pts', 'right'],
    ['max_points', 'Max pts', 'right'],
    ['notes', 'Comments', 'right'],
  ];
  const worst = Math.max(0, ...sorted.map(r => r.miss_rate ?? 0));
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <SectionTitle>Every scorecard column, worst first</SectionTitle>
        {canExportQa && (
          <button onClick={() => {
            const head = COLS.map(c => c[1]).join(',');
            const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
            const lines = [head, ...sorted.map(r => COLS.map(c => esc(r[c[0]])).join(','))];
            const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
            a.download = `qa-column-marking_${from}_${to}.csv`; a.click(); URL.revokeObjectURL(a.href);
          }} className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg"
            style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
            <Download size={13} /> CSV
          </button>
        )}
      </div>
      <div className="rounded-xl overflow-auto" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead className="sticky top-0 z-10" style={{ background: 'var(--color-surface-hover)' }}>
            <tr>
              {COLS.map(([k, label, align]) => (
                <th key={k} onClick={() => sortBy(k)}
                  className={`px-3 py-2 text-[11px] font-bold uppercase select-none cursor-pointer text-${align}`}
                  style={{ color: sortKey === k ? 'var(--color-primary-600)' : 'var(--color-text-tertiary)' }}>
                  <span className="inline-flex items-center gap-0.5">{label}{sortKey === k && <ChevronDown size={11} style={{ transform: dir === 'asc' ? 'rotate(180deg)' : 'none' }} />}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => {
              const miss = r.miss_rate;
              const tint = miss == null ? 'var(--color-text-tertiary)' : miss >= 40 ? 'var(--color-error-600)' : miss >= 15 ? 'var(--color-warning-600)' : 'var(--color-success-600)';
              return (
                <tr key={r.key} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td className="px-3 py-1.5" style={{ color: 'var(--color-text)' }}>
                    {r.label}
                    {/* a column with no right answer is still worth counting, but it
                        is not a pass/fail — say so rather than showing blanks */}
                    {miss == null && <span className="ml-1.5 text-[10px] font-bold px-1 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)' }}>not scored</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{r.answered}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--color-success-600)' }}>{r.yes ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--color-error-600)' }}>{r.no ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>{r.na}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-bold" style={{ color: tint }}>
                    {miss == null ? '—' : `${miss}%`}
                    {/* a bar so the worst columns are findable without reading numbers */}
                    {miss != null && worst > 0 && (
                      <span className="inline-block ml-1.5 align-middle rounded" style={{ width: 40, height: 5, background: 'var(--color-surface-hover)' }}>
                        <span className="block rounded h-full" style={{ width: `${Math.round((miss / worst) * 100)}%`, background: tint }} />
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{r.avg_points ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>{r.max_points ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>{r.notes || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
        Miss rate counts only the marks that were decided — an N/A is not a failure and never drags the number down.
        Open <b>Marking sheet</b> for the individual calls behind any column.
      </p>
    </div>
  );
}

function ReviewSheet({ companyId, workType, subjectRole, reviewerId, agentSel, dateFrom, dateTo, canExportQa }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  // `agentSel` is the row from data.agents. /qa/reviews keys the reviewed person
  // on subject_user_id (a CRM account) and falls back to matching the resolved
  // display label — dialer-only agents have no account, so both paths matter.
  const subjectId = agentSel?.subject_user_id || '';
  const agentLabel = agentSel && !agentSel.subject_user_id ? (agentSel.name || '') : '';

  useEffect(() => {
    setLoading(true);
    const params = {};
    if (companyId)   params.company_id = companyId;
    if (workType)    params.work_type = workType;
    if (subjectRole) params.subject_role = subjectRole;
    if (reviewerId)  params.reviewer_id = reviewerId;
    if (subjectId)   params.subject_user_id = subjectId;
    if (agentLabel)  params.agent = agentLabel;
    if (dateFrom)    params.date_from = dateFrom;
    if (dateTo)      params.date_to = dateTo;
    client.get('qa/reviews', { params })
      .then(r => setD(r.data)).catch(() => setD(null)).finally(() => setLoading(false));
  }, [companyId, workType, subjectRole, reviewerId, subjectId, agentLabel, dateFrom, dateTo]);

  if (loading && !d) return <div className="text-center py-16"><Loader2 className="animate-spin inline" size={22} style={{ color: 'var(--color-text-tertiary)' }} /></div>;
  const rows = d?.reviews || [];
  if (!rows.length) return <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No scored reviews match these filters. The sheet fills in as your QA team marks calls.</div>;

  // group by scorecard — one table per card, because the columns ARE the card
  const groups = {};
  for (const r of rows) (groups[r.scorecard_id || 'none'] ||= []).push(r);

  const csv = (cardId, cols, list, cardName) => {
    // every column exports its MARK and, right after it, the comment the reviewer
    // left on that mark — the export is the record, so it carries the reasons too
    const head = ['Date', 'Method', 'Reviewed', 'Side', 'QA agent', 'Customer',
      ...cols.flatMap(c => [c.label, `${c.label} — comment`]),
      ...COMPUTED.map(c => c.label), 'Result', 'Notes'];
    const esc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [head.map(esc).join(',')];
    for (const r of list) lines.push([
      r.call_date ? new Date(r.call_date).toLocaleDateString() : '',
      SLOT_LABEL[r.work_type] || r.work_type || r.method || '',
      r.agent || r.subject_name || '', r.subject_role || '', r.reviewer_name || '', r.customer_name || '',
      ...cols.flatMap(c => [(c.fromMeta ? r.meta?.[c.key] : r.values?.[c.key]) ?? '', r.notes?.[c.key] ?? '']),
      ...COMPUTED.map(c => r[c.key] ?? ''),
      r.passed === true ? 'Pass' : r.passed === false ? 'Fail' : (r.autofail_result || ''),
      r.overall_notes || '',
    ].map(esc).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `qa-marking-sheet_${(cardName || cardId).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}_${dateFrom || 'all'}_${dateTo || 'all'}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const th = { padding: '6px 8px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.02em', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', textAlign: 'left', borderBottom: '1px solid var(--color-border)' };
  const td = { padding: '6px 8px', fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', borderTop: '1px solid var(--color-border)' };

  return (
    <div className="space-y-4">
      {d?.truncated && (
        <div className="text-xs font-semibold px-3 py-2 rounded-xl m-0" style={{ background: 'color-mix(in srgb, var(--color-warning-600) 12%, transparent)', color: 'var(--color-warning-700)', border: '1px solid color-mix(in srgb, var(--color-warning-600) 30%, transparent)' }}>
          Showing the {d.cap} most recent reviews — there are more in this range. Narrow the dates, the company or the method to see the rest.
        </div>
      )}
      {Object.entries(groups).map(([cardId, list]) => {
        const card = d?.scorecards?.[cardId] || null;
        const cols = sheetColumns(card);
        return (
          <div key={cardId}>
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
              <div className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Table2 size={15} />{card?.name || 'Reviews'}
                <span className="text-[11px] font-normal" style={{ color: 'var(--color-text-tertiary)' }}>{list.length} scored{card?.method ? ` · ${String(card.method).toUpperCase()}` : ''}</span>
              </div>
              {canExportQa && (
                <button onClick={() => csv(cardId, cols, list, card?.name)}
                  className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg"
                  style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}
                  title="Download this sheet exactly as shown, one row per scored review">
                  <Download size={13} /> CSV
                </button>
              )}
            </div>
            <div className="rounded-xl" style={{ border: '1px solid var(--color-border)', overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--color-surface-hover)' }}>
                  <tr>
                    {['Date', 'Method', 'Reviewed', 'Side', 'QA agent', 'Customer'].map(h => <th key={h} style={th}>{h}</th>)}
                    {cols.map(c => <th key={c.key} style={th}>{c.label}</th>)}
                    {COMPUTED.map(c => <th key={c.key} style={{ ...th, color: 'var(--color-primary-600)' }}>{c.label}</th>)}
                    <th style={th}>Result</th>
                    <th style={th}>Reviewer notes</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(r => (
                    <tr key={r.id}>
                      <td style={td}>{r.call_date ? new Date(r.call_date).toLocaleDateString() : '—'}</td>
                      <td style={td}><MethodPill m={r.work_type || r.method} /></td>
                      <td style={{ ...td, color: 'var(--color-text)', fontWeight: 600 }}>{r.agent || r.subject_name || '—'}</td>
                      <td style={td}>{r.subject_role || '—'}</td>
                      <td style={td}>{r.reviewer_name || '—'}</td>
                      <td style={td}>{r.customer_name || '—'}</td>
                      {/* the mark, plus the reviewer's comment ON THAT COLUMN. The
                          comment was recorded and then shown nowhere at all — it is
                          the reason behind the mark, which is the part a manager
                          actually coaches from. Dotted underline = hover for it. */}
                      {cols.map(c => {
                        // a context column's value lives in `meta`, not in the marks
                        const raw = c.fromMeta ? r.meta?.[c.key] : r.values?.[c.key];
                        const note = r.notes?.[c.key];
                        const isComment = c.fromMeta && String(raw ?? '').trim() !== '';
                        return (
                          <td key={c.key}
                            style={{
                              ...td,
                              ...(note ? { borderBottom: '1px dotted var(--color-primary-600)', cursor: 'help' } : null),
                              // written comments get room to be read instead of a
                              // one-line slot that cuts them off
                              ...(c.fromMeta ? { whiteSpace: 'normal', minWidth: 160, maxWidth: 280, color: isComment ? 'var(--color-text)' : 'var(--color-text-tertiary)' } : null),
                            }}
                            title={note || (isComment ? String(raw) : undefined)}>
                            {raw == null || String(raw).trim() === '' ? '—' : String(raw)}
                            {note && <span className="ml-1" style={{ color: 'var(--color-primary-600)', fontWeight: 800 }}>*</span>}
                          </td>
                        );
                      })}
                      {COMPUTED.map(c => <td key={c.key} style={{ ...td, fontWeight: 700, color: 'var(--color-text)' }}>{r[c.key] ?? '—'}</td>)}
                      <td style={{ ...td, fontWeight: 800, color: r.passed === false ? 'var(--color-error-600)' : r.passed === true ? 'var(--color-success-600)' : 'var(--color-text-tertiary)' }}>
                        {r.passed === true ? 'Pass' : r.passed === false ? 'Fail' : (r.autofail_result || '—')}
                      </td>
                      {/* the reviewer's summary of the call — recorded on every
                          review and previously only reachable by reopening it */}
                      <td style={{ ...td, whiteSpace: 'normal', minWidth: 200, maxWidth: 320 }} title={r.overall_notes || undefined}>
                        {r.overall_notes || <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReportsTab({ companyId, companyName = '' }) {
  const { canExport } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  // work_type, NOT method: `method` only ever holds tra|rcm, so filtering by it
  // could not tell closed sale from unclosed sale from RCM — three of the four
  // kinds of work were invisible as separate things.
  const [f, setF] = useState({ work_type: '', agent: '', reviewer: '', subject_role: '', date_from: monthAgo, date_to: today });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('team');   // 'team' overview | 'agent' single-user report | 'sheet' marking sheet | 'columns' per-question marking

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    for (const [k, v] of Object.entries(f)) if (v) params[k] = v;
    if (companyId) params.company_id = companyId;
    client.get('qa/reports', { params }).then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [f, companyId]);
  useEffect(() => { load(); }, [load]);
  const set = (k, v) => setF(o => ({ ...o, [k]: v }));

  const s = data?.summary || {};
  const ts = data?.time_series || [];
  const passFail = [
    { label: 'Pass', value: s.passed || 0, color: '#16a34a' },
    { label: 'Fail', value: s.failed || 0, color: '#dc2626' },
  ];
  // all FOUR kinds of work. This chart used to show two, because closed sale and
  // unclosed sale are both stored under method 'rcm'.
  const wts = data?.work_type_split || {};
  const methodSplit = [
    { label: 'TRA', value: wts.tra || 0, color: '#2563eb' },
    { label: 'Closed sale', value: wts.closer_sales || 0, color: '#059669' },
    { label: 'Unclosed', value: wts.closer_dispo || 0, color: '#dc2626' },
    { label: 'RCM', value: wts.rcm || 0, color: '#d97706' },
  ].filter(x => x.value > 0 || !Object.values(wts).some(Boolean));
  const bucketBars = (data?.buckets || []).map((b, i) => ({ label: b.label, value: b.n, color: ['#dc2626', '#d97706', '#2563eb', '#16a34a'][i] }));
  const scoreSeries = [{ name: 'Avg score', color: PALETTE[0], points: ts.map(d => ({ x: d.date, y: d.avg_score })) }];
  if ((s.passed || 0) + (s.failed || 0) > 0) scoreSeries.push({ name: 'Pass rate', color: '#16a34a', points: ts.map(d => ({ x: d.date, y: d.pass_rate == null ? 0 : d.pass_rate })) });
  const volMax = Math.max(1, ...ts.map(d => d.reviews));
  const byAgent = data?.by_agent || [];
  const closerBars  = byAgent.filter(a => a.role === 'closer').slice(0, 8).map(a => ({ label: a.name, value: a.avg_score }));
  const fronterBars = byAgent.filter(a => a.role === 'fronter').slice(0, 8).map(a => ({ label: a.name, value: a.avg_score }));
  const reviewerBars = (data?.by_reviewer || []).slice(0, 10).map(r => ({ label: r.name, value: r.reviews }));

  const KPI = ({ label, value, tint }) => (
    <div className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{label}</div>
      <div className="text-2xl font-extrabold" style={{ color: tint || 'var(--color-text)' }}>{value}</div>
    </div>
  );

  return (
    <div className="h-full overflow-auto pb-4">
      <div className="max-w-[1480px] mx-auto w-full">
      {/* filters — the shared FilterBar every other list view uses, so QA reads
          as one product with the fronter/manager shells rather than its own
          inline control row. Pills = view mode + fronter/closer side; extras =
          the agent / method / reviewer selects and the export buttons. */}
      <FilterBar
        dateRange={{
          value: { date_from: f.date_from, date_to: f.date_to },
          onChange: v => setF(o => ({ ...o, date_from: v?.date_from || '', date_to: v?.date_to || '' })),
          defaultPreset: '30d',
        }}
        // Clearing resets the selects; FilterBar itself resets the date range, so
        // don't touch the dates here or the two writes fight each other.
        onClearAll={() => setF(o => ({ ...o, work_type: '', agent: '', reviewer: '', subject_role: '' }))}
        activeChips={[
          f.subject_role && { key: 'side', label: f.subject_role === 'fronter' ? 'Fronters only' : 'Closers only', onRemove: () => setF(o => ({ ...o, subject_role: '', agent: '' })) },
          f.agent && { key: 'agent', label: `Agent: ${(data?.agents || []).find(a => a.key === f.agent)?.name || f.agent}`, onRemove: () => set('agent', '') },
          f.work_type && { key: 'work_type', label: `Method: ${SLOT_LABEL[f.work_type] || f.work_type}`, onRemove: () => set('work_type', '') },
          f.reviewer && { key: 'reviewer', label: `QA agent: ${(data?.reviewers || []).find(r => r.id === f.reviewer)?.name || f.reviewer}`, onRemove: () => set('reviewer', '') },
        ].filter(Boolean)}
        statusPills={<>
          <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {[['team', 'Team overview'], ['agent', 'Single agent'], ['columns', 'By column'], ['sheet', 'Marking sheet']].map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)}
                title={k === 'team' ? 'Charts + tables across the whole team'
                     : k === 'agent' ? 'Pick one reviewed fronter/closer for their full performance report'
                     : k === 'columns' ? 'Every scorecard question, and how the team was actually marked on it'
                     : 'The scored rows exactly as the QA agent filled them in — one column per scorecard field'}
                className="px-3 py-1 rounded-lg text-xs font-bold"
                style={{ background: mode === k ? 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' : 'transparent', color: mode === k ? '#fff' : 'var(--color-text-secondary)' }}>{l}</button>
            ))}
          </div>
          {/* Fronter / closer side. Clears the agent too — the selector is rebuilt
              from the filtered rows, so a closer left selected under "Fronters"
              would report zero and look like missing data. */}
          <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {[['', 'All'], ['fronter', 'Fronters'], ['closer', 'Closers']].map(([k, l]) => (
              <button key={k || 'all'} onClick={() => setF(o => ({ ...o, subject_role: k, agent: '' }))}
                title={k ? `Only reviews of ${l.toLowerCase()}` : 'Fronters and closers together'}
                className="px-3 py-1 rounded-lg text-xs font-bold"
                style={{ background: f.subject_role === k ? 'var(--color-primary-600)' : 'transparent', color: f.subject_role === k ? '#fff' : 'var(--color-text-secondary)' }}>{l}</button>
            ))}
          </div>
        </>}
        extras={<>
        <FilterSelect value={f.agent} onChange={e => set('agent', e.target.value)} title={mode === 'agent' ? 'Pick the agent to report on' : 'Reviewed agent — the fronter or closer whose call was scored'}>
          <option value="">{mode === 'agent' ? 'Pick an agent…' : 'All agents'}</option>
          {(data?.agents || []).map(a => <option key={a.key} value={a.key}>{a.name}{!f.subject_role && a.role ? ` · ${a.role}` : ''}</option>)}
        </FilterSelect>
        <FilterSelect value={f.work_type} onChange={e => set('work_type', e.target.value)} title="Method — all four kinds of QA work">
          <option value="">All methods</option>
          {Object.entries(SLOT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </FilterSelect>
        <FilterSelect value={f.reviewer} onChange={e => set('reviewer', e.target.value)} title="Scored by — which QA agent did the marking">
          <option value="">Any QA agent</option>
          {(data?.reviewers || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </FilterSelect>
        <button onClick={load} className="p-2 rounded-lg" style={{ background: 'var(--color-surface-hover)' }} title="Refresh"><RefreshCw size={14} style={{ color: 'var(--color-text-secondary)' }} /></button>
        {canExport('qa') && (
        <button onClick={() => {
            // THE deliverable: one row per reviewed fronter/closer — the users
            // whose quality this department exists to assure.
            const rows = data?.by_agent || [];
            if (!rows.length) return toast.error('No agent data to export yet');
            const lines = [['Agent (reviewed user)', 'Reviews', 'Passed', 'Pass rate %', 'Avg score'].join(',')];
            for (const a of rows) lines.push([a.name, a.reviews, a.passed, a.pass_rate ?? '', a.avg_score].map(v => { const s2 = String(v ?? ''); return /[",\n]/.test(s2) ? '"' + s2.replace(/"/g, '""') + '"' : s2; }).join(','));
            const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
            const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob);
            a2.download = `qa-agent-report_${f.date_from}_${f.date_to}.csv`; a2.click(); URL.revokeObjectURL(a2.href);
          }}
          className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg"
          style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}
          title="Download the per-agent quality report as CSV (one row per reviewed fronter/closer)">
          <Download size={13} /> CSV
        </button>
        )}
        {canExport('qa') && (
        <button onClick={async () => {
            if (!data?.summary?.reviews) return toast.error('No scored reviews to export yet');
            try {
              const { exportQaReportPdf } = await import('../utils/qaReportPdf');
              exportQaReportPdf({ data, filters: f, companyName });
            } catch (e) { toast.error('Could not build the PDF'); console.error(e); }
          }}
          className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg text-white"
          style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' }}
          title="Download a compact PDF: agent performance with charts and a full breakdown table">
          <Download size={13} /> PDF report
        </button>
        )}
        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>from scored reviews only</span>
        </>}
      />

      {mode === 'columns'
        ? <ColumnReport rows={data?.by_criterion || []} loading={loading} canExportQa={canExport('qa')} from={f.date_from} to={f.date_to} />
        : mode === 'sheet'
        ? <ReviewSheet
            companyId={companyId}
            workType={f.work_type}
            subjectRole={f.subject_role}
            reviewerId={f.reviewer}
            agentSel={(data?.agents || []).find(a => a.key === f.agent) || null}
            dateFrom={f.date_from}
            dateTo={f.date_to}
            canExportQa={canExport('qa')}
          />
        : mode === 'agent'
        ? (() => {
            const sel = (data?.agents || []).find(a => a.key === f.agent);
            return (f.agent && sel?.subject_user_id)
              ? <AgentReport subjectId={sel.subject_user_id} subjectName={sel.name} companyId={companyId} from={f.date_from} to={f.date_to} />
              : <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>{f.agent ? 'This agent has raw dialer reviews only (no CRM account link), so the deep report isn’t available — use Team overview for them.' : 'Choose an agent in the dropdown above to open their full performance report.'}</div>;
          })()
        : loading && !data ? <div className="text-center py-16"><Loader2 className="animate-spin inline" size={22} style={{ color: 'var(--color-text-tertiary)' }} /></div>
        : !s.reviews ? <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No scored reviews in this range. Reports build from the calls your QA team has scored.</div>
        : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <KPI label="Reviews" value={s.reviews || 0} />
              <KPI label="Pass rate" value={`${s.pass_rate || 0}%`} tint={(s.pass_rate || 0) >= 80 ? 'var(--color-success-600)' : 'var(--color-error-600)'} />
              <KPI label="Avg score" value={`${s.avg_score || 0}%`} />
              <KPI label="Passed" value={s.passed || 0} tint="var(--color-success-600)" />
              <KPI label="Failed" value={s.failed || 0} tint="var(--color-error-600)" />
            </div>

            <SectionTitle>Trends over time</SectionTitle>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-4">
              <ChartCard title="Score & pass rate" hint="Average score per day (and pass rate, when there are pass/fail decisions) across the range."><Lines series={scoreSeries} yMax={100} yUnit="%" /></ChartCard>
              <ChartCard title="Reviews per day" hint="How many calls your QA team scored each day."><Lines series={[{ name: 'Reviews', color: PALETTE[2], points: ts.map(d => ({ x: d.date, y: d.reviews })) }]} yMax={volMax} /></ChartCard>
            </div>

            <SectionTitle>Quality breakdown</SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <ChartCard title="Pass vs Fail"><Donut data={passFail} centerValue={`${s.pass_rate || 0}%`} centerLabel="pass" /></ChartCard>
              <ChartCard title="Method mix"><Donut data={methodSplit} centerValue={s.reviews} centerLabel="reviews" /></ChartCard>
              <ChartCard title="Score distribution"><Bars data={bucketBars} /></ChartCard>
            </div>

            <SectionTitle>People — average score &amp; activity</SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ChartCard title="Closers — avg score" hint="Closers with the most reviews; bar = their average score. Click a name in the table below for the full report.">{closerBars.length ? <Bars data={closerBars} max={100} unit="%" color="#059669" /> : <NoData />}</ChartCard>
              <ChartCard title="Fronters — avg score" hint="Fronters (transfer agents) with the most reviews; bar = their average score.">{fronterBars.length ? <Bars data={fronterBars} max={100} unit="%" color="#2563eb" /> : <NoData />}</ChartCard>
              <ChartCard title="QA agents — reviews" hint="Who did the scoring, by number of reviews completed.">{reviewerBars.length ? <Bars data={reviewerBars} color={PALETTE[4]} /> : <NoData />}</ChartCard>
            </div>

            {/* full breakdown table */}
            <div className="mt-4 rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <table className="w-full text-sm">
                <thead><tr style={{ background: 'var(--color-surface-hover)' }}>{['Agent reviewed', 'Reviews', 'Pass rate', 'Avg score'].map(h => <th key={h} className="text-left px-3 py-2 text-[11px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{h}</th>)}</tr></thead>
                <tbody>{(data.by_agent || []).map(a => (
                  <tr key={a.key} onClick={() => set('agent', a.key)} className="cursor-pointer" style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{a.name}</td>
                    <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{a.reviews}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold" style={{ color: a.pass_rate == null ? 'var(--color-text-tertiary)' : a.pass_rate >= 80 ? 'var(--color-success-600)' : 'var(--color-error-600)' }}>{a.pass_rate == null ? '—' : `${a.pass_rate}%`}</td>
                    <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{a.avg_score}%</td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Visual scorecard field editor (sheet_v2) — add/remove/label fields, set
// which are 0-4 ratings vs Y/N, edit thresholds. Editing a GLOBAL template saves
// a company-scoped COPY (overrides the template for this company only). ────────
const slug = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || ('f' + Date.now());

// ── the sheet's column model, in the editor ─────────────────────────────────
// A column has a ROLE (how it scores) and an INPUT (what the reviewer clicks),
// and they are independent. That is what lets any column move to any group, and
// any column be Y/N, a 1–5 scale or a 5/10/15/20/25 list, in any combination.
const ROLE_META = [
  { id: 'meta',     label: 'Details',         short: 'detail',  tint: '#0891b2',
    info: 'Context columns filled in automatically from the call and the CRM record — agent, centre, duration, phone. Pick the source per column; the reviewer can still edit any cell. Never scored.' },
  { id: 'score',    label: 'Ratings',         short: 'scored',  tint: '#2563eb',
    info: 'The graded questions. Whatever the input is — a 1–5 scale, a 5/10/15/20/25 list, even Yes/No — the value it earns is summed into the Base Score when “in base” is on.' },
  { id: 'autofail', label: 'Auto-Fail',       short: 'gate',    tint: '#dc2626',
    info: 'Hard compliance rules. A single failing answer fails the whole call regardless of the ratings.' },
  { id: 'penalty',  label: 'Penalties',       short: 'deduct',  tint: '#d97706',
    info: 'Mistakes that cost points without failing the call. Each Yes subtracts its point value.' },
  { id: 'tracking', label: 'Tracking',        short: 'no score', tint: '#6b7280',
    info: 'Answered for reporting only. Never changes the score.' },
  { id: 'quality',  label: 'Sale compliance', short: 'checklist', tint: '#059669',
    info: 'A Yes/No checklist scored as a percentage — the Quality score is the share answered Yes.' },
  { id: 'outcome',  label: 'Call outcome',    short: 'dropdown', tint: '#7c3aed',
    info: 'Where the Call Outcome dropdown sits on the sheet. Its options are edited in the Call outcome box below; this only pins the column’s position.' },
  { id: 'verdict',  label: 'QA verdict',      short: 'verdict', tint: '#2563eb',
    info: 'Where the reviewer’s manual Pass/Fail sits on the sheet. When a card has one, it IS the pass/fail.' },
];
const roleMeta = (id) => ROLE_META.find(r => r.id === id) || ROLE_META[0];

const INPUT_KINDS = [
  { v: 'text',   label: 'Free text' },
  { v: 'date',   label: 'Date' },
  { v: 'yn',     label: 'Yes / No' },
  { v: 'scale',  label: 'Number scale (1–5, 0–4 …)' },
  { v: 'choice', label: 'Pick from a list (5/10/15/20/25 …)' },
];
const kindLabel = (k) => INPUT_KINDS.find(x => x.v === k)?.label || k;

// A key is the identity every saved qa_review_scores row is filed under, so it
// must be unique on the card and must NEVER change once the column has been
// saved. A brand-new column tracks its label (marked `_new`) until the first
// save stamps it; after that, renaming is label-only.
const uniqueKey = (fields, base, selfIdx) => {
  const taken = new Set(fields.map((f, i) => (i === selfIdx ? null : f.key)).filter(Boolean));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 500; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
  return `${base}_${fields.length + 1}`;
};
const newSheetField = (fields, role, defaults) => ({
  key: uniqueKey(fields, slug('new column'), -1),
  label: 'New column',
  role,
  input: defaultInputFor(role, null),
  _new: true,
  ...(role === 'score' ? { included_in_base: true } : {}),
  ...(role === 'penalty' ? { penalty: -5 } : {}),
  ...(defaults || {}),
});

// The stacked "By type" view. It edits the SAME flat list the sheet view does —
// it just filters it to one role — so the two views can never disagree.
function FieldRows({ title, tint, role, fields, onChange, extra, info }) {
  const set = (i, patch) => onChange(fields.map((f, j) => j === i ? { ...f, ...patch } : f));
  const remove = i => onChange(fields.filter((_, j) => j !== i));
  // a new column lands beside its own kind, not at the far right of the sheet
  const add = () => {
    let last = -1;
    fields.forEach((f, i) => { if (f.role === role) last = i; });
    const next = [...fields];
    next.splice(last < 0 ? fields.length : last + 1, 0, newSheetField(fields, role, extra?.defaults));
    onChange(next);
  };
  const rows = fields.map((f, i) => ({ f, i })).filter(x => x.f.role === role);
  return (
    <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full" style={{ background: tint }} />
        <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{title}</span>
        {info && <InfoTip text={info} />}
        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)' }}>{extra?.kind}</span>
        <button onClick={add} className="ml-auto text-[11px] font-bold px-2 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: tint }}>+ add</button>
      </div>
      <div className="space-y-1.5">
        {rows.map(({ f, i }) => (
          <div key={f.key || i} className="flex items-center gap-2">
            {/* renaming NEVER renumbers a saved column — that would orphan every
                review already filed under the old key */}
            <input value={f.label ?? ''} onChange={e => set(i, { label: e.target.value, ...(f._new ? { key: uniqueKey(fields, slug(e.target.value), i) } : {}) })} style={{ ...inp, flex: 1 }} />
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)' }}>{kindLabel(f.input?.kind)}</span>
            {extra?.rating && (
              <label className="flex items-center gap-1 text-[11px] whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                <input type="checkbox" checked={f.included_in_base !== false} onChange={e => set(i, { included_in_base: e.target.checked })} /> in base
                <InfoTip side="right" w={210} text="When on, this rating (0–4) counts toward the Base Score. Turn off to show the question but keep it out of the score math." />
              </label>
            )}
            {extra?.penalty && (
              <label className="flex items-center gap-1 text-[11px] whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                <input type="number" value={f.penalty ?? -5} onChange={e => set(i, { penalty: +e.target.value })} style={{ ...inp, width: 60 }} />
                <InfoTip side="right" w={210} text="Points deducted from the final score when the reviewer marks this flag Yes. Use a negative number (e.g. -5)." />
              </label>
            )}
            <button onClick={() => remove(i)} className="p-1 rounded" title="Remove"><XCircle size={15} style={{ color: 'var(--color-error-600)' }} /></button>
          </div>
        ))}
        {!rows.length && <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>No columns of this type yet — click “+ add”, or move an existing one here from the Sheet header view.</div>}
      </div>
    </div>
  );
}

// The client's own evaluation sheets — one loadable layout per method — plus
// applyPresetFields, live in utils/qaSheetPresets so the migration that writes
// them onto the live cards is generated from the SAME definition this button
// loads. See that file's header.

// Editor for the sheet's "Call Outcome" dropdown — the list the reviewer picks
// after scoring. One-click fill from the WaveTech list, add/edit/remove options.
function CallOutcomeEditor({ value, onChange }) {
  const co = value && typeof value === 'object' ? value : null;
  if (!co) {
    return (
      <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: '#7c3aed' }} />
          <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>Call outcome</span>
          <InfoTip text="An optional single-choice dropdown the reviewer picks after scoring to label WHY the call ended (e.g. No Consent, Windowshop). It doesn’t change the score — it’s used for reporting and coaching." />
          <button onClick={() => onChange({ key: 'call_out_come', label: 'Call Outcome', options: [...WAVETECH_OUTCOMES] })}
            className="ml-auto text-[11px] font-bold px-2 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: '#7c3aed' }}>+ add (WaveTech list)</button>
        </div>
        <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Optional dropdown the reviewer picks after scoring (why the call ended).</div>
      </div>
    );
  }
  const opts = Array.isArray(co.options) ? co.options : [];
  const set = (i, v) => onChange({ ...co, options: opts.map((o, j) => j === i ? v : o) });
  return (
    <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full" style={{ background: '#7c3aed' }} />
        <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>Call outcome options</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)' }}>{opts.length}</span>
        <button onClick={() => onChange({ ...co, options: [...WAVETECH_OUTCOMES] })} className="text-[11px] font-bold px-2 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: '#7c3aed' }} title="Load the WaveTech sheet's list">WaveTech list</button>
        <button onClick={() => onChange({ ...co, options: [...opts, 'New outcome'] })} className="ml-auto text-[11px] font-bold px-2 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: '#7c3aed' }}>+ add</button>
        <button onClick={() => onChange(null)} className="text-[11px] font-bold" style={{ color: 'var(--color-error-600)' }} title="Remove the call-outcome field">remove</button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-auto">
        {opts.map((o, i) => (
          <div key={i} className="flex items-center gap-1">
            <input value={o} onChange={e => set(i, e.target.value)} style={{ ...inp, flex: 1, fontSize: 12, padding: '4px 8px' }} />
            <button onClick={() => onChange({ ...co, options: opts.filter((_, j) => j !== i) })}><XCircle size={14} style={{ color: 'var(--color-error-600)' }} /></button>
          </div>
        ))}
        {!opts.length && <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>No options — add some or load the WaveTech list.</div>}
      </div>
    </div>
  );
}

// ── Sheet-header editor ──────────────────────────────────────────────────────
// The scorecard AS THE SPREADSHEET IT IS: one header cell per column, left to
// right, in the exact order SheetScoreRow renders them when a reviewer scores a
// call. Rename a header in place, move it, delete it, add one — and for the
// detail columns, say where the value is fetched from.
//
// This replaces reading a stack of vertical lists and trying to picture the
// sheet. The row of cells IS the sheet's header row.
//
// Note meta_fields — the detail columns (Fronter_Center, Call_ID, CLI, Date) —
// had NO editor anywhere before this. They could only be changed by editing the
// JSON directly, which is why "change the names of the header" was impossible.
// Human label for a saved source token, so the cell can show its mapping.
const sourceLabel = (src) => {
  if (!src) return 'auto (by name)';
  if (src.startsWith('vici:')) {
    const f = src.slice(5);
    const known = VICI_STANDARD_FIELDS.find(([n]) => n === f);
    return `Dialer · ${known ? known[1] : f}`;
  }
  if (src.startsWith('crm:')) return `CRM · ${src.slice(4)}`;
  return AUTOFILL_SOURCES.find(s => s.v === src)?.label || src;
};

function SheetHeaderEditor({ cfg, patch, ratingMin, ratingScale }) {
  const [openCol, setOpenCol] = useState(null);   // `${groupId}:${index}` whose options are expanded
  // The dialer's own lead fields — including the LIST CUSTOM fields where the
  // vehicle data (VIN, make, model, year, mileage) lives. Discovered from the
  // dialer rather than typed from memory, and offered on EVERY method's card.
  const [viciNames, setViciNames] = useState(null);   // null = loading, [] = none reachable
  useEffect(() => {
    let alive = true;
    client.get('qa/vici-field-names')
      .then(r => { if (alive) setViciNames(r.data.names || []); })
      .catch(() => { if (alive) setViciNames([]); });
    return () => { alive = false; };
  }, []);

  // ONE flat, ordered list — the sheet's header row, left to right. A column's
  // position no longer implies its type, so ‹ › walks the WHOLE sheet and the
  // group is just another property you can change.
  const fields = cfg.fields || [];
  const setFields = (next) => patch(n => { n.fields = next; });
  const setField = (i, p) => setFields(fields.map((f, j) => j === i ? { ...f, ...p } : f));
  // The key is the stable identity every saved review's raw_value is stored
  // under. Renaming the LABEL must never renumber a saved column, or the rename
  // silently orphans its history. Only a column that has never been saved
  // (`_new`) still takes its key from the label.
  const rename = (i, label) => setField(i, { label, ...(fields[i]._new ? { key: uniqueKey(fields, slug(label), i) } : {}) });
  const move = (i, d) => {
    const l = [...fields]; const t = i + d;
    if (t < 0 || t >= l.length) return;
    [l[i], l[t]] = [l[t], l[i]];
    setFields(l);
  };
  const remove = (i) => setFields(fields.filter((_, j) => j !== i));
  const add = () => setFields([...fields, newSheetField(fields, 'meta')]);

  // Moving a column to another group keeps its input when that still makes
  // sense, and swaps it for the group's natural one when it doesn't — a text box
  // in the Auto-Fail group could never be answered Y/N.
  const setRole = (i, role) => {
    const f = fields[i];
    const kind = f.input?.kind;
    const p = { role };
    if (role === 'score' && (kind === 'text' || kind === 'date')) p.input = { kind: 'scale', min: ratingMin, max: ratingScale, step: 1 };
    if ((role === 'autofail' || role === 'penalty' || role === 'quality') && kind !== 'yn') p.input = { kind: 'yn' };
    if ((role === 'outcome' || role === 'verdict') && kind !== 'choice') p.input = { kind: 'choice', options: [] };
    if (role === 'score') p.included_in_base = f.included_in_base !== false;
    if (role === 'penalty' && f.penalty == null) p.penalty = -5;
    setField(i, p);
  };
  const setKind = (i, kind) => {
    const f = fields[i];
    const input = kind === 'scale'
      ? { kind: 'scale', min: f.input?.min ?? ratingMin, max: f.input?.max ?? ratingScale, step: 1 }
      : kind === 'choice'
        ? { kind: 'choice', options: (f.input?.options?.length ? f.input.options : ['5', '10', '15', '20', '25']) }
        : { kind };
    setField(i, { input });
  };

  const cell = { minWidth: 158, maxWidth: 158 };
  // outcome/verdict placed inline take their label from the singleton config
  const labelOf = (f) => (f.role === 'outcome' ? (cfg.call_outcome?.label || 'Call Outcome')
    : f.role === 'verdict' ? (cfg.manual_status?.label || 'QA Overall Status')
      : (f.label ?? ''));
  const placed = { outcome: fields.some(f => f.role === 'outcome'), verdict: fields.some(f => f.role === 'verdict') };

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>Sheet header</span>
        <InfoTip w={360} text="This is the header row of the sheet your reviewers fill in, left to right — exactly the order they see while scoring. Click a name to rename it, use ‹ › to move a column ANYWHERE on the sheet, ⚙ to change its group (how it scores), its input (Yes/No, a number scale, a list) and where it fetches from, and ✕ to delete it." />
        {ROLE_META.map(g => (
          <span key={g.id} className="inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: g.tint }} />{g.label}
          </span>
        ))}
      </div>

      <div className="rounded-xl" style={{ border: '1px solid var(--color-border)', overflowX: 'auto', background: 'var(--color-surface)' }}>
        <div className="flex items-stretch" style={{ width: 'max-content' }}>
          {fields.map((f, i) => {
            const g = roleMeta(f.role);
            const open = openCol === i;
            const isSingleton = f.role === 'outcome' || f.role === 'verdict';
            return (
              <div key={f.key || i} className="flex flex-col" style={{ ...cell, borderRight: '1px solid var(--color-border)' }}>
                {/* the coloured cap is the column's group, at a glance */}
                <div style={{ height: 3, background: g.tint }} />
                <div className="px-1.5 pt-1.5 pb-1 flex flex-col gap-1 h-full">
                  <input
                    value={labelOf(f)}
                    onChange={e => (isSingleton
                      ? patch(n => { const box = f.role === 'outcome' ? n.call_outcome : n.manual_status; if (box) box.label = e.target.value; })
                      : rename(i, e.target.value))}
                    title={`Column key: ${f.key} — this is what saved reviews are stored under and it never changes when you rename`}
                    className="text-[11px] font-bold w-full"
                    style={{ background: 'transparent', border: '1px solid transparent', borderRadius: 6, padding: '3px 4px', color: 'var(--color-text)' }}
                    onFocus={e => { e.target.style.borderColor = 'var(--color-primary-600)'; e.target.style.background = 'var(--color-bg)'; }}
                    onBlur={e => { e.target.style.borderColor = 'transparent'; e.target.style.background = 'transparent'; }}
                  />
                  <div className="flex items-center gap-0.5">
                    <span className="text-[9px] font-bold px-1 rounded truncate" title={`${g.label} — ${kindLabel(f.input?.kind)}`}
                      style={{ background: `color-mix(in srgb, ${g.tint} 14%, transparent)`, color: g.tint }}>{g.short}</span>
                    {/* ‹ › walk the WHOLE sheet now — a column is no longer trapped
                        inside the group it was created in */}
                    <button onClick={() => move(i, -1)} disabled={i === 0} title="Move left"
                      className="px-1 text-[11px] font-bold" style={{ color: i === 0 ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)', opacity: i === 0 ? 0.4 : 1 }}>‹</button>
                    <button onClick={() => move(i, 1)} disabled={i === fields.length - 1} title="Move right"
                      className="px-1 text-[11px] font-bold" style={{ color: i === fields.length - 1 ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)', opacity: i === fields.length - 1 ? 0.4 : 1 }}>›</button>
                    <button onClick={() => setOpenCol(open ? null : i)} title="Column options — group, input type, source"
                      className="px-1 text-[11px] font-bold" style={{ color: open ? g.tint : 'var(--color-text-tertiary)' }}>⚙</button>
                    <button onClick={() => remove(i)} title="Delete this column" className="ml-auto">
                      <XCircle size={12} style={{ color: 'var(--color-error-600)' }} />
                    </button>
                  </div>

                  {/* The mapping, visible ON the cell — no click needed to see
                      what is wired and what is still guessing by name. */}
                  {!isSingleton && (
                    <button onClick={() => setOpenCol(open ? null : i)}
                      className="text-[9px] font-bold text-left truncate"
                      title={f.source ? `Fetches from: ${sourceLabel(f.source)}` : 'No source set — filled by matching the column name. Click to map it.'}
                      style={{ color: f.source ? g.tint : 'var(--color-text-tertiary)' }}>
                      {f.source ? `← ${sourceLabel(f.source)}` : '← auto (by name)'}
                    </button>
                  )}

                  {open && (
                    <div className="flex flex-col gap-1 pt-1" style={{ borderTop: '1px dashed var(--color-border)' }}>
                      <label className="flex flex-col gap-0.5 text-[9px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>
                        GROUP (how it scores)
                        <ThemedSelect value={f.role} onChange={e => setRole(i, e.target.value)}
                          style={{ ...inp, width: '100%', fontSize: 11, padding: '3px 6px' }}>
                          {ROLE_META.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                        </ThemedSelect>
                      </label>
                      {!isSingleton && (
                        <label className="flex flex-col gap-0.5 text-[9px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>
                          INPUT (what the reviewer picks)
                          <ThemedSelect value={f.input?.kind || 'text'} onChange={e => setKind(i, e.target.value)}
                            style={{ ...inp, width: '100%', fontSize: 11, padding: '3px 6px' }}>
                            {INPUT_KINDS.map(k => <option key={k.v} value={k.v}>{k.label}</option>)}
                          </ThemedSelect>
                        </label>
                      )}
                      {f.input?.kind === 'scale' && (
                        <label className="flex items-center gap-1 text-[9px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>
                          FROM
                          <input type="number" value={f.input.min ?? 0} onChange={e => setField(i, { input: { ...f.input, min: +e.target.value } })}
                            style={{ ...inp, width: 44, fontSize: 11, padding: '2px 4px' }} />
                          TO
                          <input type="number" value={f.input.max ?? 5} onChange={e => setField(i, { input: { ...f.input, max: +e.target.value } })}
                            style={{ ...inp, width: 44, fontSize: 11, padding: '2px 4px' }} />
                        </label>
                      )}
                      {f.input?.kind === 'choice' && !isSingleton && (
                        <label className="flex flex-col gap-0.5 text-[9px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>
                          OPTIONS (comma separated)
                          <input value={(f.input.options || []).join(', ')}
                            onChange={e => setField(i, { input: { ...f.input, options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })}
                            title="A numeric option scores itself — 5, 10, 15, 20, 25 needs nothing else. Text options score 0 unless the card maps them."
                            style={{ ...inp, width: '100%', fontSize: 11, padding: '3px 6px' }} />
                        </label>
                      )}
                      {isSingleton && (
                        <div className="text-[9px] font-normal" style={{ color: 'var(--color-text-tertiary)' }}>
                          The options for this column are edited in the “{f.role === 'outcome' ? 'Call outcome' : 'QA verdict'}” box below — here you only choose where it sits.
                        </div>
                      )}
                      {f.role === 'score' && (
                        <label className="flex items-center gap-1 text-[9px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>
                          <input type="checkbox" checked={f.included_in_base !== false} onChange={e => setField(i, { included_in_base: e.target.checked })} /> IN BASE
                        </label>
                      )}
                      {f.role === 'penalty' && (
                        <label className="flex items-center gap-1 text-[9px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>
                          PTS
                          <input type="number" value={f.penalty ?? -5} onChange={e => setField(i, { penalty: +e.target.value })}
                            style={{ ...inp, width: 52, fontSize: 11, padding: '2px 4px' }} />
                        </label>
                      )}
                      {!isSingleton && (
                        <label className="flex flex-col gap-0.5 text-[9px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>
                          FETCH FROM
                          <ThemedSelect value={f.source || ''} onChange={e => setField(i, { source: e.target.value })}
                            style={{ ...inp, width: '100%', fontSize: 11, padding: '3px 6px' }}>
                            {AUTOFILL_SOURCES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                            {/* Standard lead columns — always offered, because
                                this dialer keeps the vehicle data in them. */}
                            {VICI_STANDARD_FIELDS.map(([n, l]) => <option key={`vici:${n}`} value={`vici:${n}`}>Dialer · {l}</option>)}
                            {/* Custom fields, when a box was reachable to list them. */}
                            {(viciNames || []).filter(n => !VICI_STANDARD_FIELDS.some(([s]) => s === n))
                              .map(n => <option key={`vicic:${n}`} value={`vici:${n}`}>Dialer (custom) · {n}</option>)}
                            {/* A source already saved but no longer offered (box
                                down, or the list changed) must still show, or
                                opening the editor would silently reset it. */}
                            {f.source && f.source.startsWith('vici:')
                              && !(viciNames || []).includes(f.source.slice(5))
                              && !VICI_STANDARD_FIELDS.some(([s]) => s === f.source.slice(5))
                              && <option value={f.source}>Dialer · {f.source.slice(5)}</option>}
                            {f.source && f.source.startsWith('crm:') && <option value={f.source}>CRM · {f.source.slice(4)}</option>}
                          </ThemedSelect>
                          {viciNames === null && <span className="text-[9px] font-normal" style={{ color: 'var(--color-text-tertiary)' }}>checking for custom fields…</span>}
                        </label>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {/* one add button — the new column's group and input are set on the
              cell itself, so there is nothing to choose up front */}
          <button onClick={add} title="Add a column to the end of the sheet"
            className="flex flex-col items-center justify-center px-2 text-[10px] font-bold gap-0.5"
            style={{ minWidth: 62, color: 'var(--color-primary-600)', background: 'color-mix(in srgb, var(--color-primary-600) 6%, transparent)', borderRight: '1px solid var(--color-border)' }}>
            <Plus size={13} /> column
          </button>

          {/* trailing computed / verdict columns — real columns on the sheet, but
              their values are produced by the formula, not typed, so only the
              heading is editable here. */}
          {/* the outcome dropdown, only when no column has PLACED it inline —
              a card can now decide where on the sheet it belongs */}
          {cfg.call_outcome && !placed.outcome && (
            <div className="flex flex-col" style={{ ...cell, borderRight: '1px solid var(--color-border)' }}>
              <div style={{ height: 3, background: '#7c3aed' }} />
              <div className="px-1.5 pt-1.5 pb-1 flex flex-col gap-1">
                <input value={cfg.call_outcome.label ?? ''} onChange={e => patch(n => { n.call_outcome.label = e.target.value; })}
                  className="text-[11px] font-bold w-full"
                  style={{ background: 'transparent', border: '1px solid transparent', borderRadius: 6, padding: '3px 4px', color: 'var(--color-text)' }} />
                <span className="text-[9px] font-bold px-1 rounded self-start" style={{ background: 'color-mix(in srgb, #7c3aed 14%, transparent)', color: '#7c3aed' }}>dropdown</span>
                <button onClick={() => setFields([...fields, { key: cfg.call_outcome.key, label: cfg.call_outcome.label, role: 'outcome', input: { kind: 'choice', options: [] } }])}
                  className="text-[9px] font-bold text-left" style={{ color: '#7c3aed' }}
                  title="Add it as a column you can move — then ‹ › puts it anywhere on the sheet">place on the sheet →</button>
              </div>
            </div>
          )}
          {cfg.manual_status && !placed.verdict && (
            <div className="flex flex-col" style={{ ...cell, borderRight: '1px solid var(--color-border)' }}>
              <div style={{ height: 3, background: '#2563eb' }} />
              <div className="px-1.5 pt-1.5 pb-1 flex flex-col gap-1">
                <input value={cfg.manual_status.label ?? ''} onChange={e => patch(n => { n.manual_status.label = e.target.value; })}
                  className="text-[11px] font-bold w-full"
                  style={{ background: 'transparent', border: '1px solid transparent', borderRadius: 6, padding: '3px 4px', color: 'var(--color-text)' }} />
                <span className="text-[9px] font-bold px-1 rounded self-start" style={{ background: 'color-mix(in srgb, #2563eb 14%, transparent)', color: '#2563eb' }}>verdict</span>
                <button onClick={() => setFields([...fields, { key: cfg.manual_status.key, label: cfg.manual_status.label, role: 'verdict', input: { kind: 'choice', options: [] } }])}
                  className="text-[9px] font-bold text-left" style={{ color: '#2563eb' }}
                  title="Add it as a column you can move">place on the sheet →</button>
              </div>
            </div>
          )}
          {['Base_Score', 'Auto_Fail', 'Total_Penalty', 'Final_Score'].map(h => (
            <div key={h} className="flex flex-col" style={{ minWidth: 104, borderRight: '1px solid var(--color-border)', background: 'var(--color-surface-hover)' }}>
              <div style={{ height: 3, background: 'var(--color-text-tertiary)' }} />
              <div className="px-2 pt-1.5 pb-1">
                <div className="text-[11px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>{h}</div>
                <span className="text-[9px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>computed</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="text-[10px] mt-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
        Scroll sideways to see every column. Renaming a header never breaks reviews already scored — the stored column key stays the same.
      </div>
    </div>
  );
}

function ScorecardEditor({ scorecard, companyId, onClose, onSaved }) {
  // The editor works on ONE ordered list of columns. A card saved before the
  // per-field model has no `fields`, so resolveSheetFields derives it from the
  // six arrays — same columns, same order, nothing to migrate.
  const [cfg, setCfg] = useState(() => {
    const c = JSON.parse(JSON.stringify(scorecard.criteria || {}));
    c.autofail = c.autofail || { formula_type: 'all_yes', fields: [] };
    c.autofail.fields = c.autofail.fields || [];
    c.fields = resolveSheetFields(c);
    return c;
  });
  const [name, setName] = useState(scorecard.name);
  const [passT, setPassT] = useState(scorecard.pass_threshold ?? '');
  const [busy, setBusy] = useState(false);
  // 'sheet' — the header row as the reviewer sees it (default; this is the sheet).
  // 'sections' — the original stacked lists, kept because per-type bulk edits and
  // the call-outcome option list are easier there.
  const [view, setView] = useState('sheet');
  const isGlobal = !scorecard.company_id;
  const fields = cfg.fields || [];
  const preset = SHEET_PRESETS[scorecard.method] || null;   // the client's own tab for this method
  const hasQuality = !!(cfg.quality_score && Array.isArray(cfg.quality_score.fields)) || fields.some(f => f.role === 'quality');
  // Rating range taken from the first scale-input scoring column (default 1–5
  // per the WaveTech sheets). Columns on a fixed list (5/10/15/20/25) have no
  // min/max, so they are skipped here rather than dragged to a range.
  const firstScale = fields.find(f => f.role === 'score' && f.input?.kind === 'scale');
  const ratingScale = firstScale?.input?.max ?? 5;
  const ratingMin = firstScale?.input?.min ?? 1;

  const patch = fn => setCfg(c => { const n = JSON.parse(JSON.stringify(c)); fn(n); return n; });
  const setRange = (mn, mx) => patch(n => {
    n.fields = (n.fields || []).map(f => (f.role === 'score' && f.input?.kind === 'scale'
      ? { ...f, input: { ...f.input, min: mn, max: mx } } : f));
  });

  const save = async () => {
    // Saving a template is supposed to create a COMPANY copy. With no company
    // selected it posted company_id: null instead — i.e. yet another global
    // template — and since /scorecards is newest-first, that duplicate silently
    // became the card every reviewer got. Three of them piled up that way.
    if (isGlobal && !companyId) {
      toast.error('Pick a company first — a template can only be customised for one company at a time.');
      return;
    }
    setBusy(true);
    try {
      // Write BOTH shapes: the ordered `fields` (canonical) and the six v1
      // arrays projected from it, so anything still reading criteria.meta_fields
      // — old reports, exports, any card opened by an older client — keeps
      // working. `_new` is a UI-only marker and never persists.
      const clean = fields.map(({ _new, ...f }) => f);   // eslint-disable-line no-unused-vars
      const byRole = projectSheetFields(clean);
      const afOrder = cfg.autofail?.formula_type === 'explicit_table'
        ? (cfg.autofail.field_order?.length ? cfg.autofail.field_order : byRole.autofail.map(f => f.key))
        : undefined;
      const criteria = {
        ...cfg, model: 'sheet_v2', fields: clean,
        meta_fields: byRole.meta,
        rating_criteria: byRole.score,
        penalty_flags: byRole.penalty,
        tracking_flags: byRole.tracking,
        autofail: { ...(cfg.autofail || { formula_type: 'all_yes' }), fields: byRole.autofail, ...(afOrder ? { field_order: afOrder } : {}) },
      };
      if (byRole.quality.length) criteria.quality_score = { ...(cfg.quality_score || {}), fields: byRole.quality };
      else delete criteria.quality_score;
      const pt = passT === '' ? null : +passT;
      if (isGlobal) {
        await client.post('qa/scorecards', { company_id: companyId, method: scorecard.method, name: name.includes('(custom)') ? name : `${name} (custom)`, criteria, pass_threshold: pt });
        toast.success('Saved as your company scorecard — it now overrides the template here');
      } else {
        await client.put(`qa/scorecards/${scorecard.id}`, { name, criteria, pass_threshold: pt });
        toast.success('Scorecard updated');
      }
      onSaved?.();
    } catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      {/* full-screen on a phone, centred and capped on a desktop: a scorecard
          is a wide sheet and a 96vw box inside a padded overlay wasted the
          only screen a reviewer on a tablet actually has */}
      <div className="p-4 sm:p-5 overflow-auto w-full h-full sm:h-auto rounded-none sm:rounded-2xl"
        style={{ maxWidth: view === 'sheet' ? 1180 : 720, maxHeight: '100%', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div className="text-base font-bold" style={{ color: 'var(--color-text)' }}>Edit scorecard fields <MethodPill m={scorecard.method} /></div>
          <div className="flex items-center gap-1 p-1 rounded-xl ml-auto" style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)' }}>
            {[['sheet', 'Sheet header'], ['sections', 'By type']].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)}
                title={k === 'sheet' ? 'The header row exactly as the reviewer sees it, left to right' : 'The same fields grouped by question type'}
                className="px-2.5 py-1 rounded-lg text-[11px] font-bold"
                style={{ background: view === k ? 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' : 'transparent', color: view === k ? '#fff' : 'var(--color-text-secondary)' }}>{l}</button>
            ))}
          </div>
          <button onClick={onClose}><XCircle size={20} style={{ color: 'var(--color-text-tertiary)' }} /></button>
        </div>
        {isGlobal && <div className="text-[11px] mb-3 p-2 rounded-lg" style={{ background: 'rgba(217,119,6,0.1)', color: 'var(--color-warning-600)' }}>This is the shared template. Saving creates an editable copy for <b>your company only</b> — the template stays intact.</div>}

        <div className="text-[11px] mb-3 p-2.5 rounded-lg leading-relaxed" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
          A scorecard is the list of questions a reviewer answers for each call. Each colored section below is one <b>type</b> of question — the color dot matches the type. Hover any <Info size={10} className="inline" /> to see exactly how that type affects the score.
        </div>

        <div className="flex gap-2 mb-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Scorecard name" style={{ ...inp, flex: 1 }} />
          <label className="flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>pass ≥ <input type="number" value={passT} onChange={e => setPassT(e.target.value)} style={{ ...inp, width: 64 }} placeholder="none" />%
            <InfoTip side="right" text="The minimum final score a call must reach to count as a Pass. Leave blank for no pass/fail line — the score still shows, just without a pass badge." />
          </label>
        </div>

        {/* scoring settings — the knobs that make the % + auto pass/fail work */}
        <div className="rounded-xl p-3 mb-3 flex flex-wrap items-center gap-x-5 gap-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>Scoring</span>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>Rating scale
            <ThemedSelect value={`${ratingMin}-${ratingScale}`} onChange={e => { const [mn, mx] = e.target.value.split('-').map(Number); setRange(mn, mx); }} style={{ ...inp, width: 84 }}>
              <option value="1-5">1 – 5</option><option value="0-4">0 – 4</option><option value="1-10">1 – 10</option><option value="0-10">0 – 10</option>
            </ThemedSelect>
            <InfoTip side="right" text="The number range for every rating question on this card. The WaveTech sheets use 1–5." />
          </label>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>Base divisor
            <input type="number" value={cfg.base_score_divisor ?? 30} onChange={e => patch(n => { n.base_score_divisor = +e.target.value || 30; })} style={{ ...inp, width: 60 }} />
            <InfoTip side="right" text="Base Score % = (sum of in-base ratings ÷ this divisor) × 100. The WaveTech sheets divide by 30." />
          </label>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>Final score
            <ThemedSelect value={cfg.final_score_formula || 'none'} onChange={e => patch(n => { n.final_score_formula = e.target.value; })} style={{ ...inp, width: 180 }}>
              <option value="base_plus_penalty_truncated">Base % + penalties → Pass/Fail</option>
              <option value="none">No auto score (quality / manual)</option>
            </ThemedSelect>
            <InfoTip side="right" text="How the score is computed. 'Base % + penalties' gives a numeric Final Score + Pass/Fail (set a pass threshold above). 'No auto score' suits checklist or manual-verdict cards." />
          </label>
        </div>

        {/* One click lays out the client's 23-column Unclosed Sale tab — right
            order, right groups, sources already mapped. Nothing is written until
            Save, so it can always be abandoned. */}
        {preset && (
          <div className="flex items-center gap-2 mb-3 p-2.5 rounded-lg flex-wrap" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <span className="text-[11px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>Start from the client’s sheet</span>
            <InfoTip w={340} text="Lays out this method's columns exactly as the client's own workbook tab has them — order, names and groups — with the detail columns already mapped to their source so they fetch themselves. Columns this card already has keep their settings (which ratings count toward the base, penalty values, existing mappings) and their review history. Nothing is saved until you press Save." />
            <button type="button"
              onClick={() => {
                if (fields.length && !window.confirm(`Re-lay this card out as “${preset.label}”?\n\nColumns that share a key keep their history and their scoring settings. Columns not in the layout are removed. Nothing is saved until you press Save.`)) return;
                patch(n => {
                  n.fields = applyPresetFields(n.fields, preset.fields());
                  if (preset.divisor) n.base_score_divisor = preset.divisor;
                  if (preset.outcome) n.call_outcome = { ...preset.outcome, ...(n.call_outcome || {}), key: preset.outcome.key, options: n.call_outcome?.options?.length ? n.call_outcome.options : preset.outcome.options };
                  if (preset.manual_status) n.manual_status = { ...preset.manual_status, ...(n.manual_status || {}), key: n.manual_status?.key || preset.manual_status.key };
                });
                toast.success(`${preset.label} loaded — review the columns, then Save`);
              }}
              className="text-[11px] font-bold px-2.5 py-1 rounded"
              style={{ background: 'var(--color-surface-hover)', color: 'var(--color-primary-600)' }}>
              Load “{preset.label}”
            </button>
          </div>
        )}

        {view === 'sheet' && <SheetHeaderEditor cfg={cfg} patch={patch} ratingMin={ratingMin} ratingScale={ratingScale} />}

        {/* Every section edits the SAME ordered list, filtered to one group, so
            the two views can never drift apart. */}
        {view === 'sections' && <>
        <FieldRows title="Details (auto-filled columns)" tint="#0891b2" role="meta" fields={fields} extra={{ kind: 'detail' }} onChange={v => patch(n => { n.fields = v; })}
          info="The context columns — agent, centre, date, phone, duration. They fill in automatically from the call and the CRM record; set the exact source per column in the Sheet header view." />
        <FieldRows title="Scored questions" tint="#2563eb" role="score" fields={fields} extra={{ kind: `${ratingMin}–${ratingScale} or a list`, rating: true, defaults: { included_in_base: true, input: { kind: 'scale', min: ratingMin, max: ratingScale, step: 1 } } }} onChange={v => patch(n => { n.fields = v; })}
          info={`The graded questions. The ones marked “in base” are summed into the Base Score (then turned into a %). Each one keeps its own input — a ${ratingMin}–${ratingScale} scale, a 5/10/15/20/25 list, or even Yes/No — set it per column in the Sheet header view.`} />
        <FieldRows title="Compliance — Auto-Fail (Yes / No)" tint="#dc2626" role="autofail" fields={fields} extra={{ kind: 'Y / N' }} onChange={v => patch(n => { n.fields = v; })}
          info="Hard compliance rules. If the reviewer answers Yes to ANY auto-fail question, the whole call scores 0 and is marked failed — no matter how good the ratings were. Use for deal-breakers (no consent, DNC, misrepresentation)." />
        <FieldRows title="Penalty flags (Yes = deduct)" tint="#d97706" role="penalty" fields={fields} extra={{ kind: 'Y / N', penalty: true, defaults: { penalty: -5 } }} onChange={v => patch(n => { n.fields = v; })}
          info="Softer mistakes that don’t fail the call but cost points. Each flag set to Yes subtracts its points from the final score. Set the point value per flag on the right of each row." />
        {hasQuality && <FieldRows title="Sale-compliance checklist (Yes / No)" tint="#059669" role="quality" fields={fields} extra={{ kind: 'Y / N' }} onChange={v => patch(n => { n.fields = v; })}
          info="A Yes/No checklist scored as a percentage — the Quality score is the share of items answered Yes. Used on closer/RCM sale reviews to measure sale-compliance separately from the ratings." />}
        <FieldRows title="Tracking only (Yes / No, no score effect)" tint="#6b7280" role="tracking" fields={fields} extra={{ kind: 'Y / N' }} onChange={v => patch(n => { n.fields = v; })}
          info="Questions you want the reviewer to answer for reporting, but that must NOT change the score. Pure data collection — shows up in reports, never adds or removes points." />
        </>}

        {/* The outcome list belongs to both views — the Sheet header can rename
            the column, but the option list is only editable here. */}
        <CallOutcomeEditor value={cfg.call_outcome} onChange={co => patch(n => { if (co) n.call_outcome = co; else delete n.call_outcome; })} />

        <div className="flex items-center justify-end gap-2 mt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>Cancel</button>
          <button onClick={save} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white" style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', opacity: busy ? 0.6 : 1 }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {isGlobal ? 'Save as my company copy' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Per-user transcription access (superadmin / compliance) ──────────────────
// Transcription is OFF for everyone by default; enable it per user here. The
// grant is global (not per-company) — it follows the user wherever they review.
function TranscriptionAccess() {
  const [users, setUsers] = useState(null);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(null);
  const load = useCallback(() => client.get('qa/transcription-access').then(r => setUsers(r.data.users || [])).catch(() => setUsers([])), []);
  useEffect(() => { load(); }, [load]);
  const toggle = async (u) => {
    setSaving(u.user_id);
    try {
      await client.put('qa/transcription-access', { user_id: u.user_id, enabled: !u.enabled });
      setUsers(list => list.map(x => x.user_id === u.user_id ? { ...x, enabled: !x.enabled } : x));
    } catch { toast.error('Could not update transcription access'); }
    finally { setSaving(null); }
  };
  const filtered = (users || []).filter(u => u.name.toLowerCase().includes(q.trim().toLowerCase()));
  const onCount = (users || []).filter(u => u.enabled).length;
  return (
    <div className="mt-6">
      <div className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
        <Mic size={15} style={{ color: 'var(--color-primary-600)' }} /> Transcription access
        <InfoTip side="right" w={300} text="Who can transcribe call recordings. OFF for everyone by default — enable it per user. The transcribe button only appears for enabled users. Superadmins always have it." />
      </div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
        On-demand call transcription is <b>disabled by default</b>. Toggle a user on to let them transcribe recordings. {users && <>· <b>{onCount}</b> enabled</>}
      </div>
      <div className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search users…" style={{ ...inp, width: '100%', marginBottom: 8 }} />
        {users === null ? <div className="py-4 text-center"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div> : (
          <div className="space-y-1 max-h-72 overflow-auto">
            {filtered.map(u => (
              <label key={u.user_id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer" style={{ background: u.enabled ? 'rgba(37,99,235,0.08)' : 'transparent' }}>
                <input type="checkbox" checked={u.enabled} disabled={saving === u.user_id} onChange={() => toggle(u)} />
                <span className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{u.name}</span>
                {saving === u.user_id && <Loader2 size={12} className="animate-spin ml-auto" style={{ color: 'var(--color-text-tertiary)' }} />}
                <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded uppercase" style={u.enabled ? { background: 'rgba(37,99,235,0.15)', color: 'var(--color-primary-600)' } : { background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)' }}>{u.enabled ? 'On' : 'Off'}</span>
              </label>
            ))}
            {!filtered.length && <div className="text-[11px] py-3 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No users match.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Scorecards & Config tab (qa_manager) ─────────────────────────────────────
function ConfigTab({ companyId, companyName }) {
  const [cards, setCards] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [draft, setDraft] = useState({ method: 'tra', name: '', pass_threshold: 80 });
  const [editing, setEditing] = useState(null);
  const loadCards = useCallback(() => client.get('qa/scorecards', { params: { company_id: companyId } }).then(r => setCards(r.data.scorecards || [])).catch(() => setCards([])), [companyId]);
  const loadCfg = useCallback(() => client.get('qa/config', { params: { company_id: companyId } }).then(r => setCfg(r.data.config || {})).catch(() => setCfg({})), [companyId]);
  useEffect(() => { loadCards(); loadCfg(); }, [loadCards, loadCfg]);

  // Create an empty sheet-model scorecard and jump straight into the visual field
  // builder — no raw JSON.
  const createSheet = async () => {
    if (!draft.name) return;
    const starter = { model: 'sheet_v2', rating_criteria: [], autofail: { formula_type: 'all_yes', fields: [] }, penalty_flags: [], tracking_flags: [], base_score_divisor: 30, final_score_formula: 'base_plus_penalty_truncated' };
    try {
      const r = await client.post('qa/scorecards', { company_id: companyId, method: draft.method, name: draft.name, pass_threshold: draft.pass_threshold === '' ? null : +draft.pass_threshold, criteria: starter });
      toast.success('Scorecard created — add its fields');
      setDraft(d => ({ ...d, name: '' }));
      await loadCards();
      if (r.data?.scorecard) setEditing(r.data.scorecard);
    } catch (e) { toast.error(e.response?.data?.error || 'Create failed'); }
  };
  // Optimistic: update local config instantly, persist in the background. The
  // server materializes (pulls dialer calls) in the background too, so the
  // toggle never waits on it.
  const setCfgKey = (key, value) => {
    setCfg(c => ({ ...(c || {}), [key]: value }));
    client.put('qa/config', { company_id: companyId, key, value })
      .then(r => { if (key === 'qa.methods' && r.data?.materializing) toast.success('Enabled — pulling calls into the queue…'); })
      .catch(() => { toast.error('Config update failed'); loadCfg(); });
  };

  const methods = Array.isArray(cfg?.['qa.methods']) ? cfg['qa.methods'] : [];
  const setMethod = (m, on) => { const next = on ? [...new Set([...methods, m])] : methods.filter(x => x !== m); setCfgKey('qa.methods', next); };
  return (
    <div className="h-full overflow-auto">
      {editing && <ScorecardEditor scorecard={editing} companyId={companyId} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); loadCards(); }} />}

      {/* page intro */}
      <div className="mb-4">
        <div className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Settings2 size={17} style={{ color: 'var(--color-primary-600)' }} /> Scorecards &amp; Config
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
          Set up QA in two steps: <b>1)</b> turn on a review method on the left, <b>2)</b> build the scorecard reviewers fill in, on the right. Hover any <Info size={11} className="inline" /> for a plain-language explanation.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5">
      {/* ── STEP 1 — methods ─────────────────────────────────────────── */}
      <div>
        <div className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
          <span className="inline-flex items-center justify-center rounded-full text-[10px] font-bold" style={{ width: 16, height: 16, background: 'var(--color-primary-600)', color: '#fff' }}>1</span>
          Review methods
          <InfoTip text="Which QA reviews run for your company. Nothing is reviewed until you switch at least one method on — an empty list means QA is OFF." />
        </div>
        <div className="text-[11px] mb-3" style={{ color: 'var(--color-text-tertiary)' }}>Applies to <b style={{ color: 'var(--color-text-secondary)' }}>{companyName || 'your company'}</b>.</div>
        {cfg === null ? <Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} /> : (
          <div className="space-y-3">
            {[
              ['tra', 'TRA — the CRM calls', 'Every transfer entered in the CRM gets reviewed — a transfer means TRA. Full coverage of the CRM-entered numbers.', '#2563eb'],
              ['rcm', 'RCM — random RAW dialer calls', 'A random slice of the users’ actual calls straight off the dialer — numbers NOT entered in the CRM (those are TRA’s job). Sampled daily; set the rate below.', '#d97706'],
            ].map(([m, label, desc, tint]) => {
              const on = methods.includes(m);
              return (
                <div key={m} className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: `1px solid ${on ? tint + '66' : 'var(--color-border)'}` }}>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={on} onChange={e => setMethod(m, e.target.checked)} />
                    <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{label}</span>
                    <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded uppercase" style={on ? { background: tint + '22', color: tint } : { background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)' }}>{on ? 'On' : 'Off'}</span>
                  </label>
                  <div className="text-[11px] mt-1 ml-6" style={{ color: 'var(--color-text-tertiary)' }}>{desc}</div>
                  {m === 'rcm' && on && (
                    <div className="mt-2 ml-6 pt-2" style={{ borderTop: '1px dashed var(--color-border)' }}>
                      <div className="text-[11px] font-bold mb-1.5 flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>Sampling rate <InfoTip side="right" text="How much to sample and who it covers. Percentage pulls that share of calls; Fixed N pulls a set number each period. “Covers” chooses whether the sample is drawn from fronter calls, closer calls, or both." /></div>
                      <RcmConfig value={cfg['qa.rcm.sample']} covers={cfg['qa.rcm.covers']} onSample={v => setCfgKey('qa.rcm.sample', v)} onCovers={v => setCfgKey('qa.rcm.covers', v)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── STEP 2 — scorecards ──────────────────────────────────────── */}
      <div>
        <div className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
          <span className="inline-flex items-center justify-center rounded-full text-[10px] font-bold" style={{ width: 16, height: 16, background: 'var(--color-primary-600)', color: '#fff' }}>2</span>
          Scorecards
          <InfoTip w={320} text="The question sheets reviewers fill in per call. Each of the 4 sections — TRA, Closed Sale, Unclosed Sale, RCM — can carry its OWN scorecard, so grading a transfer differs from grading a sale. A section with no scorecard yet simply can't be scored until you add one. Templates are shared starting points — editing one saves a private copy for your company." />
        </div>
        <div className="text-[11px] mb-3" style={{ color: 'var(--color-text-tertiary)' }}>One scorecard per section — <b>TRA</b>, <b>Closed Sale</b>, <b>Unclosed Sale</b>, <b>RCM</b>. Each has a ready template; click <b>Edit fields</b> to customize (saves a private copy for your company). Old/disabled cards are hidden.</div>
        <div className="space-y-2 mb-4">
          {cards.filter(c => c.is_active).map(c => {
            const isSheet = c.criteria && !Array.isArray(c.criteria) && c.criteria.model === 'sheet_v2';
            const fieldCount = isSheet
              ? ((c.criteria.rating_criteria || []).length + ((c.criteria.autofail || {}).fields || []).length + (c.criteria.penalty_flags || []).length + ((c.criteria.quality_score || {}).fields || []).length + (c.criteria.tracking_flags || []).length)
              : (Array.isArray(c.criteria) ? c.criteria.length : 0);
            return (
              <div key={c.id} className="flex items-center gap-2 p-2.5 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', opacity: c.is_active ? 1 : 0.5 }}>
                <MethodPill m={c.method} />
                <div className="min-w-0 flex-1"><div className="text-sm font-semibold truncate flex items-center gap-1" style={{ color: 'var(--color-text)' }}>{c.name}{!c.company_id && <><span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>(template)</span><InfoTip side="right" w={220} text="A shared, read-only starting point. Click Edit fields and Save to make an editable copy for your company — the template itself never changes." /></>}</div><div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{fieldCount} fields{c.pass_threshold != null ? ` · pass ≥ ${c.pass_threshold}%` : ''}</div></div>
                {isSheet && c.is_active && <button onClick={() => setEditing(c)} className="text-[11px] font-bold px-2 py-1 rounded" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-primary-600)' }}>Edit fields</button>}
                {c.company_id && c.is_active && <button onClick={() => client.delete(`qa/scorecards/${c.id}`).then(loadCards)} className="text-[11px] font-bold" style={{ color: 'var(--color-error-600)' }}>Disable</button>}
              </div>
            );
          })}
          {!cards.filter(c => c.is_active).length && <div className="text-[11px] p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>No active scorecards — create one below.</div>}
        </div>
        <div className="p-3 rounded-xl space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--color-text)' }}>New scorecard <InfoTip side="right" text="Creates a blank scorecard for the chosen method and opens the visual builder so you can add questions. No coding or JSON needed." /></div>
          <div className="flex gap-2">
            <label className="flex items-center gap-1 text-[11px] whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>Section
              <ThemedSelect value={draft.method} onChange={e => setDraft(d => ({ ...d, method: e.target.value }))} style={inp} title="Which of the 4 QA sections this scorecard grades">
                <option value="tra">TRA · Transfers</option>
                <option value="closer_sales">Closed Sale</option>
                <option value="closer_dispo">Unclosed Sale</option>
                <option value="rcm">RCM · Random</option>
              </ThemedSelect>
            </label>
            <input placeholder="Name (e.g. WaveTech Fronter)" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} style={{ ...inp, flex: 1 }} />
            <label className="flex items-center gap-1 text-[11px] whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>pass ≥ <input type="number" value={draft.pass_threshold} onChange={e => setDraft(d => ({ ...d, pass_threshold: e.target.value }))} style={{ ...inp, width: 56 }} />%
              <InfoTip side="right" text="Minimum final score to count as a Pass. You can change it later in the builder; leave it as-is if unsure." />
            </label>
          </div>
          <button onClick={createSheet} disabled={!draft.name} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white" style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', opacity: draft.name ? 1 : 0.5 }}>
            <Plus size={14} /> Create &amp; build fields
          </button>
        </div>
      </div>
      </div>

      <TranscriptionAccess />
    </div>
  );
}
function RcmConfig({ value, covers, onSample, onCovers }) {
  const v = value && typeof value === 'object' ? value : { mode: 'percentage', value: 10, period: 'week' };
  const cov = Array.isArray(covers) ? covers : ['fronter'];
  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center">
        <ThemedSelect value={v.mode} onChange={e => onSample({ ...v, mode: e.target.value })} style={inp}><option value="percentage">Percentage</option><option value="fixed">Fixed N</option></ThemedSelect>
        <input type="number" value={v.value} onChange={e => onSample({ ...v, value: +e.target.value })} style={{ ...inp, width: 70 }} />
        <ThemedSelect value={v.period} onChange={e => onSample({ ...v, period: e.target.value })} style={inp}><option value="week">per week</option><option value="day">per day</option></ThemedSelect>
      </div>
      <div className="flex gap-3 items-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>Covers</span>
        {['fronter', 'closer'].map(r => <label key={r} className="flex items-center gap-1"><input type="checkbox" checked={cov.includes(r)} onChange={e => onCovers(e.target.checked ? [...new Set([...cov, r])] : cov.filter(x => x !== r))} />{r}</label>)}
      </div>
    </div>
  );
}

// ── Day Recordings tab — pick a date → EVERY call, tag Transferred (TRA) vs not
// (RCM), select, and (manager) ASSIGN to a QA agent as tasks. ─────────────────
const TransferBadge = ({ t }) => (
  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5"
    style={t ? { background: 'rgba(16,185,129,0.12)', color: '#059669' } : { background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)' }}>
    {t ? <><ArrowRightLeft size={10} />Transferred</> : 'Not transferred'}
  </span>
);
const DISPO_COLOR = { SALE: '#059669', XFER: '#2563eb', TRANSFER: '#2563eb', CALLBK: '#d97706', CB: '#d97706', CBHOLD: '#d97706', NI: '#6b7280', DNC: '#dc2626', DNQ: '#dc2626', DC: '#dc2626', WN: '#6b7280', LVM: '#7c3aed', AM: '#7c3aed', DEC: '#6b7280', NP: '#6b7280' };
const isXferCode = (d) => { const s = String(d || '').toUpperCase(); return s === 'XFER' || s === 'TRANSFER' || s === 'XFERA'; };
const DispoBadge = ({ d }) => {
  if (!d) return <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
  const c = DISPO_COLOR[String(d).toUpperCase()] || '#6b7280';
  return <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded" style={{ background: c + '22', color: c }}>{d}</span>;
};
// group a day's recordings by NUMBER + AGENT: multiple dials of the same number
// by the same agent become ONE record with expandable sub-parts (like the client
// portal). Different agents on the same number stay SEPARATE records.
const DRANK = ['SALE', 'XFER', 'TRANSFER', 'CALLBK', 'CB', 'CBHOLD', 'NI', 'NINTERESTED', 'DNQ', 'DEC', 'LVM', 'AM', 'DNC', 'DC', 'WN', 'NP'];
const drank = (d) => { const i = DRANK.indexOf(String(d || '').toUpperCase()); return i < 0 ? 999 : i; };
function groupRecordings(recs) {
  const m = new Map();
  for (const r of recs) {
    const key = (r.agent_user || '?') + '|' + (r.phone || ('rec:' + r.recording_id));  // no phone → its own group
    let g = m.get(key);
    if (!g) { g = { key, phone: r.phone, agent_user: r.agent_user, agent_name: r.agent_name, box_id: r.box_id, parts: [], transferred: false, dispo: null }; m.set(key, g); }
    g.parts.push(r);
    if (r.transferred) g.transferred = true;
    // Any dispo beats no dispo; the DRANK order only decides which to show when a
    // number has several dials with different codes. Without the `!g.dispo` guard,
    // a code missing from DRANK (rank 999) never beat the null default (also 999)
    // and showed blank — so every disposition outside the hardcoded list hid.
    if (r.dispo && (!g.dispo || drank(r.dispo) < drank(g.dispo))) g.dispo = r.dispo;
    if (r.transfer_id && !g.transfer_id) g.transfer_id = r.transfer_id;
  }
  const out = [];
  for (const g of m.values()) {
    g.parts.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
    g.count = g.parts.length;
    g.latest = g.parts[g.parts.length - 1]?.start_time;
    g.totalDur = g.parts.reduce((s, p) => s + (p.duration || 0), 0);
    // primary clip to review = the transferred leg, else the longest
    g.primary = g.parts.find(p => p.transferred) || g.parts.reduce((a, b) => ((b.duration || 0) > (a.duration || 0) ? b : a), g.parts[0]);
    out.push(g);
  }
  return out.sort((a, b) => String(b.latest || '').localeCompare(String(a.latest || '')));
}

// ── CRM-day panel: score the three sections that already live in the CRM ──────
// TRA (transfer calls), Closed Sales, Unclosed Sales — pulled from the CRM for a
// chosen past day and handed to QA agents (equal split or one agent). Recordings
// attach automatically; RCM stays in the dialer browser below. This is the
// CRM-first path: the CRM is the authoritative day, so nothing is missed.
const CRM_WT = [
  { key: 'tra',          label: 'TRA · Transfers',   tint: '#2563eb', Icon: ArrowRightLeft, hint: "Every lead this company TRANSFERRED on the selected day — the fronter transfer calls to review." },
  { key: 'closer_sales', label: 'Closed Sales',      tint: '#059669', Icon: DollarSign,     hint: "Sales that CLOSED on the selected day (by sale date), for this company's leads — the actual sales that day, matching the CRM's daily sales. A lead transferred earlier can close today. Review the closer's winning call." },
  { key: 'closer_dispo', label: 'Unclosed Sales',    tint: '#dc2626', Icon: PhoneOff,       hint: "This day's transfers that have NOT closed into a sale yet. Review the closer's call." },
];
function CrmDayPanel({ companyId, scoped, canAssign }) {
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const [date, setDate] = useState(yesterday);
  const [data, setData] = useState(null);      // { day, sections:{tra,closer_sales,closer_dispo} }
  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState([]);
  const [assignTo, setAssignTo] = useState('__equal__');
  const [alloc, setAlloc] = useState({});      // agent id → how many calls (custom split)
  const [busy, setBusy] = useState('');
  const allMode = companyId === ALL_CO;
  const co = scoped;

  useEffect(() => { if (canAssign && co) client.get('qa/agents', { params: { company_id: co } }).then(r => setAgents(r.data.agents || [])).catch(() => {}); else setAgents([]); }, [canAssign, co]);
  useEffect(() => { setData(null); }, [companyId]);

  const load = async () => {
    if (allMode || !co) return toast.error('Pick one company in the header first.');
    setLoading(true); setData(null);
    try { const r = await client.get('qa/crm-day', { params: { company_id: co, date } }); setData(r.data); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not load the day.'); }
    finally { setLoading(false); }
  };
  const assign = async (wt) => {
    if (!assignTo) return toast.error('Pick a QA agent or “equal split”.');
    setBusy(wt);
    try {
      const body = { company_id: co, date, work_type: wt };
      if (assignTo === '__custom__') {
        const allocations = Object.entries(alloc).map(([user_id, count]) => ({ user_id, count: +count || 0 })).filter(x => x.count > 0);
        if (!allocations.length) { setBusy(''); return toast.error('Give at least one agent a number of calls.'); }
        body.allocations = allocations;
      } else if (assignTo === '__equal__') body.distribute_equally = true;
      else body.assigned_to = assignTo;
      const r = await client.post('qa/assignments/from-crm', body);
      const label = CRM_WT.find(w => w.key === wt)?.label || wt;
      const bf = r.data.backfilled ? `, linked ${r.data.backfilled} lead id(s)` : '';
      const left = r.data.unassigned ? `, ${r.data.unassigned} left in the pool` : '';
      if (r.data.inserted) toast.success(`Assigned ${r.data.inserted} ${label}${r.data.distributed ? ` split across ${r.data.agents} agent(s)` : ''}${r.data.allocated != null ? ` across ${body.allocations.length} agent(s)` : ''}${left}${bf}`);
      else toast.message(`${r.data.note || 'Nothing new to assign'}${r.data.skipped ? ` (${r.data.skipped} already assigned)` : ''}${bf}`);
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Assign failed'); }
    finally { setBusy(''); }
  };

  return (
    <div className="mb-4 p-3 rounded-xl" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Score the CRM day</span>
        <InfoTip w={320} text="The three sections that are already in the CRM: TRA (transfer calls), Closed Sales, and Unclosed Sales. Pick a past day, Load, then hand each section to your QA agents (equal split or one agent). Recordings attach automatically. RCM (raw dialer calls, never in the CRM) is the browser below." />
        <label className="flex items-center gap-1 text-xs ml-2" style={{ color: 'var(--color-text-secondary)' }}><Calendar size={13} /> Day</label>
        <ThemedDate value={date} max={yesterday} onChange={e => setDate(e.target.value)} style={inp} />
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white"
          style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', opacity: loading ? 0.5 : 1 }}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Load day
        </button>
        {canAssign && (
          <label className="flex items-center gap-1 text-xs ml-auto" style={{ color: 'var(--color-text-secondary)' }}>Assign to
            <ThemedSelect value={assignTo} onChange={e => setAssignTo(e.target.value)} style={{ ...inp, minWidth: 180 }}>
              <option value="__equal__">⚖ All QA agents — equal split</option>
              <option value="__custom__">✎ Custom — a number each</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.undone ? ` · ${a.undone} to do` : ''}</option>)}
            </ThemedSelect>
          </label>
        )}
      </div>

      {/* Custom split — the manager types how many calls each reviewer gets.
          An equal split cannot say "40 to her, 10 to him, none to them", and QA
          workloads are rarely equal: different shifts, different queues. Anything
          not allocated simply stays in the pool to hand out later. */}
      {canAssign && assignTo === '__custom__' && (
        <div className="mb-2 p-2.5 rounded-lg" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-[11px] font-bold" style={{ color: 'var(--color-text)' }}>Calls per agent</span>
            <InfoTip w={320} text="How many of this section's calls each reviewer receives. They are handed out in order — the first agent's count, then the next agent's, and so on. Leave someone at 0 to skip them. Anything left over stays unassigned in the pool." />
            {(() => {
              const total = Object.values(alloc).reduce((s, v) => s + (+v || 0), 0);
              return <span className="text-[11px] font-bold" style={{ color: total ? 'var(--color-primary-600)' : 'var(--color-text-tertiary)' }}>{total} allocated</span>;
            })()}
            <button type="button" onClick={() => setAlloc({})} className="text-[11px] font-bold ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>clear</button>
          </div>
          {!agents.length && <div className="text-[11px]" style={{ color: 'var(--color-warning-600)' }}>No QA agents in this company yet.</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {agents.map(a => (
              <label key={a.id} className="flex items-center gap-2 px-2 py-1 rounded" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <span className="text-[11px] font-semibold truncate flex-1" style={{ color: 'var(--color-text)' }} title={a.name}>{a.name}</span>
                {a.undone ? <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{a.undone} to do</span> : null}
                <input type="number" min="0" inputMode="numeric" value={alloc[a.id] ?? ''} placeholder="0"
                  onChange={e => setAlloc(m => ({ ...m, [a.id]: e.target.value.replace(/\D/g, '') }))}
                  style={{ ...inp, width: 64, padding: '3px 6px', fontSize: 12 }} />
              </label>
            ))}
          </div>
        </div>
      )}
      {allMode && <div className="text-[11px] mb-1" style={{ color: 'var(--color-warning-600)' }}>Pick one company in the top-right header to score its CRM day.</div>}
      {!data ? <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Pick a past day and press <b>Load day</b> to see its transfers and sales.</div>
        : <>
          {/* plain-language cohort summary — makes clear the sale counts are the
              CONVERSION of this day's transfers, not sales dated that day */}
          {(() => {
            const t = data.sections.tra?.total || 0, c = data.sections.closer_sales?.total || 0, u = data.sections.closer_dispo?.total || 0;
            return (t || c || u) ? (
              <div className="text-[11px] mb-2 px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
                On <b style={{ color: 'var(--color-text)' }}>{data.day}</b>:
                {' '}<b style={{ color: '#2563eb' }}>{t}</b> lead{t === 1 ? '' : 's'} transferred ·
                {' '}<b style={{ color: '#059669' }}>{c}</b> sale{c === 1 ? '' : 's'} closed that day ·
                {' '}<b style={{ color: '#dc2626' }}>{u}</b> not yet closed
                {' '}<span style={{ color: 'var(--color-text-tertiary)' }}>(sales are counted by their sale date, so they need not come from this day's transfers)</span>.
              </div>
            ) : null;
          })()}
          <div className="grid grid-cols-3 gap-2.5">
            {CRM_WT.map(({ key, label, tint, Icon, hint }) => {
              const s = data.sections[key] || { total: 0, linked: 0, assigned: 0 };
              const remaining = Math.max(0, s.total - s.assigned);
              return (
                <div key={key} className="p-2.5 rounded-xl" style={{ background: `${tint}0d`, border: `1px solid ${tint}33` }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon size={14} style={{ color: tint }} />
                    <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{label}</span>
                    <InfoTip text={hint} />
                  </div>
                  <div className="text-2xl font-extrabold tabular-nums" style={{ color: tint }}>{s.total}</div>
                  <div className="text-[10px] mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
                    {s.assigned} assigned · <b style={{ color: 'var(--color-text-secondary)' }}>{remaining}</b> left
                    {key !== 'closer_dispo' && <> · {s.linked}/{s.total} lead-linked</>}
                  </div>
                  {canAssign && (
                    <button onClick={() => assign(key)} disabled={!!busy || !remaining || !assignTo}
                      className="w-full text-[11px] font-bold px-2 py-1.5 rounded-lg text-white inline-flex items-center justify-center gap-1"
                      style={{ background: tint, opacity: (!!busy || !remaining || !assignTo) ? 0.45 : 1 }}>
                      {busy === key ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                      {remaining ? `Assign ${remaining}` : 'All assigned'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>}
    </div>
  );
}

function DayRecordingsTab({ canAssign, companyId, scoped }) {
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const [date, setDate] = useState(yesterday);
  // Company scope comes from the header picker. A specific company → that
  // company's dialer agents only; "All my companies" (companyId === ALL_CO) →
  // scope=all (superadmin / view-all only). `scoped` is the concrete company id
  // (or '' when All) used for the assign-to agent list + task creation.
  const scopeParams = companyId === ALL_CO ? { scope: 'all' } : { scope: 'company', ...(companyId ? { company_id: companyId } : {}) };
  const allMode = companyId === ALL_CO;
  const assignCo = scoped;
  // agent list + task company: a specific company, or __all__ for cross-company
  // routing (each recording lands in its own company, resolved server-side).
  const agentScope = allMode ? '__all__' : assignCo;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dispoLoading, setDispoLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [xfilter, setXfilter] = useState('all');    // all | transferred | not
  const [dfilter, setDfilter] = useState('');       // '' = any dispo, else a code
  const [sel, setSel] = useState({});                // group key → group (selected)
  const [expanded, setExpanded] = useState({});      // group key → true (sub-parts open)
  const [agents, setAgents] = useState([]);
  const [assignTo, setAssignTo] = useState('');
  const [assignWt, setAssignWt] = useState('tra');   // tra | rcm | closer_sales | closer_dispo
  const [assigning, setAssigning] = useState(false);
  const [sortKey, setSortKey] = useState('time');
  const [sortDir, setSortDir] = useState('desc');
  const audioRef = useRef(null); const urlRef = useRef(null);
  const loadTokenRef = useRef(0);
  const [dispoRemaining, setDispoRemaining] = useState(0);
  const [loadingRid, setLoadingRid] = useState(null);
  const [playingRid, setPlayingRid] = useState(null);
  // Whether the player is showing at all. This used to be `urlRef.current`, a
  // ref that is ONLY set for a locally-cached clip — so a streamed call played
  // with the transport hidden and there was no scrub bar to move at all. It is
  // state now, set for either source.
  const [loadedRid, setLoadedRid] = useState(null);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  useEffect(() => { if (canAssign && agentScope) client.get('qa/agents', { params: { company_id: agentScope } }).then(r => setAgents(r.data.agents || [])).catch(() => {}); else setAgents([]); }, [canAssign, agentScope]);
  // Company changed in the header → drop stale results so the view can't show
  // another company's recordings until the user reloads for the new one.
  useEffect(() => { setData(null); setSel({}); setDispoLoading(false); }, [companyId]);

  // Poll dispositions in budgeted batches until every recording has one. Each
  // response is cumulative (cached + newly resolved), so we just apply the
  // latest map. Cancels if a new load starts (loadToken).
  const pollDispos = async (token) => {
    setDispoLoading(true);
    for (let i = 0; i < 50; i++) {
      if (loadTokenRef.current !== token) return;
      let dr;
      try { dr = await client.get('qa/day-dispositions', { params: { date, ...scopeParams }, timeout: 120000 }); }
      catch { break; }
      if (loadTokenRef.current !== token) return;
      const dispos = dr.data.dispos || {};
      setDispoRemaining(dr.data.remaining || 0);
      setData(prev => prev ? {
        ...prev, dispo_counts: dr.data.dispo_counts || prev.dispo_counts,
        recordings: (prev.recordings || []).map(x => {
          const d = dispos[`${x.box_id}|${x.recording_id}`] || null;
          return { ...x, dispo: d, transferred: x.transferred || isXferCode(d) };
        }),
      } : prev);
      if (dr.data.done) break;
    }
    if (loadTokenRef.current === token) setDispoLoading(false);
  };

  const load = async () => {
    const token = ++loadTokenRef.current;
    setLoading(true); setData(null); setSel({}); setDispoLoading(false); setDispoRemaining(0);
    try {
      // 1) recordings FIRST (skip the slow dispo pass) → instant paint
      const r = await client.get('qa/day-recordings', { params: { date, ...scopeParams, dispo: 0 }, timeout: 120000 });
      if (loadTokenRef.current !== token) return;
      setData(r.data);
      if (!r.data.total) { toast.message('No recordings found for that day.'); return; }
      pollDispos(token);   // 2) stream dispositions in the background
    } catch (e) { if (loadTokenRef.current === token) toast.error(e.response?.data?.error || 'Could not load recordings'); }
    finally { if (loadTokenRef.current === token) setLoading(false); }
  };

  // the clip currently loaded, so an expired stream can be re-ticketed without
  // hunting for it back through the grouped rows
  const nowPlayingRef = useRef(null);
  const streamingRef = useRef(false);   // true = playing a ticketed URL, not a local Blob

  const play = async (c) => {
    const a = audioRef.current; if (!a) return;
    if (a.dataset.rid === c.recording_id) { a.paused ? a.play() : a.pause(); return; }
    setLoadingRid(c.recording_id);
    nowPlayingRef.current = c;
    try {
      // Same two-stage path as the reviewer's player: a local copy when we have
      // one (no network, instant scrubbing), otherwise stream it and keep a copy
      // while it plays. The manager browses HUNDREDS of these a day, and they
      // re-open the same clips constantly.
      const key = clipKey(c.box_id, c.recording_id);
      const hit = await getClip(key);
      if (hit) {
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(hit);
        streamingRef.current = false;
        a.src = urlRef.current; a.dataset.rid = c.recording_id; setLoadedRid(c.recording_id); a.play().catch(() => {});
        return;
      }
      const r = await client.post('qa/recordings/ticket', { box_id: c.box_id, lead_id: c.lead_id, recording_id: c.recording_id });
      const apiBase = String(client.defaults.baseURL || '').replace(/\/api\/?$/, '');
      const url = apiBase + r.data.url;
      streamingRef.current = true;
      a.src = url; a.dataset.rid = c.recording_id; setLoadedRid(c.recording_id); a.play().catch(() => {});
      fetch(url).then(res => (res.ok ? res.blob() : null)).then(b => { if (b) putClip(key, b); }).catch(() => {});
    } catch { toast.error('Could not load that recording'); }
    finally { setLoadingRid(null); }
  };

  // Same two guards as the reviewer's player: once the clip has been heard
  // through, play the COMPLETE local file so every seek is instant; and if a
  // ticketed stream stops being accepted, re-ticket it and restore the position.
  const reloadAt = (a, src, at, resume) => {
    a.src = src;
    const onMeta = () => {
      a.removeEventListener('loadedmetadata', onMeta);
      try { a.currentTime = at; } catch { /* browser refused the seek */ }
      if (resume) a.play().catch(() => {});
    };
    a.addEventListener('loadedmetadata', onMeta);
    a.load();
  };
  const swapToLocal = async () => {
    const a = audioRef.current; const c = nowPlayingRef.current;
    if (!a || !c || !streamingRef.current) return;
    const hit = await getClip(clipKey(c.box_id, c.recording_id)).catch(() => null);
    if (!hit || a.dataset.rid !== c.recording_id) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(hit);
    streamingRef.current = false;
    reloadAt(a, urlRef.current, a.currentTime || 0, false);
  };
  const recoverStream = async () => {
    const a = audioRef.current; const c = nowPlayingRef.current;
    if (!a || !c || !streamingRef.current) return;
    const at = a.currentTime || 0, resume = !a.paused;
    try {
      const r = await client.post('qa/recordings/ticket', { box_id: c.box_id, lead_id: c.lead_id, recording_id: c.recording_id });
      const apiBase = String(client.defaults.baseURL || '').replace(/\/api\/?$/, '');
      reloadAt(a, apiBase + r.data.url, at, resume);
    } catch { toast.error('That recording link expired — press play again'); }
  };

  // group first, then filter at the GROUP level (a number's dispo = its best; a
  // number is transferred if ANY of its dials transferred).
  const allGroups = groupRecordings(data?.recordings || []).filter(g => {
    if (xfilter === 'transferred' && !g.transferred) return false;
    if (xfilter === 'not' && g.transferred) return false;
    if (dfilter === '__has' && !g.dispo) return false;
    // a number is a match if ANY of its dials carries the selected disposition —
    // g.dispo is only the group's BEST-ranked code, so matching on it alone hid
    // numbers whose selected code was a secondary dial.
    if (dfilter && dfilter !== '__has' && !g.parts.some(p => String(p.dispo || '').toUpperCase() === dfilter.toUpperCase())) return false;
    if (!search) return true;
    const q = search.replace(/\D/g, '');
    if (q) return g.parts.some(p => (p.phone || '').includes(q) || String(p.lead_id || '').includes(q));
    const s = search.toLowerCase();
    return (g.agent_name || '').toLowerCase().includes(s) || (g.agent_user || '').toLowerCase().includes(s);
  });
  // click-to-sort on any column
  const sortVal = (g) => ({
    time: g.latest || '', phone: g.phone || '', dispo: drank(g.dispo) + '', type: g.transferred ? 1 : 0,
    agent: (g.agent_name || g.agent_user || '').toLowerCase(), calls: g.count, length: g.totalDur,
  }[sortKey]);
  allGroups.sort((a, b) => {
    const va = sortVal(a), vb = sortVal(b);
    const c = (typeof va === 'number' && typeof vb === 'number') ? va - vb : String(va).localeCompare(String(vb));
    return sortDir === 'asc' ? c : -c;
  });
  const sortBy = (k) => { if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); else { setSortKey(k); setSortDir('asc'); } };
  const CAP = 1000;
  const rows = allGroups.slice(0, CAP);   // render cap only (perf) — selection is over ALL filtered groups
  const capped = allGroups.length > CAP;
  const selCount = Object.keys(sel).length;
  const allSelected = allGroups.length > 0 && allGroups.every(g => sel[g.key]);

  const toggle = (g) => setSel(m => { const n = { ...m }; if (n[g.key]) delete n[g.key]; else n[g.key] = g; return n; });
  // select ALL filtered numbers (not just the 1000 rendered) so a full day can be
  // assigned in one go.
  const selectAllFiltered = () => setSel(m => { const n = { ...m }; allGroups.forEach(g => { n[g.key] = g; }); return n; });
  const clearSel = () => setSel({});
  const toggleExpand = (key) => setExpanded(m => ({ ...m, [key]: !m[key] }));

  // suggest work type from selection: all transferred → TRA, all not → RCM
  useEffect(() => {
    const s = Object.values(sel);
    if (!s.length) return;
    setAssignWt(s.every(g => g.transferred) ? 'tra' : s.every(g => !g.transferred) ? 'rcm' : assignWt);
  }, [selCount]); // eslint-disable-line

  const WT_LABEL = { tra: 'TRA', rcm: 'RCM', closer_sales: 'Closed Sale', closer_dispo: 'Unclosed Sale' };
  const assign = async () => {
    const equal = assignTo === '__equal__';
    if (!assignTo) return toast.error('Pick a QA agent (or “All QA agents — equal split”)');
    if (equal && allMode) return toast.error('Equal split needs one company — pick a company in the header first.');
    setAssigning(true);
    try {
      // one task per selected group: the primary clip + all its dials as parts
      const recordings = Object.values(sel).map(g => {
        const p = g.primary;
        return {
          box_id: p.box_id, recording_id: p.recording_id, lead_id: p.lead_id, location: p.location,
          agent_user: g.agent_user, agent_name: g.agent_name || null, start_time: p.start_time, duration: p.duration, phone: g.phone,
          transfer_id: g.transfer_id || p.transfer_id || null,
          parts: g.parts.map(x => ({ box_id: x.box_id, recording_id: x.recording_id, lead_id: x.lead_id, location: x.location, start_time: x.start_time, duration: x.duration, agent_user: x.agent_user })),
        };
      });
      const body = { company_id: agentScope, work_type: assignWt, date, recordings };
      if (equal) body.distribute_equally = true; else body.assigned_to = assignTo;
      const r = await client.post('qa/assignments/from-recordings', body);
      const extra = [r.data.skipped ? `${r.data.skipped} already assigned` : '', r.data.skipped_no_company ? `${r.data.skipped_no_company} unmapped company` : ''].filter(Boolean).join(', ');
      if (r.data.inserted) toast.success(`Assigned ${r.data.inserted} ${WT_LABEL[assignWt]} call(s)${r.data.distributed ? ` split equally across ${r.data.agents} agent(s)` : ''}${extra ? ` (${extra})` : ''}`);
      else toast.error(r.data.error || `Nothing assigned${extra ? ` — ${extra}` : ''}`);
      clearSel();
    } catch (e) { toast.error(e.response?.data?.error || 'Assign failed'); }
    finally { setAssigning(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Dialer calls · RCM &amp; raw</span>
        <InfoTip text="Raw dialer calls for a day (for RCM — the random calls never entered in the CRM). Pull EVERY call straight from VICIdial, grouped by number + agent and tagged Transferred or not. Select and assign as scoring tasks. TRA / Closed / Unclosed are scored from the CRM panel above. Only the agents of the company picked in the top-right header are pulled." />
        <span className="text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
          <Building2 size={11} />{companyId === ALL_CO ? 'All my companies' : 'Selected company'}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <label className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}><Calendar size={14} />Date</label>
        <ThemedDate value={date} max={yesterday} onChange={e => setDate(e.target.value)} style={inp} />
        <button onClick={() => setDate(yesterday)} className="text-[11px] font-bold px-2 py-1 rounded" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>Yesterday</button>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white"
          style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', opacity: loading ? 0.6 : 1 }}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Headphones size={15} />} Load day
        </button>
        {data && (
          <div className="flex items-center gap-2 ml-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span className="font-bold" style={{ color: 'var(--color-text)' }}>{allGroups.length}</span> numbers · {data.total} recs · <span className="font-bold" style={{ color: '#059669' }}>{allGroups.filter(g => g.transferred).length}</span> transferred
            {dispoLoading && <span className="inline-flex items-center gap-1" style={{ color: 'var(--color-primary-600)' }}><Loader2 size={12} className="animate-spin" />dispositions{dispoRemaining ? ` · ${dispoRemaining} left` : '…'}</span>}
          </div>
        )}
        {data && (
          <ThemedSelect value={xfilter} onChange={e => setXfilter(e.target.value)} style={inp} title="Filter by transferred">
            <option value="all">All calls</option>
            <option value="transferred">Transferred → TRA</option>
            <option value="not">Not transferred → RCM</option>
          </ThemedSelect>
        )}
        {data && (
          <ThemedSelect value={dfilter} onChange={e => setDfilter(e.target.value)} style={inp} title="Filter by disposition">
            <option value="">Any disposition</option>
            <option value="__has">Has a disposition</option>
            {Object.entries(data.dispo_counts || {}).sort((a, b) => b[1] - a[1]).map(([d, n]) => <option key={d} value={d}>{d} ({n})</option>)}
          </ThemedSelect>
        )}
        <div className="ml-auto flex items-center gap-1.5 px-2 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          <Search size={14} style={{ color: 'var(--color-text-tertiary)' }} />
          <input placeholder="Search number / lead / agent" value={search} onChange={e => setSearch(e.target.value)}
            style={{ background: 'transparent', border: 'none', color: 'var(--color-text)', fontSize: 13, padding: '6px 2px', width: 200, outline: 'none' }} />
        </div>
      </div>

      {/* assign bar (manager) */}
      {canAssign && selCount > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-3 p-2.5 rounded-xl" style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-primary-600)' }}>
          <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{selCount} selected</span>
          <button onClick={clearSel} className="text-[11px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>clear</button>
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>as</span>
          <ThemedSelect value={assignWt} onChange={e => setAssignWt(e.target.value)} style={inp} title="Which of the 4 QA work types these calls become">
            <option value="tra">TRA · Transfer (fronter)</option>
            <option value="rcm">RCM · Random (fronter)</option>
            <option value="closer_sales">Closed Sale (closer)</option>
            <option value="closer_dispo">Unclosed Sale (closer)</option>
          </ThemedSelect>
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>to</span>
          <ThemedSelect value={assignTo} onChange={e => setAssignTo(e.target.value)} style={{ ...inp, minWidth: 190 }}>
            <option value="">Select QA agent…</option>
            <option value="__equal__">⚖ All QA agents — equal split</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.role === 'qa_manager' ? ' (mgr)' : ''}</option>)}
          </ThemedSelect>
          <button onClick={assign} disabled={assigning || !assignTo} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white"
            style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', opacity: (assigning || !assignTo) ? 0.5 : 1 }}>
            {assigning ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Assign
          </button>
          {allMode && <span className="text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}><Building2 size={11} /> each call routes to its own company automatically</span>}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16">
          <Loader2 className="animate-spin inline" size={22} style={{ color: 'var(--color-text-tertiary)' }} />
          <div className="text-xs mt-2" style={{ color: 'var(--color-text-tertiary)' }}>Pulling the day's recordings from every agent + dialer… (first load can take a moment)</div>
        </div>
      ) : !data ? (
        <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Pick a date and click <b>Load day</b> to see every call. Transferred calls = TRA, the rest = RCM. Then select + assign to your QA agents.</div>
      ) : (
        <div className="flex-1 overflow-auto rounded-xl" style={{ border: '1px solid var(--color-border)' }}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead className="sticky top-0 z-10" style={{ background: 'var(--color-surface-hover)' }}>
              <tr>
                {canAssign && <th className="px-2 py-2 w-8"><button onClick={allSelected ? clearSel : selectAllFiltered} title={`Select all ${allGroups.length} numbers`}>{allSelected ? <CheckSquare size={15} style={{ color: 'var(--color-primary-600)' }} /> : <Square size={15} style={{ color: 'var(--color-text-tertiary)' }} />}</button></th>}
                <th />
                {[['Time', 'time'], ['Phone', 'phone'], ['Dispo', 'dispo'], ['Type', 'type'], ['Agent', 'agent'], ['Calls', 'calls'], ['Length', 'length']].map(([label, key]) => (
                  <th key={key} className="text-left px-3 py-2 text-[11px] font-bold uppercase select-none cursor-pointer" style={{ color: sortKey === key ? 'var(--color-primary-600)' : 'var(--color-text-tertiary)' }} onClick={() => sortBy(key)}>
                    <span className="inline-flex items-center gap-0.5">{label}{sortKey === key && <ChevronDown size={11} style={{ transform: sortDir === 'asc' ? 'rotate(180deg)' : 'none' }} />}</span>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(g => {
                const checked = !!sel[g.key]; const isOpen = !!expanded[g.key]; const multi = g.count > 1;
                const p = g.primary; const on = playingRid === p.recording_id;
                return (
                  <Fragment key={g.key}>
                    <tr style={{ borderTop: '1px solid var(--color-border)', background: checked ? 'var(--color-surface-hover)' : 'transparent' }}>
                      {canAssign && <td className="px-2 py-1.5"><button onClick={() => toggle(g)}>{checked ? <CheckSquare size={15} style={{ color: 'var(--color-primary-600)' }} /> : <Square size={15} style={{ color: 'var(--color-text-tertiary)' }} />}</button></td>}
                      <td className="px-2 py-1.5">
                        <button onClick={() => play(p)} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' }}>
                          {loadingRid === p.recording_id ? <Loader2 size={13} className="animate-spin" color="#fff" /> : on ? <Pause size={13} color="#fff" /> : <Play size={13} color="#fff" />}
                        </button>
                      </td>
                      <td className="px-3 py-1.5 tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{fmtTime(g.latest)}</td>
                      <td className="px-3 py-1.5 tabular-nums font-bold" style={{ color: 'var(--color-text)' }}>{g.phone || '—'}</td>
                      <td className="px-3 py-1.5"><DispoBadge d={g.dispo} /></td>
                      <td className="px-3 py-1.5"><TransferBadge t={g.transferred} /></td>
                      <td className="px-3 py-1.5" style={{ color: 'var(--color-text-secondary)' }}>{g.agent_name || g.agent_user}</td>
                      <td className="px-3 py-1.5">
                        {multi
                          ? <button onClick={() => toggleExpand(g.key)} className="inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-primary-600)' }}>{g.count} calls <ChevronDown size={12} style={{ transition: 'transform .15s', transform: isOpen ? 'rotate(180deg)' : 'none' }} /></button>
                          : <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>1</span>}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{fmtDur(multi ? g.totalDur : p.duration)}</td>
                      <td className="px-2 py-1.5">{multi && <button onClick={() => toggleExpand(g.key)}><ChevronDown size={15} style={{ color: 'var(--color-text-tertiary)', transition: 'transform .15s', transform: isOpen ? 'rotate(180deg)' : 'none' }} /></button>}</td>
                    </tr>
                    {multi && isOpen && g.parts.map((c, i) => {
                      const pon = playingRid === c.recording_id;
                      return (
                        <tr key={c.box_id + c.recording_id} style={{ background: 'var(--color-bg)' }}>
                          {canAssign && <td />}
                          <td className="px-2 py-1" style={{ paddingLeft: 18 }}>
                            <button onClick={() => play(c)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: c.transferred ? 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' : 'var(--color-surface-hover)' }}>
                              {loadingRid === c.recording_id ? <Loader2 size={12} className="animate-spin" color={c.transferred ? '#fff' : 'var(--color-text-secondary)'} /> : pon ? <Pause size={12} color={c.transferred ? '#fff' : 'var(--color-text-secondary)'} /> : <Play size={12} color={c.transferred ? '#fff' : 'var(--color-text-secondary)'} />}
                            </button>
                          </td>
                          <td className="px-3 py-1 tabular-nums whitespace-nowrap text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{fmtTime(c.start_time)}</td>
                          <td className="px-3 py-1 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>call {i + 1}</td>
                          <td className="px-3 py-1"><DispoBadge d={c.dispo} /></td>
                          <td className="px-3 py-1">{c.transferred && <TransferBadge t />}</td>
                          <td className="px-3 py-1 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }} title={c.agent_user ? `Dialer id ${c.agent_user}` : undefined}>{c.agent_name || g.agent_name || c.agent_user}</td>
                          <td className="px-3 py-1" />
                          <td className="px-3 py-1 tabular-nums text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{fmtDur(c.duration)}</td>
                          <td />
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={canAssign ? 10 : 9} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>{search || xfilter !== 'all' || dfilter ? 'No calls match.' : 'No recordings for this day.'}</td></tr>}
              {capped && <tr><td colSpan={canAssign ? 10 : 9} className="px-3 py-3 text-center text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Showing first {CAP} of {allGroups.length} numbers (for speed) — but <b>Select all</b> selects all {allGroups.length}.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <audio ref={audioRef} controls className="w-full mt-2" style={{ display: loadedRid ? 'block' : 'none' }}
        onPlay={() => setPlayingRid(audioRef.current?.dataset.rid || null)} onPause={() => setPlayingRid(null)}
        onEnded={() => { setPlayingRid(null); swapToLocal(); }} onError={recoverStream} />
    </div>
  );
}

// ── Completed reviews as a Google-Sheets-style grid (per method/day) ──────────
const GROUP_TINT2 = { rating: 'rgba(37,99,235,0.10)', autofail: 'rgba(220,38,38,0.10)', penalty: 'rgba(217,119,6,0.10)', quality: 'rgba(22,163,74,0.10)', tracking: 'rgba(107,114,128,0.12)', outcome: 'rgba(124,58,237,0.10)', computed: 'rgba(22,163,74,0.16)', meta: 'var(--color-surface-hover)' };
function flattenFields(cfg) {
  if (!cfg || Array.isArray(cfg)) return [];
  const out = [];
  for (const f of resolveSheetFields(cfg)) {
    // Context columns — "Comments", "Additional Comments", "Reason of rejection".
    // They carry no score, which is why they used to be dropped here entirely;
    // but they hold what the reviewer actually WROTE about the call, so a
    // marking sheet without them is missing the part a manager reads. Kept, and
    // marked so the renderer reads them from `meta` rather than the marks.
    if (f.role === 'meta') { out.push({ key: f.key, label: f.label ?? f.key, group: 'meta', kind: 'text', fromMeta: true }); continue; }
    if (f.role === 'outcome' || f.role === 'verdict') {
      out.push({ key: f.key, label: f.label, group: 'outcome', kind: 'text' });
      continue;
    }
    const kind = f.input?.kind === 'scale' ? 'rating' : f.input?.kind === 'yn' ? 'yn' : 'text';
    out.push({ ...f, group: f.role === 'score' ? 'rating' : f.role, kind });
  }
  if (cfg.call_outcome && !out.some(x => x.key === cfg.call_outcome.key)) {
    out.push({ key: cfg.call_outcome.key, label: cfg.call_outcome.label, group: 'outcome', kind: 'text' });
  }
  return out;
}
// Y is not always spelled 'Y'. The client's own sheets write Yes/No, so a cell
// holding "Yes" was being read as NOT-Y and printed as **N** — the completed
// table said the opposite of what the reviewer picked. Anything unrecognised is
// now shown verbatim instead of being forced into a Y/N it never was.
const ynState = (v) => {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'Y' || s === 'YES' || s === 'TRUE' || s === '1') return true;
  if (s === 'N' || s === 'NO' || s === 'FALSE' || s === '0') return false;
  return null;
};
// Y is green, N is red — the same convention the scoring form uses, so a flag
// reads identically whether you are filling it in or reading it back.
const CellVal = ({ f, v }) => {
  if (v == null || v === '') return <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>;
  if (f.kind === 'yn') {
    const yes = ynState(v);
    if (yes == null) return <span style={{ color: 'var(--color-text-secondary)' }}>{v}</span>;
    return <span className="font-bold" style={{ color: yes ? '#059669' : 'var(--color-error-600)' }}>{yes ? 'Y' : 'N'}</span>;
  }
  if (f.kind === 'rating') return <span className="font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{v}</span>;
  return <span style={{ color: 'var(--color-text-secondary)' }}>{v}</span>;
};
function ReviewsSheet({ scorecard, reviews, managerView, onOpen }) {
  const cfg = scorecard?.criteria;
  const fields = flattenFields(cfg);
  const hasFinal = cfg?.final_score_formula === 'base_plus_penalty_truncated';
  const hasPenalty = (cfg?.penalty_flags || []).length > 0;
  const hasQuality = !!cfg?.quality_score;
  const pretty = (s) => String(s ?? '').replace(/_/g, ' ').trim();
  const th = (label, group) => { const n = pretty(label); return <th className="px-2 py-1.5 text-[9px] font-bold text-left align-bottom leading-tight" title={n} style={{ background: GROUP_TINT2[group], color: 'var(--color-text-secondary)', minWidth: group === 'meta' ? 84 : 46, maxWidth: 96, whiteSpace: 'normal', wordBreak: 'break-word' }}>{n}</th>; };
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <MethodPill m={scorecard?.method} />
        <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{scorecard?.name || 'Reviews'}</span>
        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>· {reviews.length} review{reviews.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--color-border)' }}>
        <table className="text-[12px]" style={{ borderCollapse: 'collapse', minWidth: 'max-content' }}>
          <thead className="sticky top-0 z-10">
            <tr>
              {th('Reviewed', 'meta')}{th('Call date', 'meta')}{th('Customer', 'meta')}{th('Phone', 'meta')}{th('Agent', 'meta')}
              {managerView && th('Reviewer', 'meta')}
              {fields.map(f => th(f.label, f.group))}
              {th('Base', 'computed')}{th('Auto-Fail', 'computed')}{hasPenalty && th('Penalty', 'computed')}{hasFinal && th('Final', 'computed')}{hasQuality && th('Quality', 'computed')}{th('Status', 'computed')}
              <th className="px-2 py-1.5" style={{ background: GROUP_TINT2.computed, minWidth: 34 }} />
            </tr>
          </thead>
          <tbody>
            {reviews.map(r => (
              <tr key={r.id} onClick={() => onOpen?.(r)}
                className={onOpen && r.assignment_id ? 'cursor-pointer transition-colors hover:bg-[var(--color-surface-hover)]' : ''}
                style={{ borderTop: '1px solid var(--color-border)' }}>
                <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{fmtTime(r.reviewed_at)}</td>
                <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>{fmtDate(r.call_date)}</td>
                <td className="px-2 py-1.5 truncate" style={{ color: 'var(--color-text)', maxWidth: 120 }}>{r.customer_name || '—'}</td>
                <td className="px-2 py-1.5 tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{r.customer_phone || '—'}</td>
                <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{r.agent || '—'}</td>
                {managerView && <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{r.reviewer_name || '—'}</td>}
                {fields.map(f => <td key={f.key} className="px-2 py-1.5 text-center"><CellVal f={f} v={r.values[f.key]} /></td>)}
                <td className="px-2 py-1.5 text-center tabular-nums font-bold" style={{ color: 'var(--color-text)' }}>{r.base_score != null ? `${Math.round(r.base_score * 100 * 10) / 10}%` : '—'}</td>
                <td className="px-2 py-1.5 text-center font-bold" style={{ color: r.autofail_result === 'Pass' ? '#059669' : '#dc2626' }}>{r.autofail_result || '—'}</td>
                {hasPenalty && <td className="px-2 py-1.5 text-center tabular-nums" style={{ color: (r.total_penalty || 0) < 0 ? '#dc2626' : 'var(--color-text)' }}>{r.total_penalty ?? 0}</td>}
                {hasFinal && <td className="px-2 py-1.5 text-center tabular-nums font-extrabold" style={{ color: 'var(--color-text)' }}>{r.final_score ?? '—'}</td>}
                {hasQuality && <td className="px-2 py-1.5 text-center tabular-nums font-extrabold" style={{ color: 'var(--color-text)' }}>{r.quality_score == null ? 'N/A' : `${r.quality_score}%`}</td>}
                <td className="px-2 py-1.5 text-center">
                  {r.passed == null ? <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
                    : <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded" style={r.passed ? { background: 'rgba(16,185,129,0.12)', color: '#059669' } : { background: 'rgba(220,38,38,0.12)', color: '#dc2626' }}>{r.passed ? 'PASS' : 'FAIL'}</span>}
                </td>
                <td className="px-2 py-1.5 text-center" title={r.overall_notes ? 'Has comments — click to view / edit' : 'Open to view / edit'}>
                  {r.overall_notes ? <MessageSquare size={13} style={{ color: 'var(--color-primary-600)' }} /> : <ChevronRight size={14} style={{ color: 'var(--color-text-tertiary)' }} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Completed — the reviewer SCOREBOARD ───────────────────────────────────────
// Every scored call with live KPI tiles, a score trend, search / result / sort
// controls and three views: the scorecard Sheet, a Daily breakdown, and (for
// managers) a Reviewers leaderboard.
const scoreOfReview = (r) => (r.final_score != null ? Number(r.final_score) : (r.quality_score != null ? Number(r.quality_score) : null));

// compact score badge straight from a review row (same semantics as ScoreCell)
function ReviewScore({ r }) {
  if (r.final_score != null) return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-sm font-extrabold tabular-nums" style={{ color: r.passed ? 'var(--color-success-600)' : 'var(--color-error-600)' }}>{r.final_score}</span>
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={r.passed ? { background: 'rgba(16,185,129,0.12)', color: '#059669' } : { background: 'rgba(220,38,38,0.12)', color: '#dc2626' }}>{r.passed ? 'PASS' : 'FAIL'}</span>
    </span>
  );
  if (r.quality_score != null) return <span className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--color-text)' }}>{r.quality_score}%<span className="text-[10px] font-normal ml-1" style={{ color: 'var(--color-text-tertiary)' }}>quality</span></span>;
  return <span className="text-[11px] font-bold" style={{ color: r.autofail_result === 'Fail' ? 'var(--color-error-600)' : 'var(--color-text-secondary)' }}>{r.autofail_result || 'scored'}</span>;
}

function StatTile({ icon: Icon, label, value, sub, tint = 'var(--color-primary-600)' }) {
  return (
    <div className="flex items-center gap-2 px-2.5 rounded-lg" style={{ minWidth: 118, height: 48, background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="rounded-md flex-shrink-0 flex items-center justify-center" style={{ width: 26, height: 26, background: `${tint}18` }}>
        <Icon size={13} style={{ color: tint }} />
      </div>
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-wider truncate" style={{ color: 'var(--color-text-tertiary)' }}>{label}</p>
        <p className="text-base font-bold leading-none mt-0.5 tabular-nums" style={{ color: 'var(--color-text)' }}>{value}{sub && <span className="text-[10px] font-semibold ml-1" style={{ color: 'var(--color-text-tertiary)' }}>{sub}</span>}</p>
      </div>
    </div>
  );
}

const csvEsc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

// ── Agent Quality File — one reviewed user's complete QA history ──────────────
// Opened by clicking an agent on the Agents board. Fetches every review of that
// user in the window (subject_user_id when the CRM link exists, dialer label
// otherwise) and shows: KPI tiles, score trend, the criteria they miss most,
// call-outcome mix, and every reviewed call — plus a CSV of the file.
function AgentQualityFile({ subject, managerView, companyId, onClose }) {
  const { canExport } = useAuth();
  const [daysBack, setDaysBack] = useState(90);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const today = todayISO();
  const from = addDays(today, -(daysBack - 1));

  useEffect(() => {
    setLoading(true);
    const params = { date_from: from, date_to: today };
    if (subject.subjectId) params.subject_user_id = subject.subjectId;
    else if (subject.agentLabel) params.agent = subject.agentLabel;
    if (companyId) params.company_id = companyId;
    if (!managerView) params.mine = 'true';
    client.get('qa/reviews', { params }).then(r => setData(r.data)).catch(() => setData({ reviews: [], scorecards: {} })).finally(() => setLoading(false));
  }, [subject, from, today, managerView, companyId]);

  const reviews = data?.reviews || [];
  const scorecards = data?.scorecards || {};

  // KPIs
  const scores = reviews.map(scoreOfReview).filter(v => v != null);
  const avg = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null;
  const passed = reviews.filter(r => r.passed === true).length;
  const decided = passed + reviews.filter(r => r.passed === false).length;
  const autofails = reviews.filter(r => r.autofail_result === 'Fail').length;

  // per-day score trend
  const byDay = {};
  for (const r of reviews) { const d = dayOfDate(r.reviewed_at); if (d) (byDay[d] ||= []).push(r); }
  const trend = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).map(([d, rows]) => {
    const ss = rows.map(scoreOfReview).filter(v => v != null);
    return { x: d, y: ss.length ? Math.round(ss.reduce((s, v) => s + v, 0) / ss.length) : 0 };
  });

  // the criteria this agent misses most — bad answer per section type:
  // rating ≤2, auto-fail 'N', penalty 'Y', sale-compliance 'N'.
  const missAgg = {};
  for (const r of reviews) {
    const c = scorecards[r.scorecard_id]?.criteria;
    if (!c || Array.isArray(c)) continue;
    const vals = r.values || {};
    const bump = (f, bad) => {
      const v = vals[f.key];
      if (v == null || v === '') return;
      (missAgg[f.key] ||= { label: f.label, misses: 0, seen: 0 });
      missAgg[f.key].seen++;
      if (bad(v)) missAgg[f.key].misses++;
    };
    for (const f of (c.rating_criteria || [])) bump(f, v => Number(v) <= 2);
    for (const f of ((c.autofail || {}).fields || [])) bump(f, v => v === 'N');
    for (const f of (c.penalty_flags || [])) bump(f, v => v === 'Y');
    for (const f of ((c.quality_score || {}).fields || [])) bump(f, v => v === 'N');
  }
  const issues = Object.values(missAgg).filter(x => x.misses > 0).sort((a, b) => b.misses - a.misses).slice(0, 8);

  // call-outcome mix
  const outcomeTally = {};
  for (const r of reviews) { const o = (r.call_outcome || '').trim(); if (o) outcomeTally[o] = (outcomeTally[o] || 0) + 1; }
  const outcomes = Object.entries(outcomeTally).sort((a, b) => b[1] - a[1]);

  const exportFile = () => {
    const lines = [['Reviewed at', 'Method', 'Customer', 'Phone', 'Score', 'Quality %', 'Result', 'Auto-fail', 'Call outcome', 'Reviewer', 'Notes'].join(',')];
    for (const r of reviews) {
      lines.push([
        r.reviewed_at ? new Date(r.reviewed_at).toLocaleString() : '', (r.method || '').toUpperCase(),
        r.customer_name || '', r.customer_phone || '', r.final_score ?? '', r.quality_score ?? '',
        r.passed === true ? 'PASS' : r.passed === false ? 'FAIL' : '', r.autofail_result || '',
        r.call_outcome || '', r.reviewer_name || '', r.overall_notes || '',
      ].map(csvEsc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `qa-file_${(subject.name || 'agent').replace(/[^a-z0-9]+/gi, '_')}_${from}_${today}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="p-4 sm:p-5 overflow-auto w-full h-full sm:h-auto rounded-none sm:rounded-2xl"
        style={{ maxWidth: 920, maxHeight: '100%', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center gap-2.5 mb-3 flex-wrap">
          <span className="inline-flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 34, height: 34, background: 'var(--color-primary-100, #e0e7ff)' }}>
            <User size={17} style={{ color: 'var(--color-primary-700, #4338ca)' }} />
          </span>
          <div className="min-w-0">
            <div className="text-base font-extrabold truncate" style={{ color: 'var(--color-text)' }}>{subject.name}</div>
            <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Quality file · last {daysBack} days{subject.agentLabel && subject.subjectId == null ? ` · dialer ${subject.agentLabel}` : ''}</div>
          </div>
          <div className="flex items-center gap-1 p-0.5 rounded-lg ml-2" style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)' }}>
            {[30, 90, 180].map(d => (
              <button key={d} onClick={() => setDaysBack(d)} className="text-[11px] font-bold px-2 py-1 rounded"
                style={daysBack === d ? { background: 'var(--color-primary-600)', color: '#fff' } : { color: 'var(--color-text-secondary)' }}>{d}d</button>
            ))}
          </div>
          {canExport('qa') && (
          <button onClick={exportFile} disabled={!reviews.length} className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg ml-auto"
            style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)', opacity: reviews.length ? 1 : 0.5 }}>
            <Download size={13} /> Export file
          </button>
          )}
          <button onClick={onClose} className={canExport('qa') ? '' : 'ml-auto'}><XCircle size={20} style={{ color: 'var(--color-text-tertiary)' }} /></button>
        </div>

        {loading ? <div className="text-center py-16"><Loader2 className="animate-spin inline" size={22} style={{ color: 'var(--color-text-tertiary)' }} /></div>
          : !reviews.length ? <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No reviews of this agent in the last {daysBack} days.</div>
          : (
            <>
              {/* KPIs */}
              <div className="flex items-stretch gap-2 flex-wrap mb-3">
                <StatTile icon={ClipboardCheck} label="Calls reviewed" value={reviews.length} />
                <StatTile icon={TrendingUp} label="Avg score" value={avg ?? '—'} tint={avg == null ? 'var(--color-primary-600)' : avg >= 80 ? '#059669' : avg >= 60 ? '#d97706' : '#dc2626'} />
                <StatTile icon={CheckCircle2} label="Pass rate" value={decided ? `${Math.round(passed / decided * 100)}%` : '—'} sub={decided ? `${passed}/${decided}` : null} tint="#059669" />
                <StatTile icon={XCircle} label="Auto-fails" value={autofails} tint="#dc2626" />
                <StatTile icon={ArrowRightLeft} label="TRA" value={reviews.filter(r => r.method === 'tra').length} tint="#2563eb" />
                <StatTile icon={Shield} label="RCM" value={reviews.filter(r => r.method === 'rcm').length} tint="#d97706" />
              </div>

              {/* trend */}
              {trend.length >= 2 && (
                <div className="p-3 rounded-xl mb-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Score trend</div>
                  <Lines series={[{ name: 'Avg score', color: PALETTE[0], points: trend }]} yMax={100} yUnit="%" />
                </div>
              )}

              <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: outcomes.length ? '3fr 2fr' : '1fr' }}>
                {/* most-missed criteria */}
                <div className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="text-[10px] font-bold uppercase tracking-wide mb-2 flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
                    What they miss most <InfoTip side="right" text="The scorecard questions this agent fails most often — low ratings (≤2), auto-fail violations, penalty flags and missed sale-compliance items — with how many of their reviewed calls had the problem. This is the coaching list." />
                  </div>
                  {!issues.length ? <div className="text-xs py-3" style={{ color: 'var(--color-text-tertiary)' }}>No recurring issues — clean reviews in this range. 🎉</div>
                    : <div className="space-y-1.5">
                        {issues.map(it => (
                          <div key={it.label} className="flex items-center gap-2">
                            <span className="text-xs truncate" style={{ color: 'var(--color-text-secondary)', width: 190 }}>{it.label}</span>
                            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-hover)' }}>
                              <div className="h-full rounded-full" style={{ width: `${Math.round(it.misses / it.seen * 100)}%`, background: '#dc2626' }} />
                            </div>
                            <span className="text-[11px] font-bold tabular-nums whitespace-nowrap" style={{ color: '#dc2626' }}>{it.misses}<span className="font-normal" style={{ color: 'var(--color-text-tertiary)' }}> / {it.seen}</span></span>
                          </div>
                        ))}
                      </div>}
                </div>
                {/* outcome mix */}
                {outcomes.length > 0 && (
                  <div className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                    <div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Call outcomes</div>
                    <div className="space-y-1">
                      {outcomes.slice(0, 8).map(([o, n]) => (
                        <div key={o} className="flex items-center gap-2 text-xs">
                          <span className="truncate" style={{ color: 'var(--color-text-secondary)' }}>{o}</span>
                          <span className="font-bold tabular-nums ml-auto" style={{ color: 'var(--color-text)' }}>{n}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* every reviewed call */}
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                  <thead style={{ background: 'var(--color-surface-hover)' }}>
                    <tr>{['When', 'Method', 'Customer / Phone', 'Score', 'Outcome', 'Reviewer'].map(h => <th key={h} className="text-left px-3 py-2 text-[11px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {reviews.map(r => (
                      <tr key={r.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                        <td className="px-3 py-1.5 whitespace-nowrap text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{r.reviewed_at ? new Date(r.reviewed_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</td>
                        <td className="px-2 py-1.5"><MethodPill m={r.work_type || r.method} /></td>
                        <td className="px-2 py-1.5">
                          <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{r.customer_name || '—'}</span>
                          {r.customer_phone && <span className="text-[10px] tabular-nums ml-1.5" style={{ color: 'var(--color-text-tertiary)' }}>{r.customer_phone}</span>}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap"><ReviewScore r={r} /></td>
                        <td className="px-2 py-1.5 text-[11px] truncate" style={{ color: 'var(--color-text-tertiary)', maxWidth: 150 }}>{r.call_outcome || ''}</td>
                        <td className="px-2 py-1.5 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{r.reviewer_name || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
      </div>
    </div>
  );
}

function CompletedTab({ managerView, companyId, selfId, canOverride }) {
  const { canExport } = useAuth();
  const today = todayISO();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [method, setMethod] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [agents, setAgents] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  // scoreboard controls
  const [view, setView] = useState('sheet');       // sheet | daily | agents | reviewers
  const [search, setSearch] = useState('');
  const [result, setResult] = useState('');        // '' | pass | fail | autofail
  const [sort, setSort] = useState('newest');      // newest | high | low
  const [file, setFile] = useState(null);          // agent quality-file modal
  const [openRev, setOpenRev] = useState(null);    // a completed review opened to view comments / edit

  const load = useCallback(() => {
    setLoading(true);
    const params = { date_from: from, date_to: to };
    if (method) params.method = method;
    if (reviewerId) params.reviewer_id = reviewerId;
    if (companyId) params.company_id = companyId;
    if (!managerView) params.mine = 'true';
    client.get('qa/reviews', { params }).then(r => setData(r.data)).catch(() => setData({ reviews: [], scorecards: {} })).finally(() => setLoading(false));
  }, [from, to, method, reviewerId, managerView, companyId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (managerView) client.get('qa/agents', { params: { company_id: companyId } }).then(r => setAgents(r.data.agents || [])).catch(() => {}); }, [managerView, companyId]);

  // ── filter + sort (client-side, on the loaded range) ──
  const sorted = (() => {
    const all = data?.reviews || [];
    const q = search.trim().toLowerCase(); const qd = q.replace(/\D/g, '');
    const filtered = all.filter(r => {
      if (result === 'pass' && r.passed !== true) return false;
      if (result === 'fail' && r.passed !== false) return false;
      if (result === 'autofail' && r.autofail_result !== 'Fail') return false;
      if (!q) return true;
      const hay = [r.customer_name, r.agent, r.reviewer_name, r.subject_name, r.call_outcome].filter(Boolean).join(' ').toLowerCase();
      if (hay.includes(q)) return true;
      return !!qd && String(r.customer_phone || '').replace(/\D/g, '').includes(qd);
    });
    if (sort === 'newest') return filtered;   // API order is newest-first already
    const val = (r) => { const s = scoreOfReview(r); return s == null ? (sort === 'high' ? -1 : 101) : s; };
    return [...filtered].sort((a, b) => sort === 'high' ? val(b) - val(a) : val(a) - val(b));
  })();

  // ── scoreboard stats over the filtered set ──
  const scores = sorted.map(scoreOfReview).filter(v => v != null);
  const passed = sorted.filter(r => r.passed === true).length;
  const failed = sorted.filter(r => r.passed === false).length;
  const decided = passed + failed;
  const autofails = sorted.filter(r => r.autofail_result === 'Fail').length;
  const avg = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null;
  const best = scores.length ? Math.max(...scores) : null;
  const nTra = sorted.filter(r => r.method === 'tra').length;
  const nRcm = sorted.filter(r => r.method === 'rcm').length;

  // per-day rollup (Daily view + trend line)
  const byDay = {};
  for (const r of sorted) { const d = dayOfDate(r.reviewed_at); if (d) (byDay[d] ||= []).push(r); }
  const days = Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0]));
  const trend = days.slice().reverse().map(([d, rows]) => {
    const ss = rows.map(scoreOfReview).filter(v => v != null);
    return { date: d, avg: ss.length ? Math.round(ss.reduce((s, v) => s + v, 0) / ss.length) : 0, n: rows.length };
  });

  // shared rollup: group the filtered reviews by a key and compute the quality
  // stats. Used for BOTH boards — the REVIEWED AGENTS (the department's whole
  // point: each score is linked to the fronter/closer who took the call) and
  // the reviewers (who did the scoring).
  const rollup = (keyFn, nameFn) => {
    const m = {};
    for (const r of sorted) {
      const k = keyFn(r) || '?';
      (m[k] ||= { name: nameFn(r) || 'Unknown', subjectId: r.subject_user_id || null, agentLabel: r.agent || null, n: 0, sum: 0, scored: 0, passed: 0, decided: 0, autofails: 0, tra: 0, rcm: 0 });
      const g = m[k]; g.n++;
      const s = scoreOfReview(r); if (s != null) { g.sum += s; g.scored++; }
      if (r.passed === true) { g.passed++; g.decided++; } else if (r.passed === false) g.decided++;
      if (r.autofail_result === 'Fail') g.autofails++;
      if (r.method === 'tra') g.tra++; else if (r.method === 'rcm') g.rcm++;
    }
    return Object.values(m).map(g => ({ ...g, avg: g.scored ? Math.round(g.sum / g.scored) : null, passRate: g.decided ? Math.round(g.passed / g.decided * 100) : null }));
  };
  // the REVIEWED agents' quality board — subject user first, dialer label fallback
  const [agentSort, setAgentSort] = useState('reviews');   // reviews | low | high
  const agentBoard = rollup(r => r.subject_user_id || r.agent, r => r.subject_name || r.agent)
    .sort((a, b) => agentSort === 'low' ? ((a.avg ?? 999) - (b.avg ?? 999)) : agentSort === 'high' ? ((b.avg ?? -1) - (a.avg ?? -1)) : (b.n - a.n));
  // reviewers leaderboard (manager view)
  const leaders = rollup(r => r.reviewer_id, r => r.reviewer_name).sort((a, b) => b.n - a.n);

  const downloadCsvLines = (lines, name) => {
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click(); URL.revokeObjectURL(a.href);
  };
  // The export follows the view: Agents → the per-USER quality report (the
  // department's deliverable — one row per reviewed fronter/closer); Reviewers →
  // the reviewer summary; Sheet/Daily → the raw scored calls, each row tied to
  // the user it grades.
  const exportCsv = () => {
    if (view === 'agents') {
      const lines = [['Agent (reviewed user)', 'Reviews', 'Avg score', 'Passed', 'Failed', 'Pass rate %', 'Auto-fails', 'TRA', 'RCM'].join(',')];
      for (const g of agentBoard) lines.push([g.name, g.n, g.avg ?? '', g.passed, g.decided - g.passed, g.passRate ?? '', g.autofails, g.tra, g.rcm].map(csvEsc).join(','));
      return downloadCsvLines(lines, `qa-agent-report_${from}_${to}.csv`);
    }
    if (view === 'reviewers') {
      const lines = [['Reviewer', 'Reviews', 'Avg score given', 'Pass rate %', 'Auto-fails', 'TRA', 'RCM'].join(',')];
      for (const g of leaders) lines.push([g.name, g.n, g.avg ?? '', g.passRate ?? '', g.autofails, g.tra, g.rcm].map(csvEsc).join(','));
      return downloadCsvLines(lines, `qa-reviewer-report_${from}_${to}.csv`);
    }
    const head = ['Reviewed at', 'Agent (reviewed user)', 'Dialer agent', 'Method', 'Customer', 'Phone', 'Score', 'Quality %', 'Result', 'Auto-fail', 'Call outcome', 'Reviewer', 'Notes'];
    const lines = [head.join(',')];
    for (const r of sorted) {
      lines.push([
        r.reviewed_at ? new Date(r.reviewed_at).toLocaleString() : '',
        r.subject_name || r.agent || '', r.agent || '', (r.method || '').toUpperCase(),
        r.customer_name || '', r.customer_phone || '',
        r.final_score ?? '', r.quality_score ?? '',
        r.passed === true ? 'PASS' : r.passed === false ? 'FAIL' : '', r.autofail_result || '',
        r.call_outcome || '', r.reviewer_name || '', r.overall_notes || '',
      ].map(csvEsc).join(','));
    }
    downloadCsvLines(lines, `qa-completed_${from}_${to}.csv`);
  };

  const groups = {};
  for (const r of sorted) { (groups[r.scorecard_id] = groups[r.scorecard_id] || []).push(r); }
  const scorecards = data?.scorecards || {};

  // Quick date presets — one click to view a specific day's scored records.
  const presets = [
    ['Today', today, today],
    ['Yesterday', addDays(today, -1), addDays(today, -1)],
    ['7 days', addDays(today, -6), today],
    ['30 days', addDays(today, -29), today],
  ];
  const activePreset = presets.find(([, f, t]) => f === from && t === to)?.[0] || null;
  const singleDay = from === to;

  const views = [
    ['sheet', 'Sheet', Table2],
    ['daily', 'Daily', CalendarDays],
    ['agents', 'Agents', User],
    ...(managerView ? [['reviewers', 'Reviewers', Award]] : []),
  ];

  // Click a scored record → open it to read the comments + edit later. Managers
  // can edit any; an agent can edit their own while it isn't finalized (locked).
  // ReviewEditor loads by assignment_id, so a review with no linked call can't open.
  const openReview = (r) => {
    if (!r.assignment_id) { toast('This review has no linked call to open.'); return; }
    setOpenRev({ ...r, id: r.assignment_id, status: 'scored', agent_name: r.agent, subject_date: r.call_date });
  };

  return (
    <div className="flex flex-col h-full">
      {file && <AgentQualityFile subject={file} managerView={managerView} companyId={companyId} onClose={() => setFile(null)} />}
      <ScoreModal open={openRev} onClose={() => setOpenRev(null)} selfId={selfId} canOverride={canOverride}
        onScored={() => setOpenRev(null)} onEdited={() => load()} />
      {/* row 1 — range + server filters */}
      <div className="flex items-center gap-2 flex-wrap mb-2.5">
        <span className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>{managerView ? 'Completed — scoreboard' : 'My scoreboard'}
          <InfoTip text={managerView ? "Every scored call in the range, with live KPIs. Views: Sheet (scorecard layout), Daily (day-by-day breakdown), Reviewers (who scored how much, how strictly). Search, filter by result, sort by score, export CSV." : "Everything you've scored in the range, with your live stats. Sheet shows the full scorecard layout; Daily breaks your work down day by day. Search, filter by result, sort and export."} />
        </span>
        <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)' }}>
          {presets.map(([label, f, t]) => (
            <button key={label} onClick={() => { setFrom(f); setTo(t); }}
              className="text-[11px] font-bold px-2 py-1 rounded"
              style={activePreset === label ? { background: 'var(--color-primary-600)', color: '#fff' } : { color: 'var(--color-text-secondary)' }}>{label}</button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}><Calendar size={13} />{singleDay ? 'on' : 'from'}</label>
        <ThemedDate value={from} max={to} onChange={e => setFrom(e.target.value)} style={inp} />
        {!singleDay && <><label className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>to</label>
        <ThemedDate value={to} max={today} onChange={e => setTo(e.target.value)} style={inp} /></>}
        <button onClick={() => { if (singleDay) { const t = addDays(from, 6); setTo(t > today ? today : t); } else { setTo(from); } }}
          className="text-[11px] font-bold px-2 py-1 rounded" title={singleDay ? 'Switch to a date range' : 'Collapse to a single day'}
          style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>{singleDay ? 'Range' : 'Single day'}</button>
        <ThemedSelect value={method} onChange={e => setMethod(e.target.value)} style={inp}><option value="">TRA + RCM</option><option value="tra">TRA</option><option value="rcm">RCM</option></ThemedSelect>
        {managerView && (
          <ThemedSelect value={reviewerId} onChange={e => setReviewerId(e.target.value)} style={inp}>
            <option value="">All QA agents</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </ThemedSelect>
        )}
        <button onClick={load} className="p-2 rounded-lg" style={{ background: 'var(--color-surface-hover)' }} title="Refresh"><RefreshCw size={14} style={{ color: 'var(--color-text-secondary)' }} /></button>
        {canExport('qa') && (
        <button onClick={exportCsv} disabled={!sorted.length} className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg"
          style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)', opacity: sorted.length ? 1 : 0.5 }} title="Download the filtered reviews as CSV">
          <Download size={13} /> CSV
        </button>
        )}
      </div>

      {/* row 2 — the scoreboard tiles */}
      {!loading && data && data.reviews.length > 0 && (
        <div className="flex items-stretch gap-2 flex-wrap mb-2.5">
          <StatTile icon={ClipboardCheck} label="Reviews" value={sorted.length} sub={sorted.length !== data.reviews.length ? `of ${data.reviews.length}` : null} />
          <StatTile icon={CheckCircle2} label="Pass rate" value={decided ? `${Math.round(passed / decided * 100)}%` : '—'} sub={decided ? `${passed}/${decided}` : null} tint="#059669" />
          <StatTile icon={TrendingUp} label="Avg score" value={avg != null ? avg : '—'} tint="#2563eb" />
          <StatTile icon={Star} label="Best" value={best != null ? best : '—'} tint="#d97706" />
          <StatTile icon={XCircle} label="Auto-fails" value={autofails} tint="#dc2626" />
          <StatTile icon={ArrowRightLeft} label="TRA" value={nTra} tint="#2563eb" />
          <StatTile icon={Shield} label="RCM" value={nRcm} tint="#d97706" />
        </div>
      )}

      {/* row 3 — view switch + scoreboard controls */}
      {!loading && data && data.reviews.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-2.5">
          <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)' }}>
            {views.map(([k, label, Icon]) => (
              <button key={k} onClick={() => setView(k)} className="text-[11px] font-bold px-2.5 py-1 rounded inline-flex items-center gap-1"
                style={view === k ? { background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', color: '#fff' } : { color: 'var(--color-text-secondary)' }}>
                <Icon size={11} /> {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 px-2 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
            <Search size={13} style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Customer / phone / agent / outcome…"
              style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-text)', fontSize: 12, padding: '6px 2px', width: 210 }} />
            {search && <button onClick={() => setSearch('')}><XCircle size={13} style={{ color: 'var(--color-text-tertiary)' }} /></button>}
          </div>
          <ThemedSelect value={result} onChange={e => setResult(e.target.value)} style={inp} title="Filter by result">
            <option value="">Any result</option><option value="pass">Passed</option><option value="fail">Failed</option><option value="autofail">Auto-fail</option>
          </ThemedSelect>
          <ThemedSelect value={sort} onChange={e => setSort(e.target.value)} style={inp} title="Sort order">
            <option value="newest">Newest first</option><option value="high">Score: high → low</option><option value="low">Score: low → high</option>
          </ThemedSelect>
          <span className="text-xs ml-auto" style={{ color: 'var(--color-text-tertiary)' }}><b style={{ color: 'var(--color-text)' }}>{sorted.length}</b> shown</span>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loading ? <div className="text-center py-16"><Loader2 className="animate-spin inline" size={22} style={{ color: 'var(--color-text-tertiary)' }} /></div>
          : !data || !data.reviews.length ? <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No completed reviews in this range. Score calls in the Queue and they appear here as your scoreboard.</div>
          : !sorted.length ? <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Nothing matches those filters — clear the search or result filter.</div>
          : view === 'sheet' ? (
            <>
              {trend.length >= 2 && (
                <div className="p-3 rounded-xl mb-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Score trend</div>
                  <Lines series={[{ name: 'Avg score', color: PALETTE[0], points: trend.map(d => ({ x: d.date, y: d.avg })) }]} yMax={100} yUnit="%" />
                </div>
              )}
              {Object.entries(groups).map(([scId, revs]) => <ReviewsSheet key={scId} scorecard={scorecards[scId]} reviews={revs} managerView={managerView} onOpen={openReview} />)}
            </>
          )
          : view === 'daily' ? (
            <div className="space-y-3">
              {days.map(([day, rows]) => {
                const ss = rows.map(scoreOfReview).filter(v => v != null);
                const dAvg = ss.length ? Math.round(ss.reduce((s, v) => s + v, 0) / ss.length) : null;
                const dPassed = rows.filter(r => r.passed === true).length;
                const dDecided = dPassed + rows.filter(r => r.passed === false).length;
                return (
                  <div key={day} className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                    <div className="flex items-center gap-2.5 px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <CalendarDays size={14} style={{ color: 'var(--color-primary-600)' }} />
                      <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{fmtDate(day)}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>{rows.length} review{rows.length === 1 ? '' : 's'}</span>
                      {dAvg != null && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>avg <b style={{ color: 'var(--color-text)' }}>{dAvg}</b></span>}
                      {dDecided > 0 && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>pass <b style={{ color: dPassed / dDecided >= 0.5 ? '#059669' : '#dc2626' }}>{Math.round(dPassed / dDecided * 100)}%</b></span>}
                    </div>
                    <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                      <tbody>
                        {rows.map(r => (
                          <tr key={r.id} onClick={() => openReview(r)}
                            className="cursor-pointer transition-colors hover:bg-[var(--color-surface-hover)]"
                            style={{ borderTop: '1px solid var(--color-border)' }}>
                            <td className="px-3 py-1.5 whitespace-nowrap text-[11px] tabular-nums" style={{ color: 'var(--color-text-tertiary)', width: 70 }}>{r.reviewed_at ? new Date(r.reviewed_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''}</td>
                            <td className="px-2 py-1.5"><MethodPill m={r.work_type || r.method} /></td>
                            <td className="px-2 py-1.5">
                              <div className="font-semibold truncate" style={{ color: 'var(--color-text)', maxWidth: 180 }}>{r.customer_name || '—'}</div>
                              {r.customer_phone && <div className="text-[10px] tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>{r.customer_phone}</div>}
                            </td>
                            <td className="px-2 py-1.5 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>{r.agent || '—'}</td>
                            {managerView && <td className="px-2 py-1.5 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>{r.reviewer_name || '—'}</td>}
                            <td className="px-2 py-1.5 whitespace-nowrap"><ReviewScore r={r} /></td>
                            <td className="px-2 py-1.5 text-[11px] truncate" style={{ color: 'var(--color-text-tertiary)', maxWidth: 160 }}>{r.call_outcome || ''}</td>
                            <td className="px-2 py-1.5 text-right" title={r.overall_notes ? 'Has comments — click to view / edit' : 'Open to view / edit'}>{r.overall_notes ? <MessageSquare size={13} style={{ color: 'var(--color-primary-600)' }} /> : <ChevronRight size={14} style={{ color: 'var(--color-text-tertiary)' }} />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )
          : view === 'agents' ? (
            /* the REVIEWED agents' quality board — the department's product:
               every score is linked to the fronter/closer who took the call */
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>{managerView ? 'Agent quality — the users these reviews grade' : 'Agent quality — from YOUR reviews only'}</span>
                <InfoTip text="One row per reviewed fronter/closer: how many of their calls were scored, their average score, pass rate and auto-fails in this range. Sort by lowest score to find who needs coaching. The CSV button exports exactly this report." />
                <ThemedSelect value={agentSort} onChange={e => setAgentSort(e.target.value)} style={{ ...inp, fontSize: 11, padding: '4px 8px', marginLeft: 'auto' }}>
                  <option value="reviews">Most reviewed</option><option value="low">Lowest score first</option><option value="high">Highest score first</option>
                </ThemedSelect>
              </div>
              {agentBoard.map((g, i) => {
                const risky = g.avg != null && g.avg < 60;
                return (
                  <div key={g.name + i} onClick={() => setFile({ name: g.name, subjectId: g.subjectId, agentLabel: g.agentLabel })}
                    className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-transform hover:scale-[1.005]"
                    title="Open this agent's full quality file"
                    style={{ background: 'var(--color-surface)', border: risky ? '1px solid #dc262666' : '1px solid var(--color-border)' }}>
                    <span className="inline-flex items-center justify-center rounded-full font-extrabold text-sm flex-shrink-0"
                      style={{ width: 30, height: 30, background: risky ? 'rgba(220,38,38,0.12)' : 'var(--color-surface-hover)', color: risky ? '#dc2626' : 'var(--color-text-secondary)' }}>
                      {risky ? <XCircle size={15} /> : i + 1}
                    </span>
                    <div className="min-w-0" style={{ width: 190 }}>
                      <div className="text-sm font-bold truncate" style={{ color: 'var(--color-text)' }}>{g.name}</div>
                      <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{g.n} call{g.n === 1 ? '' : 's'} reviewed · {g.tra} TRA · {g.rcm} RCM</div>
                    </div>
                    {/* avg-score bar (0–100) — green ≥80, amber ≥60, red below */}
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-hover)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, g.avg ?? 0)}%`, background: g.avg == null ? 'var(--color-border)' : g.avg >= 80 ? '#059669' : g.avg >= 60 ? '#d97706' : '#dc2626' }} />
                    </div>
                    <div className="text-xs tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text-secondary)', width: 70, textAlign: 'right' }}>avg <b style={{ color: g.avg == null ? 'var(--color-text)' : g.avg >= 80 ? '#059669' : g.avg >= 60 ? '#d97706' : '#dc2626' }}>{g.avg ?? '—'}</b></div>
                    <div className="text-xs tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text-secondary)', width: 74, textAlign: 'right' }}>pass <b style={{ color: g.passRate == null ? 'var(--color-text)' : g.passRate >= 50 ? '#059669' : '#dc2626' }}>{g.passRate != null ? `${g.passRate}%` : '—'}</b></div>
                    <div className="text-xs tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text-secondary)', width: 90, textAlign: 'right' }}>auto-fails <b style={{ color: g.autofails ? '#dc2626' : 'var(--color-text)' }}>{g.autofails}</b></div>
                    <ChevronRight size={15} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
                  </div>
                );
              })}
            </div>
          )
          : ( /* reviewers leaderboard */
            <div className="space-y-2">
              {leaders.map((g, i) => (
                <div key={g.name + i} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: i === 0 ? '1px solid #d9770666' : '1px solid var(--color-border)' }}>
                  <span className="inline-flex items-center justify-center rounded-full font-extrabold text-sm flex-shrink-0"
                    style={{ width: 30, height: 30, background: i === 0 ? 'rgba(217,119,6,0.15)' : 'var(--color-surface-hover)', color: i === 0 ? '#d97706' : 'var(--color-text-secondary)' }}>
                    {i === 0 ? <Award size={15} /> : i + 1}
                  </span>
                  <div className="min-w-0" style={{ width: 170 }}>
                    <div className="text-sm font-bold truncate" style={{ color: 'var(--color-text)' }}>{g.name}</div>
                    <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{g.n} review{g.n === 1 ? '' : 's'}</div>
                  </div>
                  {/* volume bar relative to the top reviewer */}
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-hover)' }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.round(g.n / (leaders[0]?.n || 1) * 100)}%`, background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' }} />
                  </div>
                  <div className="text-xs tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text-secondary)', width: 70, textAlign: 'right' }}>avg <b style={{ color: 'var(--color-text)' }}>{g.avg ?? '—'}</b></div>
                  <div className="text-xs tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text-secondary)', width: 74, textAlign: 'right' }}>pass <b style={{ color: g.passRate == null ? 'var(--color-text)' : g.passRate >= 50 ? '#059669' : '#dc2626' }}>{g.passRate != null ? `${g.passRate}%` : '—'}</b></div>
                  <div className="text-xs tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text-secondary)', width: 90, textAlign: 'right' }}>auto-fails <b style={{ color: g.autofails ? '#dc2626' : 'var(--color-text)' }}>{g.autofails}</b></div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

// Company review-type setup (mig 208) — MANAGER-owned. Turn the 4 review types
// on/off for the header-selected company; compliance no longer touches this.
function CfgToggle({ on, onClick, label, tint, hint }) {
  return (
    <button onClick={onClick} className="flex-1 rounded-xl p-2.5 text-left transition-colors" style={{ minWidth: 132, border: '1px solid ' + (on ? tint : 'var(--color-border)'), background: on ? `color-mix(in srgb, ${tint} 10%, transparent)` : 'var(--color-surface)' }}>
      <div className="flex items-center gap-2">
        <span style={{ width: 30, height: 17, borderRadius: 999, background: on ? tint : 'var(--color-border)', position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
          <span style={{ position: 'absolute', top: 2, left: on ? 15 : 2, width: 13, height: 13, borderRadius: 999, background: '#fff', transition: 'left .15s' }} />
        </span>
        <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{label}</span>
      </div>
      <div className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{hint}</div>
    </button>
  );
}
function CompanyReviewConfig({ companyId, onChange }) {
  const [cfg, setCfg] = useState(null);
  const load = useCallback(() => {
    setCfg(null);
    client.get('qa/admin/company-config', { params: { company_id: companyId } })
      .then(r => setCfg(r.data.config || {})).catch(() => setCfg({}));
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const methods = cfg?.['qa.methods'] || [];
  const closer = cfg?.['qa.closer'];
  const closerOn = (k) => (closer == null ? true : !!closer[k]);   // null = both closer legs on
  const sample = cfg?.['qa.rcm.sample'] || { mode: 'percentage', value: 10, period: 'week' };

  const save = async (key, value) => {
    setCfg(c => ({ ...c, [key]: value }));
    try {
      const r = await client.put('qa/admin/company-config', { company_id: companyId, key, value });
      if (key === 'qa.methods') { const mm = r.data.materialized; if (mm && (mm.tra || mm.rcm)) toast.success(`Pulled ${mm.tra || 0} TRA + ${mm.rcm || 0} RCM`); }
      if (r.data.purged) toast.success(`Cleared ${r.data.purged} unassigned task${r.data.purged === 1 ? '' : 's'} for the turned-off review type.`);
      onChange?.();   // let the parent re-read the enabled set so the agent method checkboxes update
    } catch (e) { toast.error(e.response?.data?.error || 'Save failed'); load(); }
  };
  const toggleMethod = (m) => save('qa.methods', methods.includes(m) ? methods.filter(x => x !== m) : [...methods, m]);
  const toggleCloser = (k) => { const base = closer == null ? { closer_sales: true, closer_dispo: true } : { ...closer }; base[k] = !closerOn(k); save('qa.closer', base); };

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
        Review types for this company
        <InfoTip text="Decide WHAT this company is reviewed on. TRA = every CRM transfer (the fronter's call). RCM = a random sample of raw dialer calls never entered in the CRM. Closed Sale / Unclosed Sale = the closer's call when it did / didn't close. Turning one ON makes that work exist and lets you assign agents to it below; OFF means it's not reviewed and can't be assigned. This is yours as the manager — compliance only gives you the company." />
      </div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
        These switches control what work exists for this company. <b>Agents below can only be given the types you turn on here.</b>
      </div>
      {cfg === null ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
        : (
          <div className="flex items-stretch gap-2 flex-wrap">
            <CfgToggle on={methods.includes('tra')} onClick={() => toggleMethod('tra')} label="TRA · Transfers" tint="#2563eb" hint="Every CRM transfer reviewed" />
            <CfgToggle on={methods.includes('rcm')} onClick={() => toggleMethod('rcm')} label="RCM · Random" tint="#d97706" hint="Sampled raw dialer calls" />
            <CfgToggle on={closerOn('closer_sales')} onClick={() => toggleCloser('closer_sales')} label="Closed Sale" tint="#16a34a" hint="Closer calls that closed" />
            <CfgToggle on={closerOn('closer_dispo')} onClick={() => toggleCloser('closer_dispo')} label="Unclosed Sale" tint="#dc2626" hint="Closer calls, no sale" />
            {methods.includes('rcm') && (
              <div className="rounded-xl p-2.5 flex flex-col justify-center" style={{ border: '1px solid var(--color-border)', minWidth: 118 }}>
                <div className="text-[10px] font-bold mb-1 flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>RCM sample % <InfoTip w={240} text="RCM never reviews every call — it checks only a random slice of each day's raw dialer calls (the ones not entered in the CRM). This sets how big that slice is, e.g. 10% of the day's calls are pulled for review. Only applies while RCM is on." /></div>
                <input type="number" min={1} max={100} defaultValue={sample.value}
                  onBlur={e => { const v = Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 10)); save('qa.rcm.sample', { ...sample, mode: 'percentage', value: v }); }}
                  style={{ ...inp, width: 70, padding: '4px 8px' }} />
              </div>
            )}
          </div>
        )}
    </div>
  );
}

// ── Agents & Fields tab (qa_manager) — bind each agent to RCM/TRA + choose which
// customer fields show on the agent's task card. ─────────────────────────────
const CARD_FIELDS = [
  ['customer_name', 'Customer name'], ['customer_phone', 'Phone'], ['zip', 'ZIP'],
  ['state', 'State'], ['address', 'Address'], ['agent', 'Agent'],
  ['call_date', 'Call date'], ['plan', 'Plan / vehicle'], ['disposition', 'Closer disposition'],
];
const DEFAULT_CARD_FIELDS = Object.fromEntries(CARD_FIELDS.map(([k]) => [k, true]));

// The review types a company is turned ON for (mig 208 company config). TRA/RCM
// come from qa.methods; the closer legs from qa.closer (null = both on). This is
// the universe an agent can be bound to — you can't assign a method the company
// doesn't review.
const enabledWtFromCfg = (cfg) => {
  const methods = cfg?.['qa.methods'] || [];
  const closer = cfg?.['qa.closer'];
  const cOn = (k) => (closer == null ? true : !!closer[k]);
  const s = new Set();
  if (methods.includes('tra')) s.add('tra');
  if (methods.includes('rcm')) s.add('rcm');
  if (cOn('closer_sales')) s.add('closer_sales');
  if (cOn('closer_dispo')) s.add('closer_dispo');
  return s;
};

function AgentsTab({ companyId, canManage, isSuper = false }) {
  const [agents, setAgents] = useState(null);
  const [fields, setFields] = useState(null);
  const [savingId, setSavingId] = useState({});    // agentId → 'saving' | 'saved'
  const [q, setQ] = useState('');                  // agent name search
  const [undone, setUndone] = useState({});        // agentId → open (pending+in_review) count
  const [canClear, setCanClear] = useState(false); // compliance-granted clear-tasks right
  const [clearing, setClearing] = useState(null);  // agentId | '__all__' while a clear runs
  const [clearWt, setClearWt] = useState('');       // '' = every section, else one work type
  const [enabledWt, setEnabledWt] = useState(null); // Set of review types this company is ON for — gates the method checkboxes

  const load = useCallback(() => {
    client.get('qa/agent-methods', { params: { company_id: companyId } }).then(r => setAgents(r.data.agents || [])).catch(() => setAgents([]));
    client.get('qa/config', { params: { company_id: companyId } }).then(r => {
      setFields({ ...DEFAULT_CARD_FIELDS, ...(r.data.config?.['qa.card_fields'] || {}) });
      // superadmin can always clear (backend bypasses the toggle); managers need
      // compliance to have granted it per-company.
      setCanClear(isSuper || !!r.data.config?.['qa.manager_can_clear']);
    }).catch(() => setFields(DEFAULT_CARD_FIELDS));
    // the company's enabled review types — the universe an agent may be bound to
    client.get('qa/admin/company-config', { params: { company_id: companyId } })
      .then(r => setEnabledWt(enabledWtFromCfg(r.data.config || {})))
      .catch(() => setEnabledWt(new Set(['tra', 'rcm', 'closer_sales', 'closer_dispo'])));   // fail-open: never over-restrict
    client.get('qa/agents', { params: { company_id: companyId } })
      .then(r => setUndone(Object.fromEntries((r.data.agents || []).map(a => [a.id, a.undone || 0]))))
      .catch(() => setUndone({}));
  }, [companyId, isSuper]);
  useEffect(() => { load(); }, [load]);
  // the review types the company is on for → the only methods an agent can be given
  const enabledMethods = AGENT_METHODS.filter(([m]) => !enabledWt || enabledWt.has(m)).map(([m]) => m);

  const totalUndone = Object.values(undone).reduce((s, n) => s + n, 0);
  const clearUndone = async (agentId) => {
    const who = agentId ? (agents?.find(a => a.id === agentId)?.name || 'this agent') : 'ALL QA agents';
    const scope = clearWt ? ` ${SLOT_LABEL[clearWt] || clearWt}` : '';
    const n = agentId ? (undone[agentId] || 0) : totalUndone;   // total across sections (a section is a subset)
    if (!n) { toast('Nothing to clear — no un-scored tasks.'); return; }
    if (!window.confirm(`Clear${scope} un-scored task(s) for ${who}?\n\nOnly PENDING / in-progress tasks are removed. Completed (scored) work stays.`)) return;
    setClearing(agentId || '__all__');
    try {
      const body = { company_id: companyId };
      if (agentId) body.agent_id = agentId;
      if (clearWt) body.work_type = clearWt;
      const r = await client.post('qa/clear-undone', body);
      toast.success(`Cleared ${r.data.cleared} un-scored task(s).`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not clear tasks.');
    } finally { setClearing(null); }
  };

  // Derive the next methods from the LATEST state inside the functional update —
  // so rapid toggles never race on a stale `agent.methods` closure (that race is
  // why saves seemed to "not stick" / lag). Optimistic + a brief saved ✓.
  const toggleMethod = (agent, m) => {
    setAgents(list => {
      const cur = list.find(a => a.id === agent.id); if (!cur) return list;
      const methods = cur.methods.includes(m) ? cur.methods.filter(x => x !== m) : [...cur.methods, m];
      setSavingId(s => ({ ...s, [agent.id]: 'saving' }));
      client.put('qa/agent-methods', { company_id: companyId, user_id: agent.id, methods })
        .then(() => { setSavingId(s => ({ ...s, [agent.id]: 'saved' })); setTimeout(() => setSavingId(s => { const n = { ...s }; if (n[agent.id] === 'saved') delete n[agent.id]; return n; }), 1400); })
        .catch(() => { toast.error('Could not update methods'); setSavingId(s => { const n = { ...s }; delete n[agent.id]; return n; }); load(); });
      return list.map(a => a.id === agent.id ? { ...a, methods } : a);
    });
  };
  const setAllMethods = (agent, on) => {
    const methods = on ? enabledMethods : [];   // "All" = all ENABLED types, not every type
    setAgents(list => list.map(a => a.id === agent.id ? { ...a, methods } : a));
    setSavingId(s => ({ ...s, [agent.id]: 'saving' }));
    client.put('qa/agent-methods', { company_id: companyId, user_id: agent.id, methods })
      .then(() => { setSavingId(s => ({ ...s, [agent.id]: 'saved' })); setTimeout(() => setSavingId(s => { const n = { ...s }; if (n[agent.id] === 'saved') delete n[agent.id]; return n; }), 1400); })
      .catch(() => { toast.error('Could not update methods'); load(); });
  };
  const toggleField = async (key) => {
    const next = { ...fields, [key]: !fields[key] };
    setFields(next);
    try { await client.put('qa/config', { company_id: companyId, key: 'qa.card_fields', value: next }); }
    catch { toast.error('Could not save fields'); load(); }
  };

  return (
    <div className="grid grid-cols-2 gap-5">
      {canManage && <div className="col-span-2"><CompanyReviewConfig companyId={companyId} onChange={load} /></div>}
      {/* agent → method binding */}
      <div>
        <div className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>QA agents &amp; methods <InfoTip text="Give each agent the review types they'll score. You can only check the types enabled in Review types above — a locked 🔒 method means the company isn't reviewing that type. An agent then sees and can be assigned only the types checked here (Live + My tasks hide the rest)." /></div>
        <div className="text-[11px] mb-3 flex items-center gap-2 flex-wrap" style={{ color: 'var(--color-text-tertiary)' }}>
          <span>Applies to the company in the header. You can only check the types enabled above — <b>🔒 = off for this company</b>.</span>
          {canManage && canClear && agents?.length > 0 && (
            <span className="ml-auto flex items-center gap-1.5">
              <ThemedSelect value={clearWt} onChange={e => setClearWt(e.target.value)} style={{ ...inp, padding: '3px 6px', fontSize: 11 }} title="Limit clearing to one section, or clear every section">
                <option value="">Every section</option>
                <option value="tra">TRA · Transfers</option>
                <option value="closer_sales">Closed Sale</option>
                <option value="closer_dispo">Unclosed Sale</option>
                <option value="rcm">RCM · Random</option>
              </ThemedSelect>
              <button onClick={() => clearUndone(null)} disabled={clearing !== null || !totalUndone}
                className="text-[11px] font-bold px-2.5 py-1 rounded inline-flex items-center gap-1"
                style={{ background: totalUndone ? 'rgba(220,38,38,0.12)' : 'var(--color-surface-hover)', color: totalUndone ? 'var(--color-danger-600, #dc2626)' : 'var(--color-text-tertiary)', border: '1px solid currentColor', opacity: clearing !== null ? 0.6 : 1 }}
                title="Delete un-scored (pending / in-progress) tasks for all agents in the chosen section. Completed work stays.">
                {clearing === '__all__' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Clear un-scored{clearWt ? '' : ` (${totalUndone})`}
              </button>
            </span>
          )}
        </div>
        {agents === null ? <Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
          : !agents.length ? <div className="text-sm p-4 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>No QA agents in this company yet. Create users with the <b>QA Agent</b> role first.</div>
          : <>
            {enabledWt && enabledWt.size === 0 && (
              <div className="text-[11px] p-2.5 rounded-lg mb-2 flex items-center gap-1.5" style={{ background: 'rgba(217,119,6,0.1)', color: 'var(--color-warning-600, #d97706)', border: '1px solid rgba(217,119,6,0.3)' }}>
                <Info size={13} /> No review types are on for this company. Turn one on in <b>Review types</b> above before assigning methods.
              </div>
            )}
            {agents.length > 4 && (
              <div className="relative mb-2">
                <Search size={13} className="absolute left-2.5 top-2.5" style={{ color: 'var(--color-text-tertiary)' }} />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${agents.length} agents…`} style={{ ...inp, paddingLeft: 28 }} />
              </div>
            )}
            <div className="space-y-2">
              {agents.filter(a => !q.trim() || (a.name || '').toLowerCase().includes(q.trim().toLowerCase())).map(a => {
                const allOn = enabledMethods.length > 0 && enabledMethods.every(m => a.methods.includes(m));
                return (
                <div key={a.id} className="flex items-center gap-2 p-2.5 rounded-xl flex-wrap" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <User size={15} style={{ color: 'var(--color-text-tertiary)' }} />
                  <div className="min-w-0 flex-1 text-sm font-semibold truncate flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>{a.name}
                    {savingId[a.id] === 'saving' && <Loader2 size={11} className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />}
                    {savingId[a.id] === 'saved' && <span className="text-[10px] font-bold" style={{ color: 'var(--color-success-600, #059669)' }}>✓ saved</span>}
                    {undone[a.id] > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full align-middle" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)' }}>{undone[a.id]} to do</span>}
                  </div>
                  {AGENT_METHODS.map(([m, label, tint]) => {
                    const on = a.methods.includes(m);
                    const typeOn = !enabledWt || enabledWt.has(m);   // does the company review this type?
                    const clickable = typeOn || on;                  // a stale binding can always be UNbound
                    const title = typeOn ? SLOT_LABEL[m]
                      : (on ? `${label}: this review type is OFF for the company — click to unbind`
                            : `${label}: turn it on in "Review types" above before assigning`);
                    return (
                      <button key={m} disabled={!clickable} onClick={() => clickable && toggleMethod(a, m)} title={title}
                        className="text-[10px] font-bold px-2 py-1 rounded uppercase whitespace-nowrap transition-colors"
                        style={on
                          ? (typeOn
                              ? { background: `${tint}26`, color: tint, border: '1px solid currentColor' }
                              : { background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)', border: '1px dashed var(--color-border)', textDecoration: 'line-through' })
                          : (typeOn
                              ? { background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)', border: '1px solid transparent' }
                              : { background: 'transparent', color: 'var(--color-text-tertiary)', border: '1px dashed var(--color-border)', opacity: 0.45, cursor: 'not-allowed' })}>
                        {on ? '✓ ' : (typeOn ? '' : '🔒 ')}{label}
                      </button>
                    );
                  })}
                  <button onClick={() => setAllMethods(a, !allOn)} title={allOn ? 'Unbind all methods' : 'Bind all methods'}
                    className="text-[10px] font-bold px-2 py-1 rounded whitespace-nowrap" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                    {allOn ? 'None' : 'All'}
                  </button>
                  {canManage && canClear && (
                    <button onClick={() => clearUndone(a.id)} disabled={clearing !== null || !undone[a.id]}
                      className="p-1.5 rounded" title={undone[a.id] ? `Clear ${undone[a.id]} un-scored task(s) for ${a.name}. Completed work stays.` : 'No un-scored tasks'}
                      style={{ background: 'transparent', color: undone[a.id] ? 'var(--color-danger-600, #dc2626)' : 'var(--color-text-tertiary)', opacity: (!undone[a.id] || clearing !== null) ? 0.4 : 1 }}>
                      {clearing === a.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  )}
                </div>
                );
              })}
            </div>
          </>}
      </div>
      {/* card field visibility */}
      <div>
        <div className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>Task card fields <InfoTip text="Pick which customer details (name, phone, ZIP, state, agent, call date, plan) appear on the agent's task row and scorecard header. Turn off anything they shouldn't see or don't need." /></div>
        <div className="text-[11px] mb-3" style={{ color: 'var(--color-text-tertiary)' }}>Display only — these set which customer details appear on the agent's task row + scorecard header. They don't change what's scored or which calls come in.</div>
        {fields === null ? <Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
          : <div className="p-3 rounded-xl grid grid-cols-2 gap-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', opacity: canManage ? 1 : 0.6 }}>
              {CARD_FIELDS.map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  <input type="checkbox" disabled={!canManage} checked={!!fields[key]} onChange={() => canManage && toggleField(key)} /> {label}
                </label>
              ))}
              {!canManage && <div className="col-span-2 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Changing these needs the “manage QA config” permission.</div>}
            </div>}
      </div>
    </div>
  );
}

// ── AGENT view: a focused "My Tasks" console — only tasks a manager assigned to
// this agent (server forces self + bound method). No pool, no dialer, no config.

// Reviewed-agent label: real name + dialer id, e.g. "John Doe (1002)".
const agentLabel = (a) => a.agent_name ? `${a.agent_name}${a.agent_display ? ` (${a.agent_display})` : ''}` : (a.agent_display || '—');

// Kind of call in plain words — the department's 4 work types.
const callKind = (a) => {
  const wt = a.work_type || (a.sale_id ? 'closer_sales' : a.transfer_id ? (a.subject_role === 'closer' ? 'closer_dispo' : 'tra') : 'rcm');
  return {
    tra: { label: 'TRA · Transfer call', tint: '#2563eb' },
    rcm: { label: 'RCM · Random call', tint: '#d97706' },
    closer_sales: { label: 'Closed Sale call', tint: '#059669' },
    closer_dispo: { label: 'Unclosed Sale call', tint: '#dc2626' },
  }[wt] || { label: 'Call', tint: '#6b7280' };
};

// A prominent "who + what" banner so a reviewer instantly knows whose call they
// are about to grade, of what kind, and for which customer — no guessing.
function ReviewingBanner({ a }) {
  const k = callKind(a);
  const agent = (a.agent_name || a.agent_display) ? agentLabel(a) : 'Unknown agent';
  return (
    <div className="rounded-xl p-2.5 mb-3 flex items-center gap-2.5 flex-wrap" style={{ background: `${k.tint}12`, border: `1px solid ${k.tint}44` }}>
      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: k.tint, color: '#fff' }}>{k.label}</span>
      <span className="text-sm" style={{ color: 'var(--color-text)' }}>Reviewing <b>{agent}</b></span>
      {a.customer_name && <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>· customer <b style={{ color: 'var(--color-text)' }}>{a.customer_name}</b></span>}
      {a.customer_phone && <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>· {a.customer_phone}</span>}
      {a.subject_date && <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>· {fmtDate(a.subject_date)}</span>}
    </div>
  );
}

// One-line context strip: the reviewed agent (not a sheet column) + who the call
// is. Customer/zip/etc are auto-filled INTO the sheet's own meta cells, so this
// stays a single compact line — not a big box.
function ContextLine({ a, fields }) {
  const show = (k) => fields[k] !== false;
  const bits = [
    show('agent') && a && (a.agent_name || a.agent_display) && { icon: <User size={12} />, text: agentLabel(a) },
    show('customer_name') && a.customer_name && { text: a.customer_name },
    show('customer_phone') && a.customer_phone && { text: a.customer_phone },
    show('call_date') && { text: fmtDate(a.subject_date) },
  ].filter(Boolean);
  if (!bits.length) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap text-xs mb-2" style={{ color: 'var(--color-text-secondary)' }}>
      {bits.map((b, i) => <span key={i} className="inline-flex items-center gap-1">{i > 0 && <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>}{b.icon}{b.text}</span>)}
    </div>
  );
}

// Recordings, collapsed by default so the scoresheet is front-and-center.
function RecordingsCollapse({ assignmentId }) {
  const [openR, setOpenR] = useState(false);
  return (
    <div className="mb-3">
      <button onClick={() => setOpenR(o => !o)} className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded"
        style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
        <Headphones size={13} /> Recordings <ChevronDown size={12} style={{ transition: 'transform .15s', transform: openR ? 'rotate(180deg)' : 'none' }} />
      </button>
      {openR && <div className="mt-2"><Candidates assignmentId={assignmentId} /></div>}
    </div>
  );
}

// Centered, roomy scoring popup (replaces the old bottom sheet). Backdrop click
// or Esc closes it; the wide sheet-scorecard scrolls inside.
function ScoreModal({ open, onClose, selfId, canOverride, onScored, onEdited }) {
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(8,10,18,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3vh 12px' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(1120px, 97vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 18, boxShadow: '0 30px 90px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
          <div className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}><ClipboardCheck size={16} style={{ color: 'var(--color-primary-600)' }} /> {open.status === 'scored' ? 'Review call' : 'Score call'}</div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: 'var(--color-text-tertiary)' }} title="Close (Esc)"><XCircle size={20} /></button>
        </div>
        <div className="overflow-auto p-5" style={{ flex: 1 }}>
          <ReviewingBanner a={open} />
          <RecordingsCollapse assignmentId={open.id} />
          {open.status === 'scored'
            ? <ReviewEditor assignment={open} selfId={selfId} canOverride={canOverride} onSaved={onEdited} />
            : <ScoreForm assignment={open} onScored={onScored} />}
        </div>
      </div>
    </div>
  );
}

// AGENT queue — only the tasks still TO DO (a scored/skipped task has already
// moved to Completed). Transfers/Sales split + a date filter that narrows to the
// records whose call happened on a chosen day.
function AgentTasks({ selfId, canOverride, companyId, filterCompany, allowedWt }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState(DEFAULT_CARD_FIELDS);
  const [open, setOpen] = useState(null);
  const [wtab, setWtab] = useState('tra');          // tra | rcm | closer_sales | closer_dispo
  const [day, setDay] = useState('');              // '' = all dates

  useEffect(() => { client.get('qa/config', { params: { company_id: companyId } }).then(r => setFields({ ...DEFAULT_CARD_FIELDS, ...(r.data.config?.['qa.card_fields'] || {}) })).catch(() => {}); }, [companyId]);
  const load = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoading(true);   // silent refresh never blanks the list
    try {
      const r = await client.get('qa/queue', { params: { limit: 200 } });
      const items = r.data.items || [];
      setItems(items);
      // Warm the recordings for the tasks about to be opened. Resolving them
      // hits the dialer live, which is why opening a task used to sit on a
      // spinner; doing it now, in the background, means the first click is
      // already answered. Fire-and-forget — the queue never waits on it.
      const ids = items.filter(it => it.status !== 'scored').slice(0, 25).map(it => it.id);
      if (ids.length) client.post('qa/candidates/warm', { ids }).catch(() => {});
    } catch { if (!silent) setItems([]); }
    finally { setLoading(false); }
  }, []);
  // After scoring: drop the row locally (the `todo` filter hides scored items) —
  // NO refetch, so nothing reloads and the recording panel doesn't re-mount.
  const markScored = (id) => setItems(prev => prev.map(it => it.id === id ? { ...it, status: 'scored' } : it));
  useEffect(() => { load(); }, [load]);
  const show = (k) => fields[k] !== false;

  // To-do only — scoring a call flips its status to 'scored', which drops it from
  // here and surfaces it under Completed. That IS the auto-sort the manager wants.
  // Also honor the header company filter (multi-company agents).
  const todo = items.filter(a => a.status !== 'scored' && a.status !== 'skipped' && (!filterCompany || a.company_id === filterCompany));
  const availableDays = [...new Set(todo.map(a => dayOfDate(a.subject_date)).filter(Boolean))].sort().reverse();
  const byDay = day ? todo.filter(a => dayOfDate(a.subject_date) === day) : todo;
  // FOUR sections by work type — the department's model:
  //   tra          Fronter transfer calls (in the CRM)
  //   rcm          Fronter random calls (raw dialer, not in the CRM)
  //   closer_sales Closer calls that CLOSED a sale
  //   closer_dispo Closer calls that did NOT close (unclosed sale)
  const wtOf = a => a.work_type || (a.sale_id ? 'closer_sales' : a.transfer_id ? (a.subject_role === 'closer' ? 'closer_dispo' : 'tra') : 'rcm');
  const byWt = { tra: [], rcm: [], closer_sales: [], closer_dispo: [] };
  for (const a of byDay) (byWt[wtOf(a)] || byWt.tra).push(a);
  // agent: only the sections their manager checked (bound methods). null = ungated.
  const wtGate = Array.isArray(allowedWt) ? allowedWt : null;
  const shown = (wtGate && !wtGate.includes(wtab)) ? [] : (byWt[wtab] || []);
  // keep the active section on one the manager actually checked for this agent
  useEffect(() => { if (wtGate && wtGate.length && !wtGate.includes(wtab)) setWtab(wtGate[0]); }, [allowedWt]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-sm font-bold inline-flex items-center gap-1" style={{ color: 'var(--color-text)' }}>Queue
          <InfoTip w={310} text="The calls assigned to you that still need scoring, in four sections: TRA = fronter transfer calls (in the CRM); RCM = fronter random calls (raw dialer, not in the CRM); Closed Sale = closer calls that closed a sale; Unclosed Sale = closer calls that didn't close. Open one, listen, score — it moves to Completed automatically." />
        </span>
        <div className="flex items-center gap-1 p-1 rounded-xl flex-wrap" style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)' }}>
          {[['tra', 'TRA · Transfers', ArrowRightLeft], ['rcm', 'RCM · Random', Shuffle], ['closer_sales', 'Closed Sale', DollarSign], ['closer_dispo', 'Unclosed Sale', PhoneOff]]
            .filter(([k]) => !wtGate || wtGate.includes(k)).map(([k, label, Icon]) => (
            <button key={k} onClick={() => { setWtab(k); setOpen(null); }}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all inline-flex items-center gap-1.5"
              style={{ background: wtab === k ? 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' : 'transparent', color: wtab === k ? '#fff' : 'var(--color-text-secondary)', boxShadow: wtab === k ? '0 2px 10px rgba(79,70,229,0.35)' : 'none' }}>
              <Icon size={12} /> {label}
              <span className="text-[10px] px-1.5 rounded-full" style={{ background: wtab === k ? 'rgba(255,255,255,0.25)' : 'var(--color-surface)', color: wtab === k ? '#fff' : 'var(--color-text-tertiary)' }}>{byWt[k].length}</span>
            </button>
          ))}
        </div>
        {/* date filter — view only the records whose call is on the chosen day */}
        <label className="flex items-center gap-1 text-xs ml-1" style={{ color: 'var(--color-text-secondary)' }}><Calendar size={13} /> Date</label>
        <ThemedDate value={day} list="qa-queue-days" onChange={e => { setDay(e.target.value); setOpen(null); }} style={inp} />
        <datalist id="qa-queue-days">{availableDays.map(d => <option key={d} value={d} />)}</datalist>
        {day && <button onClick={() => setDay('')} className="text-[11px] font-bold px-2 py-1 rounded" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>All dates</button>}
        <button onClick={() => load({ silent: true })} className="p-2 rounded-lg" style={{ background: 'var(--color-surface-hover)' }} title="Refresh">{loading && items.length ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-secondary)' }} /> : <RefreshCw size={14} style={{ color: 'var(--color-text-secondary)' }} />}</button>
        <span className="text-xs ml-auto" style={{ color: 'var(--color-text-tertiary)' }}><b style={{ color: 'var(--color-text)' }}>{byDay.length}</b> to&nbsp;do{day ? ` on ${fmtDate(day)}` : ''}</span>
      </div>
      {loading && !items.length ? <div className="text-center py-16"><Loader2 className="animate-spin inline" size={22} style={{ color: 'var(--color-text-tertiary)' }} /></div>
        : !shown.length ? <div className="flex-1 flex flex-col items-center justify-center text-center py-16" style={{ color: 'var(--color-text-tertiary)' }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--color-surface-hover)', display: 'grid', placeItems: 'center', marginBottom: 12 }}>
              {todo.length ? <ClipboardCheck size={26} style={{ color: 'var(--color-primary-500)' }} /> : <CheckSquare size={26} style={{ color: 'var(--color-success-500)' }} />}
            </div>
            <div className="text-sm max-w-xs">{(() => {
              const noun = { tra: 'TRA transfers', rcm: 'random (RCM) calls', closer_sales: 'closed-sale calls', closer_dispo: 'unclosed-sale calls' }[wtab] || 'calls';
              return todo.length
                ? (day ? `No ${noun} to score on ${fmtDate(day)}.` : `No ${noun} in your queue right now.`)
                : "You're all caught up — nothing left in your queue. New calls your QA manager assigns will show up here.";
            })()}</div>
          </div>
        : <div className="flex-1 overflow-auto rounded-xl" style={{ border: '1px solid var(--color-border)' }}>
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead className="sticky top-0 z-10" style={{ background: 'var(--color-surface-hover)' }}>
                <tr>{['Method', 'Customer / Phone', 'Agent reviewed', 'Location', 'Date', 'Dispo', 'Score', ''].map(h => <th key={h} className="text-left px-3 py-2 text-[11px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {shown.map(a => (
                  <tr key={a.id} onClick={() => setOpen(a)} className="cursor-pointer transition-colors hover:bg-[var(--color-surface-hover)]"
                    style={{ borderTop: '1px solid var(--color-border)', background: open?.id === a.id ? 'var(--color-surface-hover)' : undefined }}>
                    {/* the WORK TYPE, not `method` — method holds only tra|rcm, so a
                        closed- or unclosed-sale task was showing an "RCM" tag */}
                    <td className="px-3 py-2 whitespace-nowrap"><MethodPill m={wtOf(a)} /> <StatusPill s={a.status} /></td>
                    <td className="px-3 py-2">
                      <div className="font-semibold truncate" style={{ color: 'var(--color-text)', maxWidth: 200 }}>{show('customer_name') ? (a.customer_name || '—') : '—'}</div>
                      {show('customer_phone') && a.customer_phone && <div className="text-[11px] tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>{a.customer_phone}</div>}
                    </td>
                    <td className="px-3 py-2 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>{show('agent') ? agentLabel(a) : '—'}</td>
                    <td className="px-3 py-2 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>{(show('state') || show('zip')) ? ([show('state') && a.customer_state, show('zip') && a.customer_zip].filter(Boolean).join(' ') || '—') : '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>{show('call_date') ? fmtDate(a.subject_date) : '—'}</td>
                    {/* the closer's disposition CODE, as the dialer and the
                        client's sheets write it — no translation to invent */}
                    <td className="px-3 py-2 whitespace-nowrap text-[12px]">
                      {show('disposition') && a.disposition
                        ? <span className="font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>{a.disposition}</span>
                        : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap"><ScoreCell a={a} /></td>
                    <td className="px-2 py-2"><ChevronRight size={15} style={{ color: 'var(--color-text-tertiary)' }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}

      <ScoreModal open={open} onClose={() => setOpen(null)} selfId={selfId} canOverride={canOverride}
        onScored={() => { markScored(open.id); setOpen(null); toast.success('Scored — moved to Completed'); }}
        onEdited={() => load({ silent: true })} />
    </div>
  );
}

// Agent "Work" surface — the two ways work arrives, in ONE place with a segmented
// toggle, so there's no "Live vs Queue, which do I use?" confusion:
//   • Live     — the real-time floor: grab any call as it lands (pull / self-serve),
//                even a transfer the fronter hasn't finished the form on.
//   • My tasks — the work a QA manager assigned to you (push / assigned worklist).
// Both open the same scorecard modal.
function AgentWork({ selfId, companyId, scoped, allowedWt }) {
  const [seg, setSeg] = useState('live');
  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="flex items-center gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)' }}>
          {[
            ['live', 'Live', 'Calls as they land from the dialer — grab any to review, even before the fronter finishes the form.'],
            ['mine', 'My tasks', 'The work a QA manager assigned to you (any age), across your sections.'],
          ].map(([k, l, tip]) => (
            <button key={k} onClick={() => setSeg(k)} title={tip} className="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors"
              style={{ background: seg === k ? 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' : 'transparent', color: seg === k ? '#fff' : 'var(--color-text-secondary)' }}>{l}</button>
          ))}
        </div>
        <InfoTip text="Two ways work reaches you. LIVE is the real-time floor — grab any call the moment it lands (even an incomplete transfer). MY TASKS is what a manager assigned to you. Both open the same scorecard." />
      </div>
      <div className="flex-1 min-h-0">
        {seg === 'live'
          ? <LiveTab scoped={scoped} selfId={selfId} canOverride={false} isManager={false} allowedWt={allowedWt} />
          : <AgentTasks selfId={selfId} canOverride={false} companyId={companyId} filterCompany={scoped} allowedWt={allowedWt} />}
      </div>
    </div>
  );
}

function QAAgentView({ user, logout }) {
  // History-backed so the iOS edge swipe goes back a tab instead of dismissing
  // the installed app. `persist: false` — this shell has never remembered its
  // tab across reloads and this change is about the back stack, not that.
  const [tab, setTab] = useHistoryTab(null, 'work', { persist: false });
  // A tapped QA notification (assignment or review) lands on the work queue —
  // which is the thing the notification is telling them to go do.
  const qaFocus = useNavFocus();
  useEffect(() => { if (qaFocus?.kind === 'qa') setTab('work'); }, [qaFocus]); // eslint-disable-line react-hooks/exhaustive-deps
  const [methods, setMethods] = useState(null);
  const { companies, all, companyId, setCompanyId } = useQaCompanies();
  const scoped = companyId === ALL_CO ? '' : companyId;
  useEffect(() => { client.get('qa/my-methods').then(r => setMethods(r.data.methods || [])).catch(() => setMethods([])); }, []);
  const tabs = [{ key: 'work', label: 'Work', icon: Radio }, { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }, { key: 'reviews', label: 'Completed', icon: ClipboardCheck }];

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: 'var(--color-bg)' }}>
      <DotGridBg />
      <header className="flex items-center gap-4 px-5 py-3 border-b relative z-10" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex items-center gap-2 font-extrabold" style={{ color: 'var(--color-text)' }}><ClipboardCheck size={20} style={{ color: 'var(--color-primary-600)' }} /> QA</div>
        <nav className="flex items-center gap-1">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold"
              style={tab === t.key ? { background: 'var(--color-surface-hover)', color: 'var(--color-text)' } : { color: 'var(--color-text-secondary)' }}>
              <t.icon size={15} />{t.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {Array.isArray(methods) && methods.length > 0 && <span className="flex items-center gap-1">{methods.map(m => <MethodPill key={m} m={m} />)}</span>}
          <CompanyPicker companies={companies} all={all} companyId={companyId} onChange={setCompanyId} />
          <ChatLauncher />
          <ThemeToggle />
          <ProfileChip user={user} />
          <button onClick={logout} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}><LogOut size={14} />Logout</button>
        </div>
      </header>
      <main className="flex-1 p-2 sm:p-5 overflow-hidden relative z-10">
        {/* Agents only see the work-type sections their manager CHECKED for them
            (their bound methods) — in both Live and My tasks. `methods` = null
            while loading (treated as no gate); the manager view is ungated. */}
        {tab === 'work' && <AgentWork selfId={user?.id} companyId={scoped || user?.company_id} scoped={scoped} allowedWt={methods} />}
        {tab === 'dashboard' && <div className="h-full overflow-auto"><QAAgentDashboard companyId={scoped} /></div>}
        {tab === 'reviews' && <CompletedTab managerView={false} companyId={scoped} selfId={user?.id} canOverride={false} />}
      </main>
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────
export default function QAShell() {
  const { user, hasPermission, logout } = useAuth();
  const isSuper = user?.role === 'superadmin';
  const canManage = isSuper || hasPermission('manage_qa_config');
  const canReports = isSuper || hasPermission('view_qa_reports');
  const canAssign = isSuper || hasPermission('assign_qa_tasks');
  const canOverride = isSuper || hasPermission('override_qa_review');
  const canQueue = isSuper || hasPermission('view_qa_queue');   // Dashboard/Live/Completed all call view_qa_queue-gated endpoints
  // Land on the first tab the user can actually load: a reports-only or config-only
  // role has no view_qa_queue, so its Dashboard/Live/Completed would 403 — start it
  // on Reports (or Config / Day) instead of a blank 403 landing.
  // History-backed (see QAAgentView above for why). `persist: false` keeps the
  // existing "land on the first tab this role can actually load" behaviour as
  // the default instead of restoring a remembered tab that may now 403.
  const [tab, setTab] = useHistoryTab(
    null,
    canQueue ? 'dashboard' : canReports ? 'reports' : canManage ? 'config' : canAssign ? 'day' : 'dashboard',
    { persist: false },
  );
  // A tapped QA notification lands on Completed — a manager's QA notifications
  // are about reviews that have been done, not about work waiting for them.
  // Declared before the QAAgentView early-return below so hook order is stable.
  const qaFocus = useNavFocus();
  useEffect(() => {
    if (qaFocus?.kind === 'qa') setTab(canQueue ? 'completed' : 'reports');
  }, [qaFocus]); // eslint-disable-line react-hooks/exhaustive-deps

  // A QA AGENT (no manager-side permission at all) gets the focused agent
  // console. ANY manager-side permission — assign, config, or reports — opens
  // the manager shell; each tab still gates itself by its own permission.
  const isManager = isSuper || canAssign || canManage || canReports;
  if (!isManager) return <QAAgentView user={user} logout={logout} />;

  const { companies, all, companyId, setCompanyId } = useQaCompanies();
  // A specific company for scoped tabs; '' when "All my companies" is picked so
  // the server falls back to the user's full allowed set. Config/Agents need a
  // concrete company, so they fall back to the primary company.
  const scoped = companyId === ALL_CO ? '' : companyId;
  const tabs = [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, show: canQueue },
    { key: 'live', label: 'Live', icon: Radio, show: canQueue },
    // { key: 'queue', ... }  ← CRM Transfers/Sales browser: DISABLED for now.
    { key: 'day', label: 'Day Recordings', icon: Headphones, show: isSuper || canAssign },
    { key: 'agents', label: 'Agents', icon: UserPlus, show: isSuper || canAssign },
    { key: 'completed', label: canReports ? 'Completed' : 'My Reviews', icon: ClipboardCheck, show: canQueue },
    { key: 'config', label: 'Scorecards & Config', icon: Settings2, show: canManage },
    { key: 'reports', label: 'Reports', icon: BarChart3, show: canReports },
  ].filter(t => t.show);

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: 'var(--color-bg)' }}>
      <DotGridBg />
      <header className="flex items-center gap-4 px-5 py-3 border-b relative z-10" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex items-center gap-2 font-extrabold" style={{ color: 'var(--color-text)' }}><ClipboardCheck size={20} style={{ color: 'var(--color-primary-600)' }} /> QA</div>
        <nav className="flex items-center gap-1">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold"
              style={tab === t.key ? { background: 'var(--color-surface-hover)', color: 'var(--color-text)' } : { color: 'var(--color-text-secondary)' }}>
              <t.icon size={15} />{t.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <CompanyPicker companies={companies} all={all} companyId={companyId} onChange={setCompanyId} />
          <ChatLauncher />
          <ThemeToggle />
          <ProfileChip user={user} />
          <button onClick={logout} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}><LogOut size={14} />Logout</button>
        </div>
      </header>
      <main className="flex-1 p-2 sm:p-5 overflow-hidden relative z-10">
        {tab === 'dashboard' && <div className="h-full overflow-auto"><QAManagerDashboard companyId={scoped} onOpenReports={() => canReports && setTab('reports')} /></div>}
        {tab === 'live' && <LiveTab scoped={scoped} selfId={user?.id} canOverride={canOverride} isManager={isSuper || canAssign} />}
        {tab === 'day' && <>
          <CrmDayPanel companyId={companyId} scoped={scoped} canAssign={isSuper || canAssign} />
          <DayRecordingsTab canAssign={isSuper || canAssign} companyId={companyId} scoped={scoped} />
        </>}
        {tab === 'agents' && <AgentsTab companyId={scoped || user?.company_id} canManage={canManage} isSuper={isSuper} />}
        {tab === 'completed' && <CompletedTab managerView={canReports} companyId={scoped} selfId={user?.id} canOverride={canOverride} />}
        {tab === 'config' && canManage && <ConfigTab companyId={scoped || user?.company_id} companyName={(companies || []).find(c => c.id === (scoped || user?.company_id))?.name} />}
        {tab === 'reports' && canReports && <ReportsTab companyId={scoped} companyName={(companies || []).find(c => c.id === scoped)?.name || ''} />}
      </main>
    </div>
  );
}
