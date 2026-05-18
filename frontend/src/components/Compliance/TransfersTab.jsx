import { useState, useCallback, useEffect } from 'react';
import { ArrowRight, AlertTriangle, CalendarDays, X } from 'lucide-react';
import { getTransferDisplayStatus } from '../../utils/transferStatus';
import { todayET } from '../../utils/timezone';

const SALE_BADGE_MAP  = { open: 'info', pending_review: 'warning', needs_revision: 'error', closed_won: 'success', sold: 'success', closed_lost: 'error', follow_up: 'warning', cancelled: 'error' };
const SALE_LABEL_MAP  = { open: 'Sale Open', pending_review: 'In Review', needs_revision: 'Needs Revision', closed_won: 'Approved', sold: 'Sold', closed_lost: 'Lost', follow_up: 'Follow Up', cancelled: 'Cancelled' };
import { Badge } from '../UI';
import client from '../../api/client';
import ExportModal from './ExportModal';
import {
  STATUS_BADGE, STATUS_LABEL, TRANSFER_STATUSES, LIMIT,
  fmtDate, fmtDateTime, customerName, downloadCSV,
  TabHeader, Spinner, Empty, Pagination, Th, Filters, FInput, FSelect,
  Overlay, ModalBox, ModalHeader, InfoTile,
} from './shared';

