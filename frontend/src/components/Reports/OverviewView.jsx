import { useMemo, useState } from 'react';
import { Building2, Users, Crown, Trophy, Search, Info, ArrowRight } from 'lucide-react';
import { Panel, PillTabs, TableScroll, Loading, EmptyState, accent } from '../UI/kit';
import { formatMetric, earnerLabel, earnerFmt } from '../../config/companyReportMetrics';

// ============================================================================
// OverviewView -- every company the viewer may open: one KPI card per company,
// a comparison on any one measure, and every agent of those companies on one
// ladder ("whose agent is on top").
//
// SALES COUNT LEADS EVERYWHERE. The number of sales is what a company and an
// agent are judged on in this CRM, so it is the first number on every card, the
// default comparison and the default ranking. Money (down payments, monthly
// book) is shown after it, only to viewers who may see amounts, and is never
// the default order.
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
const bySales = (a, b) => (b.sold || 0) - (a.sold || 0) || (b.active || 0) - (a.active || 0) || (b.transfers || 0) - (a.transfers || 0);

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

function Kpi({ label, value, sub, strong = false, tip }) {
  return (
    <div className="rounded-xl px-3 py-2 min-w-0" title={tip}
      style={{ background: strong ? accent('success').soft : 'var(--color-bg)', border: `1px solid ${strong ? accent('success').fg : 'var(--color-border)'}` }}>
      <p className="text-[10px] font-bold uppercase tracking-wider m-0 leading-none truncate" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
      <p className={`${strong ? 'text-2xl' : 'text-lg'} font-bold m-0 mt-1 tabular-nums leading-tight`} style={{ color: 'var(--color-text)' }}>{value}</p>
      {sub && <p className="text-[11px] m-0 mt-0.5 truncate" style={{ color: 'var(--color-text-tertiary)' }}>{sub}</p>}
    </div>
  );
}

// The top performer / runner-up of one company: the name, the number of sales
// that put them there (the big number), and what else they did. Money is the
// last line and only for viewers who may see amounts.
function Performer({ place, a, lead, closer, money, onOpen }) {
  const top = place === 'top';
  const tone = accent(top ? 'success' : 'info');
  const Icon = top ? Crown : Trophy;
  return (
    <button type="button" onClick={onOpen}
      className="text-left rounded-xl px-3 py-2.5 min-w-0 cursor-pointer hover:shadow-md transition-shadow"
      style={{ background: top ? tone.soft : 'var(--color-bg)', border: `1px solid ${top ? tone.fg : 'var(--color-border)'}` }}>
      <p className="text-[10px] font-bold uppercase tracking-wider m-0 leading-none flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
        <Icon size={12} style={{ color: tone.fg }} /> {top ? 'Top performer' : 'Runner-up'}
      </p>
      <div className="flex items-end justify-between gap-2 mt-1.5">
        <div className="min-w-0">
          <p className="text-sm font-bold m-0 truncate" style={{ color: 'var(--color-text)' }}>{a.name}</p>
          {a.team_name && <p className="text-[11px] m-0 truncate" style={{ color: 'var(--color-text-tertiary)' }}>{a.team_name}</p>}
        </div>
        <p className="m-0 text-right flex-shrink-0 leading-none">
          <span className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{formatMetric('int', a.sold)}</span>
          <span className="block text-[10px] font-bold uppercase tracking-wider mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>sale{a.sold === 1 ? '' : 's'}</span>
        </p>
      </div>
      <p className="text-[11px] m-0 mt-1.5" style={{ color: 'var(--color-text-secondary)' }}>
        {formatMetric('int', a.active)} still active ({formatMetric('pct', a.stick_rate)})
        {' · '}{formatMetric('int', a.transfers)} {closer ? 'received' : 'transfers'}
        {' · '}{formatMetric('pct', a.conversion)} conversion
        {a.qa_avg != null && <>{' · '}QA {formatMetric('pct', a.qa_avg)}</>}
      </p>
      {!top && lead != null && (
        <p className="text-[11px] m-0 mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
          {lead > 0 ? `${lead} sale${lead === 1 ? '' : 's'} behind the top` : 'level with the top on sales'}
        </p>
      )}
      {money && a.dp_sold != null && (
        <p className="text-[11px] m-0 mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>Down payments {formatMetric('money', a.dp_sold)}</p>
      )}
    </button>
  );
}

