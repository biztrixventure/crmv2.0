// ClientUsagePanel — read-only lifecycle/usage rollup for the Clients & Plans
// command center. Shows, per client (carrier) and per plan, how many sales exist,
// how many are active policies (closed_won), and the status breakdown — so an
// admin sees which products are actually in use. Backed by GET /sale-configs/usage
// (aggregates the sales table). No writes.
import { useState, useEffect, useCallback } from 'react';
import { BarChart3, Package, Building2, DollarSign, TrendingUp, CalendarClock, ShieldCheck } from 'lucide-react';
import client from '../../../api/client';
import { Alert } from '../../../components/UI';
import ThemedSelect from '../../UI/Select';
import { Panel, SectionHeader, Loading, EmptyState, KpiTile } from '../../UI/kit';

const STATUS_COLOR = {
  closed_won: 'var(--color-success-600)', pending_review: 'var(--color-warning-600)',
  cancelled: 'var(--color-error-600)', returned: 'var(--color-error-500)',
};
const statusColor = (s) => STATUS_COLOR[s] || 'var(--color-text-tertiary)';
const pretty = (s) => String(s || 'unknown').replace(/_/g, ' ');
const money = (n) => '$' + Math.round(n || 0).toLocaleString();

export default function ClientUsagePanel() {
  const [companyId, setCompanyId] = useState('');
  const [companies, setCompanies] = useState([]);
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]       = useState(null);

  useEffect(() => { client.get('companies').then(r => setCompanies(r.data.companies || [])).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const params = {}; if (companyId) params.company_id = companyId;
      const r = await client.get('sale-configs/usage', { params });
      setData(r.data);
    } catch (e) { setErr(e.response?.data?.error || 'Failed to load usage.'); setData(null); }
    finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-5xl">
      <SectionHeader
        icon={BarChart3}
        title="Usage & lifecycle"
        subtitle={data ? `${data.total.toLocaleString()} sales` : undefined}
        actions={
          <ThemedSelect value={companyId} onChange={e => setCompanyId(e.target.value)} className="input w-56">
            <option value="">All companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </ThemedSelect>
        }
      />
      {err && <div className="mb-3"><Alert type="error">{err}</Alert></div>}

      {loading ? (
        <Loading variant="cards" cards={4} label="Loading usage…" />
      ) : !data ? null : (
        <>
          {/* KPI strip — from plan metadata (mig 214). $ tiles read 0 until plans have price/cost set. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <KpiTile icon={ShieldCheck} label="Active policies" value={(data.summary?.active || 0).toLocaleString()} />
            <KpiTile icon={DollarSign} label="Active revenue" value={money(data.summary?.revenue)} tone="success" />
            <KpiTile icon={TrendingUp} label="Est. margin" value={money(data.summary?.margin)} tone="primary" />
            <KpiTile icon={CalendarClock} label="Expiring ≤90d" value={(data.summary?.expiring || 0).toLocaleString()} tone="warn" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <UsageTable title="By client (carrier)" icon={Building2} rows={data.byClient} />
            <UsageTable title="By plan" icon={Package} rows={data.byPlan} />
          </div>
        </>
      )}
    </div>
  );
}

function UsageTable({ title, icon: Icon, rows }) {
  const max = Math.max(1, ...rows.map(r => r.total));
  return (
    <Panel tone="inset" radius="2xl">
      <SectionHeader level="sub" icon={Icon} title={`${title} (${rows.length})`} />
      {rows.length === 0 ? <EmptyState compact title="No data" /> : (
        <div className="space-y-2.5 max-h-[520px] overflow-y-auto">
          {rows.map(r => (
            <div key={r.value}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm font-semibold text-text truncate">{r.value}</span>
                <span className="text-[11px] text-text-secondary flex-shrink-0">
                  <b style={{ color: 'var(--color-success-600)' }}>{r.active}</b> active · {r.total} total
                  {r.revenue > 0 && <> · <b style={{ color: 'var(--color-text)' }}>{money(r.revenue)}</b></>}
                  {r.expiring > 0 && <> · <b style={{ color: 'var(--color-warning-600)' }}>{r.expiring} exp</b></>}
                </span>
              </div>
              {/* proportional bar */}
              <div className="h-1.5 rounded-full overflow-hidden mb-1" style={{ background: 'var(--color-bg-secondary)' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.round((r.total / max) * 100)}%`, background: 'var(--color-primary-600)' }} />
              </div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(r.status).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                  <span key={s} className="text-[11px] sm:text-[10px] font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: statusColor(s) + '22', color: statusColor(s) }}>{pretty(s)} {n}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
