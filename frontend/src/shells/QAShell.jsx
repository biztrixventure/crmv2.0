import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ClipboardCheck, ListChecks, BarChart3, Settings2, Play, Pause, Loader2,
  LogOut, RefreshCw, User, Phone, Calendar, Layers, CheckCircle2, XCircle,
  ChevronRight, Send, Shield, Star,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';
import SheetScoreRow from '../components/QA/SheetScoreRow';
import { isSheetConfig } from '../utils/qaSheetFormula';

// ============================================================================
// QA Shell — isolated shell for qa_manager / qa_agent (mirrors ComplianceShell).
// Tabs: Queue (listen + score), Scorecards & Config (qa_manager), Reports.
// Recording playback reuses the shared dialer library via /qa/recordings/stream.
// ============================================================================

const fmtDur = (s) => { if (s == null) return '—'; const m = Math.floor(s / 60), r = Math.floor(s % 60); return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`; };
const fmtDate = (d) => { try { return d ? new Date(String(d).length <= 10 ? d + 'T00:00:00' : d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''; } catch { return d || ''; } };
const fmtTime = (s) => { try { return s ? new Date(String(s).replace(' ', 'T')).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; } catch { return s || ''; } };
const inp = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '6px 10px', fontSize: 13 };
const MethodPill = ({ m }) => (
  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase"
    style={m === 'tra'
      ? { background: 'var(--color-primary-50, rgba(37,99,235,0.12))', color: 'var(--color-primary-600)' }
      : { background: 'var(--color-warning-50, rgba(217,119,6,0.12))', color: 'var(--color-warning-600)' }}>{m}</span>
);
const StatusPill = ({ s }) => {
  const map = { pending: ['Pending', 'var(--color-text-tertiary)'], in_review: ['In review', 'var(--color-warning-600)'], scored: ['Scored', 'var(--color-success-600)'], skipped: ['Skipped', 'var(--color-text-tertiary)'] };
  const [label, color] = map[s] || [s, 'var(--color-text-tertiary)'];
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color }}>{label}</span>;
};

// ── candidate audio player (blob-streamed with auth, like RecordingReviewTab) ──
function Candidates({ assignmentId }) {
  const [rows, setRows] = useState(null);
  const audioRef = useRef(null); const urlRef = useRef(null);
  const [loadingId, setLoadingId] = useState(null);
  const [playingRid, setPlayingRid] = useState(null);

  useEffect(() => {
    let dead = false;
    setRows(null);
    client.get(`qa/assignments/${assignmentId}/candidates`)
      .then(r => { if (!dead) setRows(r.data.candidates || []); })
      .catch(() => { if (!dead) setRows([]); });
    return () => { dead = true; if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, [assignmentId]);

  const play = async (c) => {
    const a = audioRef.current; if (!a) return;
    if (a.dataset.rid === c.recording_id) { a.paused ? a.play() : a.pause(); return; }
    setLoadingId(c.recording_id);
    try {
      const res = await client.get('qa/recordings/stream', { params: { box_id: c.box_id, lead_id: c.lead_id, recording_id: c.recording_id, location: c.location }, responseType: 'blob' });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(res.data); urlRef.current = url;
      a.src = url; a.dataset.rid = c.recording_id; a.load(); a.play().catch(() => {});
    } catch { toast.error('Could not load that recording'); }
    finally { setLoadingId(null); }
  };

  if (rows === null) return <div className="text-center py-6"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /><div className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Loading recordings…</div></div>;
  if (!rows.length) return <div className="text-center py-6 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No recordings found on the dialer for this call.</div>;
  return (
    <div className="space-y-2">
      {rows.map(c => (
        <div key={c.box_id + c.recording_id} className="flex items-center gap-3 p-2.5 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <button onClick={() => play(c)} className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' }}>
            {loadingId === c.recording_id ? <Loader2 size={15} className="animate-spin" color="#fff" /> : playingRid === c.recording_id ? <Pause size={15} color="#fff" /> : <Play size={15} color="#fff" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtDur(c.duration)} <span className="text-xs font-normal" style={{ color: 'var(--color-text-secondary)' }}>· {c.agent_user || 'agent ?'}</span></div>
            <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{fmtTime(c.start_time)} · box {c.box_id} · rec {c.recording_id}</div>
          </div>
        </div>
      ))}
      <audio ref={audioRef} controls className="w-full mt-1" onPlay={() => setPlayingRid(audioRef.current?.dataset.rid || null)} onPause={() => setPlayingRid(null)} onEnded={() => setPlayingRid(null)} />
    </div>
  );
}

// ── scorecard form ────────────────────────────────────────────────────────────
function ScoreForm({ assignment, onScored }) {
  const [scorecard, setScorecard] = useState(null);
  const [scores, setScores] = useState({});      // key → points
  const [notes, setNotes] = useState({});         // key → note
  const [overall, setOverall] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setScorecard(null); setScores({}); setNotes({}); setOverall('');
    client.get('qa/scorecards', { params: { method: assignment.method, company_id: assignment.company_id } })
      .then(r => {
        const list = r.data.scorecards || [];
        // company-scoped active first, else global template
        const pick = list.find(s => s.company_id === assignment.company_id && s.is_active) || list.find(s => !s.company_id && s.is_active) || list[0] || null;
        setScorecard(pick);
        if (pick) { const init = {}; (pick.criteria || []).forEach(c => { init[c.key] = c.max_points; }); setScores(init); }
      })
      .catch(() => setScorecard(null));
  }, [assignment.id]);

  if (scorecard === null) return <div className="py-4 text-center"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>;
  if (!scorecard) return <div className="py-4 text-sm text-center" style={{ color: 'var(--color-error-600)' }}>No active scorecard for {assignment.method.toUpperCase()}. Ask a QA manager to configure one.</div>;

  // sheet_v2 (WaveTech replication) → horizontal spreadsheet-row scoring UI
  if (isSheetConfig(scorecard.criteria)) {
    return (
      <SheetScoreRow
        config={scorecard.criteria}
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

// ── Queue tab ─────────────────────────────────────────────────────────────────
function QueueTab({ canAssign, canOverride, selfId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ method: '', status: 'pending', subject_role: '', mine: '' });
  const [open, setOpen] = useState(null);   // selected assignment

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 100 };
      for (const [k, v] of Object.entries(filters)) if (v) params[k] = v;
      const r = await client.get('qa/queue', { params });
      setItems(r.data.items || []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex gap-4 h-full">
      {/* list */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <select value={filters.method} onChange={e => setFilters(f => ({ ...f, method: e.target.value }))} style={inp}><option value="">All methods</option><option value="tra">TRA</option><option value="rcm">RCM</option></select>
          <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} style={inp}><option value="">Any status</option><option value="pending">Pending</option><option value="in_review">In review</option><option value="scored">Scored</option></select>
          <select value={filters.subject_role} onChange={e => setFilters(f => ({ ...f, subject_role: e.target.value }))} style={inp}><option value="">Fronter + closer</option><option value="fronter">Fronter</option><option value="closer">Closer</option></select>
          <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}><input type="checkbox" checked={filters.mine === 'true'} onChange={e => setFilters(f => ({ ...f, mine: e.target.checked ? 'true' : '' }))} /> Mine only</label>
          <button onClick={load} className="p-2 rounded-lg" style={{ background: 'var(--color-surface-hover)' }}><RefreshCw size={14} style={{ color: 'var(--color-text-secondary)' }} /></button>
        </div>
        {loading ? <div className="text-center py-10"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>
          : items.length === 0 ? <div className="text-center py-10 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No assignments. (QA must be enabled for a company before its calls appear here.)</div>
          : <div className="space-y-2 overflow-auto">
              {items.map(a => (
                <button key={a.id} onClick={() => setOpen(a)} className="w-full text-left flex items-center gap-3 p-3 rounded-xl" style={{ background: open?.id === a.id ? 'var(--color-surface-hover)' : 'var(--color-surface)', border: `1px solid ${open?.id === a.id ? 'var(--color-primary-600)' : 'var(--color-border)'}` }}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <MethodPill m={a.method} />
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>{a.subject_role}</span>
                      <StatusPill s={a.status} />
                      {a.sampled && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5" style={{ background: 'var(--color-warning-50, rgba(217,119,6,0.12))', color: 'var(--color-warning-600)' }}><Star size={10} />sampled</span>}
                    </div>
                    <div className="text-sm font-semibold mt-1 truncate" style={{ color: 'var(--color-text)' }}>{a.customer_name || '—'}</div>
                    <div className="flex items-center gap-3 text-[11px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                      {a.customer_phone && <span className="flex items-center gap-1"><Phone size={11} />{a.customer_phone}</span>}
                      <span className="flex items-center gap-1"><Calendar size={11} />{fmtDate(a.subject_date)}</span>
                      {a.assignee_name && <span className="flex items-center gap-1"><User size={11} />{a.assignee_name}</span>}
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: 'var(--color-text-tertiary)' }} />
                </button>
              ))}
            </div>}
      </div>

      {/* review drawer — wide, to fit the horizontal sheet row */}
      {open && (
        <div className="flex-shrink-0 rounded-xl p-4 overflow-auto" style={{ width: 'min(860px, 92vw)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', maxHeight: '100%' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{open.customer_name || 'Review'} <span className="text-xs font-normal" style={{ color: 'var(--color-text-tertiary)' }}>· {open.method.toUpperCase()} · {open.subject_role}</span></div>
            <button onClick={() => setOpen(null)}><XCircle size={18} style={{ color: 'var(--color-text-tertiary)' }} /></button>
          </div>
          {canAssign && !open.assigned_to && open.status !== 'scored' && (
            <button onClick={async () => { try { await client.post(`qa/assignments/${open.id}/assign`, { assigned_to: selfId }); toast.success('Assigned to you'); setOpen({ ...open, assigned_to: selfId }); load(); } catch { toast.error('Assign failed'); } }}
              className="w-full mb-3 px-3 py-2 rounded-lg text-xs font-bold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text)' }}>Assign to me</button>
          )}
          <div className="mb-4"><div className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>Recordings</div><Candidates assignmentId={open.id} /></div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>{open.status === 'scored' ? 'Review (submitted)' : 'Scorecard'}</div>
            {open.status === 'scored'
              ? <ReviewEditor assignment={open} selfId={selfId} canOverride={canOverride} onSaved={() => load()} />
              : <ScoreForm assignment={open} onScored={() => { setOpen(null); load(); }} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reports tab ─────────────────────────────────────────────────────────────────
function ReportsTab() {
  const [data, setData] = useState(null);
  const [method, setMethod] = useState('');
  useEffect(() => { setData(null); client.get('qa/reports', { params: method ? { method } : {} }).then(r => setData(r.data)).catch(() => setData({ summary: {}, by_agent: [] })); }, [method]);
  const s = data?.summary || {};
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <select value={method} onChange={e => setMethod(e.target.value)} style={inp}><option value="">All methods</option><option value="tra">TRA</option><option value="rcm">RCM</option></select>
      </div>
      {!data ? <Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} /> : (
        <>
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[['Reviews', s.reviews || 0], ['Pass rate', `${s.pass_rate || 0}%`], ['Avg score', `${s.avg_score || 0}%`], ['Passed', s.passed || 0]].map(([k, v]) => (
              <div key={k} className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{k}</div>
                <div className="text-2xl font-extrabold" style={{ color: 'var(--color-text)' }}>{v}</div>
              </div>
            ))}
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <table className="w-full text-sm">
              <thead><tr style={{ background: 'var(--color-surface-hover)' }}>{['Agent', 'Reviews', 'Pass rate', 'Avg score'].map(h => <th key={h} className="text-left px-3 py-2 text-[11px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{h}</th>)}</tr></thead>
              <tbody>{(data.by_agent || []).map(a => (
                <tr key={a.subject_user_id || a.name} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{a.name}</td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{a.reviews}</td>
                  <td className="px-3 py-2 tabular-nums font-semibold" style={{ color: a.pass_rate >= 80 ? 'var(--color-success-600)' : 'var(--color-error-600)' }}>{a.pass_rate}%</td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{a.avg_score}%</td>
                </tr>
              ))}
              {(!data.by_agent || !data.by_agent.length) && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No reviews yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Scorecards & Config tab (qa_manager) ─────────────────────────────────────
function ConfigTab({ companyId }) {
  const [cards, setCards] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [draft, setDraft] = useState({ method: 'tra', name: '', pass_threshold: 80, criteria: '[{"key":"overall","label":"Overall Call Quality","max_points":100,"auto_fail":false}]' });
  const loadCards = useCallback(() => client.get('qa/scorecards', { params: { company_id: companyId } }).then(r => setCards(r.data.scorecards || [])).catch(() => setCards([])), [companyId]);
  const loadCfg = useCallback(() => client.get('qa/config', { params: { company_id: companyId } }).then(r => setCfg(r.data.config || {})).catch(() => setCfg({})), [companyId]);
  useEffect(() => { loadCards(); loadCfg(); }, [loadCards, loadCfg]);

  const saveCard = async () => {
    let criteria; try { criteria = JSON.parse(draft.criteria); } catch { return toast.error('Criteria must be valid JSON array'); }
    try { await client.post('qa/scorecards', { company_id: companyId, method: draft.method, name: draft.name, pass_threshold: +draft.pass_threshold, criteria }); toast.success('Scorecard saved'); setDraft(d => ({ ...d, name: '' })); loadCards(); }
    catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
  };
  const setCfgKey = async (key, value) => { try { await client.put('qa/config', { company_id: companyId, key, value }); toast.success('Config updated'); loadCfg(); } catch { toast.error('Config update failed'); } };

  const methods = Array.isArray(cfg?.['qa.methods']) ? cfg['qa.methods'] : [];
  return (
    <div className="grid grid-cols-2 gap-5">
      {/* config */}
      <div>
        <div className="text-sm font-bold mb-2" style={{ color: 'var(--color-text)' }}>Company QA config</div>
        <div className="text-[11px] mb-3" style={{ color: 'var(--color-text-tertiary)' }}>Applies to your primary company ({companyId?.slice(0, 8)}…). Empty methods = QA off.</div>
        {cfg === null ? <Loader2 className="animate-spin" /> : (
          <div className="space-y-3">
            <div className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="text-xs font-bold mb-2" style={{ color: 'var(--color-text)' }}>Methods</div>
              {['tra', 'rcm'].map(m => (
                <label key={m} className="flex items-center gap-2 text-sm mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                  <input type="checkbox" checked={methods.includes(m)} onChange={e => { const next = e.target.checked ? [...new Set([...methods, m])] : methods.filter(x => x !== m); setCfgKey('qa.methods', next); }} />
                  {m.toUpperCase()} — {m === 'tra' ? 'review every fronter transfer' : 'random sample'}
                </label>
              ))}
            </div>
            {methods.includes('rcm') && (
              <div className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div className="text-xs font-bold mb-2" style={{ color: 'var(--color-text)' }}>RCM sampling</div>
                <RcmConfig value={cfg['qa.rcm.sample']} covers={cfg['qa.rcm.covers']} onSample={v => setCfgKey('qa.rcm.sample', v)} onCovers={v => setCfgKey('qa.rcm.covers', v)} />
              </div>
            )}
          </div>
        )}
      </div>
      {/* scorecards */}
      <div>
        <div className="text-sm font-bold mb-2" style={{ color: 'var(--color-text)' }}>Scorecards</div>
        <div className="space-y-2 mb-4">
          {cards.map(c => (
            <div key={c.id} className="flex items-center gap-2 p-2.5 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', opacity: c.is_active ? 1 : 0.5 }}>
              <MethodPill m={c.method} />
              <div className="min-w-0 flex-1"><div className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{c.name}{!c.company_id && <span className="text-[10px] ml-1" style={{ color: 'var(--color-text-tertiary)' }}>(global)</span>}</div><div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{(c.criteria || []).length} criteria · pass ≥ {c.pass_threshold}%</div></div>
              {c.company_id && c.is_active && <button onClick={() => client.delete(`qa/scorecards/${c.id}`).then(loadCards)} className="text-[11px] font-bold" style={{ color: 'var(--color-error-600)' }}>Disable</button>}
            </div>
          ))}
        </div>
        <div className="p-3 rounded-xl space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>New scorecard</div>
          <div className="flex gap-2">
            <select value={draft.method} onChange={e => setDraft(d => ({ ...d, method: e.target.value }))} style={inp}><option value="tra">TRA</option><option value="rcm">RCM</option></select>
            <input placeholder="Name" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} style={{ ...inp, flex: 1 }} />
            <input type="number" title="pass %" value={draft.pass_threshold} onChange={e => setDraft(d => ({ ...d, pass_threshold: e.target.value }))} style={{ ...inp, width: 64 }} />
          </div>
          <textarea value={draft.criteria} onChange={e => setDraft(d => ({ ...d, criteria: e.target.value }))} rows={4} style={{ ...inp, width: '100%', fontFamily: 'monospace', fontSize: 11 }} />
          <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>criteria JSON: [{'{'}"key","label","max_points","auto_fail"{'}'}]</div>
          <button onClick={saveCard} disabled={!draft.name} className="px-3 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', opacity: draft.name ? 1 : 0.5 }}>Create</button>
        </div>
      </div>
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

// ── Shell ─────────────────────────────────────────────────────────────────────
export default function QAShell() {
  const { user, hasPermission, logout } = useAuth();
  const isSuper = user?.role === 'superadmin';
  const canManage = isSuper || hasPermission('manage_qa_config');
  const canReports = isSuper || hasPermission('view_qa_reports');
  const canAssign = isSuper || hasPermission('assign_qa_tasks');
  const canOverride = isSuper || hasPermission('override_qa_review');
  const [tab, setTab] = useState('queue');

  const tabs = [
    { key: 'queue', label: 'Queue', icon: ListChecks, show: true },
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
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}><Shield size={13} className="inline mr-1" />{user?.role}</span>
          <button onClick={logout} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}><LogOut size={14} />Logout</button>
        </div>
      </header>
      <main className="flex-1 p-5 overflow-hidden">
        {tab === 'queue' && <QueueTab canAssign={canAssign} canOverride={canOverride} selfId={user?.id} />}
        {tab === 'config' && canManage && <ConfigTab companyId={user?.company_id} />}
        {tab === 'reports' && canReports && <ReportsTab />}
      </main>
    </div>
  );
}
