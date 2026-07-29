import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Target, Users, TrendingUp, RefreshCw, AlertTriangle, CheckCircle2, Clock, Gauge,
} from 'lucide-react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import ThemedDate from '../UI/ThemedDate';
import { Panel, SectionHeader, KpiTile, TableScroll, Loading, EmptyState, accent } from '../UI/kit';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler);

// ── Quota reporting — the surface a company_admin and a superadmin run on.
//
// Scope is decided by the SERVER and reported back, never chosen here: a
// superadmin sees any company, a company_admin their own, a team lead only
// their team, a member only themselves. The page labels which scope it got, so
// nobody has to guess whether they are looking at everything.
//
// Every chart is fed from ONE payload built by the same counter that scores the
// quotas, so a bar, the tile above it and the quota panel can never disagree.
// Numbers move on their own as transfers are created and sales are approved —
// there is nothing to refresh by hand and no denormalized total to go stale.

const CSS = (v, fallback) => {
  if (typeof window === 'undefined') return fallback;
  const c = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  return c || fallback;
};

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const num   = (n) => (Number(n) || 0).toLocaleString();

// Touch reality: a native `title` tooltip never fires on a phone, so every
// chart uses index mode — one tap anywhere on a column reads out every series.
const baseOpts = (extra = {}) => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      display: true, position: 'bottom',
      labels: { boxWidth: 10, boxHeight: 10, padding: 12, font: { size: 11 }, color: CSS('--color-text-secondary', '#64748b') },
    },
    tooltip: {
      backgroundColor: CSS('--color-surface', '#fff'),
      titleColor: CSS('--color-text', '#0f172a'),
      bodyColor: CSS('--color-text-secondary', '#475569'),
      borderColor: CSS('--color-border', '#e2e8f0'),
      borderWidth: 1, padding: 10, displayColors: true, boxWidth: 8, boxHeight: 8,
    },
    ...(extra.plugins || {}),
  },
  ...extra,
});

const gridOpts = () => ({
  x: { grid: { display: false }, ticks: { font: { size: 10 }, color: CSS('--color-text-tertiary', '#94a3b8'), maxRotation: 0, autoSkipPadding: 12 } },
  y: { beginAtZero: true, grid: { color: CSS('--color-border', '#e2e8f0') }, ticks: { font: { size: 10 }, color: CSS('--color-text-tertiary', '#94a3b8'), precision: 0 } },
});

