import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import {
  ClipboardCheck, ListChecks, BarChart3, Settings2, Play, Pause, Loader2,
  LogOut, RefreshCw, User, Calendar, CheckCircle2, XCircle,
  ChevronRight, ChevronDown, Send, Shield, Star, Search, Headphones,
  UserPlus, CheckSquare, Square, ArrowRightLeft, Plus, DollarSign, Info, Building2,
  Download, Award, TrendingUp, Table2, CalendarDays, Shuffle, PhoneOff, Trash2, Mic, LayoutDashboard,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';
import SheetScoreRow from '../components/QA/SheetScoreRow';
import { QAAgentDashboard, QAManagerDashboard } from '../components/QA/QADashboard';
import { Donut, Bars, Lines, PALETTE } from '../components/QA/Charts';
import { isSheetConfig } from '../utils/qaSheetFormula';

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
const inp = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '6px 10px', fontSize: 13 };
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
  const optLabel = (c) => `${c.name}${c.pending ? ` · ${c.pending} pending` : ''}${c.qa_enabled === false ? ' · QA off' : ''}`;
  if (companies.length === 1 && !all) return <span className="text-xs font-bold inline-flex items-center gap-1" style={{ color: 'var(--color-text)' }} title={optLabel(companies[0])}><Building2 size={13} style={{ color: 'var(--color-text-tertiary)' }} />{companies[0].name}{companies[0].pending ? <span className="text-[10px] font-bold px-1.5 rounded-full" style={{ background: 'rgba(217,119,6,0.14)', color: 'var(--color-warning-600)' }}>{companies[0].pending}</span> : null}</span>;
  return (
    <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }} title="You only see data for the companies assigned to you">
      <Building2 size={14} style={{ color: 'var(--color-text-tertiary)' }} />
      <select value={companyId} onChange={e => onChange(e.target.value)} style={{ ...inp, fontWeight: 700, padding: '5px 8px' }}>
        {all && <option value={ALL_CO}>All my companies</option>}
        {companies.map(c => <option key={c.id} value={c.id}>{optLabel(c)}</option>)}
      </select>
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

// ── candidate audio player (blob-streamed with auth, like RecordingReviewTab) ──
function Candidates({ assignmentId }) {
  const [rows, setRows] = useState(null);
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

  useEffect(() => {
    let dead = false;
    setRows(null); setTxById({}); setTxOpen({}); setAudioRid(null); setCurTime(0);
    client.get(`qa/assignments/${assignmentId}/candidates`)
      .then(r => { if (!dead) setRows(r.data.candidates || []); })
      .catch(() => { if (!dead) setRows([]); });
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
      const r = await client.post('qa/recordings/transcribe', { box_id: c.box_id, lead_id: c.lead_id, recording_id: c.recording_id, location: c.location });
      setTxById(m => ({ ...m, [c.recording_id]: r.data?.transcript || { text: '' } }));
      setTxOpen(o => ({ ...o, [c.recording_id]: true }));
    } catch (e) { toast.error(e.response?.data?.error || 'Transcription failed'); }
    finally { setTxBusy(null); }
  };

  // seekTo (seconds) lets a transcript word click jump the audio to that word.
  const play = async (c, seekTo = null) => {
    const a = audioRef.current; if (!a) return;
    if (a.dataset.rid === c.recording_id) {
      if (seekTo != null) { a.currentTime = seekTo; a.play().catch(() => {}); }
      else { a.paused ? a.play() : a.pause(); }
      return;
    }
    setLoadingId(c.recording_id);
    try {
      const res = await client.get('qa/recordings/stream', { params: { box_id: c.box_id, lead_id: c.lead_id, recording_id: c.recording_id, location: c.location }, responseType: 'blob' });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(res.data); urlRef.current = url;
      a.src = url; a.dataset.rid = c.recording_id; setAudioRid(c.recording_id); setCurTime(0); a.load();
      if (seekTo != null) { const onMeta = () => { a.currentTime = seekTo; a.removeEventListener('loadedmetadata', onMeta); }; a.addEventListener('loadedmetadata', onMeta); }
      a.play().catch(() => {});
    } catch { toast.error('Could not load that recording'); }
    finally { setLoadingId(null); }
  };

  if (rows === null) return <div className="text-center py-6"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /><div className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Loading recordings…</div></div>;
  if (!rows.length) return <div className="text-center py-6 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No recordings found on the dialer for this call.</div>;
  return (
    <div className="space-y-2">
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
              <div className="text-sm font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtDur(c.duration)} <span className="text-xs font-normal" style={{ color: 'var(--color-text-secondary)' }}>· {c.agent_user || 'agent ?'}</span></div>
              <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{fmtTime(c.start_time)} · box {c.box_id} · rec {c.recording_id}</div>
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
          onPause={() => setPlayingRid(null)} onEnded={() => setPlayingRid(null)}
          onTimeUpdate={() => setCurTime(audioRef.current?.currentTime || 0)} />
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Speed</span>
          {[0.75, 1, 1.5, 2].map(s => (
            <button key={s} onClick={() => { if (audioRef.current) audioRef.current.playbackRate = s; setRate(s); }}
              className="text-[11px] px-2 py-0.5 rounded font-bold transition-colors"
              style={{ background: rate === s ? 'var(--color-primary-600)' : 'var(--color-surface-hover)', color: rate === s ? '#fff' : 'var(--color-text-secondary)' }}>{s}×</button>
          ))}
          <button onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10); }} className="text-[11px] px-2 py-0.5 rounded font-bold ml-1" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }} title="Back 10s">« 10s</button>
          <button onClick={() => { if (audioRef.current) audioRef.current.currentTime += 10; }} className="text-[11px] px-2 py-0.5 rounded font-bold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }} title="Forward 10s">10s »</button>
        </div>
      </div>
    </div>
  );
}

