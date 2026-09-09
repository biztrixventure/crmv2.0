// ============================================================================
// TopAgents — the Top 5 agents table for the Team Sales tab.
//
// Exists so the best performers are on screen where the work is, instead of
// something a manager re-derives by sorting a roster every time they open the
// tab.
//
// Fed by /stats/agent-performance with the TAB's date range — the same endpoint
// Company Performance reads. That is the point: two surfaces showing "top
// agents" for the same window must not be able to disagree, which they would
// the moment one of them started tallying the paged list in the browser (that
// list is one page deep, so it would rank a sample and call it a ranking).
//
// Ranked by APPROVED, not by sales volume: a sale compliance later cancels is
// not a performance. Conversion breaks ties, so someone with fewer leads who
// closes a higher share of them outranks a high-volume, low-yield agent.
// ============================================================================
import { useEffect, useState, useCallback } from 'react';
import { Trophy, AlertTriangle } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, TableScroll, Loading, EmptyState, accent } from '../UI/kit';
import { useAbortable, isCanceled } from '../../hooks/useTableQuery';
import { pct1 } from '../../utils/recordFormat';

const num = (v) => Number(v || 0).toLocaleString();

// Display heuristic only — each scorecard carries its own pass_threshold, so
// the colour is never the verdict. The passed/reviews count rides in the title.
const qaTone = (s) => (s >= 80 ? 'success' : s >= 60 ? 'warn' : 'danger');

/**
 * @param dateFrom / dateTo  the tab's range (YYYY-MM-DD), so this table always
 *                           describes the same window as the records below it.
 * @param limit              how many rows (5 per the spec).
 * @param onPick             (userId) => void — filter the records list to them.
 * @param refreshToken       bump to re-fetch.
 */
export default function TopAgents({ dateFrom, dateTo, limit = 5, onPick, refreshToken }) {
  const [rows, setRows]    = useState(null);
  const [side, setSide]    = useState('closer');
  const [err, setErr]      = useState('');
  const [loading, setLoad] = useState(true);
  const abortable = useAbortable();

  const load = useCallback(async () => {
    setLoad(true); setErr('');
    try {
      const r = await client.get('stats/agent-performance', {
        params: { date_from: dateFrom || undefined, date_to: dateTo || undefined },
        signal: abortable(),
      });
      const agents = r.data?.agents || [];
      setSide(r.data?.side || 'closer');
      // Ranked here rather than server-side: the endpoint already returns the
      // whole roster with exact counts, and Company Performance offers three
      // different rankings over that same array. Sorting 50 elements in the
      // browser is free; re-fetching per ranking would not be.
      setRows([...agents]
        .sort((a, b) => (b.approved - a.approved) || ((b.conversion ?? 0) - (a.conversion ?? 0)))
        .slice(0, limit));
      setLoad(false);
    } catch (e) {
      if (isCanceled(e)) return;          // superseded by a newer range
      setErr(e.response?.data?.error || 'Could not load top agents');
      setLoad(false);
    }
  }, [dateFrom, dateTo, limit, abortable]);

  useEffect(() => { load(); }, [load, refreshToken]);

  const roleWord = side === 'fronter' ? 'fronters' : 'closers';
  const hasQa = (rows || []).some(a => a.qa);

  return (
    <Panel tone="inset" radius="xl" pad="md" className="mb-4">
      <SectionHeader
        level="sub"
        icon={Trophy}
        title={`Top ${limit} ${roleWord}`}
        actions={<span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
          by approved sales · this date range
        </span>}
      />

      {err ? (
        <EmptyState compact icon={AlertTriangle} title="Couldn't load top agents" hint={err} />
      ) : loading && !rows ? (
        <Loading variant="rows" rows={limit} label="Loading top agents…" />
      ) : !rows?.length ? (
        <EmptyState compact icon={Trophy} title="No agent activity in this range" />
      ) : (
        <TableScroll stickyFirst label="Top agents">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['#', 'Agent', 'Sales', 'Approved', 'Cancelled', 'Awaiting', 'Conversion', ...(hasQa ? ['QA'] : [])].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
                    style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a, i) => (
                <tr key={a.user_id}
                  onClick={onPick ? () => onPick(a.user_id) : undefined}
                  className={onPick ? 'cursor-pointer transition-colors hover:bg-bg-secondary' : ''}
                  style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="py-2 px-3 text-xs font-black tabular-nums"
                    style={{ color: i < 3 ? accent('primary').fg : 'var(--color-text-tertiary)' }}>{i + 1}</td>
                  <td className="py-2 px-3 font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{a.name}</td>
                  <td className="py-2 px-3 tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{num(a.sales)}</td>
                  <td className="py-2 px-3 tabular-nums font-bold" style={{ color: accent('success').fg }}>{num(a.approved)}</td>
                  <td className="py-2 px-3 tabular-nums" style={{ color: accent('danger').fg }}>{num(a.cancelled)}</td>
                  <td className="py-2 px-3 tabular-nums" style={{ color: accent('warn').fg }}>{num(a.pending)}</td>
                  {/* pct1, not `${v}%`: a column of 7.9 / 3.5 / 3 / 2.5 reads ragged and
                      the whole number looks like a different unit. */}
                  <td className="py-2 px-3 tabular-nums font-semibold" style={{ color: 'var(--color-text)' }}>{pct1(a.conversion)}</td>
                  {hasQa && (
                    <td className="py-2 px-3">
                      {a.qa ? (
                        <span className="text-xs font-bold tabular-nums px-1.5 py-0.5 rounded-md"
                          style={{ color: accent(qaTone(a.qa.score)).fg, background: accent(qaTone(a.qa.score)).soft }}
                          title={`${a.qa.passed} passed of ${a.qa.reviews} reviews`}>{a.qa.score}%</span>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  );
}