// A chart needs a fixed box or Chart.js regrows it on every resize tick on mobile.
function ChartBox({ title, sub, height = 240, children, right }) {
  return (
    <Panel className="space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="m-0 text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>{title}</p>
          {sub && <p className="m-0 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{sub}</p>}
        </div>
        {right}
      </div>
      <div style={{ height, position: 'relative' }}>{children}</div>
    </Panel>
  );
}

export default function QuotaReport({ embedded = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [preset, setPreset] = useState('month');       // month | 30 | 90 | custom
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');

  const range = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (preset === 'custom') return (cFrom && cTo) ? { from: cFrom, to: cTo } : null;
    if (preset === 'month')  return { from: `${today.slice(0, 7)}-01`, to: today };
    const days = Number(preset);
    return { from: new Date(Date.now() - days * 864e5).toISOString().slice(0, 10), to: today };
  }, [preset, cFrom, cTo]);

  const rFrom = range?.from, rTo = range?.to;
  const load = useCallback(async () => {
    if (!rFrom || !rTo) return;
    setLoading(true); setErr('');
    try {
      const { data: d } = await client.get('quotas/report', {
        params: { from: rFrom, to: rTo, ...(companyId ? { company_id: companyId } : {}) },
      });
      setData(d);
      if (!companyId && d.company_id) setCompanyId(d.company_id);
    } catch (e) {
      setErr(e.response?.data?.error || 'Failed to load the quota report');
      setData(null);
    } finally { setLoading(false); }
  }, [rFrom, rTo, companyId]);
  useEffect(() => { load(); }, [load]);

  const t = data?.totals || {};
  const teams = data?.teams || [];
  const members = data?.members || [];
  const series = data?.series || [];
  const fronter = (data?.side || 'fronter') === 'fronter';
  const salesWord = fronter ? 'Deals fronted' : 'Sales closed';

  // Flatten every team-tier quota once — most charts are about these.
  const teamQuotas = useMemo(
    () => teams.flatMap(tm => (tm.quotas || []).map(q => ({ ...q, team_name: tm.name, team_id: tm.id }))),
    [teams],
  );

  const C = {
    transfers: '#2563eb', won: '#16a34a', submitted: '#0891b2',
    cancelled: '#dc2626', muted: '#94a3b8',
  };

  // 1) Daily activity — the "updates itself" chart. Transfers created, sales
  //    written, sales APPROVED, each on the day it really happened.
  const activityChart = {
    labels: series.map(d => d.date.slice(5)),
    datasets: [
      { label: 'Transfers', data: series.map(d => d.transfers), borderColor: C.transfers, backgroundColor: `${C.transfers}22`, fill: true, tension: 0.3, pointRadius: 0, pointHitRadius: 14, borderWidth: 2, yAxisID: 'y' },
      { label: 'Sales submitted', data: series.map(d => d.sales_submitted), borderColor: C.submitted, backgroundColor: 'transparent', tension: 0.3, pointRadius: 0, pointHitRadius: 14, borderWidth: 2, yAxisID: 'y1' },
      { label: 'Sales approved', data: series.map(d => d.sales_won), borderColor: C.won, backgroundColor: `${C.won}22`, fill: true, tension: 0.3, pointRadius: 0, pointHitRadius: 14, borderWidth: 2, yAxisID: 'y1' },
    ],
  };
  const activityOpts = baseOpts({
    scales: {
      x: gridOpts().x,
      y:  { ...gridOpts().y, position: 'left',  title: { display: true, text: 'Transfers', font: { size: 10 }, color: C.transfers } },
      // Sales get their own axis: a few deals against hundreds of transfers
      // would otherwise render as a flat line pinned to zero.
      y1: { ...gridOpts().y, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Sales', font: { size: 10 }, color: C.won } },
    },
  });

  // 2) Attainment by team — % of quota with the elapsed clock beside it, so
  //    "61%" is readable as ahead or behind rather than as a bare number.
  const attainChart = {
    labels: teamQuotas.map(q => `${q.team_name} · ${q.metric_label}`),
    datasets: [
      { label: '% attained', data: teamQuotas.map(q => Math.min(150, q.pct ?? 0)), backgroundColor: teamQuotas.map(q => (q.on_track === false ? C.cancelled : C.won)), borderRadius: 4, barThickness: 14 },
      { label: '% of window elapsed', data: teamQuotas.map(q => q.elapsed_pct ?? 0), backgroundColor: C.muted, borderRadius: 4, barThickness: 6 },
    ],
  };
  const attainOpts = baseOpts({
    indexAxis: 'y',
    scales: {
      x: { beginAtZero: true, max: 150, grid: { color: CSS('--color-border', '#e2e8f0') }, ticks: { font: { size: 10 }, color: CSS('--color-text-tertiary', '#94a3b8'), callback: (v) => `${v}%` } },
      y: { grid: { display: false }, ticks: { font: { size: 10 }, color: CSS('--color-text-secondary', '#64748b') } },
    },
  });

  // 3) Allocation coverage — how much of the team target the lead has handed
  //    out. Unallocated is the lead's to-do list; over-allocation is a choice.
  const allocated = teamQuotas.reduce((n, q) => n + (q.allocated || 0), 0);
  const targetSum = teamQuotas.reduce((n, q) => n + (q.target_value || 0), 0);
  const allocChart = {
    labels: ['Allocated to members', 'Not yet allocated'],
    datasets: [{
      data: [allocated, Math.max(0, targetSum - allocated)],
      backgroundColor: [C.transfers, CSS('--color-bg-secondary', '#e2e8f0')],
      borderWidth: 0,
    }],
  };

  // 4) Where submitted sales end up, per team.
  const byTeamMembers = useMemo(() => {
    const acc = {};
    members.forEach(m => {
      const k = m.team_name || '—';
      acc[k] = acc[k] || { submitted: 0, won: 0, cancelled: 0, transfers: 0 };
      acc[k].submitted += m.sales_submitted || 0;
      acc[k].won       += m.sales_won || 0;
      acc[k].cancelled += m.sales_cancelled || 0;
      acc[k].transfers += m.transfers || 0;
    });
    return acc;
  }, [members]);
  const funnelChart = {
    labels: Object.keys(byTeamMembers),
    datasets: [
      { label: 'Approved',  data: Object.values(byTeamMembers).map(v => v.won),       backgroundColor: C.won,       borderRadius: 3, stack: 's' },
      { label: 'Pending',   data: Object.values(byTeamMembers).map(v => Math.max(0, v.submitted - v.won - v.cancelled)), backgroundColor: C.submitted, borderRadius: 3, stack: 's' },
      { label: 'Cancelled', data: Object.values(byTeamMembers).map(v => v.cancelled), backgroundColor: C.cancelled, borderRadius: 3, stack: 's' },
    ],
  };
  const funnelOpts = baseOpts({ scales: { x: { ...gridOpts().x, stacked: true }, y: { ...gridOpts().y, stacked: true } } });

  // 5) Per-member production, always drawn on the side's real column — a
  //    fronter team is ranked on leads sent, not on a closer_id it never has.
  const topMembers = useMemo(
    () => [...members].sort((a, b) => (b.transfers - a.transfers) || (b.sales_won - a.sales_won)).slice(0, 12),
    [members],
  );
  const memberChart = {
    labels: topMembers.map(m => m.name),
    datasets: [
      { label: 'Transfers', data: topMembers.map(m => m.transfers), backgroundColor: C.transfers, borderRadius: 3, yAxisID: 'y' },
      { label: 'Approved',  data: topMembers.map(m => m.sales_won), backgroundColor: C.won, borderRadius: 3, yAxisID: 'y1' },
    ],
  };
  const memberOpts = baseOpts({
    scales: {
      x: { ...gridOpts().x, ticks: { ...gridOpts().x.ticks, maxRotation: 45, minRotation: 30 } },
      y:  { ...gridOpts().y, position: 'left' },
      y1: { ...gridOpts().y, position: 'right', grid: { drawOnChartArea: false } },
    },
  });

  const behind = teamQuotas.filter(q => q.on_track === false);
  const scopeLabel = data?.scope === 'company' ? 'Whole company'
    : data?.scope === 'team' ? 'Your team only'
    : data?.scope === 'member' ? 'Your own numbers only' : '—';

  return (
    <div className="space-y-4 animate-fade-in w-full">
      <SectionHeader
        level={embedded ? 'section' : 'page'}
        icon={Gauge}
        title="Quota performance"
        subtitle={`${scopeLabel} · ${fronter ? 'fronter company — judged on leads sent and the deals they produced' : 'closer company — judged on deals closed'}${range ? ` · ${range.from} → ${range.to}` : ''}`}
        actions={
          <>
            {data?.superadmin && (data.companies || []).length > 0 && (
              <ThemedSelect value={companyId} onChange={e => setCompanyId(e.target.value)} className="input min-w-[180px]" style={{ fontSize: 12 }}>
                {(data.companies || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </ThemedSelect>
            )}
            <ThemedSelect value={preset} onChange={e => setPreset(e.target.value)} variant="pill" style={{ fontSize: 12 }}>
              <option value="month">This month</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="custom">Custom…</option>
            </ThemedSelect>
            {preset === 'custom' && (
              <>
                <ThemedDate value={cFrom} max={cTo || undefined} onChange={e => setCFrom(e.target.value)} placeholder="From" style={{ fontSize: 12, minWidth: 140 }} />
                <ThemedDate value={cTo} min={cFrom || undefined} onChange={e => setCTo(e.target.value)} placeholder="To" style={{ fontSize: 12, minWidth: 140 }} />
              </>
            )}
            <button onClick={load} title="Refresh" className="p-2 rounded-lg"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}><RefreshCw size={15} /></button>
          </>
        }
      />

      {err && <Panel style={{ background: accent('danger').soft }}><p className="m-0 text-xs" style={{ color: accent('danger').fg }}>{err}</p></Panel>}

      {loading ? <Loading variant="cards" cards={4} label="Measuring…" /> : !data ? null : (
        <>
          {/* Headline numbers — the same figures the charts are drawn from. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile icon={TrendingUp} label="Transfers" value={num(t.transfers)} sub={`${teams.length} team${teams.length === 1 ? '' : 's'} in scope`} tone="primary" />
            <KpiTile icon={CheckCircle2} label={salesWord} value={num(t.sales_won)} sub={t.approval != null ? `${t.approval}% of ${num(t.sales_submitted)} submitted approved` : 'nothing submitted yet'} tone="success" />
            <KpiTile icon={Target} label="Conversion" value={t.conversion != null ? `${t.conversion}%` : '—'} sub="approved ÷ transfers" tone="info" />
            <KpiTile icon={Users} label="Gross" value={money(t.gross)} sub={`${money(t.revenue)} MRR`} tone="warning" />
          </div>

          {/* The one thing a manager needs stated rather than inferred. */}
          {teamQuotas.length > 0 && (
            <Panel style={{ background: behind.length ? accent('warning').soft : accent('success').soft }}>
              <p className="m-0 text-xs font-semibold flex items-start gap-1.5" style={{ color: behind.length ? accent('warning').fg : accent('success').fg }}>
                {behind.length ? <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" /> : <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" />}
                <span>
                  {behind.length
                    ? `${behind.length} of ${teamQuotas.length} quotas are behind the clock: ${behind.slice(0, 3).map(q => `${q.team_name} ${q.metric_label} (${q.pct ?? 0}% done, ${q.elapsed_pct ?? 0}% of the window gone${q.required_pace != null ? `, needs ${q.required_pace}/day` : ''})`).join('; ')}${behind.length > 3 ? '…' : ''}`
                    : `All ${teamQuotas.length} quotas are at or ahead of pace.`}
                </span>
              </p>
            </Panel>
          )}

          {series.length > 0 && (
            <ChartBox title="Daily activity" height={260}
              sub="Transfers created and sales approved, on the day each actually happened. Updates itself as work lands — nothing to refresh.">
              <Line data={activityChart} options={activityOpts} />
            </ChartBox>
          )}

          {teamQuotas.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ChartBox title="Attainment vs the clock" height={Math.max(200, teamQuotas.length * 44)}
                sub="Thick bar = how much of the quota is done. Thin bar = how much of the period is gone. Thick below thin means behind.">
                <Bar data={attainChart} options={attainOpts} />
              </ChartBox>
              <ChartBox title="Allocation coverage" height={240}
                sub={targetSum ? `${num(allocated)} of ${num(targetSum)} handed to members${allocated > targetSum ? ' — over-allocated' : ''}` : 'No team target set yet'}>
                <Doughnut data={allocChart} options={baseOpts({ cutout: '62%' })} />
              </ChartBox>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {Object.keys(byTeamMembers).length > 0 && (
              <ChartBox title="Sale outcomes by team" height={260}
                sub="Where submitted sales end up. Cancelled volume is where a coaching conversation starts.">
                <Bar data={funnelChart} options={funnelOpts} />
              </ChartBox>
            )}
            {topMembers.length > 0 && (
              <ChartBox title="Top members" height={260}
                sub={`Ranked on ${fronter ? 'leads sent' : 'deals closed'} — the column this company is judged on.`}>
                <Bar data={memberChart} options={memberOpts} />
              </ChartBox>
            )}
          </div>

          {/* Per-member detail with each person's allocation. This is the
              "lead sees their members / admin sees everyone" view. */}
          <Panel pad="none">
            <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2 flex-wrap">
              <p className="m-0 text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>
                Member performance ({members.length})
              </p>
              {data.unallocated_count > 0 && (
                <span className="text-[11px] px-2 py-0.5 rounded-lg" style={{ background: accent('warning').soft, color: accent('warning').fg }}>
                  {data.unallocated_count} with no allocation
                </span>
              )}
            </div>
            {members.length === 0 ? <div className="p-4"><EmptyState icon={Users} title="Nobody in scope" hint="Add members to a team first." /></div> : (
              <TableScroll stickyFirst label="Member performance">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                      {['Member', 'Team', 'Transfers', 'Submitted', 'Approved', 'Cancelled', 'Conv.', 'Appr.', 'Gross', 'Quota', 'Progress'].map(h => (
                        <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map(m => {
                      const q = (m.quotas || [])[0];
                      return (
                        <tr key={m.user_id} style={{ borderTop: '1px solid var(--color-border)' }}>
                          <td className="px-3 py-1.5 font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                            {m.name}{m.is_lead && <span className="ml-1 text-[11px] opacity-70">(lead)</span>}
                          </td>
                          <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{m.team_name || '—'}</td>
                          <td className="px-3 py-1.5 tabular-nums">{num(m.transfers)}</td>
                          <td className="px-3 py-1.5 tabular-nums">{num(m.sales_submitted)}</td>
                          <td className="px-3 py-1.5 tabular-nums font-semibold" style={{ color: accent('success').fg }}>{num(m.sales_won)}</td>
                          <td className="px-3 py-1.5 tabular-nums" style={{ color: m.sales_cancelled ? accent('danger').fg : 'var(--color-text-tertiary)' }}>{num(m.sales_cancelled)}</td>
                          <td className="px-3 py-1.5 tabular-nums">{m.conversion != null ? `${m.conversion}%` : '—'}</td>
                          <td className="px-3 py-1.5 tabular-nums">{m.approval != null ? `${m.approval}%` : '—'}</td>
                          <td className="px-3 py-1.5 tabular-nums">{money(m.gross)}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                            {q ? `${num(q.actual)} / ${num(q.target_value)} ${q.metric_label}` : <span style={{ color: 'var(--color-text-tertiary)' }}>none</span>}
                          </td>
                          <td className="px-3 py-1.5" style={{ minWidth: 110 }}>
                            {q ? (
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, q.pct || 0)}%`, background: (q.pct || 0) >= 100 ? accent('success').fg : accent('primary').fg }} />
                                </div>
                                <span className="tabular-nums text-[11px] w-9 text-right" style={{ color: 'var(--color-text-secondary)' }}>{q.pct == null ? '—' : `${q.pct}%`}</span>
                              </div>
                            ) : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Panel>

          {/* Team-by-team quota detail — the admin's view of the lead's gap. */}
          {teams.length > 0 && (
            <Panel pad="none">
              <p className="m-0 px-4 pt-3 pb-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>
                Team quotas ({teamQuotas.length})
              </p>
              {teamQuotas.length === 0 ? (
                <div className="p-4"><EmptyState icon={Target} title="No team targets set" hint="Set one from the Teams tab, then the lead splits it across members." /></div>
              ) : (
                <TableScroll stickyFirst label="Team quotas">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                        {['Team', 'Lead', 'Metric', 'Period', 'Target', 'Actual', '%', 'Pace', 'Allocated', 'Unallocated'].map(h => (
                          <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {teamQuotas.map(q => {
                        const tm = teams.find(x => x.id === q.team_id);
                        return (
                          <tr key={q.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                            <td className="px-3 py-1.5 font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{q.team_name}</td>
                            <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{tm?.lead_name || '—'}</td>
                            <td className="px-3 py-1.5 whitespace-nowrap">{q.metric_label}</td>
                            <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                              {q.starts_at} → {q.ends_at}
                              {q.days_left != null && <span className="opacity-70"> · {q.days_left}d left</span>}
                            </td>
                            <td className="px-3 py-1.5 tabular-nums">{num(q.target_value)}</td>
                            <td className="px-3 py-1.5 tabular-nums font-semibold">{num(q.actual)}</td>
                            <td className="px-3 py-1.5 tabular-nums font-bold" style={{ color: (q.pct || 0) >= 100 ? accent('success').fg : 'var(--color-text)' }}>{q.pct == null ? '—' : `${q.pct}%`}</td>
                            <td className="px-3 py-1.5 whitespace-nowrap">
                              {q.on_track == null ? '—' : (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold"
                                  style={{ background: q.on_track ? accent('success').soft : accent('warning').soft, color: q.on_track ? accent('success').fg : accent('warning').fg }}>
                                  {q.on_track ? <CheckCircle2 size={10} /> : <Clock size={10} />}
                                  {q.on_track ? 'on track' : `needs ${q.required_pace ?? '—'}/day`}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 tabular-nums">{num(q.allocated)} <span className="opacity-60">({q.allocated_to})</span></td>
                            <td className="px-3 py-1.5 tabular-nums" style={{ color: q.unallocated < 0 ? accent('warning').fg : 'var(--color-text-secondary)' }}>
                              {q.unallocated < 0 ? `over by ${num(-q.unallocated)}` : num(q.unallocated)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
