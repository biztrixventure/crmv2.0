import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  BarChart3, Send, DollarSign, CheckCircle2, Percent, TrendingUp,
  AlertTriangle, XCircle, Clock, ArrowRight, User, RotateCcw,
} from 'lucide-react';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import ThemedDate from '../UI/ThemedDate';
import { Panel, SectionHeader, KpiTile, TableScroll, Loading, EmptyState, Field } from '../UI/kit';

// ============================================================================
// CompanyPerformance — the ONE performance surface for a company admin.
//
// This replaces five stacked panels (KPI trio cards, Team Performance, Funnel,
// Agent table, and two leaderboards) that each answered an overlapping slice of
// the same question and disagreed with each other at the edges. One request,
// one date range, one agent selector, one story:
//
//   pick a window  →  pick everyone or one person  →  numbers, shape, ranking
//
// Everything below the toolbar re-reads from that single selection, so there is
// never a panel on screen answering for a different range than its neighbour.
// ============================================================================

const pct   = (v) => (v === null || v === undefined ? '—' : `${v}%`);
const money = (v) => `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const num   = (v) => Number(v || 0).toLocaleString();
const iso   = (d) => d.toISOString().slice(0, 10);

const PRESETS = [
  { key: '7d',    label: '7 days',  days: 7 },
  { key: '30d',   label: '30 days', days: 30 },
  { key: '90d',   label: '90 days', days: 90 },
  { key: 'month', label: 'This month' },
];

function presetRange(key) {
  const today = iso(new Date());
  if (key === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  const p = PRESETS.find(x => x.key === key);
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - ((p?.days || 30) - 1));
  return { from: iso(d), to: today };
}

// ── Grouped daily bars. Pure CSS so it stays sharp at any width and needs no
//    chart dependency. Bars are the shape of the business; the numbers above
//    are the size of it. ───────────────────────────────────────────────────────
function DailyChart({ daily }) {
  const max  = Math.max(1, ...daily.map(d => d.transfers));
  const maxS = Math.max(1, ...daily.map(d => d.sales));
  // Sales are one to two orders of magnitude smaller than transfers; on one
  // shared scale they flatten to nothing and tell you nothing. Each series is
  // scaled to its own peak, which is why the legend says so out loud.
  const step = Math.max(1, Math.ceil(daily.length / 12));
  return (
    <div>
      <div className="flex items-end gap-[3px] h-36 sm:h-44">
        {daily.map(d => (
          <div key={d.date} className="flex-1 min-w-[6px] h-full flex items-end justify-center gap-[2px]"
            title={`${d.date} — ${d.transfers} transfers · ${d.sales} sales · ${d.approved} approved`}>
            <div className="w-1/2 rounded-t"
              style={{ height: `${(d.transfers / max) * 100}%`, minHeight: d.transfers ? 2 : 0,
                backgroundColor: 'var(--color-info-600)' }} />
            <div className="w-1/2 rounded-t"
              style={{ height: `${(d.sales / maxS) * 100}%`, minHeight: d.sales ? 2 : 0,
                backgroundColor: 'var(--color-success-600)' }} />
          </div>
        ))}
      </div>
      <div className="flex gap-[3px] mt-1.5">
        {daily.map((d, i) => (
          <div key={d.date} className="flex-1 min-w-[6px] text-center text-[11px] leading-none whitespace-nowrap overflow-hidden"
            style={{ color: 'var(--color-text-tertiary)' }}>
            {i % step === 0 ? d.date.slice(5) : ''}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] leading-none" style={{ color: 'var(--color-text-tertiary)' }}>
        <span className="inline-flex items-center gap-1.5">
          <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: 'var(--color-info-600)' }} /> Transfers
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: 'var(--color-success-600)' }} /> Sales
        </span>
        <span>each series scaled to its own peak</span>
      </div>
    </div>
  );
}

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
              <span className="text-base font-black tabular-nums" style={{ color: `var(--color-${r.tone}-600)` }}>{num(r.value)}</span>
              {r.from !== null && (
                <span className="text-[11px] leading-none font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
                  {r.from > 0 ? `${Math.round((r.value / r.from) * 1000) / 10}%` : '—'}
                </span>
              )}
            </span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <div className="h-full rounded-full"
              style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}%`, backgroundColor: `var(--color-${r.tone}-600)` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function RateBar({ value, best, tone }) {
  if (value === null || value === undefined) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
  const w = best > 0 ? Math.max(4, Math.round((value / best) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 min-w-[92px]">
      <span className="text-xs font-bold tabular-nums w-10 text-right" style={{ color: `var(--color-${tone}-600)` }}>{value}%</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
        <div className="h-full rounded-full" style={{ width: `${w}%`, backgroundColor: `var(--color-${tone}-600)` }} />
      </div>
    </div>
  );
}

export default function CompanyPerformance({ initialFrom, initialTo }) {
  const [preset, setPreset]   = useState(initialFrom && initialTo ? '' : '30d');
  const [range, setRange]     = useState(() => (initialFrom && initialTo ? { from: initialFrom, to: initialTo } : presetRange('30d')));
  const [agentId, setAgentId] = useState('');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const params = { date_from: range.from, date_to: range.to };
      if (agentId) params.user_id = agentId;
      const r = await client.get('stats/agent-performance', { params });
      setData(r.data);
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not load performance.');
    } finally { setLoading(false); }
  }, [range.from, range.to, agentId]);

  useEffect(() => { load(); }, [load]);

  const applyPreset = (key) => { setPreset(key); setRange(presetRange(key)); };
  const setDate = (which, v) => { setPreset(''); setRange(r => ({ ...r, [which]: v })); };

  const side      = data?.side || 'fronter';
  const isFronter = side === 'fronter';
  const agents    = data?.agents || [];
  const focus     = data?.focus || null;
  // With one agent selected every number on screen is theirs, so the page never
  // mixes "this person" and "the company" in the same glance.
  const view      = focus || data?.totals || null;
  const daily     = focus?.daily || data?.daily || [];
  const roleWord  = isFronter ? 'fronter' : 'closer';

  const bestConv = useMemo(() => Math.max(0, ...agents.map(a => a.conversion ?? 0)), [agents]);
  const bestAppr = useMemo(() => Math.max(0, ...agents.map(a => a.approval ?? 0)), [agents]);

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

      {/* ── Toolbar: window + who. Wraps onto its own rows at 390 rather than
             squeezing every control into an unusable width. ───────────────── */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div className="flex flex-wrap gap-1 p-1 rounded-full"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => applyPreset(p.key)}
              className="px-3 py-1.5 rounded-full text-xs font-bold transition-colors whitespace-nowrap"
              style={{
                backgroundColor: preset === p.key ? 'var(--color-surface)' : 'transparent',
                color: preset === p.key ? 'var(--color-text)' : 'var(--color-text-secondary)',
                boxShadow: preset === p.key ? 'var(--shadow-sm)' : 'none',
              }}>
              {p.label}
            </button>
          ))}
        </div>
        <Field label="From" as="div" className="w-[9.5rem]">
          <ThemedDate value={range.from} onChange={e => setDate('from', e.target.value)} className="input text-xs" />
        </Field>
        <Field label="To" as="div" className="w-[9.5rem]">
          <ThemedDate value={range.to} onChange={e => setDate('to', e.target.value)} className="input text-xs" />
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
            {/* ── The numbers ── */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              <KpiTile icon={Send}         tone="info"    label="Transfers"  value={num(view.transfers)} />
              <KpiTile icon={DollarSign}   tone="primary" label="Sales"      value={num(view.sales)} />
              <KpiTile icon={CheckCircle2} tone="success" label="Approved"   value={num(view.approved)} />
              <KpiTile icon={Percent}      tone="warn"    label="Conversion" value={pct(view.conversion)}
                sub={`${num(view.sales)} of ${num(view.transfers)}`} />
              <KpiTile icon={TrendingUp}   tone="success" label="Approval"   value={pct(view.approval)}
                sub={`${num(view.approved)} of ${num(view.sales)}`} />
              <KpiTile icon={DollarSign}   tone="primary" label="Monthly"    value={money(view.revenue)}
                sub="approved policies" />
            </div>

            {/* Secondary states — real, but not headline. */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiTile icon={Clock}   tone="warn"   label="In review" value={num(view.pending)} />
              <KpiTile icon={XCircle} tone="danger" label="Cancelled" value={num(view.cancelled)} />
              {!focus && (
                <>
                  <KpiTile icon={User}       tone="muted" label={`${roleWord}s active`} value={num(data?.totals?.agents)} />
                  <KpiTile icon={ArrowRight} tone="muted" label="Unattributed"
                    value={num((data?.totals?.unattributed_sales || 0) + (data?.totals?.unattributed_transfers || 0))}
                    sub="no agent credited" />
                </>
              )}
            </div>

            {/* ── The shape: trend beside funnel, stacked on a phone. ── */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
              <Panel tone="inset" radius="xl" pad="md" className="xl:col-span-2">
                <p className="m-0 mb-3 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>
                  Daily activity
                </p>
                {daily.length ? <DailyChart daily={daily} />
                  : <EmptyState compact icon={BarChart3} title="No daily data" />}
              </Panel>
              <Panel tone="inset" radius="xl" pad="md">
                <p className="m-0 mb-3 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>
                  Funnel
                </p>
                <Funnel t={view.transfers} s={view.sales} a={view.approved} />
              </Panel>
            </div>

            {/* ── The ranking. Hidden while one agent is in focus: a table of one
                   row is noise, and the selector already says who. ── */}
            {!focus && (
              agents.length ? (
                <div>
                  <p className="m-0 mb-2 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>
                    {isFronter ? 'Fronters' : 'Closers'} · tap a row for that person only
                  </p>
                  <TableScroll stickyFirst label="Agent performance">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                          {['#', 'Agent', isFronter ? 'Transfers' : 'Sales', isFronter ? 'Sales' : 'Transfers',
                            'Approved', 'Conversion', 'Approval', 'Monthly'].map(h => (
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
                              style={{ color: i < 3 ? 'var(--color-primary-600)' : 'var(--color-text-tertiary)' }}>{i + 1}</td>
                            <td className="py-2.5 px-3 font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{a.name}</td>
                            <td className="py-2.5 px-3 font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>
                              {num(isFronter ? a.transfers : a.sales)}
                            </td>
                            <td className="py-2.5 px-3 tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
                              {num(isFronter ? a.sales : a.transfers)}
                            </td>
                            <td className="py-2.5 px-3 tabular-nums font-semibold" style={{ color: 'var(--color-success-600)' }}>{num(a.approved)}</td>
                            <td className="py-2.5 px-3"><RateBar value={a.conversion} best={bestConv} tone="primary" /></td>
                            <td className="py-2.5 px-3"><RateBar value={a.approval}  best={bestAppr} tone="success" /></td>
                            <td className="py-2.5 px-3 tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{money(a.revenue)}</td>
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