// One company: its sales first, then everything else about it, its top
// performer and runner-up, and (last, if the viewer may see amounts) the money.
function CompanyCard({ c, money, onOpenCompany, onOpenAgent }) {
  const closer = c.side === 'closer';
  return (
    <Panel tone="surface" pad="md" className="space-y-3 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 size={16} style={{ color: accent(closer ? 'info' : 'primary').fg }} className="flex-shrink-0" />
          <p className="text-base font-bold m-0 truncate" style={{ color: 'var(--color-text)' }}>{c.company?.name}</p>
          <SideBadge side={c.side} />
        </div>
        <button type="button" onClick={() => onOpenCompany(c.company?.id)}
          className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-primary-600)' }}>
          Open full report <ArrowRight size={13} />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi strong label="Sales" value={formatMetric('int', c.sold)} sub={`${formatMetric('num', c.sales_per_agent)} per agent`}
          tip="Sales dated in the range. Post-dates are not sales." />
        <Kpi label="Still active" value={formatMetric('int', c.active)} sub={`${formatMetric('int', c.cancelled)} cancelled`} />
        <Kpi label="Stick rate" value={formatMetric('pct', c.stick_rate)} sub="active ÷ sold" />
        <Kpi label="Conversion" value={formatMetric('pct', c.conversion)} sub={`${formatMetric('int', c.xfer_sold)} of ${formatMetric('int', c.transfers)}`} />
        <Kpi label={closer ? 'Transfers received' : 'Transfers'} value={formatMetric('int', c.transfers)} sub={`${formatMetric('num', c.daily_avg)} / day`} />
        <Kpi label="Active agents" value={formatMetric('int', c.agents_active)} sub="with transfers or sales" />
        <Kpi label="Callbacks done" value={formatMetric('pct', c.cb_completion)}
          sub={`${formatMetric('int', c.cb_completed)} of ${formatMetric('int', c.cb_total)} · ${formatMetric('int', c.cb_missed)} missed`} />
        {c.qa_n > 0
          ? <Kpi label="QA score" value={formatMetric('pct', c.qa_avg)} sub={`${c.qa_n} reviews · ${formatMetric('pct', c.qa_pass_rate)} pass`} />
          : <Kpi label="In review" value={formatMetric('int', c.in_review)} sub="open or with compliance" />}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        <span>{formatMetric('int', c.post_dates)} post-date{c.post_dates === 1 ? '' : 's'} (not counted as sales)</span>
        {c.unattributed > 0 && <span>{c.unattributed} sale{c.unattributed === 1 ? '' : 's'} with no agent on the record</span>}
        {money && <span>Down payments <b style={{ color: 'var(--color-text)' }}>{formatMetric('money', c.dp_sold)}</b></span>}
        {money && <span>Monthly book <b style={{ color: 'var(--color-text)' }}>{formatMetric('money', c.monthly_active)}</b></span>}
      </div>

      {/* who is on top in this company, what they did, and who is chasing them */}
      <div className="pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
        {(c.top_agents || []).length === 0
          ? <p className="text-xs m-0" style={{ color: 'var(--color-text-tertiary)' }}>Nobody has a sale in this range yet.</p>
          : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Performer place="top" a={c.top_agents[0]} closer={closer} money={money}
                onOpen={() => onOpenAgent({ user_id: c.top_agents[0].user_id, company_id: c.company?.id })} />
              {c.top_agents[1]
                ? <Performer place="runner" a={c.top_agents[1]} lead={c.top_agents[0].sold - c.top_agents[1].sold} closer={closer} money={money}
                    onOpen={() => onOpenAgent({ user_id: c.top_agents[1].user_id, company_id: c.company?.id })} />
                : (
                  <div className="rounded-xl px-3 py-2.5 flex items-center text-xs" style={{ border: '1px dashed var(--color-border)', color: 'var(--color-text-tertiary)' }}>
                    No runner-up yet — nobody else has a sale in this range.
                  </div>
                )}
            </div>
          )}
        {c.top_agents?.[2] && (
          <p className="text-xs m-0 mt-2" style={{ color: 'var(--color-text-secondary)' }}>
            3rd: <button type="button" className="font-semibold" style={{ color: 'var(--color-text)' }}
              onClick={() => onOpenAgent({ user_id: c.top_agents[2].user_id, company_id: c.company?.id })}>{c.top_agents[2].name}</button>
            {' '}· {formatMetric('int', c.top_agents[2].sold)} sale{c.top_agents[2].sold === 1 ? '' : 's'}
          </p>
        )}
      </div>
    </Panel>
  );
}

