// ============================================================================
// PayoutTab — SuperAdmin "Payouts" sidebar tab.
//
// Worklist = every sale compliance has ever approved (backend: GET /payouts,
// scoped to compliance_reviewed_at IS NOT NULL), whether it's still Approved
// or was later Cancelled — the Status column shows whichever is current,
// rendered identically to the Compliance Sales tab (same SaleStatusBadge +
// paid-tenure chip). Payout Status is a separate, editable lifecycle
// (pending → paid / reverted) tracked only here.
// ============================================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { Layers, Clock, CheckCircle2, Undo2, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../../api/client';
import SaleStatusBadge from '../../UI/SaleStatusBadge';
import SaleDetailDrawer from '../../Shared/SaleDetailDrawer';
import ThemedSelect from '../../UI/Select';
import FilterBar, { FilterSelect } from '../../UI/FilterBar';
import { TableScroll, KpiTile } from '../../UI/kit';
import { TabHeader, Spinner, Empty, Pagination, TqTh, ActiveFilters } from '../../Compliance/shared';
import { fmtSaleDate } from '../../../utils/timezone';
import { salePaidTenure } from '../../../utils/saleTenure';
import { useFilterOptions } from '../../../hooks/useFilterOptions';
import useTableQuery, { useAbortable, isCanceled } from '../../../hooks/useTableQuery';
import { useComplianceStatuses } from '../../../hooks/useComplianceStatuses';
import { writeExport, fetchAllForExport } from '../../../utils/exportSpec';
import { buildFilename } from '../../../utils/downloadFilename';
import { useFeatureFlags } from '../../../contexts/FeatureFlagsContext';

const LIMIT = 30;
const PAYOUT_STATUSES = ['pending', 'paid', 'reverted'];
const PAYOUT_LABEL = { pending: 'Pending', paid: 'Paid', reverted: 'Reverted' };
const PAYOUT_STATUS_OPTIONS = PAYOUT_STATUSES.map(s => ({ value: s, label: PAYOUT_LABEL[s] }));

