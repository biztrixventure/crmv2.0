import { useEffect, useState, useCallback } from 'react';
import { BarChart3, Send, DollarSign, CheckCircle2, Percent, TrendingUp, AlertTriangle } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, KpiTile, TableScroll, Loading, EmptyState } from '../UI/kit';

// ============================================================================
// AgentPerformance — "who is doing what", one row per person.
//
// Answers the question a company admin actually opens the dashboard to ask:
// which of my people is producing, and is their volume turning into business?
// Volume alone is a trap — the fronter with the most leads is not the best
// fronter if none of them sell — so every row carries the funnel it owns
// (transfers → sales → approved) next to the two rates that qualify it.
//
// Side-aware: a FRONTER company ranks fronters by leads sent, a CLOSER company
// ranks closers by deals closed. The server decides which, from company type.
// ============================================================================

const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
const money = (v) => `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Conversion needs a reference point or the number is just a number. The bar is
// scaled to the BEST performer in the list, not to 100 — at a 4% company
// average every bar against 100 would be an invisible stub, and the question
// being asked is "who is ahead", which is relative.
function RateBar({ value, best, tone = 'primary' }) {
  if (value === null || value === undefined) {
    return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
  }
  const w = best > 0 ? Math.max(4, Math.round((value / best) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 min-w-[104px]">
      <span className="text-xs font-bold tabular-nums w-11 text-right"
        style={{ color: `var(--color-${tone}-600)` }}>{value}%</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden"
        style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
        <div className="h-full rounded-full"
          style={{ width: `${w}%`, background: `var(--color-${tone}-600)` }} />
      </div>
    </div>
  );
}

export default function AgentPerformance({ dateFrom, dateTo }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const params = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo)   params.date_to   = dateTo;
      const res = await client.get('stats/agent-performance', { params });
      setData(res.data);
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not load agent performance.');
    } finally { setLoading(false); }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const side      = data?.side || 'fronter';
  const isFronter = side === 'fronter';
  const agents    = data?.agents || [];
  const totals    = data?.totals;

  // Volume column is the metric that side is judged on; it leads the table.
  const volumeLabel = isFronter ? 'Transfers' : 'Sales';
  const bestConv    = Math.max(0, ...agents.map(a => a.conversion ?? 0));
  const bestAppr    = Math.max(0, ...agents.map(a => a.approval ?? 0));

  return (
    <Panel pad="lg">
      <SectionHeader
        level="section"
        icon={BarChart3}
        title={isFronter ? 'Fronter Performance' : 'Closer Performance'}
        subtitle={isFronter
          ? 'Leads sent, what they turned into, and how much survived compliance'
          : 'Leads worked, deals closed, and how much survived compliance'}
        actions={totals ? (
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
            {totals.agents} {totals.agents === 1 ? 'agent' : 'agents'}
          </span>
        ) : null}
      />

      {loading ? <Loading variant="table" rows={6} />
        : err ? <EmptyState compact icon={AlertTriangle} title="Couldn't load performance" hint={err} />
        : !agents.length ? (
          <EmptyState icon={BarChart3} title="No agent activity in this period"
            hint="Pick a wider date range, or check that leads are being submitted." />
        ) : (
          <>
            {/* Company roll-up. These are the FULL in-scope figures, so they
                match the KPI cards above rather than only the attributed rows. */}
            {totals && (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
                <KpiTile icon={Send}         tone="info"    label="Transfers"  value={totals.transfers.toLocaleString()} />
                <KpiTile icon={DollarSign}   tone="primary" label="Sales"      value={totals.sales.toLocaleString()} />
                <KpiTile icon={CheckCircle2} tone="success" label="Approved"   value={totals.approved.toLocaleString()} />
                <KpiTile icon={Percent}      tone="warn"    label="Conversion" value={pct(totals.conversion)}
                  sub={`${totals.sales} of ${totals.transfers} transfers`} />
                <KpiTile icon={TrendingUp}   tone="success" label="Approval"   value={pct(totals.approval)}
                  sub={`${totals.approved} of ${totals.sales} sales`} />
              </div>
            )}

            <TableScroll stickyFirst label={isFronter ? 'Fronter performance' : 'Closer performance'}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['#', 'Agent', volumeLabel, isFronter ? 'Sales' : 'Transfers', 'Approved', 'Conversion', 'Approval', 'Monthly'].map(h => (
                      <th key={h} className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
                        style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a, i) => (
                    <tr key={a.user_id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td className="py-2.5 px-3 text-xs font-bold tabular-nums"
                        style={{ color: i < 3 ? 'var(--color-primary-600)' : 'var(--color-text-tertiary)' }}>
                        {i + 1}
                      </td>
                      <td className="py-2.5 px-3 font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                        {a.name}
                      </td>
                      <td className="py-2.5 px-3 font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>
                        {(isFronter ? a.transfers : a.sales).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
                        {(isFronter ? a.sales : a.transfers).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums font-semibold" style={{ color: 'var(--color-success-600)' }}>
                        {a.approved.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3"><RateBar value={a.conversion} best={bestConv} tone="primary" /></td>
                      <td className="py-2.5 px-3"><RateBar value={a.approval}  best={bestAppr} tone="success" /></td>
                      <td className="py-2.5 px-3 tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                        {money(a.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>

            {/* Records nobody owns. Stated rather than hidden: without this the
                rows add up to less than the cards and both numbers lose trust. */}
            {totals && (totals.unattributed_sales > 0 || totals.unattributed_transfers > 0) && (
              <p className="m-0 mt-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                Not shown above:{' '}
                {totals.unattributed_transfers > 0 && `${totals.unattributed_transfers} transfer(s) with no creator`}
                {totals.unattributed_transfers > 0 && totals.unattributed_sales > 0 && ', '}
                {totals.unattributed_sales > 0 && `${totals.unattributed_sales} sale(s) with no ${isFronter ? 'fronter' : 'closer'} credited`}
                {' '}— counted in the totals above, but they belong to no agent.
              </p>
            )}
          </>
        )}
    </Panel>
  );
}
