// ============================================================================
// ScenariosPanel -- read the situation, pick the disposition.
//
// The answer key never reaches the browser with the question. GET /scenarios
// strips `is_correct` for anyone who cannot manage the material, and the verdict
// comes back from POST /scenarios/:id/answer after a pick. Shipping the flags
// with the list would put the answers one devtools panel away, which is the
// oldest way to make a training exercise worthless.
//
// NOT EVERY SCENARIO IS A TEST. A manager who marks no option correct has
// written a discussion piece -- several dispositions are defensible and the
// point is the guidance note. The API says so with `graded:false` and the card
// then shows the note instead of a right/wrong verdict, rather than calling a
// reasonable answer wrong.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import {
  MessageSquareWarning, CheckCircle2, XCircle, Lightbulb, RotateCcw, Search, Info,
} from 'lucide-react';
import client from '../../api/client';
import { EmptyState, Loading, PillTabs, accent } from '../UI/kit';

function ScenarioCard({ scenario, finished, onAnswered }) {
  const [picked, setPicked] = useState(null);
  const [verdict, setVerdict] = useState(null);
  const [busy, setBusy] = useState(false);

  const pick = async (optionId) => {
    if (busy || picked) return;
    setBusy(true);
    setPicked(optionId);
    try {
      const r = await client.post(`training/scenarios/${scenario.id}/answer`, { option_id: optionId });
      setVerdict(r.data);
      // An ungraded scenario counts as done once it has been worked through --
      // there is no "right" to wait for.
      onAnswered?.(scenario.id, r.data.graded ? r.data.correct : true);
    } catch {
      // Never leave the card stuck mid-answer on a network blip: hand the pick
      // back so they can try again.
      setPicked(null);
      setVerdict(null);
    } finally { setBusy(false); }
  };

  const reset = () => { setPicked(null); setVerdict(null); };

  const a = accent('warn');

  return (
    <div className="rounded-2xl p-5"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: a.soft }}>
          <MessageSquareWarning size={17} style={{ color: a.fg }} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold m-0" style={{ color: 'var(--color-text)' }}>{scenario.title}</p>
            {scenario.category && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ background: a.soft, color: a.fg }}>{scenario.category}</span>
            )}
            {finished && <CheckCircle2 size={15} style={{ color: 'var(--color-success-600)' }} />}
          </div>
          <p className="text-sm m-0 mt-2 whitespace-pre-wrap leading-relaxed"
            style={{ color: 'var(--color-text-secondary)' }}>
            {scenario.situation}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wider m-0"
          style={{ color: 'var(--color-text-secondary)' }}>
          What do you mark it as?
        </p>
        {(scenario.options || []).map(o => {
          const isPicked  = picked === o.id;
          const isCorrect = verdict?.graded && verdict.correct_option_ids?.includes(o.id);
          const isWrong   = isPicked && verdict?.graded && !verdict.correct;

          let border = 'var(--color-border)';
          let bg = 'transparent';
          if (isCorrect) { border = 'var(--color-success-600)'; bg = 'color-mix(in srgb, var(--color-success-600) 10%, transparent)'; }
          else if (isWrong) { border = 'var(--color-error-600)'; bg = 'color-mix(in srgb, var(--color-error-600) 10%, transparent)'; }
          else if (isPicked) { border = 'var(--color-primary-400, #818cf8)'; bg = 'color-mix(in srgb, var(--color-primary-600) 8%, transparent)'; }

          return (
            <button key={o.id} onClick={() => pick(o.id)} disabled={!!picked || busy}
              className="w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-2.5 transition-colors disabled:cursor-default"
              style={{ border: `1px solid ${border}`, background: bg }}>
              <span className="flex-1 min-w-0">
                <span className="text-sm font-semibold block" style={{ color: 'var(--color-text)' }}>{o.label}</span>
                {o.disposition && (
                  <span className="text-[11px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>
                    {o.disposition}
                  </span>
                )}
              </span>
              {isCorrect && <CheckCircle2 size={16} style={{ color: 'var(--color-success-600)' }} />}
              {isWrong   && <XCircle size={16} style={{ color: 'var(--color-error-600)' }} />}
            </button>
          );
        })}
        {(scenario.options || []).length === 0 && (
          <p className="text-xs m-0" style={{ color: 'var(--color-text-tertiary)' }}>
            No dispositions have been set for this one yet.
          </p>
        )}
      </div>

      {verdict && (
        <div className="mt-3 rounded-xl p-3 flex items-start gap-2.5"
          style={{
            background: verdict.graded
              ? `color-mix(in srgb, var(--color-${verdict.correct ? 'success' : 'error'}-600) 8%, transparent)`
              : 'var(--color-bg-secondary)',
            border: `1px solid ${verdict.graded
              ? `color-mix(in srgb, var(--color-${verdict.correct ? 'success' : 'error'}-600) 30%, transparent)`
              : 'var(--color-border)'}`,
          }}>
          {verdict.graded
            ? (verdict.correct
              ? <CheckCircle2 size={15} style={{ color: 'var(--color-success-600)' }} className="flex-shrink-0 mt-0.5" />
              : <XCircle size={15} style={{ color: 'var(--color-error-600)' }} className="flex-shrink-0 mt-0.5" />)
            : <Info size={15} style={{ color: 'var(--color-text-secondary)' }} className="flex-shrink-0 mt-0.5" />}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold m-0" style={{ color: 'var(--color-text)' }}>
              {verdict.graded
                ? (verdict.correct ? 'That is the right call.' : 'Not quite — the right one is highlighted.')
                : 'More than one answer works here.'}
            </p>
            {verdict.feedback && (
              <p className="text-xs m-0 mt-1" style={{ color: 'var(--color-text-secondary)' }}>{verdict.feedback}</p>
            )}
            {scenario.guidance && (
              <p className="text-xs m-0 mt-1.5 flex items-start gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                <Lightbulb size={12} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning-600)' }} />
                {scenario.guidance}
              </p>
            )}
            <button onClick={reset} className="text-[11px] font-semibold mt-2 flex items-center gap-1"
              style={{ color: 'var(--color-primary-600)' }}>
              <RotateCcw size={11} /> Try it again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScenariosPanel({ companyId, done, onAnswered }) {
  const [scenarios, setScenarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    let dead = false;
    setLoading(true);
    const params = companyId ? `?company_id=${companyId}` : '';
    client.get(`training/scenarios${params}`)
      .then(r => { if (!dead) setScenarios(r.data.scenarios || []); })
      .catch(() => { if (!dead) setScenarios([]); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [companyId]);

  const categories = useMemo(() => {
    const seen = [...new Set(scenarios.map(s => s.category).filter(Boolean))];
    return seen.length > 1 ? [{ key: 'all', label: 'All' }, ...seen.map(c => ({ key: c, label: c }))] : [];
  }, [scenarios]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => scenarios.filter(s =>
    (cat === 'all' || s.category === cat)
    && (!needle || `${s.title} ${s.situation}`.toLowerCase().includes(needle))
  ), [scenarios, cat, needle]);

  if (loading) return <Loading variant="rows" rows={3} label="Loading the scenarios" />;

  return (
    <div className="space-y-4">
      {(categories.length > 0 || scenarios.length > 5) && (
        <div className="flex flex-wrap items-center gap-3">
          {categories.length > 0 && <PillTabs items={categories} value={cat} onChange={setCat} />}
          {scenarios.length > 5 && (
            <div className="relative" style={{ maxWidth: 300, flex: 1 }}>
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--color-text-tertiary)' }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search scenarios…"
                className="input text-sm py-2 pl-9 w-full" />
            </div>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState icon={MessageSquareWarning}
          title={scenarios.length ? 'Nothing matches that' : 'No scenarios yet'}
          hint={scenarios.length
            ? 'Clear the search or pick another category.'
            : 'Your manager writes practice situations under Manage → Scenarios.'} />
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))' }}>
          {shown.map(s => (
            <ScenarioCard key={s.id} scenario={s}
              finished={done?.has(`scenario:${s.id}`)} onAnswered={onAnswered} />
          ))}
        </div>
      )}
    </div>
  );
}
