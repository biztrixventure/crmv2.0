import { useState, useEffect } from 'react';
import { Building2 } from 'lucide-react';
import client from '../../api/client';
import DateRangePicker from '../UI/DateRangePicker';
import { TabHeader, Spinner, Empty } from './shared';

// Compact money label: $0 / $850 / $1.2k / $14k — keeps the KPI card tight.
const fmtMoney = (n) => {
  const v = Number(n) || 0;
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(v)}`;
};

// Overview of every company with live KPI counts. The date range filters the
// time-based KPIs (Sales / Pending / Transfers) to the selected window via the
// backend; User headcount is a live total and stays unfiltered. The shared
// companyList prop (used for dropdowns elsewhere) is never mutated — when a
// range is active we fetch our own date-scoped copy.
const CompaniesTab = ({ companyList, loading, onRefresh, onNavigate }) => {
  const [range, setRange]       = useState({ date_from: '', date_to: '' });
  const [rows, setRows]         = useState(null);   // date-filtered copy (null = use companyList)
  const [fetching, setFetching] = useState(false);

  const hasRange = !!(range.date_from || range.date_to);

  useEffect(() => {
    if (!hasRange) { setRows(null); return; }
    let cancelled = false;
    setFetching(true);
    client.get('compliance/companies', { params: { date_from: range.date_from || undefined, date_to: range.date_to || undefined } })
      .then(r => { if (!cancelled) setRows(r.data.companies || []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setFetching(false); });
    return () => { cancelled = true; };
  }, [range.date_from, range.date_to, hasRange]);

  const shown = hasRange ? (rows || []) : companyList;
  const busy  = hasRange ? fetching : loading;

  return (
    <div>
      <TabHeader
        title="All Companies"
        subtitle={`${companyList.length} companies on platform${hasRange ? ' · KPIs filtered by date' : ''}`}
        onRefresh={onRefresh}
        extra={
          <DateRangePicker
            value={range}
            defaultPreset="all"
            onChange={(r) => setRange({ date_from: r.date_from || '', date_to: r.date_to || '' })}
            onClear={() => setRange({ date_from: '', date_to: '' })}
          />
        }
      />

      {busy ? <Spinner /> : shown.length === 0 ? (
        <Empty icon={Building2} msg="No companies found." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map(c => (
            <CompanyCard key={c.id} company={c} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
};

const CompanyCard = ({ company: c, onNavigate }) => (
  <div className="rounded-2xl p-5 transition-shadow hover:shadow-md"
    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

    {/* Header */}
    <div className="flex items-start gap-3 mb-4">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'var(--gradient-sidebar)' }}>
        <Building2 size={18} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold truncate" style={{ color: 'var(--color-text)' }}>{c.name}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold capitalize"
            style={{
              backgroundColor: c.company_type === 'fronter' ? '#dbeafe' : '#dcfce7',
              color: c.company_type === 'fronter' ? '#1e40af' : '#166534',
            }}>
            {c.company_type || 'unknown'}
          </span>
          {!c.is_active && (
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>Inactive</span>
          )}
        </div>
      </div>
    </div>

    {/* Stats — compact label/value rows (denser than the old big tiles). */}
    <div className="grid grid-cols-2 gap-x-2.5 gap-y-1.5 mb-2.5">
      {[
        { label: 'Users',     val: c.user_count },
        { label: 'Transfers', val: c.transfer_count ?? 0 },
        { label: 'Sales',     val: c.sale_count, strong: true },
        { label: 'Pending',   val: c.pending_review_count, color: c.pending_review_count > 0 ? '#d97706' : undefined },
      ].map(s => (
        <div key={s.label} className="flex items-center justify-between rounded-lg px-2.5 py-1.5"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{s.label}</span>
          <span className={`${s.strong ? 'text-base' : 'text-sm'} font-bold`} style={{ color: s.color || 'var(--color-text)' }}>{s.val}</span>
        </div>
      ))}
    </div>

    {/* Sales breakdown — completed / cancelled / gross, packed into one row. */}
    <div className="flex items-center gap-1.5 flex-wrap mb-4">
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full"
        style={{ backgroundColor: '#dcfce7', color: '#166534' }} title="Completed (approved) sales">
        ✓ {c.completed_count ?? 0} done
      </span>
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full"
        style={{ backgroundColor: '#fee2e2', color: '#991b1b' }} title="Cancelled sales">
        ✕ {c.cancelled_count ?? 0} cancelled
      </span>
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full"
        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
        title="Gross sales value (sum of down payments)">
        {fmtMoney(c.gross_value)} gross
      </span>
    </div>

    {/* Actions */}
    <div className="flex gap-2">
      <button
        onClick={() => onNavigate('sales', { company: c.id })}
        className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white hover:opacity-90 transition-opacity"
        style={{ background: 'var(--gradient-sidebar)' }}>
        View Sales
      </button>
      <button
        onClick={() => onNavigate('transfers', { company: c.id })}
        className="flex-1 py-1.5 rounded-lg text-xs font-semibold border hover:opacity-80 transition-opacity"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
        Transfers
      </button>
    </div>
  </div>
);

export default CompaniesTab;