// Pre-fill a sheet scorecard's meta columns from what we already know about the
// call, so the agent doesn't retype it (the cells stay editable). Fuzzy-matches
// the config's meta_field keys → assignment data.
function metaAutoFill(cfg, a) {
  const out = {};
  const rec = a.recording_ref || {};
  const dispo = a.disposition || a.dispo || rec.disposition || '';
  for (const f of (cfg?.meta_fields || [])) {
    const k = `${f.key} ${f.label || ''}`.toLowerCase();
    if (/center|company/.test(k)) continue;         // center name isn't ours to guess
    else if (/call.?id|lead.?id|call_id/.test(k)) out[f.key] = rec.lead_id || a.lead_id || a.call_id || '';
    else if (/date/.test(k)) { const d = a.subject_date || a.call_date || rec.start_time || a.created_at; out[f.key] = d ? new Date(d).toLocaleDateString() : ''; }
    else if (/agent/.test(k)) out[f.key] = a.agent_name || a.agent_display || a.subject_name || '';   // BEFORE the /name/ rule
    else if (/cli|phone|number|caller/.test(k)) out[f.key] = a.customer_phone || rec.phone || '';
    else if (/actual/.test(k)) continue;            // "Call Disposition Actual" — the QA agent enters the real one
    else if (/disposition|dispo/.test(k)) out[f.key] = dispo;
    else if (/name/.test(k)) out[f.key] = a.customer_name || '';
    else if (/zip|postal/.test(k)) out[f.key] = a.customer_zip || '';
    else if (/state/.test(k)) out[f.key] = a.customer_state || '';
    else if (/duration/.test(k)) out[f.key] = a.duration != null ? fmtDur(a.duration) : (rec.duration != null ? fmtDur(rec.duration) : '');
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

  useEffect(() => {
    setScorecard(null); setLoadErr(''); setScores({}); setNotes({}); setOverall('');
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

  if (loadErr) return <div className="py-4 text-sm text-center" style={{ color: 'var(--color-error-600)' }}>{loadErr}</div>;
  if (scorecard === null) return <div className="py-4 text-center"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>;
  if (!scorecard) return <div className="py-4 text-sm text-center" style={{ color: 'var(--color-error-600)' }}>No active scorecard for {SLOT_LABEL[assignment.work_type || assignment.method] || (assignment.method || '').toUpperCase()} yet. Ask a QA manager to set one up in Scorecards &amp; Config.</div>;

  // sheet_v2 (WaveTech replication) → horizontal spreadsheet-row scoring UI
  if (isSheetConfig(scorecard.criteria)) {
    return (
      <SheetScoreRow
        config={scorecard.criteria}
        initialValues={metaAutoFill(scorecard.criteria, assignment)}
        busy={busy}
        onSubmit={async (payload) => {
          setBusy(true);
          try {
            const r = await client.post('qa/reviews', { assignment_id: assignment.id, ...payload });
            const c = r.data.computed || {};
            toast.success(c.final_score != null
              ? `Review submitted — ${c.passed ? 'Pass' : 'FAIL'} (Final ${c.final_score})`
              : `Review submitted — Quality ${c.quality_score == null ? 'N/A' : `${c.quality_score}%`}`);
            onScored?.();
          } catch (e) { toast.error(e.response?.data?.error || 'Could not submit review'); }
          finally { setBusy(false); }
        }}
      />
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

// ── Reports tab ─────────────────────────────────────────────────────────────────
const ChartCard = ({ title, children, wide }) => (
  <div className={`p-4 rounded-2xl ${wide ? 'col-span-full' : ''}`} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
    <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-tertiary)' }}>{title}</div>
    {children}
  </div>
);

function ReportsTab({ companyId, companyName = '' }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const [f, setF] = useState({ method: '', agent: '', reviewer: '', date_from: monthAgo, date_to: today });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

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
  const methodSplit = [
    { label: 'TRA', value: data?.method_split?.tra || 0, color: PALETTE[0] },
    { label: 'RCM', value: data?.method_split?.rcm || 0, color: PALETTE[4] },
  ];
  const bucketBars = (data?.buckets || []).map((b, i) => ({ label: b.label, value: b.n, color: ['#dc2626', '#d97706', '#2563eb', '#16a34a'][i] }));
  const scoreSeries = [{ name: 'Avg score', color: PALETTE[0], points: ts.map(d => ({ x: d.date, y: d.avg_score })) }];
  if ((s.passed || 0) + (s.failed || 0) > 0) scoreSeries.push({ name: 'Pass rate', color: '#16a34a', points: ts.map(d => ({ x: d.date, y: d.pass_rate == null ? 0 : d.pass_rate })) });
  const volMax = Math.max(1, ...ts.map(d => d.reviews));
  const agentBars = (data?.by_agent || []).slice(0, 10).map(a => ({ label: a.name, value: a.avg_score }));
  const reviewerBars = (data?.by_reviewer || []).slice(0, 10).map(r => ({ label: r.name, value: r.reviews }));

  const KPI = ({ label, value, tint }) => (
    <div className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{label}</div>
      <div className="text-2xl font-extrabold" style={{ color: tint || 'var(--color-text)' }}>{value}</div>
    </div>
  );

  return (
    <div className="h-full overflow-auto pb-4">
      {/* filters */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <select value={f.agent} onChange={e => set('agent', e.target.value)} style={inp} title="Reviewed agent">
          <option value="">All agents</option>
          {(data?.agents || []).map(a => <option key={a.key} value={a.key}>{a.name}</option>)}
        </select>
        <select value={f.method} onChange={e => set('method', e.target.value)} style={inp}><option value="">TRA + RCM</option><option value="tra">TRA</option><option value="rcm">RCM</option></select>
        <select value={f.reviewer} onChange={e => set('reviewer', e.target.value)} style={inp} title="Scored by">
          <option value="">Any reviewer</option>
          {(data?.reviewers || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}><Calendar size={13} />from</label>
        <input type="date" value={f.date_from} max={f.date_to} onChange={e => set('date_from', e.target.value)} style={inp} />
        <label className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>to</label>
        <input type="date" value={f.date_to} max={today} onChange={e => set('date_to', e.target.value)} style={inp} />
        <button onClick={load} className="p-2 rounded-lg" style={{ background: 'var(--color-surface-hover)' }} title="Refresh"><RefreshCw size={14} style={{ color: 'var(--color-text-secondary)' }} /></button>
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
        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>from scored reviews only</span>
      </div>

      {loading && !data ? <div className="text-center py-16"><Loader2 className="animate-spin inline" size={22} style={{ color: 'var(--color-text-tertiary)' }} /></div>
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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ChartCard title="Pass vs Fail"><Donut data={passFail} centerValue={`${s.pass_rate || 0}%`} centerLabel="pass" /></ChartCard>
              <ChartCard title="Method mix"><Donut data={methodSplit} centerValue={s.reviews} centerLabel="reviews" /></ChartCard>
              <ChartCard title="Score distribution"><Bars data={bucketBars} /></ChartCard>

              <ChartCard title="Score & pass rate over time" wide><Lines series={scoreSeries} yMax={100} yUnit="%" /></ChartCard>
              <ChartCard title="Reviews per day" wide><Lines series={[{ name: 'Reviews', color: PALETTE[2], points: ts.map(d => ({ x: d.date, y: d.reviews })) }]} yMax={volMax} /></ChartCard>

              <ChartCard title="By agent — avg score"><Bars data={agentBars} max={100} unit="%" /></ChartCard>
              <ChartCard title="Who's scoring — reviews"><Bars data={reviewerBars} color={PALETTE[4]} /></ChartCard>
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
  );
}

// ── Visual scorecard field editor (sheet_v2) — add/remove/label fields, set
// which are 0-4 ratings vs Y/N, edit thresholds. Editing a GLOBAL template saves
// a company-scoped COPY (overrides the template for this company only). ────────
const slug = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || ('f' + Date.now());

function FieldRows({ title, tint, fields, onChange, extra, info }) {
  const set = (i, patch) => onChange(fields.map((f, j) => j === i ? { ...f, ...patch } : f));
  const remove = i => onChange(fields.filter((_, j) => j !== i));
  const add = () => onChange([...fields, { key: slug('field ' + (fields.length + 1)), label: 'New field', ...(extra?.defaults || {}) }]);
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
        {fields.map((f, i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={f.label} onChange={e => set(i, { label: e.target.value, key: f._locked ? f.key : slug(e.target.value) })} style={{ ...inp, flex: 1 }} />
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
        {!fields.length && <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>No fields yet — click “+ add”.</div>}
      </div>
    </div>
  );
}

// The client's WaveTech sheet Call_Out_Come list (Rough Work / Fronter tabs).
const WAVETECH_OUTCOMES = [
  'Passed', 'Qualifying Questions Missing', 'Consent not taken properly', 'Inaccurate rebuttal',
  'Sarcastic CX', 'NEFW', 'Defective listening', 'DAIR', 'Misguide', 'No Consent', 'Windowshop',
  'Overeducating', 'Already Have Warranty', "Lack of cx's understanding", 'Wrong verbiage',
  'Communication', 'Free Sense', 'Paid Off Dealership Warranty', 'Probe Missing', 'Script Bound',
  'Incomplete Product Context', 'Multiple Parameter Issue', 'Lack of rebuttal',
];

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

function ScorecardEditor({ scorecard, companyId, onClose, onSaved }) {
  const [cfg, setCfg] = useState(() => {
    const c = JSON.parse(JSON.stringify(scorecard.criteria || {}));
    c.rating_criteria = c.rating_criteria || [];
    c.penalty_flags = c.penalty_flags || [];
    c.tracking_flags = c.tracking_flags || [];
    c.autofail = c.autofail || { formula_type: 'all_yes', fields: [] };
    c.autofail.fields = c.autofail.fields || [];
    return c;
  });
  const [name, setName] = useState(scorecard.name);
  const [passT, setPassT] = useState(scorecard.pass_threshold ?? '');
  const [busy, setBusy] = useState(false);
  const isGlobal = !scorecard.company_id;
  const hasQuality = !!(cfg.quality_score && Array.isArray(cfg.quality_score.fields));

  const patch = fn => setCfg(c => { const n = JSON.parse(JSON.stringify(c)); fn(n); return n; });

  const save = async () => {
    setBusy(true);
    try {
      const criteria = { ...cfg, model: 'sheet_v2' };
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="rounded-2xl p-5 overflow-auto" style={{ width: 'min(720px, 96vw)', maxHeight: '90vh', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-base font-bold" style={{ color: 'var(--color-text)' }}>Edit scorecard fields <MethodPill m={scorecard.method} /></div>
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

        <FieldRows title="Ratings (score 0–4)" tint="#2563eb" fields={cfg.rating_criteria} extra={{ kind: '0–4 rating', rating: true }} onChange={v => patch(n => { n.rating_criteria = v; })}
          info="The main graded questions. The reviewer rates each 0–4; the ones marked “in base” are summed into the Base Score (then turned into a %). Use these for things like tone, script adherence, rebuttals." />
        <FieldRows title="Compliance — Auto-Fail (Yes / No)" tint="#dc2626" fields={cfg.autofail.fields} extra={{ kind: 'Y / N' }} onChange={v => patch(n => { n.autofail.fields = v; })}
          info="Hard compliance rules. If the reviewer answers Yes to ANY auto-fail question, the whole call scores 0 and is marked failed — no matter how good the ratings were. Use for deal-breakers (no consent, DNC, misrepresentation)." />
        <FieldRows title="Penalty flags (Yes = deduct)" tint="#d97706" fields={cfg.penalty_flags} extra={{ kind: 'Y / N', penalty: true, defaults: { penalty: -5 } }} onChange={v => patch(n => { n.penalty_flags = v; })}
          info="Softer mistakes that don’t fail the call but cost points. Each flag set to Yes subtracts its points from the final score. Set the point value per flag on the right of each row." />
        {hasQuality && <FieldRows title="Sale-compliance checklist (Yes / No)" tint="#059669" fields={cfg.quality_score.fields} extra={{ kind: 'Y / N' }} onChange={v => patch(n => { n.quality_score.fields = v; })}
          info="A Yes/No checklist scored as a percentage — the Quality score is the share of items answered Yes. Used on closer/RCM sale reviews to measure sale-compliance separately from the 0–4 ratings." />}
        <FieldRows title="Tracking only (Yes / No, no score effect)" tint="#6b7280" fields={cfg.tracking_flags} extra={{ kind: 'Y / N' }} onChange={v => patch(n => { n.tracking_flags = v; })}
          info="Questions you want the reviewer to answer for reporting, but that must NOT change the score. Pure data collection — shows up in reports, never adds or removes points." />
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
    const starter = { model: 'sheet_v2', rating_criteria: [], autofail: { formula_type: 'all_yes', fields: [] }, penalty_flags: [], tracking_flags: [] };
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
              <select value={draft.method} onChange={e => setDraft(d => ({ ...d, method: e.target.value }))} style={inp} title="Which of the 4 QA sections this scorecard grades">
                <option value="tra">TRA · Transfers</option>
                <option value="closer_sales">Closed Sale</option>
                <option value="closer_dispo">Unclosed Sale</option>
                <option value="rcm">RCM · Random</option>
              </select>
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
        <select value={v.mode} onChange={e => onSample({ ...v, mode: e.target.value })} style={inp}><option value="percentage">Percentage</option><option value="fixed">Fixed N</option></select>
        <input type="number" value={v.value} onChange={e => onSample({ ...v, value: +e.target.value })} style={{ ...inp, width: 70 }} />
        <select value={v.period} onChange={e => onSample({ ...v, period: e.target.value })} style={inp}><option value="week">per week</option><option value="day">per day</option></select>
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
      if (assignTo === '__equal__') body.distribute_equally = true; else body.assigned_to = assignTo;
      const r = await client.post('qa/assignments/from-crm', body);
      const label = CRM_WT.find(w => w.key === wt)?.label || wt;
      const bf = r.data.backfilled ? `, linked ${r.data.backfilled} lead id(s)` : '';
      if (r.data.inserted) toast.success(`Assigned ${r.data.inserted} ${label}${r.data.distributed ? ` split across ${r.data.agents} agent(s)` : ''}${bf}`);
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
        <input type="date" value={date} max={yesterday} onChange={e => setDate(e.target.value)} style={inp} />
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white"
          style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', opacity: loading ? 0.5 : 1 }}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Load day
        </button>
        {canAssign && (
          <label className="flex items-center gap-1 text-xs ml-auto" style={{ color: 'var(--color-text-secondary)' }}>Assign to
            <select value={assignTo} onChange={e => setAssignTo(e.target.value)} style={{ ...inp, minWidth: 180 }}>
              <option value="__equal__">⚖ All QA agents — equal split</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.undone ? ` · ${a.undone} to do` : ''}</option>)}
            </select>
          </label>
        )}
      </div>
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

  const play = async (c) => {
    const a = audioRef.current; if (!a) return;
    if (a.dataset.rid === c.recording_id) { a.paused ? a.play() : a.pause(); return; }
    setLoadingRid(c.recording_id);
    try {
      const res = await client.get('qa/recordings/stream', { params: { box_id: c.box_id, lead_id: c.lead_id, recording_id: c.recording_id, location: c.location }, responseType: 'blob' });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(res.data); urlRef.current = url;
      a.src = url; a.dataset.rid = c.recording_id; a.load(); a.play().catch(() => {});
    } catch { toast.error('Could not load that recording'); }
    finally { setLoadingRid(null); }
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
        <input type="date" value={date} max={yesterday} onChange={e => setDate(e.target.value)} style={inp} />
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
          <select value={xfilter} onChange={e => setXfilter(e.target.value)} style={inp} title="Filter by transferred">
            <option value="all">All calls</option>
            <option value="transferred">Transferred → TRA</option>
            <option value="not">Not transferred → RCM</option>
          </select>
        )}
        {data && (
          <select value={dfilter} onChange={e => setDfilter(e.target.value)} style={inp} title="Filter by disposition">
            <option value="">Any disposition</option>
            <option value="__has">Has a disposition</option>
            {Object.entries(data.dispo_counts || {}).sort((a, b) => b[1] - a[1]).map(([d, n]) => <option key={d} value={d}>{d} ({n})</option>)}
          </select>
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
          <select value={assignWt} onChange={e => setAssignWt(e.target.value)} style={inp} title="Which of the 4 QA work types these calls become">
            <option value="tra">TRA · Transfer (fronter)</option>
            <option value="rcm">RCM · Random (fronter)</option>
            <option value="closer_sales">Closed Sale (closer)</option>
            <option value="closer_dispo">Unclosed Sale (closer)</option>
          </select>
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>to</span>
          <select value={assignTo} onChange={e => setAssignTo(e.target.value)} style={{ ...inp, minWidth: 190 }}>
            <option value="">Select QA agent…</option>
            <option value="__equal__">⚖ All QA agents — equal split</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.role === 'qa_manager' ? ' (mgr)' : ''}</option>)}
          </select>
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
                          <td className="px-3 py-1 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{c.agent_user}</td>
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
      <audio ref={audioRef} controls className="w-full mt-2" style={{ display: urlRef.current ? 'block' : 'none' }}
        onPlay={() => setPlayingRid(audioRef.current?.dataset.rid || null)} onPause={() => setPlayingRid(null)} onEnded={() => setPlayingRid(null)} />
    </div>
  );
}

// ── Completed reviews as a Google-Sheets-style grid (per method/day) ──────────
const GROUP_TINT2 = { rating: 'rgba(37,99,235,0.10)', autofail: 'rgba(220,38,38,0.10)', penalty: 'rgba(217,119,6,0.10)', quality: 'rgba(22,163,74,0.10)', tracking: 'rgba(107,114,128,0.12)', outcome: 'rgba(124,58,237,0.10)', computed: 'rgba(22,163,74,0.16)', meta: 'var(--color-surface-hover)' };
function flattenFields(cfg) {
  if (!cfg || Array.isArray(cfg)) return [];
  const f = [];
  (cfg.rating_criteria || []).forEach(c => f.push({ ...c, group: 'rating', kind: 'rating' }));
  ((cfg.autofail || {}).fields || []).forEach(c => f.push({ ...c, group: 'autofail', kind: 'yn' }));
  (cfg.penalty_flags || []).forEach(c => f.push({ ...c, group: 'penalty', kind: 'yn' }));
  ((cfg.quality_score || {}).fields || []).forEach(c => f.push({ ...c, group: 'quality', kind: 'yn' }));
  (cfg.tracking_flags || []).forEach(c => f.push({ ...c, group: 'tracking', kind: 'yn' }));
  if (cfg.call_outcome) f.push({ key: cfg.call_outcome.key, label: cfg.call_outcome.label, group: 'outcome', kind: 'text' });
  return f;
}
const CellVal = ({ f, v }) => {
  if (v == null || v === '') return <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>;
  if (f.kind === 'yn') { const y = String(v).trim().toUpperCase() === 'Y'; return <span className="font-bold" style={{ color: y ? '#059669' : 'var(--color-text-tertiary)' }}>{y ? 'Y' : 'N'}</span>; }
  if (f.kind === 'rating') return <span className="font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{v}</span>;
  return <span style={{ color: 'var(--color-text-secondary)' }}>{v}</span>;
};
function ReviewsSheet({ scorecard, reviews, managerView }) {
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
            </tr>
          </thead>
          <tbody>
            {reviews.map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--color-border)' }}>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="rounded-2xl p-5 overflow-auto" style={{ width: 'min(920px, 96vw)', maxHeight: '92vh', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
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
          <button onClick={exportFile} disabled={!reviews.length} className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg ml-auto"
            style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)', opacity: reviews.length ? 1 : 0.5 }}>
            <Download size={13} /> Export file
          </button>
          <button onClick={onClose}><XCircle size={20} style={{ color: 'var(--color-text-tertiary)' }} /></button>
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
                        <td className="px-2 py-1.5"><MethodPill m={r.method} /></td>
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

function CompletedTab({ managerView, companyId }) {
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

  return (
    <div className="flex flex-col h-full">
      {file && <AgentQualityFile subject={file} managerView={managerView} companyId={companyId} onClose={() => setFile(null)} />}
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
        <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={inp} />
        {!singleDay && <><label className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>to</label>
        <input type="date" value={to} max={today} onChange={e => setTo(e.target.value)} style={inp} /></>}
        <button onClick={() => { if (singleDay) { const t = addDays(from, 6); setTo(t > today ? today : t); } else { setTo(from); } }}
          className="text-[11px] font-bold px-2 py-1 rounded" title={singleDay ? 'Switch to a date range' : 'Collapse to a single day'}
          style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>{singleDay ? 'Range' : 'Single day'}</button>
        <select value={method} onChange={e => setMethod(e.target.value)} style={inp}><option value="">TRA + RCM</option><option value="tra">TRA</option><option value="rcm">RCM</option></select>
        {managerView && (
          <select value={reviewerId} onChange={e => setReviewerId(e.target.value)} style={inp}>
            <option value="">All QA agents</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <button onClick={load} className="p-2 rounded-lg" style={{ background: 'var(--color-surface-hover)' }} title="Refresh"><RefreshCw size={14} style={{ color: 'var(--color-text-secondary)' }} /></button>
        <button onClick={exportCsv} disabled={!sorted.length} className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg"
          style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)', opacity: sorted.length ? 1 : 0.5 }} title="Download the filtered reviews as CSV">
          <Download size={13} /> CSV
        </button>
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
          <select value={result} onChange={e => setResult(e.target.value)} style={inp} title="Filter by result">
            <option value="">Any result</option><option value="pass">Passed</option><option value="fail">Failed</option><option value="autofail">Auto-fail</option>
          </select>
          <select value={sort} onChange={e => setSort(e.target.value)} style={inp} title="Sort order">
            <option value="newest">Newest first</option><option value="high">Score: high → low</option><option value="low">Score: low → high</option>
          </select>
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
              {Object.entries(groups).map(([scId, revs]) => <ReviewsSheet key={scId} scorecard={scorecards[scId]} reviews={revs} managerView={managerView} />)}
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
                          <tr key={r.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                            <td className="px-3 py-1.5 whitespace-nowrap text-[11px] tabular-nums" style={{ color: 'var(--color-text-tertiary)', width: 70 }}>{r.reviewed_at ? new Date(r.reviewed_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''}</td>
                            <td className="px-2 py-1.5"><MethodPill m={r.method} /></td>
                            <td className="px-2 py-1.5">
                              <div className="font-semibold truncate" style={{ color: 'var(--color-text)', maxWidth: 180 }}>{r.customer_name || '—'}</div>
                              {r.customer_phone && <div className="text-[10px] tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>{r.customer_phone}</div>}
                            </td>
                            <td className="px-2 py-1.5 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>{r.agent || '—'}</td>
                            {managerView && <td className="px-2 py-1.5 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>{r.reviewer_name || '—'}</td>}
                            <td className="px-2 py-1.5 whitespace-nowrap"><ReviewScore r={r} /></td>
                            <td className="px-2 py-1.5 text-[11px] truncate" style={{ color: 'var(--color-text-tertiary)', maxWidth: 160 }}>{r.call_outcome || ''}</td>
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
                <select value={agentSort} onChange={e => setAgentSort(e.target.value)} style={{ ...inp, fontSize: 11, padding: '4px 8px', marginLeft: 'auto' }}>
                  <option value="reviews">Most reviewed</option><option value="low">Lowest score first</option><option value="high">Highest score first</option>
                </select>
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

// ── Agents & Fields tab (qa_manager) — bind each agent to RCM/TRA + choose which
// customer fields show on the agent's task card. ─────────────────────────────
const CARD_FIELDS = [
  ['customer_name', 'Customer name'], ['customer_phone', 'Phone'], ['zip', 'ZIP'],
  ['state', 'State'], ['address', 'Address'], ['agent', 'Agent'],
  ['call_date', 'Call date'], ['plan', 'Plan / vehicle'],
];
const DEFAULT_CARD_FIELDS = Object.fromEntries(CARD_FIELDS.map(([k]) => [k, true]));

function AgentsTab({ companyId, canManage, isSuper = false }) {
  const [agents, setAgents] = useState(null);
  const [fields, setFields] = useState(null);
  const [savingId, setSavingId] = useState({});    // agentId → 'saving' | 'saved'
  const [q, setQ] = useState('');                  // agent name search
  const [undone, setUndone] = useState({});        // agentId → open (pending+in_review) count
  const [canClear, setCanClear] = useState(false); // compliance-granted clear-tasks right
  const [clearing, setClearing] = useState(null);  // agentId | '__all__' while a clear runs
  const [clearWt, setClearWt] = useState('');       // '' = every section, else one work type

  const load = useCallback(() => {
    client.get('qa/agent-methods', { params: { company_id: companyId } }).then(r => setAgents(r.data.agents || [])).catch(() => setAgents([]));
    client.get('qa/config', { params: { company_id: companyId } }).then(r => {
      setFields({ ...DEFAULT_CARD_FIELDS, ...(r.data.config?.['qa.card_fields'] || {}) });
      // superadmin can always clear (backend bypasses the toggle); managers need
      // compliance to have granted it per-company.
      setCanClear(isSuper || !!r.data.config?.['qa.manager_can_clear']);
    }).catch(() => setFields(DEFAULT_CARD_FIELDS));
    client.get('qa/agents', { params: { company_id: companyId } })
      .then(r => setUndone(Object.fromEntries((r.data.agents || []).map(a => [a.id, a.undone || 0]))))
      .catch(() => setUndone({}));
  }, [companyId, isSuper]);
  useEffect(() => { load(); }, [load]);

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
    const methods = on ? AGENT_METHODS.map(([m]) => m) : [];
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
      {/* agent → method binding */}
      <div>
        <div className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>QA agents &amp; methods <InfoTip text="Bind each QA agent to TRA and/or RCM. Manual assigns require the binding; compliance work rules route regardless. Bind one or both." /></div>
        <div className="text-[11px] mb-3 flex items-center gap-2 flex-wrap" style={{ color: 'var(--color-text-tertiary)' }}>
          <span>Applies to the company selected in the header picker. Bind one or both methods.</span>
          {canManage && canClear && agents?.length > 0 && (
            <span className="ml-auto flex items-center gap-1.5">
              <select value={clearWt} onChange={e => setClearWt(e.target.value)} style={{ ...inp, padding: '3px 6px', fontSize: 11 }} title="Limit clearing to one section, or clear every section">
                <option value="">Every section</option>
                <option value="tra">TRA · Transfers</option>
                <option value="closer_sales">Closed Sale</option>
                <option value="closer_dispo">Unclosed Sale</option>
                <option value="rcm">RCM · Random</option>
              </select>
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
            {agents.length > 4 && (
              <div className="relative mb-2">
                <Search size={13} className="absolute left-2.5 top-2.5" style={{ color: 'var(--color-text-tertiary)' }} />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${agents.length} agents…`} style={{ ...inp, paddingLeft: 28 }} />
              </div>
            )}
            <div className="space-y-2">
              {agents.filter(a => !q.trim() || (a.name || '').toLowerCase().includes(q.trim().toLowerCase())).map(a => {
                const allOn = AGENT_METHODS.every(([m]) => a.methods.includes(m));
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
                    return (
                      <button key={m} onClick={() => toggleMethod(a, m)} title={SLOT_LABEL[m]}
                        className="text-[10px] font-bold px-2 py-1 rounded uppercase whitespace-nowrap transition-colors"
                        style={on
                          ? { background: `${tint}26`, color: tint, border: '1px solid currentColor' }
                          : { background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)', border: '1px solid transparent' }}>
                        {on ? '✓ ' : ''}{label}
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
        <div className="text-[11px] mb-3" style={{ color: 'var(--color-text-tertiary)' }}>Choose which customer details show on the agent's task card / scorecard header.</div>
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
function AgentTasks({ selfId, canOverride, companyId, filterCompany }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState(DEFAULT_CARD_FIELDS);
  const [open, setOpen] = useState(null);
  const [wtab, setWtab] = useState('tra');          // tra | rcm | closer_sales | closer_dispo
  const [day, setDay] = useState('');              // '' = all dates

  useEffect(() => { client.get('qa/config', { params: { company_id: companyId } }).then(r => setFields({ ...DEFAULT_CARD_FIELDS, ...(r.data.config?.['qa.card_fields'] || {}) })).catch(() => {}); }, [companyId]);
  const load = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoading(true);   // silent refresh never blanks the list
    try { const r = await client.get('qa/queue', { params: { limit: 200 } }); setItems(r.data.items || []); }
    catch { if (!silent) setItems([]); }
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
  const shown = byWt[wtab] || [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-sm font-bold inline-flex items-center gap-1" style={{ color: 'var(--color-text)' }}>Queue
          <InfoTip w={310} text="The calls assigned to you that still need scoring, in four sections: TRA = fronter transfer calls (in the CRM); RCM = fronter random calls (raw dialer, not in the CRM); Closed Sale = closer calls that closed a sale; Unclosed Sale = closer calls that didn't close. Open one, listen, score — it moves to Completed automatically." />
        </span>
        <div className="flex items-center gap-1 p-1 rounded-xl flex-wrap" style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)' }}>
          {[['tra', 'TRA · Transfers', ArrowRightLeft], ['rcm', 'RCM · Random', Shuffle], ['closer_sales', 'Closed Sale', DollarSign], ['closer_dispo', 'Unclosed Sale', PhoneOff]].map(([k, label, Icon]) => (
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
        <input type="date" value={day} list="qa-queue-days" onChange={e => { setDay(e.target.value); setOpen(null); }} style={inp} />
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
                <tr>{['Method', 'Customer / Phone', 'Agent reviewed', 'Location', 'Date', 'Score', ''].map(h => <th key={h} className="text-left px-3 py-2 text-[11px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {shown.map(a => (
                  <tr key={a.id} onClick={() => setOpen(a)} className="cursor-pointer transition-colors hover:bg-[var(--color-surface-hover)]"
                    style={{ borderTop: '1px solid var(--color-border)', background: open?.id === a.id ? 'var(--color-surface-hover)' : undefined }}>
                    <td className="px-3 py-2 whitespace-nowrap"><MethodPill m={a.method} /> <StatusPill s={a.status} /></td>
                    <td className="px-3 py-2">
                      <div className="font-semibold truncate" style={{ color: 'var(--color-text)', maxWidth: 200 }}>{show('customer_name') ? (a.customer_name || '—') : '—'}</div>
                      {show('customer_phone') && a.customer_phone && <div className="text-[11px] tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>{a.customer_phone}</div>}
                    </td>
                    <td className="px-3 py-2 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>{show('agent') ? agentLabel(a) : '—'}</td>
                    <td className="px-3 py-2 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>{(show('state') || show('zip')) ? ([show('state') && a.customer_state, show('zip') && a.customer_zip].filter(Boolean).join(' ') || '—') : '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>{show('call_date') ? fmtDate(a.subject_date) : '—'}</td>
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

function QAAgentView({ user, logout }) {
  const [tab, setTab] = useState('dashboard');
  const [methods, setMethods] = useState(null);
  const { companies, all, companyId, setCompanyId } = useQaCompanies();
  const scoped = companyId === ALL_CO ? '' : companyId;
  useEffect(() => { client.get('qa/my-methods').then(r => setMethods(r.data.methods || [])).catch(() => setMethods([])); }, []);
  const tabs = [{ key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }, { key: 'tasks', label: 'Queue', icon: ListChecks }, { key: 'reviews', label: 'Completed', icon: ClipboardCheck }];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg)' }}>
      <header className="flex items-center gap-4 px-5 py-3 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
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
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}><Shield size={13} className="inline mr-1" />{user?.role}</span>
          <button onClick={logout} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}><LogOut size={14} />Logout</button>
        </div>
      </header>
      <main className="flex-1 p-5 overflow-hidden">
        {/* No method-binding gate here: compliance work rules route tasks straight
            to a reviewer, so an agent must always see what's assigned to them —
            AgentTasks shows its own empty state when there's nothing. */}
        {tab === 'dashboard' && <div className="h-full overflow-auto"><QAAgentDashboard companyId={scoped} /></div>}
        {tab === 'tasks' && <AgentTasks selfId={user?.id} canOverride={false} companyId={scoped || user?.company_id} filterCompany={scoped} />}
        {tab === 'reviews' && <CompletedTab managerView={false} companyId={scoped} />}
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
  // Manager lands on the Dashboard (team overview + per-agent cards).
  const [tab, setTab] = useState('dashboard');

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
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true },
    // { key: 'queue', ... }  ← CRM Transfers/Sales browser: DISABLED for now.
    { key: 'day', label: 'Day Recordings', icon: Headphones, show: isSuper || canAssign },
    { key: 'agents', label: 'Agents', icon: UserPlus, show: isSuper || canAssign },
    { key: 'completed', label: canReports ? 'Completed' : 'My Reviews', icon: ClipboardCheck, show: true },
    { key: 'config', label: 'Scorecards & Config', icon: Settings2, show: canManage },
    { key: 'reports', label: 'Reports', icon: BarChart3, show: canReports },
  ].filter(t => t.show);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg)' }}>
      <header className="flex items-center gap-4 px-5 py-3 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
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
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}><Shield size={13} className="inline mr-1" />{user?.role}</span>
          <button onClick={logout} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}><LogOut size={14} />Logout</button>
        </div>
      </header>
      <main className="flex-1 p-5 overflow-hidden">
        {tab === 'dashboard' && <div className="h-full overflow-auto"><QAManagerDashboard companyId={scoped} onOpenReports={() => canReports && setTab('reports')} /></div>}
        {tab === 'day' && <>
          <CrmDayPanel companyId={companyId} scoped={scoped} canAssign={isSuper || canAssign} />
          <DayRecordingsTab canAssign={isSuper || canAssign} companyId={companyId} scoped={scoped} />
        </>}
        {tab === 'agents' && <AgentsTab companyId={scoped || user?.company_id} canManage={canManage} isSuper={isSuper} />}
        {tab === 'completed' && <CompletedTab managerView={canReports} companyId={scoped} />}
        {tab === 'config' && canManage && <ConfigTab companyId={scoped || user?.company_id} companyName={(companies || []).find(c => c.id === (scoped || user?.company_id))?.name} />}
        {tab === 'reports' && canReports && <ReportsTab companyId={scoped} companyName={(companies || []).find(c => c.id === scoped)?.name || ''} />}
      </main>
    </div>
  );
}
