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
import { ArrowLeft, Play, Pause, Phone, Building2, User, Clock, Send, SkipForward, Car, Hash } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import { Panel, SectionHeader, Loading } from '../UI/kit';
import { getClip, putClip, clipKey } from '../../utils/audioCache';

function AudioPlayer({ call }) {
  const audioRef = useRef(null);
  const urlRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [cached, setCached] = useState(false);

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
        onLoadedMetadata={e => setDur(e.currentTarget.duration)}
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

  return (
    <div className="flex items-center gap-2 py-1.5 flex-wrap">
      <span className="text-sm flex-1 min-w-[160px]" style={{ color: 'var(--color-text)' }}>{param.label || param.key}</span>
      {control}
      {param.allow_na && naToggle}
      {(param.requires_comment !== 'never') && (
        <input className="input" placeholder="Comment" style={{ maxWidth: 220 }}
          value={a.comment || ''} onChange={e => onChange({ comment: e.target.value })} />
      )}
    </div>
  );
}

export default function ReviewScreen({ assignment, onDone }) {
  const [call, setCall] = useState(null);
  const [linked, setLinked] = useState(null);
  const [customerContext, setCustomerContext] = useState(null);
  const [hangup, setHangup] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [def, setDef] = useState(null); // { version, sections, parameters, computed_max }
  const [answers, setAnswers] = useState({}); // parameter_id -> {value_num, value_text, value_bool, is_na, comment}
  const [score, setScore] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const callRes = await client.get(`qa2/calls/${assignment.call_id}`);
        if (dead) return;
        setCall(callRes.data.call);
        setLinked(callRes.data.linked);
        setCustomerContext(callRes.data.customer_context || null);
        setHangup(callRes.data.hangup || null);

        const evalRes = await client.post('qa2/evaluations', { assignment_id: assignment.id });
        if (dead) return;
        setEvaluation(evalRes.data.evaluation);

        const defRes = await client.get(`qa2/versions/${evalRes.data.evaluation.form_version_id}`);
        if (dead) return;
        setDef(defRes.data);
      } catch (e) { if (!dead) setLoadError(e.response?.data?.error || 'Could not open this call'); }
    })();
    return () => { dead = true; if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [assignment.id, assignment.call_id]);

  const setAnswer = (parameterId, patch) => {
    setAnswers(prev => {
      const next = { ...prev, [parameterId]: { ...prev[parameterId], ...patch } };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(next), 1000);
      return next;
    });
  };

  const save = async (currentAnswers) => {
    if (!evaluation) return;
    const payload = Object.entries(currentAnswers).map(([parameter_id, v]) => ({ parameter_id, ...v }));
    try {
      const r = await client.put(`qa2/evaluations/${evaluation.id}`, { answers: payload });
      setScore(r.data.evaluation);
    } catch { /* autosave failure is silent — next edit retries */ }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await client.put(`qa2/evaluations/${evaluation.id}`, { answers: Object.entries(answers).map(([parameter_id, v]) => ({ parameter_id, ...v })) });
      await client.post(`qa2/evaluations/${evaluation.id}/submit`);
      toast.success('Submitted');
      onDone();
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
              {call.dispo_raw && <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Dispo: {call.dispo_raw}</div>}
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
