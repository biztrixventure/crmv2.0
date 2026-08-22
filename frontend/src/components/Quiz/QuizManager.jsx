import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ClipboardList, Plus, Edit2, Trash2, Send, BarChart3, Clock, Users, User, X,
  CheckCircle2, AlertTriangle, Search, Minus, Save, Trophy, Tag, Target, TrendingUp, Copy,
} from 'lucide-react';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { Button, Alert } from '../UI';
import ThemedSelect from '../UI/Select';
import ThemedDate from '../UI/ThemedDate';
import { Panel, SectionHeader, Loading, EmptyState, KpiTile, PillTabs } from '../UI/kit';
import { pct, fmtDue, categoryColor, CategoryBadge, RankBadge, MiniBar } from './quizUtils';

const MIN_OPTIONS = 2;
// 8 made a "pick the state" or "pick the plan" question impossible. Matches the
// route's limit (mig 279). Past a handful of options a dropdown reads far
// better than a column of radio buttons, which is what display_type selects.
const MAX_OPTIONS = 100;
const BULK_ADD = 10;
const blankQuestion = () => ({ question_text: '', options: ['', ''], correct_index: 0, points: 1, display_type: 'radio' });

// ── Question editor (create/edit) ────────────────────────────────────────────
function QuestionEditor({ question, index, onChange, onRemove, onDuplicate, canRemove }) {
  const set = (patch) => onChange({ ...question, ...patch });
  const setOption = (i, v) => {
    const options = [...question.options];
    options[i] = v;
    set({ options });
  };
  const addOption = () => { if (question.options.length < MAX_OPTIONS) set({ options: [...question.options, ''] }); };
  const addManyOptions = () => {
    const room = MAX_OPTIONS - question.options.length;
    if (room <= 0) return;
    set({ options: [...question.options, ...Array(Math.min(BULK_ADD, room)).fill('')] });
  };
  const removeOption = (i) => {
    if (question.options.length <= MIN_OPTIONS) return;
    const options = question.options.filter((_, idx) => idx !== i);
    const correct_index = question.correct_index === i ? 0 : (question.correct_index > i ? question.correct_index - 1 : question.correct_index);
    set({ options, correct_index });
  };

  return (
    <Panel tone="inset" className="space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>Question {index + 1}</p>
        <div className="flex items-center gap-2">
          {/* Same data either way — a list of options and one correct answer.
              This picks how the person taking the quiz sees it, which is what
              makes a forty-option question workable. */}
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            {[{ k: 'radio', label: 'Choices' }, { k: 'dropdown', label: 'Dropdown' }].map(t => (
              <button key={t.k} type="button" onClick={() => set({ display_type: t.k })}
                className="text-xs font-semibold px-2 py-1"
                style={{
                  background: (question.display_type || 'radio') === t.k ? 'var(--color-primary-600)' : 'transparent',
                  color: (question.display_type || 'radio') === t.k ? '#fff' : 'var(--color-text-secondary)',
                }}>
                {t.label}
              </button>
            ))}
          </div>
          {onDuplicate && (
            <button type="button" onClick={onDuplicate} className="p-1 rounded-lg" title="Duplicate this question">
              <Copy size={14} style={{ color: 'var(--color-text-secondary)' }} />
            </button>
          )}
          {canRemove && (
            <button type="button" onClick={onRemove} className="p-1 rounded-lg hover:bg-error-50" title="Remove question">
              <Trash2 size={14} style={{ color: 'var(--color-error-500)' }} />
            </button>
          )}
        </div>
      </div>
      <input value={question.question_text} onChange={e => set({ question_text: e.target.value })}
        placeholder="Question text…" className="input w-full" />

      <div className="space-y-2">
        {question.options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <button type="button" onClick={() => set({ correct_index: i })}
              title={question.correct_index === i ? 'Correct answer' : 'Mark as correct'}
              className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors"
              style={{
                background: question.correct_index === i ? 'var(--color-success-600)' : 'transparent',
                border: `2px solid ${question.correct_index === i ? 'var(--color-success-600)' : 'var(--color-border)'}`,
              }}>
              {question.correct_index === i && <CheckCircle2 size={12} className="text-white" />}
            </button>
            <input value={opt} onChange={e => setOption(i, e.target.value)} placeholder={`Option ${i + 1}`} className="input flex-1" />
            {question.options.length > MIN_OPTIONS && (
              <button type="button" onClick={() => removeOption(i)} className="p-1 rounded-lg hover:bg-error-50 flex-shrink-0">
                <Minus size={14} style={{ color: 'var(--color-error-500)' }} />
              </button>
            )}
          </div>
        ))}
        {question.options.length < MAX_OPTIONS && (
          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={addOption} className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--color-primary-600)' }}>
              <Plus size={12} /> Add option
            </button>
            {/* Clicking "add" forty times is not a workflow. */}
            <button type="button" onClick={addManyOptions} className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--color-primary-600)' }}>
              <Plus size={12} /> Add {BULK_ADD}
            </button>
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {question.options.length} of {MAX_OPTIONS}
              {question.options.length > 8 && (question.display_type || 'radio') === 'radio'
                ? ' — long lists read better as a dropdown' : ''}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>Points</label>
        <input type="number" min={1} value={question.points} onChange={e => set({ points: Math.max(1, +e.target.value || 1) })} className="input w-20" />
      </div>
    </Panel>
  );
}

