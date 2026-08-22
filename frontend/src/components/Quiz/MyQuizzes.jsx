import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ClipboardList, Clock, CheckCircle2, XCircle, Award, AlertTriangle, X, Users, ChevronRight,
} from 'lucide-react';
import client from '../../api/client';
import { Button, Alert } from '../UI';
import { Panel, SectionHeader, Loading, EmptyState, KpiTile } from '../UI/kit';

const pct = (n) => (n == null ? '—' : `${n}%`);
const fmtDue = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

// ── Take a quiz ───────────────────────────────────────────────────────────────
function TakeQuizModal({ attemptId, onClose, onSubmitted }) {
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    client.get(`quiz/my/${attemptId}/take`).then(r => {
      setData(r.data);
      if (r.data.quiz.time_limit_minutes) {
        const startedAt = new Date(r.data.started_at).getTime();
        const deadline = startedAt + r.data.quiz.time_limit_minutes * 60_000;
        setSecondsLeft(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
      }
    }).catch(e => setErr(e.response?.data?.error || 'Failed to load quiz')).finally(() => setLoading(false));
  }, [attemptId]);

  const submit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true); setErr('');
    try {
      const payload = { answers: Object.entries(answers).map(([question_id, selected_index]) => ({ question_id, selected_index })) };
      const r = await client.post(`quiz/my/${attemptId}/submit`, payload);
      onSubmitted(r.data.attempt);
      onClose();
    } catch (e) { setErr(e.response?.data?.error || 'Failed to submit'); submittedRef.current = false; }
    finally { setSubmitting(false); }
  }, [answers, attemptId, onClose, onSubmitted]);

  // Countdown — auto-submits whatever is answered when time runs out.
  useEffect(() => {
    if (secondsLeft == null) return;
    if (secondsLeft <= 0) { submit(); return; }
    const t = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, submit]);

  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const answeredCount = Object.keys(answers).length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
      <div className="relative w-full max-w-2xl my-6 rounded-2xl animate-scale-in"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <ClipboardList size={20} className="text-white flex-shrink-0" />
            <h3 className="text-lg font-bold text-white truncate">{data?.quiz?.title || 'Quiz'}</h3>
          </div>
          {secondsLeft != null && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-bold flex-shrink-0"
              style={{ background: secondsLeft < 60 ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.2)', color: '#fff' }}>
              <Clock size={13} /> {mmss(secondsLeft)}
            </span>
          )}
        </div>

        {loading ? <div className="p-8"><Loading /></div> : (
          <div className="p-6 space-y-4">
            {err && <Alert type="error" message={err} dismissible onDismiss={() => setErr('')} />}
            {data?.quiz?.description && <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{data.quiz.description}</p>}

            {(data?.questions || []).map((q, i) => (
              <Panel key={q.id} tone="inset" className="space-y-2.5">
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{i + 1}. {q.question_text}</p>
                <div className="space-y-1.5">
                  {q.options.map((opt, oi) => {
                    const selected = answers[q.id] === oi;
                    return (
                      <label key={oi} className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors"
                        style={{ background: selected ? 'var(--color-primary-50, rgba(37,99,235,0.08))' : 'transparent', border: `1px solid ${selected ? 'var(--color-primary-500)' : 'var(--color-border)'}` }}>
                        <input type="radio" name={q.id} checked={selected} onChange={() => setAnswers(a => ({ ...a, [q.id]: oi }))} />
                        <span className="text-sm" style={{ color: 'var(--color-text)' }}>{opt}</span>
                      </label>
                    );
                  })}
                </div>
              </Panel>
            ))}

            <div className="flex items-center justify-between gap-3 pt-2">
              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{answeredCount}/{data?.questions?.length || 0} answered</span>
              <Button variant="primary" disabled={submitting} onClick={submit} className="flex items-center gap-1.5">
                <CheckCircle2 size={15} /> {submitting ? 'Submitting…' : 'Submit Quiz'}
              </Button>
            </div>
            <p className="text-[11px] text-center" style={{ color: 'var(--color-text-tertiary)' }}>You get one attempt — double-check your answers before submitting.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── View my graded result ─────────────────────────────────────────────────────
function ResultModal({ attemptId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    client.get(`quiz/my/${attemptId}/result`).then(r => setData(r.data)).catch(e => setErr(e.response?.data?.error || 'Failed to load result')).finally(() => setLoading(false));
  }, [attemptId]);

  const answerOf = useMemo(() => {
    const out = {};
    (data?.attempt?.answers || []).forEach(a => { out[a.question_id] = a.selected_index; });
    return out;
  }, [data]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-2xl my-6 rounded-2xl animate-scale-in"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-2.5">
            <Award size={20} className="text-white" />
            <h3 className="text-lg font-bold text-white">{data?.quiz?.title ? `Result — ${data.quiz.title}` : 'Result'}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"><X size={18} className="text-white" /></button>
        </div>

        <div className="p-6 space-y-4">
          {err && <Alert type="error" message={err} />}
          {loading ? <Loading /> : data && (
            <>
              <div className="grid grid-cols-3 gap-2.5">
                <KpiTile label="Score" value={pct(data.attempt.percent)} tone="primary" />
                <KpiTile label="Points" value={`${data.attempt.score}/${data.attempt.total_points}`} tone="info" />
                <KpiTile label="Submitted" value={fmtDue(data.attempt.submitted_at) || '—'} tone="success" />
              </div>
              {data.questions.map((q, i) => {
                const your = answerOf[q.id];
                const correct = your === q.correct_index;
                return (
                  <Panel key={q.id} tone="inset" className="space-y-2">
                    <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
                      {correct ? <CheckCircle2 size={15} style={{ color: 'var(--color-success-600)' }} /> : <XCircle size={15} style={{ color: 'var(--color-error-500)' }} />}
                      {i + 1}. {q.question_text}
                    </p>
                    <div className="space-y-1">
                      {q.options.map((opt, oi) => {
                        const isCorrect = oi === q.correct_index;
                        const isYours = oi === your;
                        return (
                          <div key={oi} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm"
                            style={{
                              background: isCorrect ? 'rgba(34,197,94,0.12)' : (isYours ? 'rgba(239,68,68,0.12)' : 'transparent'),
                              color: 'var(--color-text)',
                            }}>
                            {isCorrect ? <CheckCircle2 size={13} style={{ color: 'var(--color-success-600)' }} /> : isYours ? <XCircle size={13} style={{ color: 'var(--color-error-500)' }} /> : <span className="w-[13px]" />}
                            <span>{opt}</span>
                            {isYours && !isCorrect && <span className="text-[11px] ml-auto" style={{ color: 'var(--color-error-500)' }}>Your answer</span>}
                          </div>
                        );
                      })}
                    </div>
                  </Panel>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Team lead progress panel ──────────────────────────────────────────────────
function TeamProgress({ teamId, teamName }) {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    client.get(`quiz/team/${teamId}/progress`).then(r => setAssignments(r.data.assignments || [])).catch(() => {}).finally(() => setLoading(false));
  }, [teamId]);

  if (loading) return <Loading />;
  if (!assignments.length) return null;

  return (
    <div className="space-y-2.5">
      <SectionHeader level="section" icon={Users} title={`${teamName} — quiz progress`} subtitle="Quizzes assigned to your team." />
      {assignments.map(a => {
        const isOpen = open === a.assignment_id;
        return (
          <Panel key={a.assignment_id} tone="inset" className="space-y-2">
            <button className="w-full flex items-center justify-between gap-2" onClick={() => setOpen(isOpen ? null : a.assignment_id)}>
              <span className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
                <ChevronRight size={14} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} /> {a.quiz_title}
              </span>
              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{a.submitted}/{a.total} done · avg {pct(a.avg_percent)}</span>
            </button>
            {isOpen && (
              <div className="space-y-1 pl-5">
                {a.members.map(m => (
                  <div key={m.user_id} className="flex items-center justify-between text-sm py-1" style={{ borderTop: '1px solid var(--color-border)' }}>
                    <span style={{ color: 'var(--color-text)' }}>{m.user_name}</span>
                    {m.status === 'submitted' ? (
                      <span className="font-semibold" style={{ color: 'var(--color-success-600)' }}>{pct(m.percent)}</span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Pending</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

// ── Main assignee view ────────────────────────────────────────────────────────
export default function MyQuizzes() {
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [takeId, setTakeId] = useState(null);
  const [resultId, setResultId] = useState(null);
  const [ledTeam, setLedTeam] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await client.get('quiz/my/list');
      setQuizzes(r.data.quizzes || []);
    } catch (e) { setErr(e.response?.data?.error || 'Failed to load quizzes'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    client.get('teams/my').then(r => { if (r.data.team && r.data.is_lead) setLedTeam(r.data.team); }).catch(() => {});
  }, []);

  const pending = quizzes.filter(q => q.status === 'pending');
  const submitted = quizzes.filter(q => q.status === 'submitted');

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader level="page" icon={ClipboardList} title="My Quizzes" subtitle="Quizzes assigned to you — one attempt each, auto-graded on submit." />
      {err && <Alert type="error" message={err} dismissible onDismiss={() => setErr('')} />}

      <div className="grid grid-cols-2 gap-2.5">
        <KpiTile label="Pending" value={pending.length} tone="warn" />
        <KpiTile label="Completed" value={submitted.length} tone="success" />
      </div>

      {loading ? <Loading /> : quizzes.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No quizzes assigned" hint="Quizzes assigned to you or your team will show up here." />
      ) : (
        <div className="space-y-2.5">
          {[...pending, ...submitted].map(q => (
            <Panel key={q.attempt_id} className="flex items-center justify-between gap-3 flex-wrap"
              style={q.is_overdue ? { borderColor: 'var(--color-error-500)' } : undefined}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{q.title}</p>
                  {q.time_limit_minutes && <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}><Clock size={11} /> {q.time_limit_minutes}m</span>}
                  {q.is_overdue && <span className="text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center gap-1" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--color-error-500)' }}><AlertTriangle size={10} /> OVERDUE</span>}
                </div>
                {q.description && <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--color-text-secondary)' }}>{q.description}</p>}
                {q.due_at && q.status === 'pending' && <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Due {fmtDue(q.due_at)}</p>}
                {q.status === 'submitted' && <p className="text-[11px] mt-1 font-semibold" style={{ color: 'var(--color-success-600)' }}>Scored {pct(q.percent)} ({q.score}/{q.total_points})</p>}
              </div>
              {q.status === 'pending' ? (
                <Button variant="primary" onClick={() => setTakeId(q.attempt_id)} disabled={!q.is_active}>
                  {q.is_active ? 'Start Quiz' : 'Unavailable'}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setResultId(q.attempt_id)}>View Result</Button>
              )}
            </Panel>
          ))}
        </div>
      )}

      {ledTeam && <TeamProgress teamId={ledTeam.id} teamName={ledTeam.name} />}

      {takeId && <TakeQuizModal attemptId={takeId} onClose={() => setTakeId(null)} onSubmitted={() => load()} />}
      {resultId && <ResultModal attemptId={resultId} onClose={() => setResultId(null)} />}
    </div>
  );
}
