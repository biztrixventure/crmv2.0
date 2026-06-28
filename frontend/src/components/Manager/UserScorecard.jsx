import { useEffect, useState } from 'react';
import { X, Send, DollarSign, CheckCircle, XCircle, Percent, TrendingUp } from 'lucide-react';
import client from '../../api/client';
import Tooltip from '../UI/Tooltip';

const initials = (n) => (n || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
const dayLabel = (d) => { const [, m, day] = (d || '').split('-'); return `${m}/${day}`; };
const RANGES = [{ d: 14, l: '14d' }, { d: 30, l: '30d' }, { d: 60, l: '60d' }];

const Kpi = ({ icon: Icon, label, value, tip, accent }) => (
  <Tooltip text={tip}>
    <div className="rounded-xl border px-3 py-2.5 cursor-help text-center"
      style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)' }}>
      <Icon size={14} className="mx-auto mb-1" style={{ color: accent }} />
      <div className="text-lg font-extrabold" style={{ color: 'var(--color-text)' }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{label}</div>
    </div>
  </Tooltip>
);

/**
 * UserScorecard — a teammate's personal performance, role-aware (fronter shows
 * created transfers + fronted sales; closer shows assigned transfers + closed
 * sales). Opened from the Team panel; data from /stats/user-performance.
 */
export default function UserScorecard({ user, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const uid = user?.id || user?.user_id;
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || 'Agent';

  useEffect(() => {
    if (!uid) return;
    let alive = true; setLoading(true);
    client.get(`stats/user-performance/${uid}`, { params: { days } })
      .then(r => { if (alive) setData(r.data); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [uid, days]);

  const t = data?.totals || {};
  const daily = data?.daily || [];
  const max = Math.max(1, ...daily.map(d => Math.max(d.transfers, d.sales)));
  const side = data?.side;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border max-h-[90vh] overflow-y-auto" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }} onClick={e => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center justify-between gap-3 p-5 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>{initials(name)}</div>
            <div className="min-w-0">
              <h3 className="text-lg font-extrabold truncate" style={{ color: 'var(--color-text)' }}>{name}</h3>
              <p className="text-xs capitalize" style={{ color: 'var(--color-text-secondary)' }}>
                {(data?.user?.role || user?.role_level || '').replace(/_/g, ' ') || 'agent'}
                {side && <span className="ml-1" style={{ color: 'var(--color-text-tertiary)' }}>· {side} metrics</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 p-0.5 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
              {RANGES.map(r => (
                <button key={r.d} onClick={() => setDays(r.d)} className="px-2 py-1 rounded-md text-xs font-semibold"
                  style={{ backgroundColor: days === r.d ? 'var(--color-surface)' : 'transparent', color: days === r.d ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>{r.l}</button>
              ))}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-secondary"><X size={18} style={{ color: 'var(--color-text-secondary)' }} /></button>
          </div>
        </div>

        {/* body */}
        <div className="p-5 space-y-5">
          {loading ? (
            <div className="h-40 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--color-bg-secondary)' }} />
          ) : !data ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>Couldn't load this user's performance.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                <Kpi icon={Send} label={side === 'fronter' ? 'Transfers' : 'Assigned'} value={t.transfers} accent="#3b82f6"
                  tip={side === 'fronter' ? 'Transfers this fronter created' : 'Transfers assigned to this closer'} />
                <Kpi icon={DollarSign} label="Sales" value={t.sales} accent="#16a34a"
                  tip={side === 'fronter' ? 'Sales this fronter is credited on' : 'Sales this closer made'} />
                <Kpi icon={CheckCircle} label="Approved" value={t.won} accent="#10b981" tip="Of those, approved by compliance" />
                <Kpi icon={XCircle} label="Cancelled" value={t.cancellations} accent="#dc2626" tip="Of those, later cancelled" />
                <Kpi icon={Percent} label="Conversion" value={t.conversion == null ? '—' : `${t.conversion}%`} accent="#7c3aed" tip={t.conversion == null ? 'Not computable — more sales than transfers (e.g. bulk-imported sales)' : 'Sales ÷ transfers for this user'} />
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
                  <TrendingUp size={13} /> Daily Activity · last {days}d
                </div>
                <div className="flex items-center gap-4 mb-2 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#3b82f6' }} /> Transfers</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#16a34a' }} /> Sales</span>
                </div>
                <div className="flex items-end gap-1 h-40 border-b" style={{ borderColor: 'var(--color-border)' }}>
                  {daily.map(d => (
                    <Tooltip key={d.date} text={`${d.date} — ${d.transfers} transfers · ${d.sales} sales`} className="flex-1 h-full">
                      <div className="flex-1 h-full flex items-end justify-center gap-[2px] cursor-help rounded-t hover:bg-[var(--color-bg-secondary)] px-[1px]">
                        <div style={{ height: `${(d.transfers / max) * 100}%`, minHeight: d.transfers ? 3 : 0, width: 6, backgroundColor: '#3b82f6', borderRadius: '2px 2px 0 0' }} />
                        <div style={{ height: `${(d.sales / max) * 100}%`, minHeight: d.sales ? 3 : 0, width: 6, backgroundColor: '#16a34a', borderRadius: '2px 2px 0 0' }} />
                      </div>
                    </Tooltip>
                  ))}
                </div>
                <div className="flex gap-1 mt-1">
                  {daily.map((d, i) => (
                    <span key={d.date} className="flex-1 text-center text-[8px]" style={{ color: 'var(--color-text-tertiary)' }}>
                      {i % Math.ceil(daily.length / 10) === 0 ? dayLabel(d.date) : ''}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