const money = (v) => (v == null || v === '' ? '$0' : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

export default function PayoutTab() {
  const [companies, setCompanies] = useState([]);
  useEffect(() => { client.get('companies').then(r => setCompanies(r.data.companies || [])).catch(() => {}); }, []);
  const { clientOptions } = useFilterOptions({ companyList: companies });
  const { allStatuses, labelOf } = useComplianceStatuses();
  const { isEnabled } = useFeatureFlags();

  const [sales, setSales] = useState([]);
  const [total, setTotal] = useState(0);
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [company, setCompany] = useState('');
  const [clientName, setClientName] = useState('');
  const [payoutStatus, setPayoutStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [detailSale, setDetailSale] = useState(null);
  const [savingId, setSavingId] = useState(null);

  // Click-a-column-header sort + filter — same primitive every other list in
  // the app uses. `columns` starts empty and is filled in from the server's
  // response, so a header offers exactly what the backend will honour.
  const [columns, setColumns] = useState({});
  const tq = useTableQuery({
    scope: 'admin:payouts',
    columns,
    defaultSort: { by: 'sale_date', dir: 'desc' },
  });
  const statusOptions = allStatuses.map(s => ({ value: s, label: labelOf(s) }));

  const abortable = useAbortable();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('payouts', {
        params: {
          search: search || undefined,
          company_id: company || undefined,
          client_name: clientName || undefined,
          payout_status: payoutStatus || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          // sort_by / sort_dir / filters — all resolved by useTableQuery.
          ...tq.params,
          page, limit: LIMIT,
        },
        signal: abortable(),
      });
      setLoadError('');
      setSales(res.data.sales || []);
      setTotal(res.data.total || 0);
      setKpis(res.data.kpis || null);
      if (res.data.columns) setColumns(res.data.columns);
    } catch (e) {
      if (isCanceled(e)) return;
      const httpStatus = e.response?.status;
      setLoadError(e.response?.data?.error || (httpStatus ? `the server returned ${httpStatus}` : (e.message || 'the request failed')));
    } finally { setLoading(false); }
  }, [search, company, clientName, payoutStatus, dateFrom, dateTo, page, tq.version, tq.params, abortable]);

  useEffect(() => { load(); }, [load]);

  // A new column sort or filter re-windows the whole dataset — page 2 of the
  // old result is meaningless, so jump back to page 1.
  const firstQuery = useRef(true);
  useEffect(() => {
    if (firstQuery.current) { firstQuery.current = false; return; }
    setPage(1);
  }, [tq.version]);

  const patchPayout = async (sale, next) => {
    const prev = sale.payout_status;
    setSales(list => list.map(x => x.id === sale.id ? { ...x, payout_status: next } : x));
    setSavingId(sale.id);
    try {
      await client.patch(`payouts/${sale.id}`, { payout_status: next });
      load();   // resync KPI sums against the new bucket
    } catch (err) {
      setSales(list => list.map(x => x.id === sale.id ? { ...x, payout_status: prev } : x));
      toast.error(err.response?.data?.error || 'Failed to update payout status');
    } finally { setSavingId(null); }
  };

  // Both exports honor the same top filters shown on screen (search / company /
  // client / payout status / date range) — not the per-column header filters,
  // matching how every other tab's CSV export works (e.g. SalesTab.jsx).
  const exportParams = () => ({
    search: search || undefined,
    company_id: company || undefined,
    client_name: clientName || undefined,
    payout_status: payoutStatus || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  });
  const companyScopeName = () => companies.find(c => c.id === company)?.name || '';

  const [exporting, setExporting] = useState('');
  const handleExportCsv = async () => {
    if (exporting) return;
    setExporting('csv');
    try {
      const rows = await fetchAllForExport('payouts', exportParams(), 'sales', undefined, 'sales');
      writeExport({
        dataset: 'sales', surface: 'payout_sales', allowed: null,
        rows, ctx: { labelOf },
        filename: buildFilename({ dataset: 'payouts', scope: companyScopeName(), dateFrom, dateTo }),
      });
    } catch (err) {
      toast.error(err.egressBlocked ? err.message : 'Failed to export CSV');
    } finally { setExporting(''); }
  };
  const handleExportPdf = async () => {
    if (exporting) return;
    setExporting('pdf');
    try {
      const rows = await fetchAllForExport('payouts', exportParams(), 'sales', undefined, 'sales');
      const { exportPayoutReportPdf } = await import('../../../utils/payoutReportPdf');
      exportPayoutReportPdf({
        rows, kpis, labelOf,
        filters: { date_from: dateFrom, date_to: dateTo, payout_status: payoutStatus },
        companyName: companyScopeName(),
      });
    } catch (err) {
      toast.error(err.egressBlocked ? err.message : 'Could not build the PDF');
    } finally { setExporting(''); }
  };

  const kpiTiles = [
    { key: 'pending',  label: 'Pending',  tone: 'warn',    icon: Clock },
    { key: 'paid',     label: 'Paid',     tone: 'success', icon: CheckCircle2 },
    { key: 'reverted', label: 'Reverted', tone: 'danger',  icon: Undo2 },
  ];
  const totalGross = kpiTiles.reduce((sum, t) => sum + (kpis?.[t.key]?.gross || 0), 0);

  return (
    <div>
      <TabHeader
        title="Payouts"
        subtitle="Every compliance-approved sale, with its payout status — pending, paid, or reverted."
        onRefresh={() => { setPage(1); load(); }}
        onExport={handleExportCsv}
        extra={
          isEnabled('exports') && (
            <button onClick={handleExportPdf} disabled={!!exporting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold border transition-colors disabled:opacity-60"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)' }}>
              <FileDown size={13} /> {exporting === 'pdf' ? 'Building…' : 'Export PDF (A4)'}
            </button>
          )
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KpiTile icon={Layers} label="All approved" value={money(totalGross)}
          sub={`${total.toLocaleString()} sale${total === 1 ? '' : 's'}`}
          tone="primary" active={!payoutStatus}
          onClick={() => { setPayoutStatus(''); setPage(1); }} />
        {kpiTiles.map(t => (
          <KpiTile key={t.key} icon={t.icon} label={t.label}
            value={money(kpis?.[t.key]?.gross)}
            sub={`${(kpis?.[t.key]?.count || 0).toLocaleString()} sale${(kpis?.[t.key]?.count || 0) === 1 ? '' : 's'}`}
            tone={t.tone} active={payoutStatus === t.key}
            onClick={() => { setPayoutStatus(payoutStatus === t.key ? '' : t.key); setPage(1); }} />
        ))}
      </div>

      <FilterBar
        search={{
          value: search,
          onChange: (v) => { setSearch(v); setPage(1); },
          placeholder: 'Search — customer name, phone, reference…',
        }}
        dateRange={{
          value: { date_from: dateFrom, date_to: dateTo },
          onChange: (r) => { setDateFrom(r.date_from || ''); setDateTo(r.date_to || ''); setPage(1); },
          defaultPreset: 'all',
        }}
        extras={
          <>
            <FilterSelect value={clientName} onChange={e => { setClientName(e.target.value); setPage(1); }} title="Filter by client">
              <option value="">All clients</option>
              {clientOptions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </FilterSelect>
            <FilterSelect value={company} onChange={e => { setCompany(e.target.value); setPage(1); }} title="Filter by company">
              <option value="">All companies</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </FilterSelect>
          </>
        }
        onClearAll={() => {
          setSearch(''); setCompany(''); setClientName(''); setPayoutStatus('');
          setDateFrom(''); setDateTo(''); setPage(1);
          tq.clearAll();
        }}
      />

      <ActiveFilters tq={tq} />

      {loadError && (
        <div className="flex items-center gap-2 flex-wrap mb-3 px-3 py-2 rounded-xl text-xs font-semibold"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-error-600) 8%, transparent)', color: 'var(--color-error-600)', border: '1px solid color-mix(in srgb, var(--color-error-600) 30%, transparent)' }}>
          <span>Could not load payouts — {loadError}</span>
          <button onClick={load} className="px-2 py-0.5 rounded-full font-bold"
            style={{ border: '1px solid color-mix(in srgb, var(--color-error-600) 40%, transparent)' }}>Retry</button>
        </div>
      )}

      <div className="rounded-xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {loading ? <Spinner /> : sales.length === 0 ? (
          <Empty
            msg={loadError ? 'The list could not be loaded.' : 'No approved sales match the current filters.'}
            hint={loadError ? 'This is a load failure, not an empty result — the records are still there.'
              : (search || company || clientName || payoutStatus || dateFrom || dateTo)
                ? 'Search, client, company, payout, or date filters are active above.'
                : 'Sales appear here automatically once compliance approves them.'}
          />
        ) : (
          <TableScroll stickyFirst inheritRowBg label="Payouts">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <TqTh tq={tq} col="sale_date">Sale Date</TqTh>
                  <TqTh tq={tq} col="customer_phone">Phone Number</TqTh>
                  <TqTh tq={tq} col="customer">Customer Name</TqTh>
                  <TqTh tq={tq} col="client_name" options={clientOptions}>Client Name</TqTh>
                  <TqTh tq={tq} col="down_payment" align="right">Down Payment</TqTh>
                  <TqTh tq={tq} col="plan">Plan Name</TqTh>
                  <TqTh tq={tq} col="status" options={statusOptions}>Status</TqTh>
                  <TqTh tq={tq} col="payout_status" options={PAYOUT_STATUS_OPTIONS}>Payout Status</TqTh>
                </tr>
              </thead>
              <tbody>
                {sales.map(s => (
                  <tr key={s.id} className="cursor-pointer"
                    style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                    onClick={() => setDetailSale(s)}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--color-surface)'}>
                    <td className="px-3 py-1.5 text-xs whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>
                      {s.sale_date ? fmtSaleDate(s.sale_date) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{s.customer_phone || '—'}</td>
                    <td className="px-3 py-1.5 font-semibold" style={{ color: 'var(--color-text)' }}>{s.customer_name || '—'}</td>
                    <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{s.client_name || '—'}</td>
                    <td className="px-3 py-1.5 text-xs text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{money(s.down_payment)}</td>
                    <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{s.plan || '—'}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <SaleStatusBadge sale={s} size="sm" />
                        {(() => { const t = salePaidTenure(s); return t ? (
                          <span title={`Kept paying ${t.label} — sale ${fmtSaleDate(s.sale_date)} → cancelled ${fmtSaleDate(s.cancellation_date)}`}
                            className="inline-flex items-center text-[11px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                            style={{ backgroundColor: '#fef3c7', color: '#b45309' }}>
                            paid {t.short}
                          </span>
                        ) : null; })()}
                      </div>
                    </td>
                    <td className="px-3 py-1.5" onClick={e => e.stopPropagation()}>
                      <ThemedSelect
                        value={s.payout_status || 'pending'}
                        disabled={savingId === s.id}
                        onChange={e => patchPayout(s, e.target.value)}
                        className="text-xs w-32"
                        style={{ opacity: savingId === s.id ? 0.6 : 1 }}>
                        {PAYOUT_STATUSES.map(st => <option key={st} value={st}>{PAYOUT_LABEL[st]}</option>)}
                      </ThemedSelect>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        <Pagination page={page} total={total} limit={LIMIT} onPage={setPage} />
      </div>

      <SaleDetailDrawer sale={detailSale} onClose={() => setDetailSale(null)} />
    </div>
  );
}
