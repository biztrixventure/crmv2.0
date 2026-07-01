import { useState, useEffect } from 'react';
import { X, Building2, DollarSign, RefreshCw, TrendingUp, Users, Briefcase, CheckCircle2, Clock, XCircle, ArrowRight, Trophy } from 'lucide-react';
import client from '../../api/client';
import DateRangePicker, { getPresetRange } from '../UI/DateRangePicker';

const money = (n) => (n == null || isNaN(Number(n))) ? '$0' : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Deep-dive report for one company — funnel + agent leaderboard + per-client
// breakdown, all scoped to a date range chosen at the top. Fronter companies are
// measured by their fronters + the transfers they generated; closer companies by
// their closers + approvals.
export default function CompanyReportModal({ company, onClose, onNavigate }) {
  const [range, setRange] = useState(() => { const m = getPresetRange('month'); return { date_from: m.date_from || '', date_to: m.date_to || '' }; });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    client.get(`compliance/companies/${company.id}/report`, { params: { date_from: range.date_from || undefined, date_to: range.date_to || undefined } })
      .then(r => { if (alive) setData(r.data); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [company.id, range.date_from, range.date_to]);

  const isFronter = (data?.role_label || company.company_type) === 'fronter';
  const s = data?.sales || {};
  const nav = (view, params) => { onNavigate?.(view, params); onClose?.(); };

  const Kpi = ({ icon: Icon, label, value, color, onClick, sub }) => {
    const Tag = onClick ? 'button' : 'div';
    return (
      <Tag onClick={onClick} className={`rounded-xl border p-3 text-left w-full ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: color || 'var(--color-text-secondary)' }}><Icon size={13} /> {label}</div>
        <div className="text-2xl font-extrabold mt-0.5" style={{ color: 'var(--color-text)' }}>{value}</div>
        {sub && <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{sub}</div>}
      </Tag>
    );
  };

  const Leader = ({ title, icon: Icon, rows, empty }) => {
    const max = Math.max(1, ...rows.map(r => r.sales || 0));
    return (
      <div className="rounded-xl border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <Icon size={15} style={{ color: 'var(--color-primary-600)' }} />
          <h4 className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{title}</h4>
          <span className="text-xs ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>{rows.length}</span>
        </div>
        <div className="p-2 max-h-72 overflow-y-auto space-y-1">
          {rows.length === 0 ? <p className="text-xs text-center py-4" style={{ color: 'var(--color-text-tertiary)' }}>{empty}</p> : rows.map((r, i) => (
            <div key={i} className="px-2 py-1.5 rounded-lg" style={{ backgroundColor: i < 3 ? 'var(--color-bg-secondary)' : 'transparent' }}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-semibold truncate flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
                  {i < 3 && <Trophy size={12} style={{ color: ['#f59e0b', '#9ca3af', '#b45309'][i] }} />}{r.name}
                </span>
                <span className="flex items-center gap-2 flex-shrink-0 text-xs">
                  <span style={{ color: '#16a34a' }} title="Approved"><b>{r.approved}</b> won</span>
                  <span style={{ color: 'var(--color-text-tertiary)' }}>/ {r.sales}</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full mt-1 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                <div className="h-full" style={{ width: `${Math.round((r.approved / max) * 100)}%`, background: 'var(--gradient-sidebar)' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center items-start overflow-y-auto p-4" style={{ background: 'rgba(15,23,42,0.55)' }} onClick={onClose}>
      <div className="w-full max-w-4xl rounded-2xl my-4" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center gap-3 px-5 py-4 rounded-t-2xl" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}><Building2 size={20} className="text-white" /></div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white truncate">{company.name}</h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full capitalize" style={{ backgroundColor: 'rgba(255,255,255,0.22)', color: '#fff' }}>{data?.role_label || company.company_type} company</span>
          </div>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg bg-white/20 hover:bg-white/30"><X size={18} className="text-white" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* date selector on top */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Report period</span>
            <DateRangePicker value={range} defaultPreset="month"
              onChange={(r) => setRange({ date_from: r.date_from || '', date_to: r.date_to || '' })}
              onClear={() => setRange({ date_from: '', date_to: '' })} />
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
          ) : !data ? (
            <p className="text-center py-16" style={{ color: 'var(--color-text-tertiary)' }}>Could not load the report.</p>
          ) : (
            <>
              {/* funnel KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Kpi icon={CheckCircle2} label="Approved sales" value={s.approved} color="#16a34a" onClick={() => nav('sales', { company: company.id, status: 'closed_won' })} sub="closed won" />
                <Kpi icon={DollarSign} label="Total sales" value={s.total} onClick={() => nav('sales', { company: company.id })} />
                <Kpi icon={Clock} label="Pending review" value={s.pending} color={s.pending ? '#d97706' : undefined} onClick={() => nav('sales', { company: company.id, status: 'pending_review' })} />
                <Kpi icon={XCircle} label="Cancelled" value={s.cancelled} color="#dc2626" onClick={() => nav('sales', { company: company.id, status: 'cancelled' })} />
                <Kpi icon={ArrowRight} label={isFronter ? 'Transfers generated' : 'Transfers worked'} value={data.transfers_total} onClick={() => nav('transfers', { company: company.id })} />
                <Kpi icon={TrendingUp} label="Conversion" value={data.conversion_rate != null ? `${data.conversion_rate}%` : '—'} sub="approved / transfers" />
                <Kpi icon={DollarSign} label="Gross down pmts" value={money(s.gross_down_payment)} color="#16a34a" sub="approved sales" />
                <Kpi icon={RefreshCw} label="Monthly recurring" value={`${money(s.monthly_recurring)}/mo`} sub={`${s.resells} resells`} />
              </div>

              {/* leaderboards */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Leader title={isFronter ? 'Top fronters' : 'Top closers'} icon={isFronter ? Users : Trophy}
                  rows={data.agents} empty="No agent activity in this period." />
                <Leader title="Clients closed" icon={Briefcase} rows={data.clients} empty="No client sales in this period." />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
