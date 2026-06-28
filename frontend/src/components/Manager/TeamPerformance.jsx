import { useState, useEffect, useCallback } from 'react';
import { BarChart3, TrendingUp, Users, Send, DollarSign, CheckCircle, Percent } from 'lucide-react';
import client from '../../api/client';
import Tooltip from '../UI/Tooltip';

// ── tiny helpers ─────────────────────────────────────────────────────────────
const initials = (n) => (n || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
const PALETTE = ['#6366f1', '#0891b2', '#059669', '#dc2626', '#7c3aed', '#ea580c', '#0284c7', '#65a30d'];
const dayLabel = (d) => { const [, m, day] = (d || '').split('-'); return `${m}/${day}`; };

const RANGES = [{ d: 7, l: '7d' }, { d: 14, l: '14d' }, { d: 30, l: '30d' }];

const Stat = ({ icon: Icon, label, value, tip, accent }) => (
  <Tooltip text={tip}>
    <div className="rounded-xl border px-3 py-2.5 cursor-help min-w-[7rem]"
      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
        <Icon size={12} style={{ color: accent }} /> {label}
      </div>
      <div className="text-xl font-extrabold mt-0.5" style={{ color: 'var(--color-text)' }}>{value}</div>
    </div>
  </Tooltip>
);

// ── grouped daily bar chart (CSS, responsive) ────────────────────────────────
function DailyBars({ daily }) {
  const max = Math.max(1, ...daily.map(d => Math.max(d.transfers, d.sales)));
  return (
    <div>
      <div className="flex items-center gap-4 mb-2 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#3b82f6' }} /> Transfers</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#16a34a' }} /> Sales</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#10b981' }} /> Approved</span>
      </div>
      <div className="flex items-end gap-1 h-44 border-b" style={{ borderColor: 'var(--color-border)' }}>
        {daily.map((d) => (
          <Tooltip key={d.date} text={`${d.date} — ${d.transfers} transfers · ${d.sales} sales · ${d.approved} approved`} className="flex-1 h-full">
            <div className="flex-1 h-full flex items-end justify-center gap-[2px] cursor-help rounded-t hover:bg-[var(--color-bg-secondary)] transition-colors px-[1px]">
              <div title="" style={{ height: `${(d.transfers / max) * 100}%`, minHeight: d.transfers ? 3 : 0, width: 7, backgroundColor: '#3b82f6', borderRadius: '2px 2px 0 0' }} />
              <div style={{ height: `${(d.sales / max) * 100}%`, minHeight: d.sales ? 3 : 0, width: 7, backgroundColor: '#16a34a', borderRadius: '2px 2px 0 0' }} />
            </div>
          </Tooltip>
        ))}
      </div>
      <div className="flex gap-1 mt-1">
        {daily.map((d, i) => (
          <span key={d.date} className="flex-1 text-center text-[8px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {daily.length <= 14 || i % 2 === 0 ? dayLabel(d.date) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── agent leaderboard (horizontal bars) — role-aware (leads or sales) ─────────
function AgentBars({ agents, metric = 'sales' }) {
  if (!agents.length) return <p className="text-xs text-center py-6" style={{ color: 'var(--color-text-tertiary)' }}>No {metric} in this window</p>;
  const val = (a) => (a.value != null ? a.value : a.sales);
  const max = Math.max(1, ...agents.map(val));
  return (
    <div className="space-y-2">
      {agents.map((a, i) => {
        const v = val(a);
        const rate = v ? Math.round((a.approved / v) * 100) : 0;
        const tip = metric === 'leads'
          ? `${v} leads · ${a.approved} became approved sales`
          : `${v} sales · ${a.approved} approved · ${rate}% approval`;
        return (
          <div key={a.user_id} className="flex items-center gap-2.5">
            <span className="w-4 text-[11px] font-bold text-center" style={{ color: 'var(--color-text-tertiary)' }}>{i + 1}</span>
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ backgroundColor: PALETTE[i % PALETTE.length] }}>{initials(a.name)}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>{a.name}</span>
                <Tooltip text={tip}>
                  <span className="text-[11px] font-bold cursor-help" style={{ color: 'var(--color-text-secondary)' }}>{v}</span>
                </Tooltip>
              </div>
              <div className="h-1.5 rounded-full mt-1 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                <div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, backgroundColor: PALETTE[i % PALETTE.length] }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── main ─────────────────────────────────────────────────────────────────────
export default function TeamPerformance() {
  const [days, setDays] = useState(14);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d) => {
    setLoading(true);
    try { const r = await client.get('stats/team-trends', { params: { days: d } }); setData(r.data); }
    catch { setData(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  const totals = data?.totals || {};

  return (
    <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart3 size={18} style={{ color: 'var(--color-primary-600)' }} />
          <h3 className="font-bold text-base" style={{ color: 'var(--color-text)' }}>Team Performance</h3>
          <Tooltip text="Daily team activity + top agents over the selected window. Scoped to your team only.">
            <span className="text-[11px] cursor-help px-1.5 rounded-full" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>?</span>
          </Tooltip>
        </div>
        <div className="flex gap-1 p-0.5 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
          {RANGES.map(r => (
            <button key={r.d} onClick={() => setDays(r.d)}
              className="px-2.5 py-1 rounded-md text-xs font-semibold transition-colors"
              style={{ backgroundColor: days === r.d ? 'var(--color-surface)' : 'transparent', color: days === r.d ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>
              {r.l}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-44 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--color-bg-secondary)' }} />
      ) : !data ? (
        <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>Couldn't load performance data.</p>
      ) : (
        <div className="space-y-5">
          {/* summary stats */}
          <div className="flex gap-3 flex-wrap">
            <Stat icon={Send} label="Transfers" value={totals.transfers} accent="#3b82f6" tip={`Transfers your team received in the last ${days} days`} />
            <Stat icon={DollarSign} label="Sales" value={totals.sales} accent="#16a34a" tip={`Sales made in the last ${days} days`} />
            <Stat icon={CheckCircle} label="Approved" value={totals.approved} accent="#10b981" tip="Sales approved by compliance (closed_won)" />
            <Stat icon={Percent} label="Conversion" value={`${totals.conversion}%`} accent="#7c3aed" tip="Sales ÷ transfers — how many leads became a sale" />
          </div>

          {/* charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center gap-1.5 mb-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
                <TrendingUp size={13} /> Daily Activity
              </div>
              <DailyBars daily={data.daily || []} />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
                <Users size={13} /> Top {data.side === 'fronter' ? 'Fronters' : 'Closers'} <span className="font-normal normal-case" style={{ color: 'var(--color-text-tertiary)' }}>· by {data.agent_metric || 'sales'}</span>
              </div>
              <AgentBars agents={data.top_agents || []} metric={data.agent_metric || 'sales'} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