// ── Create / edit quiz modal ─────────────────────────────────────────────────
function QuizEditorModal({ quizId, existingCategories, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [passThreshold, setPassThreshold] = useState(70);
  const [timeLimit, setTimeLimit] = useState('');
  const [questions, setQuestions] = useState([blankQuestion()]);
  const [loading, setLoading] = useState(!!quizId);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!quizId) return;
    client.get(`quiz/${quizId}`).then(r => {
      setTitle(r.data.quiz.title || '');
      setDescription(r.data.quiz.description || '');
      setCategory(r.data.quiz.category || '');
      setPassThreshold(r.data.quiz.pass_threshold ?? 70);
      setTimeLimit(r.data.quiz.time_limit_minutes || '');
      setQuestions((r.data.questions || []).map(q => ({ question_text: q.question_text, options: q.options, correct_index: q.correct_index, points: q.points, display_type: q.display_type || 'radio' })));
    }).catch(e => setErr(e.response?.data?.error || 'Failed to load quiz')).finally(() => setLoading(false));
  }, [quizId]);

  const setQuestion = (i, q) => setQuestions(prev => prev.map((p, idx) => idx === i ? q : p));
  const addQuestion = () => setQuestions(prev => [...prev, blankQuestion()]);

  // Building a quiz where every question offers the same forty options meant
  // retyping all forty each time. A copy lands directly beneath its original,
  // carrying the options, the correct answer, the points and the display type —
  // everything except the question text, which is the part that changes.
  const duplicateQuestion = (i) => setQuestions(prev => {
    const src = prev[i];
    const copy = { ...src, options: [...src.options], question_text: src.question_text ? `${src.question_text} (copy)` : '' };
    return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
  });
  const removeQuestion = (i) => setQuestions(prev => prev.filter((_, idx) => idx !== i));

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return setErr('Title is required');
    if (!questions.length) return setErr('Add at least one question');
    for (const q of questions) {
      if (!q.question_text.trim()) return setErr('Every question needs text');
      if (q.options.some(o => !o.trim())) return setErr('Options cannot be blank');
    }
    setSaving(true); setErr('');
    const payload = {
      title, description: description || null, category: category.trim() || null,
      pass_threshold: Math.max(0, Math.min(100, +passThreshold || 70)),
      time_limit_minutes: timeLimit ? +timeLimit : null, questions,
    };
    try {
      if (quizId) await client.put(`quiz/${quizId}`, payload);
      else await client.post('quiz', payload);
      onSaved();
      onClose();
    } catch (er) { setErr(er.response?.data?.error || 'Failed to save quiz'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-2xl my-6 rounded-2xl animate-scale-in"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-2.5">
            <ClipboardList size={20} className="text-white" />
            <h3 className="text-lg font-bold text-white">{quizId ? 'Edit Quiz' : 'New Quiz'}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"><X size={18} className="text-white" /></button>
        </div>

        {loading ? <div className="p-8"><Loading /></div> : (
          <form onSubmit={submit} className="p-6 space-y-4">
            {err && <Alert type="error" message={err} dismissible onDismiss={() => setErr('')} />}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Title <span style={{ color: '#ef4444' }}>*</span></label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Compliance basics — Q3" className="input w-full" />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What this quiz covers…" className="input w-full" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}><Tag size={12} /> Category</label>
                <input list="quiz-categories" value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Compliance" className="input w-full" />
                <datalist id="quiz-categories">
                  {(existingCategories || []).map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}><Target size={12} /> Pass threshold (%)</label>
                <input type="number" min={0} max={100} value={passThreshold} onChange={e => setPassThreshold(e.target.value)} className="input w-full" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock size={14} style={{ color: 'var(--color-text-tertiary)' }} />
              <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>Time limit (minutes, optional)</label>
              <input type="number" min={1} value={timeLimit} onChange={e => setTimeLimit(e.target.value)} placeholder="Untimed" className="input w-28" />
            </div>

            <div className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>Questions</p>
              {questions.map((q, i) => (
                <QuestionEditor key={i} question={q} index={i} onChange={qq => setQuestion(i, qq)} onRemove={() => removeQuestion(i)} onDuplicate={() => duplicateQuestion(i)} canRemove={questions.length > 1} />
              ))}
              <div className="flex gap-2">
                <button type="button" onClick={addQuestion} className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5"
                  style={{ border: '1px dashed var(--color-border)', color: 'var(--color-primary-600)' }}>
                  <Plus size={15} /> Add question
                </button>
                {questions.length > 0 && (
                  <button type="button" onClick={() => duplicateQuestion(questions.length - 1)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5"
                    style={{ border: '1px dashed var(--color-border)', color: 'var(--color-primary-600)' }}
                    title="Copy the last question, options and all">
                    <Copy size={15} /> Duplicate last
                  </button>
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving} className="flex-1 flex items-center justify-center gap-1.5">
                <Save size={15} /> {saving ? 'Saving…' : quizId ? 'Save Changes' : 'Create Quiz'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Assign modal (users and/or teams, one or many) ───────────────────────────
function AssignModal({ quiz, crossCompany, onClose, onAssigned }) {
  const { user } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState(user?.company_id || '');
  const [teams, setTeams] = useState([]);
  const [members, setMembers] = useState([]);
  const [selectedTeams, setSelectedTeams] = useState(new Set());
  const [selectedUsers, setSelectedUsers] = useState(new Set());
  const [search, setSearch] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!crossCompany) return;
    // GET /companies only special-cases superadmin (everyone else gets just
    // their own companies) — compliance_manager needs the compliance-scoped
    // endpoint, which is what the rest of the Compliance shell already uses
    // to see every company.
    const endpoint = user?.role === 'compliance_manager' ? 'compliance/companies' : 'companies';
    client.get(endpoint).then(r => {
      const cos = (Array.isArray(r.data) ? r.data : r.data?.companies || []).map(c => ({ id: c.id, name: c.name })).filter(c => c.id);
      setCompanies(cos);
      setCompanyId(prev => prev || user?.company_id || cos[0]?.id || '');
    }).catch(() => {});
  }, [crossCompany, user?.company_id, user?.role]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [t, m] = await Promise.all([
        client.get('teams', { params: { company_id: companyId } }),
        client.get('teams/company-members', { params: { company_id: companyId } }),
      ]);
      setTeams(t.data.teams || []);
      setMembers(m.data.members || []);
    } catch (e) { setErr(e.response?.data?.error || 'Failed to load teams/members'); }
    finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const toggle = (set, setter, id) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(m => m.name.toLowerCase().includes(q));
  }, [members, search]);

  const submit = async () => {
    if (!selectedTeams.size && !selectedUsers.size) return setErr('Pick at least one user or team');
    setSaving(true); setErr('');
    try {
      await client.post(`quiz/${quiz.id}/assign`, {
        user_ids: [...selectedUsers],
        team_ids: [...selectedTeams],
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
      });
      onAssigned();
      onClose();
    } catch (e) { setErr(e.response?.data?.error || 'Failed to assign'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-xl my-6 rounded-2xl animate-scale-in"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-2.5">
            <Send size={20} className="text-white" />
            <h3 className="text-lg font-bold text-white">Assign "{quiz.title}"</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"><X size={18} className="text-white" /></button>
        </div>

        <div className="p-6 space-y-4">
          {err && <Alert type="error" message={err} dismissible onDismiss={() => setErr('')} />}

          {crossCompany && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Company</label>
              <ThemedSelect value={companyId} onChange={e => { setCompanyId(e.target.value); setSelectedTeams(new Set()); setSelectedUsers(new Set()); }} className="input w-full">
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </ThemedSelect>
            </div>
          )}

          {loading ? <Loading /> : (
            <>
              {teams.length > 0 && (
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}><Users size={12} /> Teams</label>
                  <div className="flex flex-wrap gap-2">
                    {teams.map(t => {
                      const on = selectedTeams.has(t.id);
                      return (
                        <button key={t.id} type="button" onClick={() => toggle(selectedTeams, setSelectedTeams, t.id)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                          style={{ background: on ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)', color: on ? '#fff' : 'var(--color-text)' }}>
                          {t.name} <span style={{ opacity: 0.7 }}>({t.member_count})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}><User size={12} /> Individual users</label>
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people…" className="input pl-8 w-full" />
                </div>
                <div className="max-h-48 overflow-y-auto rounded-xl" style={{ border: '1px solid var(--color-border)' }}>
                  {filteredMembers.length === 0 ? (
                    <p className="text-xs p-3" style={{ color: 'var(--color-text-tertiary)' }}>No members found.</p>
                  ) : filteredMembers.map(m => {
                    const on = selectedUsers.has(m.user_id);
                    return (
                      <label key={m.user_id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-bg-secondary" style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <input type="checkbox" checked={on} onChange={() => toggle(selectedUsers, setSelectedUsers, m.user_id)} />
                        <span className="text-sm flex-1" style={{ color: 'var(--color-text)' }}>{m.name}</span>
                        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{m.role}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Due date (optional)</label>
                <ThemedDate withTime value={dueAt} onChange={e => setDueAt(e.target.value)} className="input w-full" />
              </div>
            </>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="button" variant="primary" disabled={saving || loading} onClick={submit} className="flex-1 flex items-center justify-center gap-1.5">
              <Send size={15} /> {saving ? 'Assigning…' : 'Assign Quiz'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Results / progress modal ──────────────────────────────────────────────────
function ResultsModal({ quizId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    client.get(`quiz/${quizId}/results`).then(r => setData(r.data)).catch(e => setErr(e.response?.data?.error || 'Failed to load results')).finally(() => setLoading(false));
  }, [quizId]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-3xl my-6 rounded-2xl animate-scale-in"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-2.5">
            <BarChart3 size={20} className="text-white" />
            <h3 className="text-lg font-bold text-white">{data?.quiz?.title ? `Results — ${data.quiz.title}` : 'Results'}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"><X size={18} className="text-white" /></button>
        </div>

        <div className="p-6 space-y-4">
          {err && <Alert type="error" message={err} />}
          {loading ? <Loading /> : data && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <KpiTile label="Assigned" value={data.summary.total_assigned} tone="primary" />
                <KpiTile label="Submitted" value={data.summary.total_submitted} tone="success" />
                <KpiTile label="Pass / Fail" value={`${data.summary.pass_count} / ${data.summary.fail_count}`} tone={data.summary.fail_count > data.summary.pass_count ? 'danger' : 'success'} />
                <KpiTile label="Avg score" value={pct(data.summary.avg_percent)} tone="info" />
              </div>

              {data.ranked?.length > 0 && (
                <Panel tone="inset" className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                    <Trophy size={13} style={{ color: '#f59e0b' }} /> Top scorers
                  </p>
                  <div className="space-y-1.5">
                    {data.ranked.map((r, i) => (
                      <div key={r.user_id} className="flex items-center gap-2.5 text-sm">
                        <RankBadge rank={i + 1} />
                        <span className="flex-1" style={{ color: 'var(--color-text)' }}>{r.user_name}</span>
                        <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{pct(r.percent)}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {data.assignments.length === 0 ? (
                <EmptyState icon={Send} title="Not assigned yet" hint="Assign this quiz to a team or specific users to see progress here." />
              ) : data.assignments.map(a => (
                <Panel key={a.id} tone="inset" className="space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-sm font-bold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
                      {a.target_type === 'team' ? <Users size={14} /> : <User size={14} />}
                      {a.target_type === 'team' ? a.target_team_name : a.target_user_name}
                    </p>
                    {a.due_at && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Due {fmtDue(a.due_at)}</span>}
                  </div>
                  <div className="space-y-1">
                    {a.attempts.map(at => (
                      <div key={at.user_id} className="flex items-center justify-between gap-2 text-sm py-1" style={{ borderTop: '1px solid var(--color-border)' }}>
                        <span style={{ color: 'var(--color-text)' }}>{at.user_name}</span>
                        {at.status === 'submitted' ? (
                          <span className="flex items-center gap-1.5 font-semibold" style={{ color: at.pass ? 'var(--color-success-600)' : 'var(--color-error-500)' }}>
                            {at.pass ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {pct(at.percent)} ({at.score}/{at.total_points})
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
                            <Clock size={12} /> Pending
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </Panel>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Cross-quiz leaderboard ────────────────────────────────────────────────────
function LeaderboardPanel() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    client.get('quiz/leaderboard').then(r => setRows(r.data.leaderboard || [])).catch(e => setErr(e.response?.data?.error || 'Failed to load leaderboard')).finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (err) return <Alert type="error" message={err} />;
  if (!rows?.length) {
    return <EmptyState icon={Trophy} title="No scores yet" hint="Once people start completing your quizzes, the top performers show up here." />;
  }

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <Panel key={r.user_id} className="flex items-center gap-3">
          <div className="w-7 flex justify-center flex-shrink-0"><RankBadge rank={i + 1} /></div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold truncate" style={{ color: 'var(--color-text)' }}>{r.user_name}</p>
            <div className="flex items-center gap-2 mt-1">
              <MiniBar value={r.avg_percent} tone={r.avg_percent >= 70 ? 'var(--color-success-600)' : 'var(--color-warning-600)'} />
              <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{r.quizzes_taken} quiz{r.quizzes_taken === 1 ? '' : 'zes'}</span>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="font-bold text-lg leading-none" style={{ color: 'var(--color-text)' }}>{pct(r.avg_percent)}</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>best {pct(r.best_percent)}</p>
          </div>
        </Panel>
      ))}
    </div>
  );
}

// ── Main manager ──────────────────────────────────────────────────────────────
export default function QuizManager() {
  const { user, hasPermission } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';
  const crossCompany = isSuperadmin || user?.role === 'compliance_manager';
  // Mirror the backend's canManageQuizzes(): compliance_manager is always
  // allowed, independent of the quiz.manage role_permissions row — so this
  // still works even before/without migration 273's permission grant landing.
  const canManage = isSuperadmin || user?.role === 'compliance_manager' || hasPermission('quiz.manage');

  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editorId, setEditorId] = useState(undefined);   // undefined = closed, null = new, id = edit
  const [assignQuiz, setAssignQuiz] = useState(null);
  const [resultsId, setResultsId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [view, setView] = useState('quizzes');           // 'quizzes' | 'leaderboard'
  const [categoryFilter, setCategoryFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await client.get('quiz');
      setQuizzes(r.data.quizzes || []);
    } catch (e) { setErr(e.response?.data?.error || 'Failed to load quizzes'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (quiz) => {
    try { await client.delete(`quiz/${quiz.id}`); setConfirmDelete(null); load(); }
    catch (e) { setErr(e.response?.data?.error || 'Failed to delete quiz'); }
  };

  const totals = useMemo(() => ({
    quizzes: quizzes.length,
    assigned: quizzes.reduce((s, q) => s + (q.assigned_count || 0), 0),
    submitted: quizzes.reduce((s, q) => s + (q.submitted_count || 0), 0),
  }), [quizzes]);
  const categories = useMemo(() => [...new Set(quizzes.map(q => q.category).filter(Boolean))].sort(), [quizzes]);
  const visibleQuizzes = useMemo(
    () => categoryFilter ? quizzes.filter(q => q.category === categoryFilter) : quizzes,
    [quizzes, categoryFilter],
  );

  if (!canManage) {
    return <EmptyState icon={ClipboardList} title="No access" hint="You don't have permission to manage quizzes." />;
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader level="page" icon={ClipboardList} title="Quizzes"
        subtitle="Build MCQ quizzes and assign them to teams or individuals — track results as they come in."
        actions={<Button variant="primary" onClick={() => setEditorId(null)} className="flex items-center gap-1.5"><Plus size={16} /> New Quiz</Button>} />

      {err && <Alert type="error" message={err} dismissible onDismiss={() => setErr('')} />}

      <div className="grid grid-cols-3 gap-2.5">
        <KpiTile label="Quizzes" value={totals.quizzes} tone="primary" />
        <KpiTile label="Assigned" value={totals.assigned} tone="info" />
        <KpiTile label="Submitted" value={totals.submitted} tone="success" />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <PillTabs
          items={[{ key: 'quizzes', label: 'Quizzes', icon: ClipboardList }, { key: 'leaderboard', label: 'Leaderboard', icon: Trophy }]}
          value={view} onChange={setView}
        />
        {view === 'quizzes' && categories.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setCategoryFilter('')} className="px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors"
              style={{ background: !categoryFilter ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)', color: !categoryFilter ? '#fff' : 'var(--color-text-secondary)' }}>
              All
            </button>
            {categories.map(c => {
              const on = categoryFilter === c;
              const col = categoryColor(c);
              return (
                <button key={c} onClick={() => setCategoryFilter(on ? '' : c)} className="px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors flex items-center gap-1"
                  style={{ background: on ? col : `color-mix(in srgb, ${col} 12%, transparent)`, color: on ? '#fff' : col }}>
                  <Tag size={9} /> {c}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {view === 'leaderboard' ? <LeaderboardPanel /> : (
        loading ? <Loading /> : visibleQuizzes.length === 0 ? (
          quizzes.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No quizzes yet" hint="Create your first quiz and assign it to a team or specific people."
              action={<Button variant="primary" onClick={() => setEditorId(null)} className="inline-flex items-center gap-1.5"><Plus size={15} /> New Quiz</Button>} />
          ) : (
            <EmptyState icon={Tag} title="No quizzes in this category" hint="Pick a different category or clear the filter." />
          )
        ) : (
          <div className="space-y-2.5">
            {visibleQuizzes.map(q => (
              <Panel key={q.id} className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{q.title}</p>
                    <CategoryBadge category={q.category} />
                    {!q.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>INACTIVE</span>}
                    {q.time_limit_minutes && <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}><Clock size={11} /> {q.time_limit_minutes}m</span>}
                  </div>
                  {q.description && <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--color-text-secondary)' }}>{q.description}</p>}
                  <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                    {q.question_count} question{q.question_count === 1 ? '' : 's'} · {q.assigned_count} assigned · {q.submitted_count} submitted
                    {crossCompany && <> · by {q.created_by_name}</>}
                  </p>
                  {q.avg_percent != null && (
                    <div className="flex items-center gap-2 mt-1.5 max-w-[220px]">
                      <TrendingUp size={11} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
                      <MiniBar value={q.avg_percent} tone={q.avg_percent >= q.pass_threshold ? 'var(--color-success-600)' : 'var(--color-warning-600)'} />
                      <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{pct(q.avg_percent)} avg</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setAssignQuiz(q)} title="Assign" className="p-2 rounded-lg hover:bg-bg-secondary"><Send size={15} style={{ color: 'var(--color-primary-500)' }} /></button>
                  <button onClick={() => setResultsId(q.id)} title="Results" className="p-2 rounded-lg hover:bg-bg-secondary"><BarChart3 size={15} style={{ color: 'var(--color-info-500, #0891b2)' }} /></button>
                  <button onClick={() => setEditorId(q.id)} title="Edit" className="p-2 rounded-lg hover:bg-bg-secondary"><Edit2 size={15} style={{ color: 'var(--color-text-secondary)' }} /></button>
                  <button onClick={() => setConfirmDelete(q)} title="Delete" className="p-2 rounded-lg hover:bg-error-50"><Trash2 size={15} style={{ color: 'var(--color-error-500)' }} /></button>
                </div>
              </Panel>
            ))}
          </div>
        )
      )}

      {editorId !== undefined && <QuizEditorModal quizId={editorId} existingCategories={categories} onClose={() => setEditorId(undefined)} onSaved={load} />}
      {assignQuiz && <AssignModal quiz={assignQuiz} crossCompany={crossCompany} onClose={() => setAssignQuiz(null)} onAssigned={load} />}
      {resultsId && <ResultsModal quizId={resultsId} onClose={() => setResultsId(null)} />}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md p-6 rounded-2xl animate-scale-in" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
            <div className="flex items-center gap-2 mb-1"><AlertTriangle size={18} style={{ color: 'var(--color-error-500)' }} /><h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Delete Quiz</h3></div>
            <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>Permanently delete "{confirmDelete.title}"? All assignments and results are removed too. This cannot be undone.</p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setConfirmDelete(null)} className="flex-1">Cancel</Button>
              <Button variant="danger" onClick={() => remove(confirmDelete)} className="flex-1">Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
