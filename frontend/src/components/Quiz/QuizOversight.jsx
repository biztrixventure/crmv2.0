// ============================================================================
// QuizOversight — read-only visibility into QA-conducted quizzes, quiz-wise
// AND agent-wise.
//
// Separate from QuizManager on purpose. That panel is the CREATOR's surface:
// its list, detail and results endpoints all filter on
// `quizzes.created_by === me`, so an operations_manager pointed at it would see
// an empty list however many quizzes QA had run. This one reads
// /quiz/oversight/*, which scopes by COMPANY instead and offers no write path.
//
// Agent rows are always this viewer's own company's members. A quiz can be
// owned by another company and still be listed (QA ran it at your team) — the
// "Run by another company" pill says which. `participants_total` vs `assigned`
// is shown everywhere for the same reason: on the production data a 1-Vertex
// manager sees 0 of 40 participants, and an empty table has to explain itself
// rather than look broken.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import {
  GraduationCap, Users, ClipboardList, CheckCircle2, XCircle, Clock,
  ArrowLeft, Trophy, ChevronDown, ChevronRight, HelpCircle, AlertTriangle,
} from 'lucide-react';
import {
  Panel, SectionHeader, Loading, EmptyState, KpiTile, PillTabs, TableScroll, accent,
} from '../UI/kit';
import client from '../../api/client';

// ── helpers ─────────────────────────────────────────────────────────────────
// A null percentage means "no score yet", never zero. Rendering 0% for an
// agent who has not sat the quiz reads as a failing agent.
const pct = (v) => (v === null || v === undefined ? '—' : `${Number(v)}%`);
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}) : '—');

// Tone from a score against the quiz's OWN threshold, not a fixed 50/80 — the
// production quiz passes at 90, where a hardcoded scale would call 85 good.
const scoreTone = (p, threshold) => {
  if (p === null || p === undefined) return 'muted';
  if (p >= threshold) return 'success';
  return p >= threshold * 0.7 ? 'warn' : 'danger';
};

const Pill = ({ children, tone = 'muted' }) => (
  <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md whitespace-nowrap"
    style={{ background: accent(tone).soft, color: accent(tone).fg }}>{children}</span>
);

const Th = ({ children, className = '' }) => (
  <th className={`px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide whitespace-nowrap ${className}`}
    style={{ color: 'var(--color-text-tertiary)' }}>{children}</th>
);
const Td = ({ children, className = '', style }) => (
  <td className={`px-3 py-2 text-xs whitespace-nowrap ${className}`} style={style}>{children}</td>
);

