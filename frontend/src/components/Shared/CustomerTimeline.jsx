import { useEffect, useState } from 'react';
import {
  Phone, ArrowRightLeft, UserCheck, DollarSign, Clock, CheckCircle2,
  RotateCcw, XCircle, Archive, CalendarClock, AlertTriangle, RefreshCw, Repeat,
} from 'lucide-react';
import client from '../../api/client';

// Unified lead -> policy lifetime timeline. Self-contained: give it a phone,
// it pulls /sales/timeline/by-phone (role-scoped server-side) and renders one
// chronological feed merging leads (transfers), the transfer chain
// (transfer_assignments), and policy lifecycle (policy_events).

const KIND_STYLE = {
  lead_created:     { icon: Phone,         color: '#2563eb', bg: '#eff6ff', label: 'Lead' },
  lead_assigned:    { icon: UserCheck,     color: '#2563eb', bg: '#eff6ff', label: 'Assigned' },
  lead_transferred: { icon: ArrowRightLeft,color: '#7c3aed', bg: '#f5f3ff', label: 'Transfer' },
  sold:             { icon: DollarSign,    color: '#16a34a', bg: '#f0fdf4', label: 'Sold' },
  renewed:          { icon: RefreshCw,     color: '#16a34a', bg: '#f0fdf4', label: 'Renewed' },
  replaced:         { icon: Repeat,        color: '#16a34a', bg: '#f0fdf4', label: 'Replaced' },
  resold:           { icon: Repeat,        color: '#16a34a', bg: '#f0fdf4', label: 'Resold' },
  submitted:        { icon: Clock,         color: '#d97706', bg: '#fffbeb', label: 'Review' },
  approved:         { icon: CheckCircle2,  color: '#16a34a', bg: '#f0fdf4', label: 'Approved' },
  returned:         { icon: RotateCcw,     color: '#dc2626', bg: '#fef2f2', label: 'Returned' },
  cancelled:        { icon: XCircle,       color: '#dc2626', bg: '#fef2f2', label: 'Cancelled' },
  reinstated:       { icon: RefreshCw,     color: '#16a34a', bg: '#f0fdf4', label: 'Reinstated' },
  superseded:       { icon: Archive,       color: '#6b7280', bg: '#f9fafb', label: 'Retired' },
  expired:          { icon: Archive,       color: '#6b7280', bg: '#f9fafb', label: 'Expired' },
  lost:             { icon: XCircle,       color: '#dc2626', bg: '#fef2f2', label: 'Lost' },
  chargeback:       { icon: AlertTriangle, color: '#dc2626', bg: '#fef2f2', label: 'Chargeback' },
  charged:          { icon: CalendarClock, color: '#4f46e5', bg: '#eef2ff', label: 'Charged' },
  post_dated:       { icon: CalendarClock, color: '#4f46e5', bg: '#eef2ff', label: 'Post-date' },
};
const FALLBACK = { icon: Clock, color: '#6b7280', bg: '#f9fafb', label: '' };

const fmt = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso).slice(0, 10);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const Chip = ({ label, value, color }) => (
  <div className="flex flex-col items-center px-3 py-1.5 rounded-lg"
    style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', minWidth: 64 }}>
    <span className="text-sm font-bold leading-none" style={{ color: color || 'var(--color-text)' }}>{value}</span>
    <span className="text-[10px] uppercase tracking-wide mt-1" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
  </div>
);

export default function CustomerTimeline({ phone, currentRef = null }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | done | error

  useEffect(() => {
    if (!phone) { setData(null); setState('idle'); return; }
    let cancelled = false;
    setState('loading');
    client.get(`sales/timeline/by-phone/${encodeURIComponent(phone)}`)
      .then(r => { if (!cancelled) { setData(r.data || null); setState('done'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [phone]);

  if (state === 'idle' || state === 'error') return null;
  if (state === 'loading') {
    return (
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-primary-600)' }}>
          Customer Lifetime Timeline
        </p>
        <div className="rounded-xl px-4 py-6 flex items-center justify-center gap-2"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <RefreshCw size={14} className="animate-spin" style={{ color: 'var(--color-text-secondary)' }} />
          <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Building timeline…</span>
        </div>
      </div>
    );
  }

  const timeline = Array.isArray(data?.timeline) ? data.timeline : [];
  const s = data?.summary || {};
  if (timeline.length === 0) return null;

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-primary-600)' }}>
          Customer Lifetime Timeline
        </p>
        <span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
          {timeline.length} event{timeline.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 mb-3">
        <Chip label="Leads"    value={s.leads ?? 0} color="#2563eb" />
        <Chip label="Sales"    value={s.sales ?? 0} />
        <Chip label="Active"   value={s.active ?? 0} color="#16a34a" />
        {s.cancelled > 0  && <Chip label="Cancelled"  value={s.cancelled}  color="#dc2626" />}
        {s.superseded > 0 && <Chip label="Retired"    value={s.superseded} color="#6b7280" />}
        {s.companies > 1  && <Chip label="Companies"  value={s.companies}  color="#7c3aed" />}
      </div>

      {/* Vertical timeline */}
      <div className="relative pl-1">
        {timeline.map((ev, i) => {
          const st = KIND_STYLE[ev.kind] || FALLBACK;
          const Icon = st.icon;
          const isCurrent = currentRef && ev.ref && ev.ref === currentRef;
          const last = i === timeline.length - 1;
          return (
            <div key={i} className="flex gap-3 relative">
              {/* connector + dot */}
              <div className="flex flex-col items-center" style={{ width: 26 }}>
                <div className="flex items-center justify-center rounded-full flex-shrink-0"
                  style={{ width: 26, height: 26, backgroundColor: st.bg, border: `1.5px solid ${st.color}` }}>
                  <Icon size={13} style={{ color: st.color }} strokeWidth={2.4} />
                </div>
                {!last && <div className="flex-1 w-px my-0.5" style={{ backgroundColor: 'var(--color-border)', minHeight: 14 }} />}
              </div>

              {/* card */}
              <div className="flex-1 pb-3 min-w-0">
                <div className="rounded-lg px-3 py-2"
                  style={{
                    backgroundColor: isCurrent ? 'var(--color-primary-50, #eef2ff)' : 'var(--color-bg-secondary)',
                    border: `1px solid ${isCurrent ? 'var(--color-primary-300, #c7d2fe)' : 'var(--color-border)'}`,
                  }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{ev.title}</span>
                    {ev.ref && (
                      <code className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
                        {String(ev.ref).toUpperCase()}
                      </code>
                    )}
                    <span className="text-[10px] ml-auto whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>
                      {fmt(ev.at)}
                    </span>
                  </div>
                  {(ev.detail || ev.actor) && (
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {ev.detail && (
                        <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{ev.detail}</span>
                      )}
                      {ev.actor && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                          style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
                          {ev.actor}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