const TransfersTab = ({ companyList, initCompany = '' }) => {
  const [transfers, setTransfers] = useState([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [page, setPage]           = useState(1);
  const [status, setStatus]       = useState('');
  const [company, setCompany]     = useState(initCompany);
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');

  const [detail, setDetail]         = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [todayCount, setTodayCount] = useState(null);

  const today         = todayET();
  const isTodayActive = dateFrom === today && dateTo === today;

  useEffect(() => {
    const params = { date_from: today, date_to: today, limit: 1, page: 1 };
    if (initCompany) params.company_id = initCompany;
    client.get('compliance/transfers', { params })
      .then(r => setTodayCount(r.data.total ?? 0))
      .catch(() => {});
  }, [initCompany, today]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('compliance/transfers', {
        params: {
          status: status || undefined, company_id: company || undefined,
          date_from: dateFrom || undefined, date_to: dateTo || undefined,
          page, limit: LIMIT,
        },
      });
      setTransfers(res.data.transfers || []);
      setTotal(res.data.total || 0);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [status, company, dateFrom, dateTo, page]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async ({ dateFrom: df, dateTo: dt, company: co, userIds }) => {
    const res = await client.get('compliance/transfers', {
      params: { date_from: df || undefined, date_to: dt || undefined, company_id: co || undefined, user_ids: userIds.length ? userIds.join(',') : undefined, limit: 5000, page: 1 },
    });
    const rows = (res.data.transfers || []).map(t => [
      customerName(t), t.form_data?.Phone || '',
      t.created_by_name || '', t.assigned_closer_name || '',
      t.company_name || '', STATUS_LABEL[t.status] || t.status || '',
      fmtDate(t.created_at),
    ]);
    downloadCSV(rows, ['Customer','Phone','Created By','Assigned Closer','Company','Status','Created'],
      `transfers_${todayET()}.csv`);
  };

  return (
    <div>
      <TabHeader
        title="All Transfers"
        subtitle="Read-only view of lead transfers across all companies"
        onRefresh={() => { setPage(1); load(); }}
        onExport={() => setExportOpen(true)}
      />

      {/* Today created chip */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          onClick={() => { if (isTodayActive) { setDateFrom(''); setDateTo(''); } else { setDateFrom(today); setDateTo(today); } setPage(1); }}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
          style={{
            backgroundColor: isTodayActive ? '#eff6ff' : 'var(--color-bg-secondary)',
            color:            isTodayActive ? '#2563eb' : 'var(--color-text-secondary)',
            borderColor:      isTodayActive ? '#bfdbfe' : 'var(--color-border)',
          }}>
          <CalendarDays size={12} />
          Created Today
          {todayCount !== null && (
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold"
              style={{ backgroundColor: isTodayActive ? '#bfdbfe' : 'var(--color-border)', color: isTodayActive ? '#1d4ed8' : 'var(--color-text-secondary)' }}>
              {todayCount}
            </span>
          )}
          {isTodayActive && <X size={10} />}
        </button>
      </div>

      <Filters onSubmit={() => { setPage(1); load(); }}>
        <FSelect label="Company" value={company} onChange={e => setCompany(e.target.value)}>
          <option value="">All companies</option>
          {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FSelect>
        <FSelect label="Status" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {TRANSFER_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
        </FSelect>
        <FInput label="From" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <FInput label="To"   type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)} />
      </Filters>

      <div className="rounded-xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {loading ? <Spinner /> : transfers.length === 0 ? (
          <Empty icon={ArrowRight} msg="No transfers found." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <Th>Customer</Th>
                  <Th>Created By</Th>
                  <Th>Assigned Closer</Th>
                  <Th>Company</Th>
                  <Th>Transfer Status</Th>
                  <Th>Sale Status</Th>
                  <Th>Date</Th>
                </tr>
              </thead>
              <tbody>
                {transfers.map(t => (
                  <tr key={t.id} className="cursor-pointer"
                    style={{ borderBottom: '1px solid var(--color-border)' }}
                    onClick={() => setDetail(t)}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <td className="px-4 py-3">
                      <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{customerName(t)}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                        {t.form_data?.Phone || t.form_data?.customer_phone || ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {t.created_by_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {t.assigned_closer_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {t.company_name || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {(() => { const ds = getTransferDisplayStatus(t); return <Badge variant={ds.variant} size="sm">{ds.label}</Badge>; })()}
                    </td>
                    <td className="px-4 py-3">
                      {t.sale_status
                        ? (
                          <div>
                            <Badge variant={SALE_BADGE_MAP[t.sale_status] || 'secondary'} size="sm">
                              {SALE_LABEL_MAP[t.sale_status] || t.sale_status}
                            </Badge>
                            {t.sale_status === 'needs_revision' && t.sale_compliance_note && (
                              <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: 'var(--color-error-600)' }}>
                                <AlertTriangle size={10} />{t.sale_compliance_note.slice(0, 40)}{t.sale_compliance_note.length > 40 ? '…' : ''}
                              </p>
                            )}
                          </div>
                        )
                        : <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                      {fmtDate(t.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} limit={LIMIT} onPage={setPage} />
      </div>

      {/* Transfer detail modal */}
      {detail && (
        <Overlay>
          <ModalBox wide>
            <ModalHeader icon={ArrowRight} title="Transfer Record"
              subtitle={customerName(detail)} onClose={() => setDetail(null)} />
            <div className="overflow-y-auto p-6 space-y-5">
              <section>
                <p className="text-xs font-bold uppercase tracking-wide mb-3"
                  style={{ color: 'var(--color-text-secondary)' }}>Trace Info</p>
                <div className="grid grid-cols-2 gap-3">
                  <InfoTile label="Record ID"       value={detail.id} />
                  <InfoTile label="Transfer Status"  value={(() => { const ds = getTransferDisplayStatus(detail); return <Badge variant={ds.variant} size="sm">{ds.label}</Badge>; })()} />
                  {detail.sale_status && (
                    <InfoTile label="Sale Status" value={
                      <div>
                        <Badge variant={SALE_BADGE_MAP[detail.sale_status] || 'secondary'} size="sm">
                          {SALE_LABEL_MAP[detail.sale_status] || detail.sale_status}
                        </Badge>
                        {detail.sale_reference_no && (
                          <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>Ref: {detail.sale_reference_no}</p>
                        )}
                        {detail.sale_status === 'needs_revision' && detail.sale_compliance_note && (
                          <p className="text-xs mt-0.5 flex items-start gap-1" style={{ color: 'var(--color-error-600)' }}>
                            <AlertTriangle size={10} style={{ marginTop: 2, flexShrink: 0 }} />{detail.sale_compliance_note}
                          </p>
                        )}
                      </div>
                    } />
                  )}
                  <InfoTile label="Company"         value={detail.company_name} />
                  <InfoTile label="Created By"      value={detail.created_by_name} />
                  <InfoTile label="Assigned Closer" value={detail.assigned_closer_name} />
                  <InfoTile label="Entered At"      value={fmtDateTime(detail.created_at)} />
                  <InfoTile label="Last Updated"    value={fmtDateTime(detail.updated_at)} />
                </div>
              </section>

              {detail.form_data && Object.keys(detail.form_data).length > 0 && (
                <section>
                  <p className="text-xs font-bold uppercase tracking-wide mb-3"
                    style={{ color: 'var(--color-text-secondary)' }}>Form Fields</p>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(detail.form_data).map(([key, val]) => (
                      <InfoTile key={key} label={key}
                        value={val === null || val === undefined || val === '' ? '—'
                          : typeof val === 'object' ? JSON.stringify(val) : String(val)} />
                    ))}
                  </div>
                </section>
              )}

              {detail.notes && (
                <section>
                  <p className="text-xs font-bold uppercase tracking-wide mb-2"
                    style={{ color: 'var(--color-text-secondary)' }}>Notes</p>
                  <div className="rounded-xl p-4"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                    <p className="text-sm" style={{ color: 'var(--color-text)' }}>{detail.notes}</p>
                  </div>
                </section>
              )}
            </div>
            <div className="px-6 pb-6 pt-3 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
              <button onClick={() => setDetail(null)}
                className="w-full py-2.5 rounded-xl border font-semibold text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                Close
              </button>
            </div>
          </ModalBox>
        </Overlay>
      )}

      {exportOpen && (
        <ExportModal tab="transfers" companyList={companyList}
          onClose={() => setExportOpen(false)} onExport={handleExport} />
      )}
    </div>
  );
};

export default TransfersTab;
