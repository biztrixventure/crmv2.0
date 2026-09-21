// ============================================================================
// ReviewScreen.jsx — audio left, scorecard right. Reuses the exact ticketed-
// blob + IndexedDB pattern from QAShell.jsx's Candidates component
// (:265-434) via the SAME utils/audioCache.js store ('qa-audio') — not
// reimplemented, just simplified: v2 already knows the ONE recording from
// qa2_call, so there's no multi-candidate search to render.
//
// Autosave is debounced (1s after the last edit) and PUTs the full answer
// set — the backend recomputes the score from qa2_answer every time (raw
// answers are the source of truth), so the live score shown here always
// matches exactly what submit will persist.
// ============================================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ArrowLeft, Play, Pause, Phone, Building2, User, Clock, Send, SkipForward, Car, Hash, CheckCircle2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import { Panel, SectionHeader, Loading } from '../UI/kit';
import { getClip, putClip, clipKey } from '../../utils/audioCache';
import DialerBadge from '../Shared/DialerBadge';

// Prefetching for "Next" — module-level (not component state) so a value
// warmed while viewing record A survives the full remount that opening
// record B causes (ReviewScreen is keyed on assignment.id in QueueTab).
//
// Deliberately READ-ONLY only. GET /qa2/calls/:id has no side effect, so it's
// safe to fetch speculatively before the agent has actually chosen to move
// on. POST /qa2/evaluations does NOT get this treatment — it marks the
// assignment "in review" server-side (qa2Evaluations.js), so firing it
// speculatively would show a record as opened on a manager's live view
// before the agent ever saw it, and would leave it stuck "in review" forever
// if the agent never actually goes there. That call only ever fires from the
// main load effect below, when the record is genuinely being opened.
const callPrefetchCache = new Map(); // call_id -> Promise<calls/:id response data>

function prefetchCallData(callId) {
  if (!callId || callPrefetchCache.has(callId)) return;
  callPrefetchCache.set(callId, client.get(`qa2/calls/${callId}`).then(r => r.data).catch(() => null));
}

// Same read-only reasoning for audio: a recording ticket is a short-lived
// signed URL, not a state change on the call/evaluation. Skips anything
// already in the IndexedDB clip cache.
async function prefetchAudio(call) {
  if (!call || call.recording_state !== 'found') return;
  try {
    const key = clipKey(call.box_id, call.recording_id);
    if (await getClip(key)) return;
    const r = await client.post(`qa2/calls/${call.id}/recording-ticket`);
    const apiBase = String(client.defaults.baseURL || '').replace(/\/api\/?$/, '');
    const res = await fetch(apiBase + r.data.url);
    if (res.ok) await putClip(key, await res.blob());
  } catch { /* best-effort — Next still works, just not pre-warmed */ }
}

// ── playback speed ───────────────────────────────────────────────────────────
// A reviewer works through a queue of calls; most of a call is dead air and
// hold music. The presets are the speeds people actually use, and Custom is
// there because "how fast can I still understand it" is personal.
// 5x is the ceiling: browsers keep pitch correction (and audible output at all)
// only up to roughly there, so a higher number would silently play nothing.
const SPEEDS = [1, 1.5, 2, 3, 4];
const SPEED_MIN = 0.25, SPEED_MAX = 5;
const SPEED_KEY = 'qa2.playbackRate';
const clampSpeed = (v) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(v) || 1));
// Remembered per browser: a reviewer who works at 2x wants 2x on the next call
// too, not a reset with every record they open. Storage can throw (private
// mode, blocked site data), so every touch is guarded and 1x is the fallback.
const readSpeed = () => {
  try { const v = parseFloat(localStorage.getItem(SPEED_KEY)); return v >= SPEED_MIN && v <= SPEED_MAX ? v : 1; }
  catch { return 1; }
};

