import { useMemo } from 'react';
import { UserCircle, Trophy, Tag } from 'lucide-react';
import DrawerShell from '../Shared/DrawerShell';
import DialerBadge from '../Shared/DialerBadge';
import { Panel, TableScroll, EmptyState, accent } from '../UI/kit';
import DailyBars from './DailyBars';
import { formatMetric, metricLabel, metricValue } from '../../config/companyReportMetrics';

// ============================================================================
// AgentReportDrawer -- one agent, everything the report knows about them:
// headline numbers, daily trend, what happens to their leads, who their best
// partner is, which dialer their work came through.
// ============================================================================

const partnerWord = (side) => (side === 'closer' ? 'Fronter' : 'Closer');

function fillSeries(series, from, to) {
  if (!from || !to) return series || [];
  const byDay = new Map((series || []).map(s => [s.d, s]));
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let guard = 0; d <= end && guard < 402; guard++) {
    const k = d.toISOString().slice(0, 10);
    out.push(byDay.get(k) || { d: k, x: 0, s: 0, dp: 0 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function Stat({ label, value, tip }) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} title={tip}>
      <p className="text-[10px] font-bold uppercase tracking-wider m-0 leading-none" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
      <p className="text-lg font-bold m-0 mt-1 tabular-nums" style={{ color: 'var(--color-text)' }}>{value}</p>
    </div>
  );
}

function BestChip({ label, p, value }) {
  if (!p) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: accent('success').soft, color: 'var(--color-text)' }}>
      <Trophy size={11} style={{ color: accent('success').fg }} />
      {label}: {p.name}
      <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>{value}</span>
    </span>
  );
}