// One measure, one bar per company. Colour only says which side the company
// is on (the badge on its card says it in words too).
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
  const [barMetric, setBarMetric] = useState('sold');
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);

  const money = !!overview?.can_see_money;
  const companies = useMemo(() => overview?.companies || [], [overview]);
  const agents = useMemo(() => overview?.agents || [], [overview]);
  const earnerKey = overview?.earner_metric || 'sold';

  // Companies are always ordered by sales count.
  const sortedCompanies = useMemo(() => companies.slice().sort(bySales), [companies]);

  const ladder = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return agents.filter(a => a.side === side
      && (!needle || String(a.name).toLowerCase().includes(needle) || String(a.company || '').toLowerCase().includes(needle)));
  }, [agents, side, q]);

  if (loading && !overview) return <Loading variant="cards" cards={4} />;
  if (!companies.length) return <EmptyState icon={Building2} title="No companies to show" />;

  const topCompany = sortedCompanies.find(c => c.side === 'fronter' && c.sold > 0);
  const topFronter = agents.find(a => a.side === 'fronter' && a.rank === 1);
  const topCloser = agents.find(a => a.side === 'closer' && a.rank === 1);
  const valueOf = (a) => `${formatMetric(earnerFmt(earnerKey), a?.[earnerKey])} ${earnerLabel(earnerKey)}`;

  // Sales measures first; money after them, and only for viewers with amounts.
  const barOptions = [
    { key: 'sold', label: 'Sales', fmt: 'int' },
    { key: 'active', label: 'Still active', fmt: 'int' },
    { key: 'conversion', label: 'Conversion', fmt: 'pct' },
    { key: 'stick_rate', label: 'Stick rate', fmt: 'pct' },
    { key: 'transfers', label: 'Transfers', fmt: 'int' },
    ...(money ? [{ key: 'dp_sold', label: 'Down payments', fmt: 'money' }, { key: 'monthly_active', label: 'Monthly book', fmt: 'money' }] : []),
  ];
  const bar = barOptions.find(b => b.key === barMetric) || barOptions[0];
  const counts = { fronter: agents.filter(a => a.side === 'fronter').length, closer: agents.filter(a => a.side === 'closer').length };
  const shown = showAll ? ladder : ladder.slice(0, 50);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Headline icon={Building2} title="Top fronter company · most sales"
          name={topCompany?.company?.name}
          sub={topCompany && `${formatMetric('int', topCompany.sold)} sales · ${formatMetric('pct', topCompany.stick_rate)} stick`}
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
              <p className="text-sm font-bold m-0" style={{ color: 'var(--color-text)' }}>Compare companies</p>
              <PillTabs value={bar.key} onChange={setBarMetric} items={barOptions.map(b => ({ key: b.key, label: b.label }))} />
            </div>
            <CompanyBars companies={companies.slice().sort((a, b) => Number(b[bar.key] || 0) - Number(a[bar.key] || 0))}
              metric={bar.key} fmt={bar.fmt} onOpen={onOpenCompany} />
            <p className="text-[11px] m-0 mt-3" style={{ color: 'var(--color-text-tertiary)' }}>
              Fronter and closer companies count the same sales from opposite ends — compare fronter companies with each other, not with the closer company.
            </p>
          </Panel>

          {/* one KPI card per company, most sales first */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {sortedCompanies.map(c => (
              <CompanyCard key={c.company?.id} c={c} money={money} onOpenCompany={onOpenCompany} onOpenAgent={onOpenAgent} />
            ))}
          </div>
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
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Ranked by {earnerLabel(earnerKey)}</span>
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
                      <th className={`${th} text-right`}>Sales</th>
                      <th className={`${th} text-right`}>Still active</th>
                      <th className={`${th} text-right`}>Stick rate</th>
                      <th className={`${th} text-right`}>{side === 'closer' ? 'Received' : 'Transfers'}</th>
                      <th className={`${th} text-right`}>Conversion</th>
                      <th className={`${th} text-right`}>QA</th>
                      {money && <th className={`${th} text-right`}>Down payments</th>}
                      {money && <th className={`${th} text-right`}>Monthly book</th>}
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
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatMetric('int', a.sold)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMetric('int', a.active)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMetric('pct', a.stick_rate)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMetric('int', a.transfers)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMetric('pct', a.conversion)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMetric('pct', a.qa_avg)}</td>
                        {money && <td className="px-3 py-2 text-right tabular-nums">{formatMetric('money', a.dp_sold)}</td>}
                        {money && <td className="px-3 py-2 text-right tabular-nums">{formatMetric('money', a.monthly_active)}</td>}
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
