import { useState, useEffect } from 'react';
import { Building2 } from 'lucide-react';
import client from '../../api/client';
import DateRangePicker, { getPresetRange } from '../UI/DateRangePicker';
import { TabHeader, Spinner, Empty } from './shared';

// Overview of every company with live KPI counts. The date range filters the
// time-based KPIs (Sales / Pending / Transfers) to the selected window via the
// backend; User headcount is a live total and stays unfiltered. The shared
// companyList prop (used for dropdowns elsewhere) is never mutated — when a
// range is active we fetch our own date-scoped copy.
const CompaniesTab = ({ companyList, loading, onRefresh, onNavigate }) => {
  // Default to THIS MONTH (first of month → today) instead of all-time.
  const [range, setRange]       = useState(() => { const m = getPresetRange('month'); return { date_from: m.date_from || '', date_to: m.date_to || '' }; });
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
            defaultPreset="month"
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

    {/* Operational counts — Users / Transfers / Pending. Click a number to
        drill into the matching records. */}
    <div className="grid grid-cols-3 gap-2 mb-2.5">
      {[
        { label: 'Users',     val: c.user_count },
        { label: 'Transfers', val: c.transfer_count ?? 0,   nav: ['transfers', { company: c.id }] },
        { label: 'Pending',   val: c.pending_review_count,  color: c.pending_review_count > 0 ? '#d97706' : undefined, nav: ['sales', { company: c.id, status: 'pending_review' }] },
      ].map(s => {
        const Tag = s.nav ? 'button' : 'div';
        return (
          <Tag key={s.label} type={s.nav ? 'button' : undefined}
            onClick={s.nav ? () => onNavigate(s.nav[0], s.nav[1]) : undefined}
            title={s.nav ? `View ${s.label.toLowerCase()}` : undefined}
            className={`rounded-lg px-2 py-1.5 text-center w-full transition-colors ${s.nav ? 'cursor-pointer hover:shadow-sm' : ''}`}
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: `1px solid ${s.nav ? 'var(--color-border)' : 'var(--color-border)'}` }}>
            <p className="text-base font-bold leading-none" style={{ color: s.color || 'var(--color-text)' }}>{s.val}</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{s.label}</p>
          </Tag>
        );
      })}
    </div>

    {/* Sales status capsules — Total / Approved / Cancelled, accurate filtered
        counts (no gross), styled like the other status capsules. */}
    <div className="flex items-center gap-1.5 flex-wrap mb-4">
      {[
        { label: 'Total Sales',     val: c.sale_count ?? 0,      bg: '#dbeafe', fg: '#1e40af', nav: ['sales', { company: c.id }] },
        { label: 'Approved Sales',  val: c.completed_count ?? 0, bg: '#dcfce7', fg: '#166534', nav: ['sales', { company: c.id, status: 'closed_won' }] },
        { label: 'Cancelled Sales', val: c.cancelled_count ?? 0, bg: '#fee2e2', fg: '#991b1b', nav: ['sales', { company: c.id, status: 'cancelled' }] },
      ].map(s => (
        <button key={s.label} type="button" onClick={() => onNavigate(s.nav[0], s.nav[1])}
          title={`View ${s.label.toLowerCase()}`}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full cursor-pointer transition-transform hover:scale-105"
          style={{ backgroundColor: s.bg, color: s.fg }}>
          {s.label} <span className="font-bold">{s.val}</span>
        </button>
      ))}
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