export default function AgentReportDrawer({ agent, side, range, metrics, canSeeMoney, onClose }) {
  const series = useMemo(() => fillSeries(agent?.series, range?.from, range?.to), [agent, range]);
  if (!agent) return null;

  const headline = metrics.filter(m => m.fmt !== 'text').slice(0, 12);
  const partnerTitle = side === 'closer' ? 'Fronters who fed this closer' : 'Closers who worked these transfers';
  const dispoTotal = (agent.dispositions || []).reduce((t, d) => t + d.n, 0);
  const best = agent.best;

  return (
    <DrawerShell
      icon={<UserCircle size={16} />}
      title={agent.name}
      subtitle={[
        agent.rank ? `#${agent.rank}` : (agent.placeholder ? 'Placeholder account' : agent.unattributed ? 'No agent on the record' : null),
        agent.level, agent.team_name,
      ].filter(Boolean).join(' · ')}
      onClose={onClose}
      recordKey={agent.user_id || 'unattributed'}
      width={720}
    >
      <div className="space-y-4">
        {(agent.placeholder || agent.unattributed) && (
          <Panel tone="inset" pad="sm" className="flex items-start gap-2">
            <Tag size={14} className="mt-0.5 flex-shrink-0" style={{ color: accent('warn').fg }} />
            <p className="text-xs m-0" style={{ color: 'var(--color-text-secondary)' }}>
              {agent.placeholder
                ? 'A placeholder login that sales were punched to when the real agent had no CRM account. Its numbers count in the company totals, but it is never ranked or picked as anyone\'s best partner.'
                : 'Sales with no fronter on the record. They count in the company totals and are never credited to anyone.'}
            </p>
          </Panel>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {headline.map(m => (
            <Stat key={m.key} label={metricLabel(m, side)} value={formatMetric(m.fmt, metricValue(m, agent))} tip={m.tip} />
          ))}
        </div>

        <Panel tone="surface" pad="md" className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <DailyBars title={side === 'closer' ? 'Transfers received per day' : 'Transfers per day'} data={series} valueKey="x" />
          <DailyBars title="Sales per day" data={series} valueKey="s" color="var(--color-success-600)" />
        </Panel>

        <Panel tone="surface" pad="md">
          <p className="text-sm font-bold m-0 mb-1" style={{ color: 'var(--color-text)' }}>What happens to these leads</p>
          <p className="text-xs m-0 mb-3" style={{ color: 'var(--color-text-secondary)' }}>
            The closer disposition each transfer in the range ended on, most common first.
          </p>
          {(agent.dispositions || []).length === 0
            ? <EmptyState compact title="No transfers in this range" />
            : (
              <div className="space-y-1.5">
                {agent.dispositions.slice(0, 12).map(d => (
                  <div key={d.label} className="flex items-center gap-2 text-xs">
                    <span className="w-32 sm:w-44 truncate" style={{ color: 'var(--color-text)' }} title={d.label}>{d.label}</span>
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-secondary)' }}>
                      <div className="h-full rounded-full" style={{ width: `${dispoTotal ? (d.n / dispoTotal) * 100 : 0}%`, background: 'var(--color-primary-600)' }} />
                    </div>
                    <span className="w-20 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{d.n} · {d.pct}%</span>
                  </div>
                ))}
              </div>
            )}
        </Panel>

        <Panel tone="surface" pad="md">
          <p className="text-sm font-bold m-0 mb-2" style={{ color: 'var(--color-text)' }}>{partnerTitle}</p>
          {best && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              <BestChip label="Most sales" p={best.by_sold} value={best.by_sold ? `${best.by_sold.sold} sold` : ''} />
              {canSeeMoney && <BestChip label="Most money" p={best.by_money} value={best.by_money ? formatMetric('money', best.by_money.dp) : ''} />}
              <BestChip label="Best rate" p={best.by_rate} value={best.by_rate ? `${best.by_rate.rate}% of ${best.by_rate.transfers}` : ''} />
            </div>
          )}
          {(agent.partners || []).length === 0
            ? <EmptyState compact title={`No ${partnerWord(side).toLowerCase()} on these transfers`} />
            : (
              <TableScroll label={partnerTitle}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: 'var(--color-text-secondary)' }}>
                      <th className="text-left font-semibold py-1.5 pr-3">{partnerWord(side)}</th>
                      {side === 'closer' && <th className="text-left font-semibold py-1.5 pr-3">Company</th>}
                      <th className="text-right font-semibold py-1.5 px-2">Transfers</th>
                      <th className="text-right font-semibold py-1.5 px-2">Sold</th>
                      <th className="text-right font-semibold py-1.5 px-2">Rate</th>
                      {canSeeMoney && <th className="text-right font-semibold py-1.5 pl-2">Down payments</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {agent.partners.slice(0, 40).map(p => (
                      <tr key={p.partner} style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                        <td className="py-1.5 pr-3">
                          {p.name}{p.placeholder && <span className="ml-1 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>(placeholder)</span>}
                        </td>
                        {side === 'closer' && <td className="py-1.5 pr-3" style={{ color: 'var(--color-text-secondary)' }}>{p.partner_company || '—'}</td>}
                        <td className="text-right tabular-nums px-2">{p.transfers}</td>
                        <td className="text-right tabular-nums px-2">{p.sold}</td>
                        <td className="text-right tabular-nums px-2">{formatMetric('pct', p.transfers ? Math.round((p.sold / p.transfers) * 1000) / 10 : null)}</td>
                        {canSeeMoney && <td className="text-right tabular-nums pl-2">{formatMetric('money', p.dp)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
        </Panel>

        {(agent.boxes || []).length > 0 && (
          <Panel tone="surface" pad="md">
            <p className="text-sm font-bold m-0 mb-2" style={{ color: 'var(--color-text)' }}>Where the transfers came from</p>
            <div className="flex flex-wrap gap-2">
              {agent.boxes.map(b => (
                <span key={`${b.dialer_provider}|${b.dialer_box}`} className="inline-flex items-center gap-1.5 text-xs">
                  <DialerBadge record={{ dialer_provider: b.dialer_provider, dialer_box: b.dialer_box }} />
                  <span className="tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{b.n}</span>
                </span>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </DrawerShell>
  );
}