// ── quiz detail ─────────────────────────────────────────────────────────────
const QuizDetail = ({ quizId, onBack }) => {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState(null);
  const [view, setView]           = useState('agents');
  const [openAgent, setOpenAgent] = useState(null);

  useEffect(() => {
    let live = true;
    setLoading(true); setErr(null);
    client.get(`quiz/oversight/quizzes/${quizId}`)
      .then(r => { if (live) setData(r.data); })
      .catch(e => { if (live) setErr(e?.response?.data?.error || 'Could not load this quiz'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [quizId]);

  if (loading) return <Loading />;
  if (err)     return <EmptyState icon={AlertTriangle} tone="danger" title="Not available" hint={err} />;
  if (!data)   return null;

  const { quiz, questions = [], rows = [], ranked = [], per_question = [], summary = {} } = data;
  const threshold = quiz?.pass_threshold ?? 0;
  const pqOf = Object.fromEntries(per_question.map(p => [p.question_id, p]));

  return (
    <div className="space-y-5">
      <button onClick={onBack}
        className="flex items-center gap-1.5 text-xs font-semibold hover:opacity-80"
        style={{ color: 'var(--color-primary-600)' }}>
        <ArrowLeft size={14} /> All quizzes
      </button>

      <SectionHeader
        icon={GraduationCap} level="page"
        title={quiz.title}
        subtitle={`${questions.length} questions · pass mark ${threshold}% · by ${quiz.created_by_name}${quiz.category ? ` · ${quiz.category}` : ''}`}
        actions={
          <div className="flex items-center gap-1.5 flex-wrap">
            {quiz.external && <Pill tone="info">Run by another company</Pill>}
            <Pill tone={quiz.is_active ? 'success' : 'muted'}>{quiz.is_active ? 'Active' : 'Closed'}</Pill>
            {quiz.time_limit_minutes ? <Pill tone="muted">{quiz.time_limit_minutes} min limit</Pill> : null}
          </div>
        }
      />

      {/* ── Overall performance + participation ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiTile icon={Users}        label="Your agents" value={summary.assigned}  sub={`of ${summary.participants_total} assigned`} tone="primary" />
        <KpiTile icon={CheckCircle2} label="Submitted"   value={summary.submitted} sub={summary.completion_rate === null ? 'no participation' : `${summary.completion_rate}% completed`} tone="info" />
        <KpiTile icon={Clock}        label="Not taken"   value={summary.pending}   tone="warn" />
        <KpiTile icon={Trophy}       label="Average"     value={pct(summary.avg_percent)} tone={scoreTone(summary.avg_percent, threshold)} />
        <KpiTile icon={CheckCircle2} label="Passed"      value={summary.pass_count} sub={`at ${threshold}%`} tone="success" />
        <KpiTile icon={XCircle}      label="Failed"      value={summary.fail_count} tone="danger" />
      </div>

      {/* Nobody from this company took it — say why, rather than leaving an
          empty table under populated-looking tiles. */}
      {summary.assigned === 0 && (
        <Panel pad="md" className="flex items-start gap-2">
          <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" style={{ color: accent('warn').fg }} />
          <p className="text-xs m-0" style={{ color: 'var(--color-text-secondary)' }}>
            {summary.participants_total} {summary.participants_total === 1 ? 'person' : 'people'} sat this quiz,
            but none of them is a member of your company, so there are no agent results to show you.
          </p>
        </Panel>
      )}

      {/* Scores exist where the per-question record does not, for some
          attempts. Stated plainly — the alternative is a grid that looks like
          everyone answered nothing. */}
      {summary.submitted > 0 && summary.answers_recorded < summary.submitted && (
        <Panel pad="md" className="flex items-start gap-2">
          <HelpCircle size={15} className="flex-shrink-0 mt-0.5" style={{ color: accent('info').fg }} />
          <p className="text-xs m-0" style={{ color: 'var(--color-text-secondary)' }}>
            {summary.answers_recorded} of {summary.submitted} submitted attempts kept a per-question record.
            The rest carry a score but no stored answers, so their picks cannot be shown.
          </p>
        </Panel>
      )}

      {ranked.length > 0 && (
        <Panel pad="lg">
          <SectionHeader icon={Trophy} title="Top performers" subtitle="Your agents, best score first" tone="warn" />
          <div className="space-y-1.5 mt-3">
            {ranked.map((r, i) => (
              <div key={r.user_id} className="flex items-center gap-3 px-3 py-2 rounded-xl"
                style={{ border: '1px solid var(--color-border)' }}>
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0"
                  style={{
                    background: i < 3 ? accent(i === 0 ? 'warn' : 'muted').soft : 'transparent',
                    color:      i < 3 ? accent(i === 0 ? 'warn' : 'muted').fg : 'var(--color-text-tertiary)',
                    border:     i >= 3 ? '1px solid var(--color-border)' : 'none',
                  }}>{i + 1}</span>
                <span className="text-sm font-semibold text-text truncate flex-1 min-w-0">{r.user_name}</span>
                <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{r.score}/{r.total_points}</span>
                <span className="text-sm font-bold" style={{ color: accent(scoreTone(r.percent, threshold)).fg }}>{pct(r.percent)}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <PillTabs
        value={view} onChange={setView}
        items={[
          { key: 'agents',    label: 'Agent results', icon: Users,         count: rows.length },
          { key: 'questions', label: 'Questions',     icon: ClipboardList, count: questions.length },
        ]}
      />

      {/* ── agent-wise: each of my agents, expandable to their own answers ── */}
      {view === 'agents' && (
        rows.length === 0
          ? <EmptyState icon={Users} title="No agent results" hint="Nobody from your company has been assigned this quiz." />
          : (
            <Panel pad="none">
              <TableScroll label="Agent results">
                <table className="w-full">
                  <thead style={{ background: 'var(--color-bg-secondary)' }}>
                    <tr>
                      <Th>Agent</Th><Th>Status</Th><Th>Score</Th><Th>Result</Th><Th>Submitted</Th><Th>Answers</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const open = openAgent === r.attempt_id;
                      return [
                        <tr key={r.attempt_id}
                          className="cursor-pointer hover:bg-bg-secondary"
                          style={{ borderTop: '1px solid var(--color-border)' }}
                          onClick={() => setOpenAgent(open ? null : r.attempt_id)}>
                          <Td className="font-semibold text-text">
                            <span className="flex items-center gap-1.5">
                              {r.answers_recorded
                                ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)
                                : <span className="inline-block w-[13px]" />}
                              {r.user_name}
                            </span>
                          </Td>
                          <Td>
                            <Pill tone={r.status === 'submitted' ? 'info' : 'muted'}>
                              {r.status === 'submitted' ? 'Submitted' : 'Not taken'}
                            </Pill>
                          </Td>
                          <Td style={{ color: 'var(--color-text-secondary)' }}>
                            {r.status === 'submitted' ? `${r.score}/${r.total_points}` : '—'}
                          </Td>
                          <Td>
                            <span className="font-bold" style={{ color: accent(scoreTone(r.percent, threshold)).fg }}>
                              {pct(r.percent)}
                            </span>
                            {r.pass !== null && (
                              <span className="ml-1.5">{r.pass ? <Pill tone="success">Pass</Pill> : <Pill tone="danger">Fail</Pill>}</span>
                            )}
                          </Td>
                          <Td style={{ color: 'var(--color-text-tertiary)' }}>{when(r.submitted_at)}</Td>
                          <Td style={{ color: 'var(--color-text-tertiary)' }}>
                            {r.answers_recorded ? `${r.answers.length} recorded` : 'not recorded'}
                          </Td>
                        </tr>,
                        open && r.answers_recorded && (
                          <tr key={`${r.attempt_id}-detail`} style={{ background: 'var(--color-bg-secondary)' }}>
                            <td colSpan={6} className="px-3 py-3">
                              <div className="space-y-1.5">
                                {questions.map((q, qi) => {
                                  const pick   = r.answers.find(a => a.question_id === q.id);
                                  const opts   = Array.isArray(q.options) ? q.options : [];
                                  const chosen = pick ? opts[pick.selected_index] : null;
                                  const right  = pick ? pick.selected_index === q.correct_index : null;
                                  return (
                                    <div key={q.id} className="rounded-lg px-3 py-2"
                                      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                                      <p className="text-xs font-semibold text-text m-0">{qi + 1}. {q.question_text}</p>
                                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                                        <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                                          Answered:{' '}
                                          <span className="font-semibold"
                                            style={{ color: accent(right === null ? 'muted' : right ? 'success' : 'danger').fg }}>
                                            {chosen ?? 'no answer'}
                                          </span>
                                        </span>
                                        {right === false && (
                                          <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                                            Correct:{' '}
                                            <span className="font-semibold" style={{ color: accent('success').fg }}>
                                              {opts[q.correct_index] ?? '—'}
                                            </span>
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        ),
                      ];
                    })}
                  </tbody>
                </table>
              </TableScroll>
            </Panel>
          )
      )}

      {/* ── quiz-wise: the questions, their correct answers, and how the team
              actually did on each one ── */}
      {view === 'questions' && (
        <div className="space-y-2">
          {questions.map((q, qi) => {
            const p    = pqOf[q.id] || { answered: 0, correct: 0, correct_rate: null, chosen_counts: {} };
            const opts = Array.isArray(q.options) ? q.options : [];
            return (
              <Panel key={q.id} pad="lg">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <p className="text-sm font-semibold text-text m-0 flex-1 min-w-0">{qi + 1}. {q.question_text}</p>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Pill tone="muted">{q.points} {q.points === 1 ? 'pt' : 'pts'}</Pill>
                    {p.answered > 0
                      ? <Pill tone={p.correct_rate >= 70 ? 'success' : p.correct_rate >= 40 ? 'warn' : 'danger'}>
                          {p.correct}/{p.answered} correct · {p.correct_rate}%
                        </Pill>
                      : <Pill tone="muted">no answers recorded</Pill>}
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  {opts.map((opt, oi) => {
                    const isCorrect = oi === q.correct_index;
                    const picked    = p.chosen_counts?.[oi] || 0;
                    const share     = p.answered > 0 ? Math.round((picked / p.answered) * 100) : 0;
                    return (
                      <div key={oi} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                        style={{
                          background: isCorrect ? accent('success').soft : 'var(--color-bg-secondary)',
                          border: `1px solid ${isCorrect ? accent('success').fg : 'var(--color-border)'}`,
                        }}>
                        {isCorrect
                          ? <CheckCircle2 size={13} className="flex-shrink-0" style={{ color: accent('success').fg }} />
                          : <span className="inline-block w-[13px] flex-shrink-0" />}
                        <span className="text-xs flex-1 min-w-0" style={{ color: 'var(--color-text)' }}>{opt}</span>
                        {picked > 0 && (
                          <span className="text-[11px] font-semibold flex-shrink-0"
                            style={{ color: isCorrect ? accent('success').fg : accent('danger').fg }}>
                            {picked} chose ({share}%)
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── main panel ──────────────────────────────────────────────────────────────
const QuizOversight = () => {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState(null);
  const [tab, setTab]             = useState('quizzes');
  const [openQuiz, setOpenQuiz]   = useState(null);
  const [openAgent, setOpenAgent] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    client.get('quiz/oversight/summary')
      .then(r => setData(r.data))
      .catch(e => setErr(e?.response?.data?.error || 'Could not load quiz results'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (openQuiz) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <QuizDetail quizId={openQuiz} onBack={() => setOpenQuiz(null)} />
      </div>
    );
  }

  const { quizzes = [], agents = [], totals = {} } = data || {};

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-5 animate-fade-in">
      <SectionHeader
        icon={GraduationCap} level="page"
        title="Quiz Results"
        subtitle="Knowledge assessments run at your team, and how your agents scored"
      />

      {loading ? <Loading /> : err ? (
        <EmptyState icon={AlertTriangle} tone="danger" title="Not available" hint={err} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile icon={ClipboardList} label="Quizzes"        value={totals.quizzes} tone="primary" />
            <KpiTile icon={Users}         label="Agents sat one" value={totals.agents_participating} tone="info" />
            <KpiTile icon={CheckCircle2}  label="Submissions"    value={totals.submitted} tone="success" />
            <KpiTile icon={Trophy}        label="Average score"  value={pct(totals.avg_percent)} tone="warn" />
          </div>

          <PillTabs
            value={tab} onChange={setTab}
            items={[
              { key: 'quizzes', label: 'Quiz-wise',  icon: ClipboardList, count: quizzes.length },
              { key: 'agents',  label: 'Agent-wise', icon: Users,         count: agents.length },
            ]}
          />

          {tab === 'quizzes' && (
            quizzes.length === 0
              ? <EmptyState icon={ClipboardList} title="No quizzes yet"
                  hint="Nothing has been assigned to your company, and QA has not run a quiz at your agents." />
              : (
                <div className="space-y-2">
                  {quizzes.map(q => (
                    <Panel key={q.id} pad="lg" className="cursor-pointer transition-colors hover:bg-bg-secondary"
                      onClick={() => setOpenQuiz(q.id)}>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold text-text m-0 truncate">{q.title}</p>
                            {q.external && <Pill tone="info">Run by another company</Pill>}
                            <Pill tone={q.is_active ? 'success' : 'muted'}>{q.is_active ? 'Active' : 'Closed'}</Pill>
                          </div>
                          <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                            {q.question_count} questions · pass mark {q.pass_threshold}% · by {q.created_by_name}
                            {q.category ? ` · ${q.category}` : ''}
                          </p>
                        </div>
                        <ChevronRight size={16} className="flex-shrink-0 mt-1" style={{ color: 'var(--color-text-tertiary)' }} />
                      </div>

                      <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3">
                        {/* Your agents vs everyone, always as a pair. On the
                            production quiz these read 0 and 40, which is the
                            honest answer and not a broken screen. */}
                        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          Your agents: <span className="font-bold text-text">{q.assigned}</span>
                          <span style={{ color: 'var(--color-text-tertiary)' }}> of {q.participants_total} assigned</span>
                        </span>
                        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          Submitted: <span className="font-bold text-text">{q.submitted}</span>
                          {q.completion_rate !== null && (
                            <span style={{ color: 'var(--color-text-tertiary)' }}> ({q.completion_rate}%)</span>
                          )}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          Average:{' '}
                          <span className="font-bold" style={{ color: accent(scoreTone(q.avg_percent, q.pass_threshold)).fg }}>
                            {pct(q.avg_percent)}
                          </span>
                        </span>
                        {q.submitted > 0 && (
                          <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                            <span className="font-bold" style={{ color: accent('success').fg }}>{q.pass_count}</span> passed ·{' '}
                            <span className="font-bold" style={{ color: accent('danger').fg }}>{q.fail_count}</span> failed
                          </span>
                        )}
                      </div>
                    </Panel>
                  ))}
                </div>
              )
          )}

          {tab === 'agents' && (
            agents.length === 0
              ? <EmptyState icon={Users} title="No agent results"
                  hint="None of your company's members has been assigned a quiz yet." />
              : (
                <Panel pad="none">
                  <TableScroll label="Agents" stickyFirst>
                    <table className="w-full">
                      <thead style={{ background: 'var(--color-bg-secondary)' }}>
                        <tr>
                          <Th>Agent</Th><Th>Assigned</Th><Th>Submitted</Th><Th>Not taken</Th>
                          <Th>Average</Th><Th>Best</Th><Th>Passed</Th><Th>Last submitted</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {agents.map(a => {
                          const open = openAgent === a.user_id;
                          return [
                            <tr key={a.user_id} className="cursor-pointer hover:bg-bg-secondary"
                              style={{ borderTop: '1px solid var(--color-border)' }}
                              onClick={() => setOpenAgent(open ? null : a.user_id)}>
                              <Td className="font-semibold text-text">
                                <span className="flex items-center gap-1.5">
                                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                  {a.name}
                                </span>
                              </Td>
                              <Td style={{ color: 'var(--color-text-secondary)' }}>{a.assigned}</Td>
                              <Td style={{ color: 'var(--color-text-secondary)' }}>{a.submitted}</Td>
                              <Td style={{ color: a.pending ? accent('warn').fg : 'var(--color-text-tertiary)' }}>{a.pending}</Td>
                              <Td className="font-bold">{pct(a.avg_percent)}</Td>
                              <Td style={{ color: 'var(--color-text-secondary)' }}>{pct(a.best_percent)}</Td>
                              <Td style={{ color: 'var(--color-text-secondary)' }}>{a.pass_count}</Td>
                              <Td style={{ color: 'var(--color-text-tertiary)' }}>{when(a.last_submitted_at)}</Td>
                            </tr>,
                            open && (
                              <tr key={`${a.user_id}-quizzes`} style={{ background: 'var(--color-bg-secondary)' }}>
                                <td colSpan={8} className="px-3 py-3">
                                  <div className="space-y-1.5">
                                    {a.quizzes.map(z => (
                                      <div key={`${a.user_id}-${z.quiz_id}`}
                                        className="flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer hover:opacity-90"
                                        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                                        onClick={(e) => { e.stopPropagation(); setOpenQuiz(z.quiz_id); }}>
                                        <span className="text-xs font-semibold text-text flex-1 min-w-0 truncate">{z.title}</span>
                                        <Pill tone={z.status === 'submitted' ? 'info' : 'muted'}>
                                          {z.status === 'submitted' ? 'Submitted' : 'Not taken'}
                                        </Pill>
                                        {z.status === 'submitted' && (
                                          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                                            {z.score}/{z.total_points}
                                          </span>
                                        )}
                                        <span className="text-xs font-bold">{pct(z.percent)}</span>
                                        {z.pass !== null && (z.pass ? <Pill tone="success">Pass</Pill> : <Pill tone="danger">Fail</Pill>)}
                                        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                          {when(z.submitted_at)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            ),
                          ];
                        })}
                      </tbody>
                    </table>
                  </TableScroll>
                </Panel>
              )
          )}
        </>
      )}
    </div>
  );
};

export default QuizOversight;
