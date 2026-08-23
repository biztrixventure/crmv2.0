// ============================================================================
// HR -> Performance reviews. Cycle list, review list, and the review detail
// with goals, competency ratings and the self-assessment form.
//
// The four-stop ladder is the whole design, and this page renders exactly the
// stop you are standing at:
//
//   pending_self     -> only the SUBJECT sees an editable self-assessment
//   pending_manager  -> only the REVIEWER sees an editable manager section
//   pending_signoff  -> only the SUBJECT can sign off
//   completed        -> everything is read-only
//
// The other side is always VISIBLE but never editable, because a review whose
// halves cannot be read together is not a review. is_subject and is_reviewer
// come from the server (it resolves the caller employee record); the page never
// works them out from a user id.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, Plus, ArrowLeft, Send, CheckCircle2, Undo2, Target, Star, Rocket } from 'lucide-react';
import { Panel, SectionHeader, Loading, EmptyState, Field, KpiTile, TableScroll, PillTabs } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import { Btn, StatusPill, ModuleModal } from '../../components/Modules/ModuleUI';
import { usePerformanceReviews } from '../../hooks/usePerformanceReviews';
import { fmtDate, fmtNumber, todayISO } from '../../utils/money';

const fullName = (e) => [e?.first_name, e?.last_name].filter(Boolean).join(' ') || 'Unnamed';
const LADDER_LABEL = {
  pending_self: 'Waiting on the self-assessment',
  pending_manager: 'Waiting on the reviewer',
  pending_signoff: 'Waiting on sign-off',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default function ReviewsPage({ scope }) {
  const companyId = scope?.company_id || null;
  const canManage = !!scope?.permissions?.['hr.reviews.manage'];
  const {
    reviews, cycles, scope: serverScope, myEmployeeId, loading, error,
    fetchCycles, saveCycle, launchCycle, fetchReviews,
  } = usePerformanceReviews(companyId);

  const [tab, setTab] = useState('mine');
  const [openId, setOpenId] = useState(null);
  const [makingCycle, setMakingCycle] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => { fetchCycles(); }, [fetchCycles]);
  useEffect(() => { fetchReviews({ scope: tab === 'all' ? 'all' : 'mine' }); }, [fetchReviews, tab]);

  const teamAllowed = serverScope === 'all' || canManage;
  useEffect(() => { if (!teamAllowed && tab !== 'mine') setTab('mine'); }, [teamAllowed, tab]);

  if (openId) {
    return <ReviewDetail companyId={companyId} reviewId={openId} onBack={() => { setOpenId(null); fetchReviews({ scope: tab === 'all' ? 'all' : 'mine' }); }} />;
  }

  const waitingOnMe = reviews.filter(r =>
    (r.is_subject && ['pending_self', 'pending_signoff'].includes(r.status)) ||
    (r.is_reviewer && r.status === 'pending_manager'));

  const tabs = [{ key: 'mine', label: 'My reviews', icon: ClipboardList }];
  if (teamAllowed) tabs.push({ key: 'all', label: 'All reviews', icon: Target });
  if (canManage) tabs.push({ key: 'cycles', label: 'Cycles', icon: Rocket });

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={ClipboardList} title="Performance reviews"
        subtitle={scope?.company_name || undefined}
        actions={canManage && tab === 'cycles'
          ? <Btn variant="primary" icon={Plus} onClick={() => setMakingCycle(true)}>New cycle</Btn>
          : null} />

      {error && <Alert type="error">{error}</Alert>}
      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}

      {waitingOnMe.length > 0 && tab !== 'cycles' && (
        <Alert type="warning" dismissible={false}>
          <strong>{waitingOnMe.length}</strong> review{waitingOnMe.length === 1 ? ' is' : 's are'} waiting on you.
        </Alert>
      )}

      {tabs.length > 1 && <PillTabs items={tabs} value={tab} onChange={setTab} />}

      {tab === 'cycles' ? (
        <CycleList cycles={cycles} canManage={canManage}
          onLaunch={async (id) => {
            setNotice(null);
            try {
              const r = await launchCycle(id);
              setNotice({
                type: 'success',
                text: r.created
                  ? `Created ${r.created} review${r.created === 1 ? '' : 's'}.${r.skipped ? ` ${r.skipped} already existed.` : ''}`
                  : 'Everyone in this cycle already has a review.',
              });
            } catch (e) {
              setNotice({ type: 'error', text: e.response?.data?.error || 'Could not launch the cycle.' });
            }
          }} />
      ) : (
        loading && reviews.length === 0 ? <Loading variant="table" rows={5} label="Loading reviews" /> : (
          reviews.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No reviews"
              hint={canManage
                ? 'Create a cycle and launch it -- that creates one review per active employee, pointed at their manager.'
                : 'Reviews appear here when a cycle is launched.'} />
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiTile label="Reviews" value={reviews.length} tone="info" />
                <KpiTile label="Waiting on you" value={waitingOnMe.length} tone={waitingOnMe.length ? 'warning' : 'muted'} />
                <KpiTile label="In progress" value={reviews.filter(r => !['completed', 'cancelled'].includes(r.status)).length} tone="primary" />
                <KpiTile label="Completed" value={reviews.filter(r => r.status === 'completed').length} tone="success" />
              </div>

              <Panel pad="none">
                <TableScroll stickyFirst>
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                        {['Employee', 'Cycle', 'Your part', 'Stage', 'Rating', ''].map((h, i) => (
                          <th key={h + i} className="td-p text-[11px] font-bold uppercase tracking-wider text-left"
                            style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reviews.map(r => {
                        const yours = r.is_subject && r.is_reviewer ? 'Subject and reviewer'
                          : r.is_subject ? 'You are reviewed'
                          : r.is_reviewer ? 'You are the reviewer' : '--';
                        const actionable = (r.is_subject && ['pending_self', 'pending_signoff'].includes(r.status))
                          || (r.is_reviewer && r.status === 'pending_manager');
                        return (
                          <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>
                              {r.employee_id === myEmployeeId ? 'You' : fullName(r.hr_employees)}
                            </td>
                            <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                              {r.hr_review_cycles?.name || '--'}
                              {r.hr_review_cycles?.due_date && (
                                <span className="block text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                  due {fmtDate(r.hr_review_cycles.due_date)}
                                </span>
                              )}
                            </td>
                            <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>{yours}</td>
                            <td className="td-p">
                              <StatusPill status={r.status} />
                              <span className="block text-[11px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                                {LADDER_LABEL[r.status]}
                              </span>
                            </td>
                            <td className="td-p text-sm tabular-nums" style={{ color: 'var(--color-text)' }}>
                              {r.overall_rating != null ? fmtNumber(r.overall_rating, 1) : '--'}
                            </td>
                            <td className="td-p text-right">
                              <Btn size="sm" variant={actionable ? 'primary' : 'secondary'} onClick={() => setOpenId(r.id)}>
                                {actionable ? 'Continue' : 'Open'}
                              </Btn>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableScroll>
              </Panel>
            </>
          )
        )
      )}

      {makingCycle && (
        <CycleDialog onClose={() => setMakingCycle(false)}
          onSubmit={async (payload) => {
            setNotice(null);
            try {
              await saveCycle(payload);
              setMakingCycle(false);
              setNotice({ type: 'success', text: 'Cycle created. Launch it to generate the reviews.' });
            } catch (e) {
              setNotice({ type: 'error', text: e.response?.data?.error || 'Could not create the cycle.' });
            }
          }} />
      )}
    </div>
  );
}

function CycleList({ cycles, canManage, onLaunch }) {
  if (cycles.length === 0) {
    return <EmptyState icon={Rocket} title="No review cycles"
      hint="A cycle is a period everyone is reviewed against. Create one, then launch it to generate a review per employee." />;
  }
  return (
    <div className="space-y-2">
      {cycles.map(c => {
        const p = c.progress || { total: 0, completed: 0 };
        const pct = p.total ? Math.round((p.completed / p.total) * 100) : 0;
        return (
          <Panel key={c.id} pad="sm">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{c.name}</span>
              <StatusPill status={c.status} />
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {fmtDate(c.period_start)} to {fmtDate(c.period_end)}
                {c.due_date ? ` -- due ${fmtDate(c.due_date)}` : ''}
              </span>
              <div className="ml-auto flex items-center gap-3">
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  {p.completed} of {p.total} complete
                </span>
                {canManage && c.status !== 'closed' && (
                  <Btn size="sm" variant="primary" icon={Rocket} onClick={() => onLaunch(c.id)}
                    title="Creates a review for every active employee who does not have one yet">
                    {p.total ? 'Sync employees' : 'Launch'}
                  </Btn>
                )}
              </div>
            </div>
            {p.total > 0 && (
              <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-success-600)' }} />
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

function CycleDialog({ onClose, onSubmit }) {
  const [form, setForm] = useState({
    name: '', period_start: '', period_end: '', due_date: '', description: '', rating_scale_max: 5,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <ModuleModal title="New review cycle" onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" busy={saving} disabled={!form.name || !form.period_start || !form.period_end}
            onClick={async () => { setSaving(true); await onSubmit({ ...form, due_date: form.due_date || null }); setSaving(false); }}>
            Create cycle
          </Btn>
        </>
      }>
      <div className="space-y-3">
        <Field label="Name" required>
          <input className="input w-full" value={form.name} onChange={e => set('name', e.target.value)} placeholder="H1 2026" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Period start" required>
            <input className="input w-full" type="date" value={form.period_start} onChange={e => set('period_start', e.target.value)} />
          </Field>
          <Field label="Period end" required>
            <input className="input w-full" type="date" value={form.period_end} onChange={e => set('period_end', e.target.value)} />
          </Field>
          <Field label="Due date">
            <input className="input w-full" type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
          </Field>
        </div>
        <Field label="Rating scale maximum" hint="Kept per cycle, so changing it later never rewrites old reviews.">
          <input className="input w-full" type="number" step="1" min="1" value={form.rating_scale_max}
            onChange={e => set('rating_scale_max', Number(e.target.value))} />
        </Field>
        <Field label="Description"><textarea className="input w-full" rows={2} value={form.description} onChange={e => set('description', e.target.value)} /></Field>
      </div>
    </ModuleModal>
  );
}

// -- Review detail --------------------------------------------------------------

function ReviewDetail({ companyId, reviewId, onBack }) {
  const { fetchReview, submitSelf, submitManager, signOff, reopen, addGoal, updateGoal, deleteGoal, addRating } =
    usePerformanceReviews(companyId);

  const [data, setData] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selfText, setSelfText] = useState('');
  const [mgrText, setMgrText] = useState('');
  const [overall, setOverall] = useState('');
  const [goalDraft, setGoalDraft] = useState('');
  const [competency, setCompetency] = useState('');

  const reload = useCallback(async () => {
    const d = await fetchReview(reviewId);
    setData(d);
    setSelfText(d?.review?.self_comments || '');
    setMgrText(d?.review?.manager_comments || '');
    setOverall(d?.review?.overall_rating ?? '');
  }, [fetchReview, reviewId]);

  useEffect(() => { reload(); }, [reload]);

  const guard = async (fn, ok) => {
    setBusy(true);
    setNotice(null);
    try { await fn(); await reload(); setNotice({ type: 'success', text: ok }); }
    catch (e) { setNotice({ type: 'error', text: e.response?.data?.error || 'That did not work.' }); }
    finally { setBusy(false); }
  };

  if (!data) return <Loading variant="rows" rows={6} label="Loading the review" />;

  const r = data.review;
  const { is_subject: isSubject, is_reviewer: isReviewer, can_manage: canManage } = data;
  const scaleMax = r.hr_review_cycles?.rating_scale_max || 5;
  const goals = (r.hr_review_goals || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const ratings = (r.hr_review_ratings || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  const selfEditable = isSubject && r.status === 'pending_self';
  const mgrEditable = (isReviewer || canManage) && r.status === 'pending_manager' && !(isSubject && !canManage);
  const canSign = isSubject && r.status === 'pending_signoff';

  // The goals/ratings payload each side sends with its submission. Which column
  // it lands in is decided by the endpoint, not by this object.
  const goalPayload = (side) => goals.map(g => ({
    id: g.id,
    rating: side === 'self' ? g.self_rating : g.manager_rating,
    comments: side === 'self' ? g.self_comments : g.manager_comments,
  }));

  return (
    <div className="space-y-4">
      <SectionHeader title={`${fullName(r.hr_employees)} -- ${r.hr_review_cycles?.name || 'Review'}`}
        subtitle={LADDER_LABEL[r.status]}
        actions={
          <div className="flex items-center gap-2">
            <Btn icon={ArrowLeft} onClick={onBack}>Back</Btn>
            {canManage && !['pending_self'].includes(r.status) && (
              <Btn icon={Undo2} busy={busy}
                onClick={() => { if (window.confirm('Send this review back one step?')) guard(() => reopen(r.id), 'Review sent back one step.'); }}>
                Reopen
              </Btn>
            )}
          </div>
        } />

      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}

      <Ladder status={r.status} />

      {/* Goals. Both ratings live on the same row -- the gap between them is the
          interesting number in a review. */}
      <Panel>
        <SectionHeader icon={Target} title="Goals" subtitle={`Rated out of ${scaleMax}`} />
        {goals.length === 0
          ? <EmptyState compact icon={Target} title="No goals on this review yet" />
          : (
            <TableScroll>
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['Goal', 'Status', 'Self', 'Manager', ''].map(h => (
                      <th key={h} className="td-p text-[10px] font-bold uppercase tracking-wider text-left"
                        style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {goals.map(g => (
                    <tr key={g.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>
                        {g.title}
                        {g.description && <span className="block text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{g.description}</span>}
                      </td>
                      <td className="td-p">
                        {mgrEditable ? (
                          <ThemedSelect value={g.status}
                            onChange={e => guard(() => updateGoal(g.id, { status: e.target.value }), 'Goal updated.')}>
                            {['not_started', 'in_progress', 'achieved', 'partially_met', 'missed'].map(s => (
                              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                            ))}
                          </ThemedSelect>
                        ) : <StatusPill status={g.status} />}
                      </td>
                      <td className="td-p">
                        <RatingInput value={g.self_rating} max={scaleMax} editable={selfEditable}
                          onChange={v => guard(() => updateGoal(g.id, { self_rating: v }), 'Saved.')} />
                      </td>
                      <td className="td-p">
                        <RatingInput value={g.manager_rating} max={scaleMax} editable={mgrEditable}
                          onChange={v => guard(() => updateGoal(g.id, { manager_rating: v }), 'Saved.')} />
                      </td>
                      <td className="td-p text-right">
                        {(selfEditable || mgrEditable) && (
                          <Btn size="sm" variant="danger"
                            onClick={() => guard(() => deleteGoal(g.id), 'Goal removed.')}>Remove</Btn>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        {(selfEditable || mgrEditable) && (
          <div className="flex items-center gap-2 mt-3">
            <input className="input flex-1" placeholder="Add a goal" value={goalDraft}
              onChange={e => setGoalDraft(e.target.value)} />
            <Btn variant="primary" icon={Plus} disabled={!goalDraft.trim()} busy={busy}
              onClick={() => guard(async () => { await addGoal(r.id, { title: goalDraft.trim() }); setGoalDraft(''); }, 'Goal added.')}>
              Add
            </Btn>
          </div>
        )}
      </Panel>

      {/* Competencies */}
      <Panel>
        <SectionHeader icon={Star} title="Competencies" subtitle={`Rated out of ${scaleMax}`} />
        {ratings.length === 0
          ? <EmptyState compact icon={Star} title="No competencies added" />
          : (
            <div className="space-y-2">
              {ratings.map(c => (
                <div key={c.id} className="flex items-center gap-3 py-1.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <span className="text-sm flex-1" style={{ color: 'var(--color-text)' }}>{c.competency}</span>
                  <span className="text-[10px] uppercase font-bold" style={{ color: 'var(--color-text-tertiary)' }}>self</span>
                  <RatingInput value={c.self_rating} max={scaleMax} editable={false} />
                  <span className="text-[10px] uppercase font-bold" style={{ color: 'var(--color-text-tertiary)' }}>mgr</span>
                  <RatingInput value={c.manager_rating} max={scaleMax} editable={false} />
                </div>
              ))}
            </div>
          )}
        {(selfEditable || mgrEditable) && (
          <div className="flex items-center gap-2 mt-3">
            <input className="input flex-1" placeholder="Add a competency, e.g. Communication" value={competency}
              onChange={e => setCompetency(e.target.value)} />
            <Btn variant="primary" icon={Plus} disabled={!competency.trim()} busy={busy}
              onClick={() => guard(async () => { await addRating(r.id, competency.trim()); setCompetency(''); }, 'Competency added.')}>
              Add
            </Btn>
          </div>
        )}
      </Panel>

      {/* The two written halves. Always visible, editable only at your stop. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel>
          <SectionHeader title="Self-assessment"
            subtitle={r.self_submitted_at ? `Submitted ${fmtDate(r.self_submitted_at)}` : 'Not submitted yet'} />
          {selfEditable ? (
            <>
              <textarea className="input w-full" rows={7} value={selfText} onChange={e => setSelfText(e.target.value)}
                placeholder="What went well, what was hard, what you want next." />
              <div className="flex items-center justify-end gap-2 mt-3">
                <Btn busy={busy}
                  onClick={() => guard(() => submitSelf(r.id, { self_comments: selfText, submit: false, goals: goalPayload('self') }), 'Draft saved.')}>
                  Save draft
                </Btn>
                <Btn variant="primary" icon={Send} busy={busy}
                  onClick={() => guard(() => submitSelf(r.id, { self_comments: selfText, submit: true, goals: goalPayload('self') }), 'Self-assessment submitted -- it is now with your reviewer.')}>
                  Submit to reviewer
                </Btn>
              </div>
            </>
          ) : (
            <ReadOnlyText text={r.self_comments} empty="Not written yet." />
          )}
        </Panel>

        <Panel>
          <SectionHeader title="Manager review"
            subtitle={r.manager_submitted_at ? `Submitted ${fmtDate(r.manager_submitted_at)}` : 'Not submitted yet'} />
          {mgrEditable ? (
            <>
              <textarea className="input w-full" rows={5} value={mgrText} onChange={e => setMgrText(e.target.value)}
                placeholder="Your assessment of the period." />
              <Field label="Overall rating" className="mt-3">
                <input className="input w-full" type="number" step="0.1" min="0" max={scaleMax}
                  value={overall} onChange={e => setOverall(e.target.value)} />
              </Field>
              <div className="flex items-center justify-end gap-2 mt-3">
                <Btn busy={busy}
                  onClick={() => guard(() => submitManager(r.id, {
                    manager_comments: mgrText, submit: false,
                    overall_rating: overall === '' ? null : Number(overall),
                    goals: goalPayload('manager'),
                  }), 'Draft saved.')}>
                  Save draft
                </Btn>
                <Btn variant="primary" icon={Send} busy={busy}
                  onClick={() => guard(() => submitManager(r.id, {
                    manager_comments: mgrText, submit: true,
                    overall_rating: overall === '' ? null : Number(overall),
                    goals: goalPayload('manager'),
                  }), 'Review submitted -- it is now with the employee for sign-off.')}>
                  Submit for sign-off
                </Btn>
              </div>
            </>
          ) : (
            <>
              <ReadOnlyText text={r.manager_comments} empty="Not written yet." />
              {r.overall_rating != null && (
                <p className="text-sm mt-3 m-0" style={{ color: 'var(--color-text)' }}>
                  Overall rating <strong>{fmtNumber(r.overall_rating, 1)}</strong> of {scaleMax}
                </p>
              )}
            </>
          )}
        </Panel>
      </div>

      {canSign && (
        <Panel>
          <SectionHeader icon={CheckCircle2} title="Sign off"
            subtitle="Acknowledging your review. Add anything you want on the record." />
          <SignOffForm busy={busy} onSign={(comments) => guard(() => signOff(r.id, comments), 'Review completed.')} />
        </Panel>
      )}

      {r.status === 'completed' && (
        <Panel>
          <SectionHeader icon={CheckCircle2} title="Signed off" subtitle={fmtDate(r.signed_off_at)} />
          <ReadOnlyText text={r.signoff_comments} empty="No comments added at sign-off." />
        </Panel>
      )}
    </div>
  );
}

function SignOffForm({ busy, onSign }) {
  const [text, setText] = useState('');
  return (
    <>
      <textarea className="input w-full" rows={3} value={text} onChange={e => setText(e.target.value)}
        placeholder="Optional -- anything you want recorded alongside this review." />
      <div className="flex justify-end mt-3">
        <Btn variant="primary" icon={CheckCircle2} busy={busy} onClick={() => onSign(text || null)}>
          Sign off and complete
        </Btn>
      </div>
    </>
  );
}

const ReadOnlyText = ({ text, empty }) => (
  <p className="text-sm whitespace-pre-wrap m-0" style={{ color: text ? 'var(--color-text)' : 'var(--color-text-tertiary)' }}>
    {text || empty}
  </p>
);

function RatingInput({ value, max, editable, onChange }) {
  if (!editable) {
    return (
      <span className="text-sm tabular-nums" style={{ color: value != null ? 'var(--color-text)' : 'var(--color-text-tertiary)', minWidth: 42, display: 'inline-block' }}>
        {value != null ? `${fmtNumber(value, 1)}/${max}` : '--'}
      </span>
    );
  }
  return (
    <input className="input tabular-nums" type="number" step="0.5" min="0" max={max} style={{ width: 74 }}
      value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
  );
}

// The ladder, drawn. Someone opening a review mid-flow should be able to see
// where it is and who it is with without reading a status word.
function Ladder({ status }) {
  const steps = ['pending_self', 'pending_manager', 'pending_signoff', 'completed'];
  const idx = steps.indexOf(status);
  const labels = ['Self-assessment', 'Manager review', 'Sign-off', 'Complete'];
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {steps.map((s, i) => {
        const done = idx > i || status === 'completed';
        const here = idx === i && status !== 'completed';
        return (
          <div key={s} className="flex items-center gap-1">
            <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
              style={{
                background: here ? 'var(--color-primary-600)' : done ? 'color-mix(in srgb, var(--color-success-600) 14%, transparent)' : 'var(--color-surface)',
                color: here ? '#fff' : done ? 'var(--color-success-600)' : 'var(--color-text-tertiary)',
                border: '1px solid ' + (here ? 'transparent' : 'var(--color-border)'),
              }}>
              {labels[i]}
            </span>
            {i < steps.length - 1 && <span style={{ color: 'var(--color-text-tertiary)' }}>-</span>}
          </div>
        );
      })}
    </div>
  );
}
