import { useMemo, useState } from 'react';
import { Building2, Users, Crown, Trophy, Search, Info } from 'lucide-react';
import { Panel, PillTabs, TableScroll, Loading, EmptyState, accent } from '../UI/kit';
import { formatMetric, earnerLabel } from '../../config/companyReportMetrics';

// ============================================================================
// OverviewView -- every company the viewer may open, side by side, and every
// agent of those companies on one ladder ("whose agent is on top").
//
// Fronters and closers are ranked on SEPARATE ladders: a fronter's sale and a
// closer's sale are the same sale seen from two ends, so one list mixing both
// would count every sale twice and compare unlike jobs. Placeholder accounts
// are listed but never ranked (utils/companyReport.buildOverview).
// ============================================================================

export function SideBadge({ side }) {
  const a = accent(side === 'closer' ? 'info' : 'primary');
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
      style={{ background: a.soft, color: a.fg }}>
      {side === 'closer' ? 'Closer company' : 'Fronter company'}
    </span>
  );
}

const th = 'px-3 py-2 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap';
const row = { borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' };

function Headline({ icon: Icon, tone = 'primary', title, name, sub, onClick }) {
  const a = accent(tone);
  return (
    <button type="button" disabled={!onClick} onClick={onClick || undefined}
      className={`text-left rounded-2xl p-4 min-w-0 ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : 'cursor-default'}`}
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <p className="text-[11px] font-bold uppercase tracking-wider m-0 leading-none flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
        <Icon size={13} style={{ color: a.fg }} /> {title}
      </p>
      <p className="text-base font-bold m-0 mt-2 truncate" style={{ color: 'var(--color-text)' }}>{name || 'Nobody yet'}</p>
      {sub && <p className="text-xs m-0 mt-0.5 truncate" style={{ color: 'var(--color-text-secondary)' }}>{sub}</p>}
    </button>
  );
}

// One measure, one bar per company. Colour only says which side the company
// is on (the badge in the table says it in words too).
function CompanyBars({ companies, metric, fmt, onOpen }) {
  const max = Math.max(1, ...companies.map(c => Number(c[metric] || 0)));
  return (
    <div className="space-y-2">
      {companies.map(c => {
        const v = c[metric];
        return (
          <button type="button" key={c.company?.id} onClick={() => onOpen(c.company?.id)}
            className="w-full flex items-center gap-3 text-left" title={`Open ${c.company?.name}`}>
            <span className="w-32 sm:w-44 truncate text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{c.company?.name}</span>
            <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-secondary)' }}>
              <div className="h-full rounded-full"
                style={{ width: `${v ? Math.max(2, (Number(v) / max) * 100) : 0}%`, background: c.side === 'closer' ? 'var(--color-info-600)' : 'var(--color-primary-600)' }} />
            </div>
            <span className="w-24 text-right text-sm tabular-nums" style={{ color: 'var(--color-text)' }}>{formatMetric(fmt, v)}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function OverviewView({ overview, loading, onOpenCompany, onOpenAgent }) {
  const [tab, setTab] = useState('companies');
  const [side, setSide] = useState('fronter');
  const [barMetric, setBarMetric] = useState(null);
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);

  const money = !!overview?.can_see_money;
  const companies = useMemo(() => overview?.companies || [], [overview]);
  const agents = useMemo(() => overview?.agents || [], [overview]);
  const earnerKey = overview?.earner_metric || 'sold';

  const sortedCompanies = useMemo(
    () => companies.slice().sort((a, b) => (money ? (b.dp_sold || 0) - (a.dp_sold || 0) : (b.sold || 0) - (a.sold || 0))),
    [companies, money],
  );

  const ladder = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return agents.filter(a => a.side === side
      && (!needle || String(a.name).toLowerCase().includes(needle) || String(a.company || '').toLowerCase().includes(needle)));
  }, [agents, side, q]);

  if (loading && !overview) return <Loading variant="cards" cards={4} />;
  if (!companies.length) return <EmptyState icon={Building2} title="No companies to show" />;

  const topCompany = sortedCompanies.find(c => c.side === 'fronter' && (money ? c.dp_sold : c.sold));
  const topFronter = agents.find(a => a.side === 'fronter' && a.rank === 1);
  const topCloser = agents.find(a => a.side === 'closer' && a.rank === 1);
  const valueOf = (a) => formatMetric(earnerKey === 'sold' ? 'int' : 'money', a?.[earnerKey]);

  const barOptions = [
    ...(money ? [{ key: 'dp_sold', label: 'Down payments', fmt: 'money' }, { key: 'monthly_active', label: 'Monthly book', fmt: 'money' }] : []),
    { key: 'sold', label: 'Sold', fmt: 'int' },
    { key: 'transfers', label: 'Transfers', fmt: 'int' },
    { key: 'conversion', label: 'Conversion', fmt: 'pct' },
    { key: 'stick_rate', label: 'Stick rate', fmt: 'pct' },
  ];
  const bar = barOptions.find(b => b.key === barMetric) || barOptions[0];
  const counts = { fronter: agents.filter(a => a.side === 'fronter').length, closer: agents.filter(a => a.side === 'closer').length };
  const shown = showAll ? ladder : ladder.slice(0, 50);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Headline icon={Building2} title="Top fronter company"
          name={topCompany?.company?.name}
          sub={topCompany && (money ? `${formatMetric('money', topCompany.dp_sold)} · ${formatMetric('int', topCompany.sold)} sold` : `${formatMetric('int', topCompany.sold)} sold`)}
          onClick={topCompany ? () => onOpenCompany(topCompany.company.id) : null} />
        <Headline icon={Crown} tone="success" title="Top fronter, all companies"
          name={topFronter?.name} sub={topFronter && `${topFronter.company} · ${valueOf(topFronter)}`}
          onClick={topFronter ? () => onOpenAgent(topFronter) : null} />
        <Headline icon={Trophy} tone="info" title="Top closer, all companies"
          name={topCloser?.name} sub={topCloser && `${topCloser.company} · ${valueOf(topCloser)}`}
          onClick={topCloser ? () => onOpenAgent(topCloser) : null} />
        <Headline icon={Info} tone="muted" title="Post-dates excluded"
          name={formatMetric('int', companies.filter(c => c.side === 'fronter').reduce((t, c) => t + (c.post_dates || 0), 0))}
          sub="post-dated reminders, never counted as sales" />
      </div>

      <PillTabs value={tab} onChange={setTab} items={[
        { key: 'companies', label: 'Companies', icon: Building2 },
        { key: 'agents', label: 'Top agents', icon: Users },
      ]} />

      {tab === 'companies' && (
        <>
          <Panel tone="surface" pad="md">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <p className="text-sm font-bold m-0" style={{ color: 'var(--color-text)' }}>Which company is doing what</p>
              <PillTabs value={bar.key} onChange={setBarMetric} items={barOptions.map(b => ({ key: b.key, label: b.label }))} />
            </div>
            <CompanyBars companies={companies.slice().sort((a, b) => Number(b[bar.key] || 0) - Number(a[bar.key] || 0))}
              metric={bar.key} fmt={bar.fmt} onOpen={onOpenCompany} />
            <p className="text-[11px] m-0 mt-3" style={{ color: 'var(--color-text-tertiary)' }}>
              Fronter and closer companies count the same sales from opposite ends — compare fronter companies with each other, not with the closer company. Click a company to open its agents.
            </p>
          </Panel>

          <Panel tone="surface" pad="none" className="overflow-hidden">
            <TableScroll stickyFirst label="All companies">
              <table className="w-full text-sm">
                <thead style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                  <tr>
                    <th className={`${th} text-left`}>Company</th>
                    <th className={`${th} text-right`}>Agents</th>
                    <th className={`${th} text-right`}>Transfers</th>
                    <th className={`${th} text-right`}>Conversion</th>
                    <th className={`${th} text-right`}>Sold</th>
                    <th className={`${th} text-right`}>Stick rate</th>
                    <th className={`${th} text-right`}>Post-dates</th>
                    {money && <th className={`${th} text-right`}>Down payments</th>}
                    {money && <th className={`${th} text-right`}>Monthly book</th>}
                    <th className={`${th} text-left`}>Top agent</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCompanies.map(c => (
                    <tr key={c.company?.id} onClick={() => onOpenCompany(c.company?.id)} className="cursor-pointer" style={row}>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-semibold">{c.company?.name}</span>
                        <span className="ml-2"><SideBadge side={c.side} /></span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMetric('int', c.agents_active)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMetric('int', c.transfers)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMetric('pct', c.conversion)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMetric('int', c.sold)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMetric('pct', c.stick_rate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{formatMetric('int', c.post_dates)}</td>
                      {money && <td className="px-3 py-2 text-right tabular-nums">{formatMetric('money', c.dp_sold)}</td>}
                      {money && <td className="px-3 py-2 text-right tabular-nums">{formatMetric('money', c.monthly_active)}</td>}
                      <td className="px-3 py-2 whitespace-nowrap">
                        {c.top_agent ? <>{c.top_agent.name} <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{formatMetric(c.top_agent.metric === 'sold' ? 'int' : 'money', c.top_agent.value)}</span></> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Panel>
        </>
      )}

      {tab === 'agents' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PillTabs value={side} onChange={(v) => { setSide(v); setShowAll(false); }} items={[
              { key: 'fronter', label: `Fronters (${counts.fronter})` },
              { key: 'closer', label: `Closers (${counts.closer})` },
            ]} />
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Ranked by {earnerLabel(earnerKey).toLowerCase()}</span>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Agent or company" className="input pl-8 w-48 text-sm" />
              </div>
            </div>
          </div>
          {ladder.length === 0 ? <EmptyState icon={Users} title="No agents match" /> : (
            <Panel tone="surface" pad="none" className="overflow-hidden">
              <TableScroll stickyFirst label="Top agents across companies">
                <table className="w-full text-sm">
                  <thead style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                    <tr>
                      <th className={`${th} text-left`}>Agent</th>
                      <th className={`${th} text-left`}>Company</th>
                      <th className={`${th} text-right`}>{side === 'closer' ? 'Received' : 'Transfers'}</th>
                      <th className={`${th} text-right`}>Conversion</th>
                      <th className={`${th} text-right`}>Sold</th>
                      <th className={`${th} text-right`}>Still active</th>
                      <th className={`${th} text-right`}>Stick rate</th>
                      {money && <th className={`${th} text-right`}>Down payments</th>}
                      {money && <th className={`${th} text-right`}>Monthly book</th>}
                      <th className={`${th} text-right`}>QA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(a => (
                      <tr key={`${a.company_id}|${a.user_id}`} onClick={() => onOpenAgent(a)} className="cursor-pointer" style={row}>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="inline-block w-7 text-xs font-bold tabular-nums"
                            style={{ color: a.rank && a.rank <= 3 ? accent('warn').fg : 'var(--color-text-tertiary)' }}>{a.rank ?? '—'}</span>
                          <span className="font-semibold" style={{ fontStyle: a.rank == null ? 'italic' : 'normal', color: a.rank == null ? 'var(--color-text-secondary)' : 'var(--color-text)' }}>{a.name}</span>
                          {a.placeholder && <span className="ml-1.5 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>placeholder — not ranked</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{a.company}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMetric('int', a.transfers)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMetric('pct', a.conversion)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMetric('int', a.sold)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMetric('int', a.active)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMetric('pct', a.stick_rate)}</td>
                        {money && <td className="px-3 py-2 text-right tabular-nums">{formatMetric('money', a.dp_sold)}</td>}
                        {money && <td className="px-3 py-2 text-right tabular-nums">{formatMetric('money', a.monthly_active)}</td>}
                        <td className="px-3 py-2 text-right tabular-nums">{formatMetric('pct', a.qa_avg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
              {ladder.length > 50 && (
                <div className="px-3 py-2 text-center" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <button type="button" className="text-xs font-semibold" style={{ color: 'var(--color-primary-600)' }} onClick={() => setShowAll(v => !v)}>
                    {showAll ? 'Show top 50' : `Show all ${ladder.length}`}
                  </button>
                </div>
              )}
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
