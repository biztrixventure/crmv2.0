import { useState, useEffect } from 'react';
import { Building2, BarChart3 } from 'lucide-react';
import client from '../../api/client';
import DateRangePicker, { getPresetRange } from '../UI/DateRangePicker';
import { TabHeader, Spinner, Empty } from './shared';
import CompanyReportModal from './CompanyReportModal';

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
  const [reportCo, setReportCo] = useState(null);   // company open in the report modal

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
            <CompanyCard key={c.id} company={c} onNavigate={onNavigate} onOpenReport={setReportCo} />
          ))}
        </div>
      )}

      {reportCo && <CompanyReportModal company={reportCo} onClose={() => setReportCo(null)} onNavigate={onNavigate} />}
    </div>
  );
};

const CompanyCard = ({ company: c, onNavigate, onOpenReport }) => {
  // A click anywhere on the card (except a metric/button) opens the full report.
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
  <div onClick={() => onOpenReport(c)} title="Open company report"
    className="rounded-2xl p-5 transition-shadow hover:shadow-lg cursor-pointer"
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
      <BarChart3 size={16} style={{ color: 'var(--color-text-tertiary)' }} title="Report" />
    </div>

    {/* Headline metrics — Approved sales first (what matters), then Pending +
        Users. Click a box to drill into those records. */}
    <div className="grid grid-cols-3 gap-2 mb-2.5">
      {[
        { label: 'Approved', val: c.completed_count ?? 0, color: '#16a34a', nav: ['sales', { company: c.id, status: 'closed_won' }] },
        { label: 'Pending',  val: c.pending_review_count ?? 0, color: c.pending_review_count > 0 ? '#d97706' : undefined, nav: ['sales', { company: c.id, status: 'pending_review' }] },
        { label: 'Users',    val: c.user_count ?? 0 },
      ].map(s => {
        const Tag = s.nav ? 'button' : 'div';
        return (
          <Tag key={s.label} type={s.nav ? 'button' : undefined}
            onClick={s.nav ? stop(() => onNavigate(s.nav[0], s.nav[1])) : undefined}
            title={s.nav ? `View ${s.label.toLowerCase()}` : undefined}
            className={`rounded-lg px-2 py-2 text-center w-full transition-colors ${s.nav ? 'cursor-pointer hover:shadow-sm' : ''}`}
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <p className="text-lg font-extrabold leading-none" style={{ color: s.color || 'var(--color-text)' }}>{s.val}</p>
            <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{s.label}</p>
          </Tag>
        );
      })}
    </div>

    {/* Secondary counts — Total / Transfers / Cancelled. */}
    <div className="flex items-center gap-1.5 flex-wrap mb-4">
      {[
        { label: 'Total Sales', val: c.sale_count ?? 0,      bg: '#dbeafe', fg: '#1e40af', nav: ['sales', { company: c.id }] },
        { label: 'Transfers',   val: c.transfer_count ?? 0,  bg: '#ede9fe', fg: '#6d28d9', nav: ['transfers', { company: c.id }] },
        { label: 'Cancelled',   val: c.cancelled_count ?? 0, bg: '#fee2e2', fg: '#991b1b', nav: ['sales', { company: c.id, status: 'cancelled' }] },
      ].map(s => (
        <button key={s.label} type="button" onClick={stop(() => onNavigate(s.nav[0], s.nav[1]))}
          title={`View ${s.label.toLowerCase()}`}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full cursor-pointer transition-transform hover:scale-105"
          style={{ backgroundColor: s.bg, color: s.fg }}>
          {s.label} <span className="font-bold">{s.val}</span>
        </button>
      ))}
    </div>

    {/* Actions */}
    <div className="flex gap-2">
      <button onClick={stop(() => onOpenReport(c))}
        className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white hover:opacity-90 transition-opacity inline-flex items-center justify-center gap-1.5"
        style={{ background: 'var(--gradient-sidebar)' }}>
        <BarChart3 size={13} /> Full Report
      </button>
      <button onClick={stop(() => onNavigate('sales', { company: c.id }))}
        className="flex-1 py-1.5 rounded-lg text-xs font-semibold border hover:opacity-80 transition-opacity"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
        View Sales
      </button>
    </div>
  </div>
  );
};

export default CompaniesTab;