function AudioPlayer({ call }) {
  const audioRef = useRef(null);
  const urlRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [cached, setCached] = useState(false);
  const [speed, setSpeed] = useState(readSpeed);
  const [customOpen, setCustomOpen] = useState(false);

  const applySpeed = useCallback((v) => {
    const r = clampSpeed(v);
    setSpeed(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
    try { localStorage.setItem(SPEED_KEY, String(r)); } catch { /* not important enough to fail on */ }
  }, []);

  // The element is recreated/re-sourced on every record, and some browsers reset
  // playbackRate when a new source loads — so it is re-applied whenever the
  // clip changes, not just when the reviewer picks a speed.
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = speed; }, [speed, loading, call.id]);

  const fmt = (s) => { if (!Number.isFinite(s)) return '0:00'; const m = Math.floor(s / 60); const r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, '0')}`; };

  useEffect(() => {
    return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, []);

  const load = useCallback(async () => {
    const a = audioRef.current;
    if (!a || call.recording_state !== 'found') return;
    setLoading(true);
    try {
      const key = clipKey(call.box_id, call.recording_id);
      const hit = await getClip(key);
      if (hit) {
        urlRef.current = URL.createObjectURL(hit);
        a.src = urlRef.current;
        setCached(true);
        return;
      }
      const r = await client.post(`qa2/calls/${call.id}/recording-ticket`);
      const apiBase = String(client.defaults.baseURL || '').replace(/\/api\/?$/, '');
      const url = apiBase + r.data.url;
      a.src = url;
      const startCopy = () => {
        a.removeEventListener('playing', startCopy);
        fetch(url).then(res => (res.ok ? res.blob() : null)).then(blob => {
          if (blob) putClip(key, blob).then(ok => { if (ok) setCached(true); });
        }).catch(() => {});
      };
      a.addEventListener('playing', startCopy);
    } catch { toast.error('Could not load the recording'); }
    finally { setLoading(false); }
  }, [call.id, call.box_id, call.recording_id, call.recording_state]);

  useEffect(() => { load(); }, [load]);

  const toggle = () => {
    const a = audioRef.current; if (!a) return;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  };

  if (call.recording_state !== 'found') {
    return (
      <Panel tone="inset" className="text-center py-6">
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {call.recording_state === 'missing' ? 'No recording was found for this call.' : 'Recording still being located — check back shortly.'}
        </p>
      </Panel>
    );
  }

  return (
    <Panel tone="inset" className="space-y-2">
      <audio ref={audioRef}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onTimeUpdate={e => setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={e => { setDur(e.currentTarget.duration); e.currentTarget.playbackRate = speed; }}
        className="hidden" />
      <div className="flex items-center gap-3">
        <button onClick={toggle} disabled={loading}
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-primary-600)', color: 'white' }}>
          {loading ? <Loading variant="inline" size={16} /> : (playing ? <Pause size={16} /> : <Play size={16} />)}
        </button>
        <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{fmt(cur)} / {fmt(dur)}</span>
        <div className="relative flex-1 h-1.5 rounded-full" style={{ background: 'var(--color-border)' }}>
          <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${dur ? (cur / dur) * 100 : 0}%`, background: 'var(--color-primary-600)' }} />
          <input type="range" min={0} max={dur || 0} step="0.1" value={cur}
            onChange={e => { if (audioRef.current) audioRef.current.currentTime = Number(e.target.value); }}
            className="absolute inset-0 w-full opacity-0 cursor-pointer" />
        </div>
        {cached && <span className="text-[10px] font-semibold" style={{ color: 'var(--color-success-600)' }}>cached</span>}
      </div>

      {/* Speed. Its own row so the transport above keeps the exact layout it
          had — the seek bar is the control people aim at in a hurry. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Speed</span>
        {SPEEDS.map(s => {
          const on = !customOpen && Math.abs(speed - s) < 0.001;
          return (
            <button key={s} type="button" onClick={() => { setCustomOpen(false); applySpeed(s); }}
              className="text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums"
              style={{
                background: on ? 'var(--color-primary-600)' : 'var(--color-surface)',
                color: on ? '#fff' : 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
              }}>
              {s}x
            </button>
          );
        })}
        <button type="button" onClick={() => setCustomOpen(o => !o)}
          className="text-[11px] font-bold px-2 py-0.5 rounded-full"
          style={{
            background: customOpen ? 'var(--color-primary-600)' : 'var(--color-surface)',
            color: customOpen ? '#fff' : 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
          }}>
          Custom
        </button>
        {customOpen && (
          <>
            <input type="number" min={SPEED_MIN} max={SPEED_MAX} step={0.25} value={speed}
              onChange={e => applySpeed(e.target.value)}
              className="text-[11px] tabular-nums rounded-lg px-1.5 py-0.5" style={{ width: 62, background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              aria-label="Playback speed" />
            <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{SPEED_MIN}–{SPEED_MAX}x</span>
          </>
        )}
        {speed !== 1 && (
          <button type="button" onClick={() => { setCustomOpen(false); applySpeed(1); }}
            className="text-[10px] font-semibold ml-auto" style={{ color: 'var(--color-primary-600)' }}>
            back to 1x
          </button>
        )}
      </div>
    </Panel>
  );
}

export function ParameterInput({ param, answer, onChange }) {
  const a = answer || {};
  const naToggle = (
    <label className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
      <input type="checkbox" checked={!!a.is_na} onChange={e => onChange({ is_na: e.target.checked })} /> N/A
    </label>
  );

  let control;
  if (param.input_type === 'yes_no') {
    control = (
      <ThemedSelect variant="pill" value={a.value_text || ''} onChange={e => onChange({ value_text: e.target.value })} disabled={a.is_na}>
        <option value="">—</option><option value="Y">Yes</option><option value="N">No</option>
      </ThemedSelect>
    );
  } else if (param.input_type === 'scale') {
    control = (
      <input type="number" className="input" style={{ maxWidth: 90 }} min={param.scale_min} max={param.scale_max} step={param.scale_step || 1}
        value={a.value_num ?? ''} disabled={a.is_na}
        onChange={e => onChange({ value_num: e.target.value === '' ? null : Number(e.target.value) })} />
    );
  } else if (param.input_type === 'choice') {
    control = (
      <ThemedSelect variant="pill" value={a.value_text || ''} onChange={e => onChange({ value_text: e.target.value })} disabled={a.is_na}>
        <option value="">—</option>
        {(param.options || []).map(o => <option key={o.value} value={o.value}>{o.label || o.value}</option>)}
      </ThemedSelect>
    );
  } else {
    control = (
      <input className="input" value={a.value_text || ''} disabled={a.is_na}
        onChange={e => onChange({ value_text: e.target.value })} />
    );
  }

  // The comment gets its OWN full-width row under the question rather than a
  // 220px box competing for space on the same line. A reviewer writes a sentence
  // or two explaining why they marked something down, and in a single-line input
  // that narrow the text scrolls sideways after a few words — you cannot read
  // back what you just typed. Multi-line, full width, and drag-resizable for a
  // longer note. Still writes the same `comment` string, so nothing downstream
  // changes.
  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm flex-1 min-w-[160px]" style={{ color: 'var(--color-text)' }}>{param.label || param.key}</span>
        {control}
        {param.allow_na && naToggle}
      </div>
      {(param.requires_comment !== 'never') && (
        <textarea className="input w-full mt-1.5" rows={2} placeholder="Comment…"
          style={{ resize: 'vertical', minHeight: 60, lineHeight: 1.45 }}
          value={a.comment || ''} onChange={e => onChange({ comment: e.target.value })} />
      )}
    </div>
  );
}

export default function ReviewScreen({ assignment, onDone, onNext, nextLabel, remaining, nextAssignment }) {
  const [call, setCall] = useState(null);
  const [linked, setLinked] = useState(null);
  const [customerContext, setCustomerContext] = useState(null);
  const [hangup, setHangup] = useState(null);
  // The VICIdial lead behind this recording — comments and the rest. Loads on
  // its own so a slow box never delays the scorecard.
  const [dialer, setDialer] = useState({ loading: false, detail: null });
  const [evaluation, setEvaluation] = useState(null);
  const [def, setDef] = useState(null); // { version, sections, parameters, computed_max }
  const [answers, setAnswers] = useState({}); // parameter_id -> {value_num, value_text, value_bool, is_na, comment}
  const [notes, setNotes] = useState('');
  const [score, setScore] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);   // the score, once it is in
  const saveTimer = useRef(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        // A background prefetch from the PREVIOUS record's screen may already
        // have this in flight (or done) — use it instead of paying for the
        // round trip again. Consumed once, then dropped from the cache.
        const pending = callPrefetchCache.get(assignment.call_id);
        callPrefetchCache.delete(assignment.call_id);
        const callData = pending ? await pending : (await client.get(`qa2/calls/${assignment.call_id}`)).data;
        if (dead) return;
        if (!callData) throw new Error('not found');
        setCall(callData.call);
        setLinked(callData.linked);
        setCustomerContext(callData.customer_context || null);
        setHangup(callData.hangup || null);

        // The lead's own record on the dialer — comments above all. Fired here
        // and NOT awaited: it is a per-field round trip to a box that can be
        // slow or down, and the scorecard must not wait behind it.
        setDialer({ loading: true, detail: null });
        client.get(`qa2/calls/${assignment.call_id}/dialer-detail`)
          .then(r => { if (!dead) setDialer({ loading: false, detail: r.data.detail || null }); })
          .catch(() => { if (!dead) setDialer({ loading: false, detail: null }); });

        const evalRes = await client.post('qa2/evaluations', { assignment_id: assignment.id });
        if (dead) return;
        setEvaluation(evalRes.data.evaluation);
        setNotes(evalRes.data.evaluation.overall_notes || '');

        const defRes = await client.get(`qa2/versions/${evalRes.data.evaluation.form_version_id}`);
        if (dead) return;
        setDef(defRes.data);
      } catch (e) { if (!dead) setLoadError(e.response?.data?.error || 'Could not open this call'); }
    })();
    return () => { dead = true; if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [assignment.id, assignment.call_id]);

  // Warm the NEXT record while this one is still being scored — once this
  // record's own call has loaded (never competes with it for bandwidth), and
  // only when the caller (QueueTab) can hand us a concrete next assignment.
  // Read-only fetches only, see the module-level comment above.
  useEffect(() => {
    if (!call || !nextAssignment?.call_id) return;
    prefetchCallData(nextAssignment.call_id);
    const entry = callPrefetchCache.get(nextAssignment.call_id);
    if (entry) entry.then(data => {
      if (data?.call) prefetchAudio(data.call);
      if (data?.linked) prefetchAudio(data.linked);
    });
  }, [call, nextAssignment?.call_id]);

  const setAnswer = (parameterId, patch) => {
    setAnswers(prev => {
      const next = { ...prev, [parameterId]: { ...prev[parameterId], ...patch } };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(next, notes), 1000);
      return next;
    });
  };

  const setNotesDebounced = (value) => {
    setNotes(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(answers, value), 1000);
  };

  const save = async (currentAnswers, currentNotes) => {
    if (!evaluation) return;
    const payload = Object.entries(currentAnswers).map(([parameter_id, v]) => ({ parameter_id, ...v }));
    try {
      const r = await client.put(`qa2/evaluations/${evaluation.id}`, { answers: payload, overall_notes: currentNotes });
      setScore(r.data.evaluation);
    } catch { /* autosave failure is silent — next edit retries */ }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await client.put(`qa2/evaluations/${evaluation.id}`, { answers: Object.entries(answers).map(([parameter_id, v]) => ({ parameter_id, ...v })), overall_notes: notes });
      const r = await client.post(`qa2/evaluations/${evaluation.id}/submit`);
      toast.success('Submitted');
      // Landing back on the queue after every single review meant finding your
      // place again, opening the next one, waiting for it to load — for every
      // call. Stay here and offer the next record instead; going back is still
      // one click for anyone who wants it.
      setSubmitted(r.data?.evaluation || { final_score: score?.final_score ?? null });
    } catch (e) { toast.error(e.response?.data?.error || 'Could not submit'); }
    finally { setSubmitting(false); }
  };

  const skip = async () => {
    const reason = window.prompt('Why are you excluding this call? (bad recording, wrong number, test call…)');
    if (!reason || !reason.trim()) return;
    try {
      await client.post(`qa2/assignments/${assignment.id}/skip`, { reason: reason.trim() });
      toast.success('Excluded from QA');
      onDone();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not skip'); }
  };

  const bySection = useMemo(() => {
    if (!def) return new Map();
    const map = new Map(def.sections.map(s => [s.id, []]));
    map.set(null, []);
    for (const p of def.parameters) {
      if (!map.has(p.section_id)) map.set(p.section_id, []);
      map.get(p.section_id).push(p);
    }
    return map;
  }, [def]);

  if (loadError) return (
    <div className="max-w-3xl mx-auto space-y-3">
      <button className="text-sm font-semibold flex items-center gap-1" onClick={onDone}><ArrowLeft size={14} />Back</button>
      <Panel tone="inset"><p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{loadError}</p></Panel>
    </div>
  );
  if (!call || !def) return <Loading variant="cards" />;

  // ── submitted ────────────────────────────────────────────────────────────
  // The scored call is done; the only thing worth doing next is the next call.
  // Everything below is deliberately quiet — one obvious action, one way back.
  if (submitted) {
    const finalScore = submitted.final_score ?? score?.final_score ?? null;
    const verdict = submitted.result || submitted.autofail_result || null;
    return (
      <div className="max-w-2xl mx-auto space-y-4 pt-6">
        <Panel className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2">
            <CheckCircle2 size={22} style={{ color: 'var(--color-success-600, #16a34a)' }} />
            <span className="text-lg font-semibold">Review submitted</span>
          </div>
          {finalScore != null && (
            <div>
              <div className="text-3xl font-bold">{finalScore}</div>
              {verdict && <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{verdict}</div>}
            </div>
          )}
          <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {call.agent_name || call.agent_user || 'This agent'} · {call.customer_phone || '—'}
          </div>

          <div className="flex items-center justify-center gap-2 pt-2 flex-wrap">
            {onNext ? (
              <button className="btn btn-primary text-sm flex items-center gap-1.5" onClick={onNext}>
                {nextLabel || 'Next record'} <ArrowRight size={14} />
              </button>
            ) : (
              <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                That was the last one in this list.
              </span>
            )}
            <button className="btn text-sm" style={{ border: '1px solid var(--color-border)' }} onClick={onDone}>
              Back to queue
            </button>
          </div>

          {remaining > 0 && (
            <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {remaining} more waiting in this list
            </div>
          )}
        </Panel>
      </div>
    );
  }

  const s = score || evaluation;

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button className="text-sm font-semibold flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }} onClick={onDone}><ArrowLeft size={14} />Back to queue</button>
        <div className="flex items-center gap-2">
          <button className="btn text-sm flex items-center gap-1.5" style={{ border: '1px solid var(--color-border)', color: 'var(--color-error-600)' }} onClick={skip}>
            <SkipForward size={14} />Exclude
          </button>
          <button className="btn btn-primary text-sm flex items-center gap-1.5" onClick={submit} disabled={submitting}>
            <Send size={14} />{submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <Panel>
            <SectionHeader level="section" title="Call context" actions={hangup?.label ? (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                title={`Dialer hangup reason: ${hangup.reason}${hangup.call_status ? ` · status ${hangup.call_status}` : ''}`}
                style={/^AGENT/i.test(hangup.reason || '')
                  ? { background: 'rgba(220,38,38,0.14)', color: 'var(--color-error-600)' }
                  : { background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
                {hangup.label}
              </span>
            ) : hangup?.unavailable ? (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                title="The dialer's call log no longer holds this call, so who hung up cannot be read for it."
                style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)' }}>
                hangup n/a
              </span>
            ) : null} />
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2"><Building2 size={13} style={{ color: 'var(--color-text-tertiary)' }} />{call.company_name || '—'}</div>
              <div className="flex items-center gap-2"><User size={13} style={{ color: 'var(--color-text-tertiary)' }} />{call.agent_name || '—'} ({call.leg})</div>
              <div className="flex items-center gap-2"><Phone size={13} style={{ color: 'var(--color-text-tertiary)' }} />{call.customer_phone || '—'}</div>
              <div className="flex items-center gap-2"><Clock size={13} style={{ color: 'var(--color-text-tertiary)' }} />{call.call_at ? new Date(call.call_at).toLocaleString() : '—'}</div>
            </div>

            {/* CALL OUTCOME — the dialer's own verdict on the call, in one strip
                a reviewer reads before pressing play: what was punched, what the
                CLOSER made of the lead (on a TRA the row is the fronter's leg and
                its dispo is just XFER), who ended the call, and how long it ran.
                These used to be two lines of 11px text and a 9px badge. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
              {[
                { k: 'Dispo', v: call.dispo_raw || '—' },
                // WHICH DIALER THIS RECORDING CAME FROM. With two dialers in
                // the estate, a reviewer hearing something odd — a different
                // greeting, a different hold tone, audio that cuts early —
                // needs to know which system produced it before they score it.
                // Stated outright here (not hidden like in a list) because
                // this screen IS the detail.
                { k: 'Dialer', v: <DialerBadge record={call} showLegacy />, raw: true },
                { k: 'Closer dispo', v: call.closer_dispo || '—', strong: true },
                { k: 'Ended by', v: hangup?.label || (hangup?.unavailable ? 'n/a' : '—'),
                  tone: /^AGENT/i.test(hangup?.reason || '') ? 'agent' : (hangup?.label ? 'customer' : null),
                  hint: hangup?.reason ? `Dialer: ${hangup.reason}${hangup.call_status ? ` · ${hangup.call_status}` : ''}` : undefined },
                { k: 'Talk time', v: Number.isFinite(call.talk_sec) ? `${Math.floor(call.talk_sec / 60)}:${String(call.talk_sec % 60).padStart(2, '0')}` : '—' },
              ].map(f => (
                <div key={f.k} title={f.hint}>
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>{f.k}</div>
                  <div className={`text-sm ${f.strong ? 'font-bold' : 'font-semibold'}`}
                    style={{ color: f.tone === 'agent' ? 'var(--color-error-600)' : f.tone === 'customer' ? 'var(--color-success-600)' : 'var(--color-text)' }}>
                    {f.v}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {customerContext && (
            <Panel tone="inset">
              <SectionHeader level="section" title="Customer & vehicle" subtitle="Auto-fetched from the CRM — not entered by the reviewer." />
              <div className="space-y-1.5 text-sm">
                {customerContext.customer_name && (
                  <div className="flex items-center gap-2"><User size={13} style={{ color: 'var(--color-text-tertiary)' }} />{customerContext.customer_name}{customerContext.zip ? ` · ${customerContext.zip}` : ''}</div>
                )}
                {(customerContext.vehicle_year || customerContext.vehicle_make || customerContext.vehicle_model) && (
                  <div className="flex items-center gap-2">
                    <Car size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                    {[customerContext.vehicle_year, customerContext.vehicle_make, customerContext.vehicle_model].filter(Boolean).join(' ')}
                  </div>
                )}
                {customerContext.vin && (
                  <div className="flex items-center gap-2"><Hash size={13} style={{ color: 'var(--color-text-tertiary)' }} />VIN {customerContext.vin}</div>
                )}
              </div>
            </Panel>
          )}

          {/* What the agent TYPED on the lead. The comments box is where the
              objection, the callback promise and the "call after 6" live, and
              none of it reaches the CRM — so it is read straight off the
              dialer. Absent box, archived lead or no notes → nothing renders. */}
          {(dialer.loading || dialer.detail) && (
            <Panel tone="inset">
              <SectionHeader level="section" title="From the dialer"
                subtitle="The lead record behind this recording — read live from VICIdial, not entered by the reviewer." />
              {dialer.loading ? (
                <Loading variant="inline" size={16} />
              ) : (
                <div className="space-y-2 text-sm">
                  {dialer.detail.comments ? (
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-text-tertiary)' }}>Agent comments</div>
                      <div className="rounded-lg px-2.5 py-2 whitespace-pre-wrap"
                        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                        {dialer.detail.comments}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No comments on this lead.</div>
                  )}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {[
                      ['Lead status',  dialer.detail.status],
                      ['Times called', dialer.detail.called_count],
                      ['Last call',    dialer.detail.last_local_call_time],
                      ['In list',      dialer.detail.list_id],
                      ['Vendor code',  dialer.detail.vendor_lead_code],
                      ['Source',       dialer.detail.source_id],
                      ['Email',        dialer.detail.email],
                      ['Alt phone',    dialer.detail.alt_phone],
                      ['Lead created', dialer.detail.entry_date],
                    ].filter(([, v]) => v).map(([label, v]) => (
                      <div key={label} className="flex gap-1.5 min-w-0">
                        <span className="flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
                        <span className="truncate" style={{ color: 'var(--color-text)' }} title={String(v)}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          )}

          <AudioPlayer call={call} />

          {linked && (
            <Panel tone="inset">
              <SectionHeader level="sub" title={`Linked ${linked.leg} leg`} />
              <AudioPlayer call={linked} />
            </Panel>
          )}

          {s && (
            <Panel>
              <SectionHeader level="section" title="Live score" />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                <div><span style={{ color: 'var(--color-text-secondary)' }}>Base %</span><br /><strong>{s.base_pct ?? '—'}</strong></div>
                <div><span style={{ color: 'var(--color-text-secondary)' }}>Penalty</span><br /><strong>{s.penalty_total ?? '—'}</strong></div>
                <div><span style={{ color: 'var(--color-text-secondary)' }}>Final</span><br /><strong>{s.final_score ?? '—'}</strong></div>
                <div><span style={{ color: 'var(--color-text-secondary)' }}>Autofail</span><br /><strong>{s.autofail_result ?? 'none'}</strong></div>
                <div><span style={{ color: 'var(--color-text-secondary)' }}>Result</span><br /><strong>{s.result ?? '—'}</strong></div>
              </div>
            </Panel>
          )}

          <Panel>
            <SectionHeader level="section" title="Comments" subtitle="Overall notes on this call — separate from each question's own comment box below." />
            <textarea className="input w-full" rows={7} placeholder="Additional comments…"
              style={{ resize: 'vertical', minHeight: 140, lineHeight: 1.45 }}
              value={notes} onChange={e => setNotesDebounced(e.target.value)} />
          </Panel>
        </div>

        <div className="space-y-3">
          {[...def.sections, { id: null, name: 'Other' }].map(sec => {
            const params = bySection.get(sec.id) || [];
            if (!params.length) return null;
            return (
              <Panel key={sec.id || 'other'}>
                <SectionHeader level="section" title={sec.name || 'Other'} />
                <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                  {params.map(p => (
                    <ParameterInput key={p.id} param={p} answer={answers[p.id]} onChange={patch => setAnswer(p.id, patch)} />
                  ))}
                </div>
              </Panel>
            );
          })}
        </div>
      </div>
    </div>
  );
}
