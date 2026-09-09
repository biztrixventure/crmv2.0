import { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import {
  BarChart3, Send, DollarSign, CheckCircle2, Percent, TrendingUp,
  AlertTriangle, XCircle, Clock, User, RotateCcw, Users, ShieldCheck,
  ArrowRight, Table2, ListFilter,
} from 'lucide-react';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import DateRangePicker, { getPresetRange } from '../UI/DateRangePicker';
import { pct1 } from '../../utils/recordFormat';
import { Panel, SectionHeader, KpiTile, PillTabs, TableScroll, Loading, EmptyState, Field, accent } from '../UI/kit';

// Only one chart left, so it stays lazy — chart.js is ~186KB and a manager who
// never scrolls this far should not pay for it.
const OutcomeChart = lazy(() => import('./PerfCharts').then(m => ({ default: m.OutcomeChart })));

// ============================================================================
// CompanyPerformance — the ONE performance surface for a company admin.
//
//   pick a window  →  company numbers  →  teams  →  best people  →  everyone
//
// Everything below the toolbar re-reads from that single selection, so there is
// never a panel on screen answering for a different range than its neighbour.
//
// WHAT CHANGED AND WHY
//
// The Daily Activity chart is gone. It drew a 120-bucket line for a shape the
// KPI tiles and the funnel already state as numbers, and it cost a per-day
// series for the company AND for a focused agent on every date change. The
// endpoint no longer computes either. (/stats/team-trends still serves a daily
// series for anything that genuinely wants one.)
//
// The date controls are now the shared DateRangePicker instead of a hand-rolled
// preset row plus two date inputs. It carries the same presets AND a two-click
// calendar range, so it strictly supersedes what was here, and it is the same
// control the Overview's two stat sections use — one date affordance in the
// shell, not three.
//
// QA scores now sit beside the funnel. They come from qa_reviews, averaged per
// agent over the window. An agent with no review reads "—", never 0: a manager
// has to be able to tell "scored badly" from "never reviewed", and on the
// largest company only 23 of 43 active agents have a review in a typical month.
//
// The agent table lost its Monthly column and, by default, everything except
// the five metrics a manager acts on. "All agents stats" widens the SAME table
// to the full column set rather than opening a second one — two tables of the
// same people at different detail levels is the duplication this pass exists
// to remove.
//
// Theming: kit accent() and CSS vars only. No hex literals, and no Tailwind
// class built from a template string.
// ============================================================================

const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
const num = (v) => Number(v || 0).toLocaleString();

// QA tone is a DISPLAY heuristic only — each scorecard carries its own
// pass_threshold, so the colour must never be read as the verdict. The
// passed/reviews count travels with every score so the scorecard's own answer
// is the one on screen.
const qaTone = (score) => (score >= 80 ? 'success' : score >= 60 ? 'warn' : 'danger');

// ── Funnel. Horizontal so the labels stay readable at 390 and the drop between
//    stages is the visual, not a decoration. ───────────────────────────────────
function Funnel({ t, s, a }) {
  const rows = [
    { label: 'Transfers', value: t, tone: 'info',    from: null },
    { label: 'Sales',     value: s, tone: 'primary', from: t },
    { label: 'Approved',  value: a, tone: 'success', from: s },
  ];
  const max = Math.max(1, t);
  return (
    <div className="space-y-3">
      {rows.map(r => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between mb-1 gap-2">
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
              {r.label}
            </span>
            <span className="flex items-baseline gap-2 whitespace-nowrap">
              <span className="text-base font-black tabular-nums" style={{ color: accent(r.tone).fg }}>{num(r.value)}</span>
              {r.from !== null && (
                <span className="text-[11px] leading-none font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
                  {r.from > 0 ? `${Math.round((r.value / r.from) * 1000) / 10}%` : '—'}
                </span>
              )}
            </span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <div className="h-full rounded-full"
              style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}%`, backgroundColor: accent(r.tone).fg }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// A rate rendered against the best in the set, so a column of percentages reads
// as a ranking without having to compare digits.
function RateBar({ value, best, tone }) {
  if (value === null || value === undefined) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
  const w = best > 0 ? Math.max(4, Math.round((value / best) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 min-w-[92px]">
      {/* One decimal: a column of 7.9 / 7.2 / 3.5 / 3 / 2.5 reads ragged, and
          the whole number looks like a different unit. w-11 fits the extra digit. */}
      <span className="text-xs font-bold tabular-nums w-11 text-right" style={{ color: accent(tone).fg }}>{pct1(value)}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
        <div className="h-full rounded-full" style={{ width: `${w}%`, backgroundColor: accent(tone).fg }} />
      </div>
    </div>
  );
}

// QA cell / chip. Carries the sample size because an 80% from one review and an
// 80% from twelve are not the same claim.
function QaScore({ qa, showSample = true }) {
  if (!qa) {
    return <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }} title="No QA review in this range">—</span>;
  }
  const a = accent(qaTone(qa.score));
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-xs font-bold tabular-nums px-1.5 py-0.5 rounded-md"
        style={{ color: a.fg, background: a.soft }}>{qa.score}%</span>
      {showSample && (
        <span className="text-[11px] tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>
          {qa.passed}/{qa.reviews}
        </span>
      )}
    </span>
  );
}

export default function CompanyPerformance({ initialFrom, initialTo }) {
  // One range object in the shape DateRangePicker speaks, so the control and
  // the request never need translating between two vocabularies.
  const [range, setRange] = useState(() => (initialFrom && initialTo
    ? { date_from: initialFrom, date_to: initialTo }
    : getPresetRange('month')));
  const [agentId, setAgentId] = useState('');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState('');

  // Top-N ranking: which metric, and how many. Both are explicit controls
  // because "top agent" means different things to a manager chasing volume and
  // one chasing quality — guessing one would be wrong half the time.
  const [topBy, setTopBy] = useState('approved');
  const [topN, setTopN]   = useState(5);
  // The "All agents stats" link widens the roster table's columns instead of
  // opening a second table of the same people.
  const [wideTable, setWideTable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const params = { date_from: range.date_from, date_to: range.date_to };
      if (agentId) params.user_id = agentId;
      const r = await client.get('stats/agent-performance', { params });
      setData(r.data);
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not load performance.');
    } finally { setLoading(false); }
  }, [range.date_from, range.date_to, agentId]);

  useEffect(() => { load(); }, [load]);

  const side      = data?.side || 'fronter';
  const isFronter = side === 'fronter';
  const agents    = data?.agents || [];
  const teams     = data?.teams || [];
  const focus     = data?.focus || null;
  // With one agent selected every number on screen is theirs, so the page never
  // mixes "this person" and "the company" in the same glance.
  const view      = focus || data?.totals || null;
  const roleWord  = isFronter ? 'fronter' : 'closer';

  const bestConv = useMemo(() => Math.max(0, ...agents.map(a => a.conversion ?? 0)), [agents]);
  const bestAppr = useMemo(() => Math.max(0, ...agents.map(a => a.approval ?? 0)), [agents]);

  // Does anyone in this window have a QA score? Drives whether QA columns and
  // the QA ranking option appear at all — a column of dashes on a company that
  // has never used the QA module is furniture, not information.
  const hasQa = useMemo(() => agents.some(a => a.qa), [agents]);

  const topAgents = useMemo(() => {
    const ranked = [...agents];
    if (topBy === 'qa') {
      // Unreviewed agents sink rather than sorting as 0 — they are not the
      // worst performers, they are unmeasured.
      ranked.sort((x, y) => (y.qa?.score ?? -1) - (x.qa?.score ?? -1) || (y.approved - x.approved));
    } else if (topBy === 'volume') {
      ranked.sort((x, y) => (isFronter ? y.transfers - x.transfers : y.sales - x.sales) || (y.approved - x.approved));
    } else {
      ranked.sort((x, y) => (y.approved - x.approved) || ((y.conversion ?? 0) - (x.conversion ?? 0)));
    }
    return ranked.slice(0, topN);
  }, [agents, topBy, topN, isFronter]);

  const topMetric = (a) => {
    if (topBy === 'qa')     return { value: a.qa ? `${a.qa.score}%` : '—', label: 'QA' };
    if (topBy === 'volume') return { value: num(isFronter ? a.transfers : a.sales), label: isFronter ? 'transfers' : 'sales' };
    return { value: num(a.approved), label: 'approved' };
  };
  const topBest = useMemo(() => {
    if (!topAgents.length) return 0;
    if (topBy === 'qa')     return Math.max(0, ...topAgents.map(a => a.qa?.score ?? 0));
    if (topBy === 'volume') return Math.max(0, ...topAgents.map(a => (isFronter ? a.transfers : a.sales)));
    return Math.max(0, ...topAgents.map(a => a.approved));
  }, [topAgents, topBy, isFronter]);
  const topBarWidth = (a) => {
    const v = topBy === 'qa' ? (a.qa?.score ?? 0) : topBy === 'volume' ? (isFronter ? a.transfers : a.sales) : a.approved;
    return topBest > 0 ? Math.max(v > 0 ? 3 : 0, Math.round((v / topBest) * 100)) : 0;
  };

  return (
    <Panel pad="lg">
      <SectionHeader
        level="section"
        icon={BarChart3}
        title={focus ? focus.name : 'Company Performance'}
        subtitle={focus
          ? `One ${roleWord}'s numbers for the selected range`
          : `Every ${roleWord}, what they sent, and what it turned into`}
        actions={focus ? (
          <button onClick={() => setAgentId('')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)' }}>
            <RotateCcw size={13} /> Back to company
          </button>
        ) : null}
      />

      {/* ── Toolbar: window + who. The shared DateRangePicker replaces the old
             preset row + two date inputs; it portals its popover, so this
             panel's overflow cannot clip it. ─────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <Field label="Date range" as="div">
          <DateRangePicker defaultPreset="month" value={range} onChange={setRange} />
        </Field>
        <Field label={isFronter ? 'Fronter' : 'Closer'} as="div" className="min-w-[11rem] flex-1">
          <ThemedSelect value={agentId} onChange={e => setAgentId(e.target.value)} className="input text-xs">
            <option value="">All {roleWord}s ({agents.length})</option>
            {agents.map(a => (
              <option key={a.user_id} value={a.user_id}>
                {a.name} — {isFronter ? `${a.transfers} transfers` : `${a.sales} sales`}
              </option>
            ))}
          </ThemedSelect>
        </Field>
      </div>

      {loading ? <Loading variant="cards" cards={4} />
        : err ? <EmptyState compact icon={AlertTriangle} title="Couldn't load performance" hint={err} />
        : !view ? <EmptyState icon={BarChart3} title="No activity in this range" hint="Try a wider window." />
        : (
          <div className="space-y-5">
            {/* ── The numbers. Sale states and transfer volume in one strip, so
                   the whole company reads at a glance. The revenue tile stays
                   removed at the operator's request; the endpoint still
                   returns it. ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
              <KpiTile icon={Send}         tone="info"    label="Transfers"       value={num(view.transfers)} />
              <KpiTile icon={DollarSign}   tone="primary" label="Sales"           value={num(view.sales)} />
              <KpiTile icon={CheckCircle2} tone="success" label="Approved"        value={num(view.approved)} />
              <KpiTile icon={Clock}        tone="warn"    label="Awaiting review" value={num(view.pending)} />
              <KpiTile icon={XCircle}      tone="danger"  label="Cancelled"       value={num(view.cancelled)} />
              <KpiTile icon={Percent}      tone="warn"    label="Conversion"      value={pct(view.conversion)}
                sub={`${num(view.sales)} of ${num(view.transfers)}`} />
              <KpiTile icon={TrendingUp}   tone="success" label="Approval"        value={pct(view.approval)}
                sub={`${num(view.approved)} of ${num(view.sales)}`} />
            </div>

            {/* Roster + QA context. For one agent this row is their own QA;
                for the company it is coverage, teams and the attribution gap. */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {focus ? (
                <KpiTile icon={ShieldCheck} tone={focus.qa ? qaTone(focus.qa.score) : 'muted'}
                  label="QA score" value={focus.qa ? `${focus.qa.score}%` : '—'}
                  sub={focus.qa ? `${focus.qa.passed} passed of ${focus.qa.reviews}` : 'no review in range'} />
              ) : (
                <>
                  <KpiTile icon={User} tone="muted" label={`${roleWord}s active`} value={num(data?.totals?.agents)} />
                  <KpiTile icon={ShieldCheck}
                    tone={data?.totals?.qa_score != null ? qaTone(data.totals.qa_score) : 'muted'}
                    label="QA score" value={data?.totals?.qa_score != null ? `${data.totals.qa_score}%` : '—'}
                    // Says how much of the roster the score speaks for. Without
                    // it, 65% over 23 of 43 agents reads as the whole company.
                    sub={data?.totals?.qa_reviews
                      ? `${num(data.totals.qa_reviews)} reviews · ${data.totals.qa_reviewed_agents} of ${data.totals.agents} agents`
                      : 'no reviews in range'} />
                  <KpiTile icon={Users} tone="muted" label="Teams" value={num(teams.length)}
                    sub={teams.length ? 'with activity in range' : 'none configured'} />
                  <KpiTile icon={ArrowRight} tone="muted" label="Unattributed"
                    value={num((data?.totals?.unattributed_sales || 0) + (data?.totals?.unattributed_transfers || 0))}
                    sub="no agent credited" />
                </>
              )}
            </div>

            {/* ── Team stats. Rendered only when the company actually has teams
                   with activity. The rollup comes from the same per-agent rows
                   as the roster below, so a team total can never disagree with
                   the agents inside it. ───────────────────────────────────── */}
            {!focus && teams.length > 0 && (
              <Panel tone="inset" radius="xl" pad="md">
                <SectionHeader level="sub" icon={Users} title="Team stats" />
                <TableScroll stickyFirst label="Team performance">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                        {['Team', 'Agents', 'Transfers', 'Approved', 'Cancelled', 'Conversion', ...(hasQa ? ['QA'] : [])].map(h => (
                          <th key={h} className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
                            style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {teams.map(t => (
                        <tr key={t.team_id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td className="py-2.5 px-3 font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{t.name}</td>
                          <td className="py-2.5 px-3 tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{num(t.agents)}</td>
                          <td className="py-2.5 px-3 font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{num(t.transfers)}</td>
                          <td className="py-2.5 px-3 tabular-nums font-semibold" style={{ color: accent('success').fg }}>{num(t.approved)}</td>
                          <td className="py-2.5 px-3 tabular-nums" style={{ color: accent('danger').fg }}>{num(t.cancelled)}</td>
                          <td className="py-2.5 px-3"><RateBar value={t.conversion} best={bestConv} tone="primary" /></td>
                          {hasQa && (
                            <td className="py-2.5 px-3">
                              {t.qa_score != null
                                ? <span className="text-xs font-bold tabular-nums px-1.5 py-0.5 rounded-md"
                                    style={{ color: accent(qaTone(t.qa_score)).fg, background: accent(qaTone(t.qa_score)).soft }}
                                    title={`${t.qa_reviewed} of ${t.agents} agents reviewed`}>{t.qa_score}%</span>
                                : <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              </Panel>
            )}

            {/* ── Top performers. Sits in the main section so the best people
                   are never something a manager has to hunt for. Ranked by an
                   explicit metric — "top" means volume to one manager and QA to
                   another. ────────────────────────────────────────────────── */}
            {!focus && agents.length > 0 && (
              <Panel tone="inset" radius="xl" pad="md">
                <SectionHeader
                  level="sub"
                  icon={TrendingUp}
                  title={`Top ${Math.min(topN, agents.length)} ${roleWord}s`}
                  actions={
                    <div className="flex items-center gap-2 flex-wrap">
                      <PillTabs
                        items={[
                          { key: 'approved', label: 'Approved' },
                          { key: 'volume',   label: isFronter ? 'Transfers' : 'Sales' },
                          ...(hasQa ? [{ key: 'qa', label: 'QA' }] : []),
                        ]}
                        value={topBy}
                        onChange={setTopBy}
                      />
                      <PillTabs
                        items={[{ key: 5, label: 'Top 5' }, { key: 10, label: 'Top 10' }]}
                        value={topN}
                        onChange={setTopN}
                      />
                    </div>
                  }
                />
                <div className="space-y-1.5">
                  {topAgents.map((a, i) => {
                    const m = topMetric(a);
                    return (
                      <button key={a.user_id} type="button" onClick={() => setAgentId(a.user_id)}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors hover:bg-bg-secondary">
                        <span className="w-5 text-xs font-black tabular-nums flex-shrink-0 text-right"
                          style={{ color: i < 3 ? accent('primary').fg : 'var(--color-text-tertiary)' }}>{i + 1}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{a.name}</span>
                          {/* The bar is relative to the leader, so first place is
                              always full width and the gap behind it is the
                              information. */}
                          <span className="block mt-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                            <span className="block h-full rounded-full"
                              style={{ width: `${topBarWidth(a)}%`, backgroundColor: accent(topBy === 'qa' ? 'info' : 'primary').fg }} />
                          </span>
                        </span>
                        <span className="flex items-center gap-3 flex-shrink-0">
                          {hasQa && topBy !== 'qa' && <QaScore qa={a.qa} showSample={false} />}
                          <span className="text-right">
                            <span className="block text-sm font-black tabular-nums leading-none" style={{ color: 'var(--color-text)' }}>{m.value}</span>
                            <span className="block text-[11px] mt-0.5 leading-none" style={{ color: 'var(--color-text-tertiary)' }}>{m.label}</span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Panel>
            )}

            {/* ── The shape. Funnel is pure CSS; the outcome doughnut is the one
                   remaining chart. ─────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Panel tone="inset" radius="xl" pad="md">
                <p className="m-0 mb-3 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>
                  Funnel
                </p>
                <Funnel t={view.transfers} s={view.sales} a={view.approved} />
              </Panel>
              <Panel tone="inset" radius="xl" pad="md">
                <p className="m-0 mb-3 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>
                  Sale outcomes
                </p>
                <Suspense fallback={<Loading variant="block" height={224} />}>
                  <OutcomeChart approved={view.approved} pending={view.pending} cancelled={view.cancelled} />
                </Suspense>
              </Panel>
            </div>

            {/* ── The roster. Five metrics by default — the ones a manager acts
                   on. "All agents stats" widens THIS table rather than opening
                   a second one of the same people. Hidden while one agent is in
                   focus: a table of one row is noise. ────────────────────── */}
            {!focus && (
              agents.length ? (
                <div>
                  <SectionHeader
                    level="sub"
                    icon={Users}
                    title={`All ${roleWord}s · tap a row for that person only`}
                    actions={
                      <button type="button" onClick={() => setWideTable(v => !v)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors"
                        style={{
                          borderColor: wideTable ? accent('primary').fg : 'var(--color-border)',
                          color:       wideTable ? accent('primary').fg : 'var(--color-text-secondary)',
                          background:  wideTable ? accent('primary').soft : 'transparent',
                        }}>
                        {wideTable
                          ? <><ListFilter size={12} /> Key metrics only</>
                          : <><Table2 size={12} /> All agents stats</>}
                      </button>
                    }
                  />
                  <TableScroll stickyFirst label="Agent performance">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                          {[
                            '#', 'Agent',
                            ...(wideTable && hasQa ? ['QA'] : []),
                            'Transfers',
                            ...(wideTable ? ['Sales'] : []),
                            'Approved',
                            ...(wideTable ? ['Awaiting review'] : []),
                            'Cancelled', 'Conversion',
                            ...(wideTable ? ['Approval'] : []),
                          ].map(h => (
                            <th key={h} className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
                              style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {agents.map((a, i) => (
                          <tr key={a.user_id} onClick={() => setAgentId(a.user_id)}
                            className="cursor-pointer transition-colors hover:bg-bg-secondary"
                            style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <td className="py-2.5 px-3 text-xs font-bold tabular-nums"
                              style={{ color: i < 3 ? accent('primary').fg : 'var(--color-text-tertiary)' }}>{i + 1}</td>
                            <td className="py-2.5 px-3 font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{a.name}</td>
                            {wideTable && hasQa && <td className="py-2.5 px-3"><QaScore qa={a.qa} /></td>}
                            <td className="py-2.5 px-3 font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{num(a.transfers)}</td>
                            {wideTable && (
                              <td className="py-2.5 px-3 tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{num(a.sales)}</td>
                            )}
                            <td className="py-2.5 px-3 tabular-nums font-semibold" style={{ color: accent('success').fg }}>{num(a.approved)}</td>
                            {wideTable && (
                              <td className="py-2.5 px-3 tabular-nums" style={{ color: accent('warn').fg }}>{num(a.pending)}</td>
                            )}
                            <td className="py-2.5 px-3 tabular-nums" style={{ color: accent('danger').fg }}>{num(a.cancelled)}</td>
                            <td className="py-2.5 px-3"><RateBar value={a.conversion} best={bestConv} tone="primary" /></td>
                            {wideTable && (
                              <td className="py-2.5 px-3"><RateBar value={a.approval} best={bestAppr} tone="success" /></td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableScroll>
                </div>
              ) : <EmptyState icon={User} title={`No ${roleWord} activity in this range`} hint="Try a wider window." />
            )}
          </div>
        )}
    </Panel>
  );
}
