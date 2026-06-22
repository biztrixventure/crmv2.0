import { useState, useCallback, useEffect } from 'react';
import { ArrowRight, AlertTriangle, CalendarDays, X, Copy } from 'lucide-react';
import { getTransferDisplayStatus } from '../../utils/transferStatus';
import { todayET } from '../../utils/timezone';

// Why a transfer is flagged as a duplicate (from transfer_dedup_events.event_type).
const DUP_REASON_LABEL = {
  refresh:      'Re-transferred within the dedup window — it updated the existing lead in place, so no separate transfer row was created. Shown here so the count reconciles with VICIDIAL.',
  reengage:     'Re-engaged after the dedup window (a fresh transfer was created)',
  sale_overlap: 'A completed sale already existed on the prior lead',
};

const SALE_BADGE_MAP  = { open: 'info', pending_review: 'warning', needs_revision: 'error', closed_won: 'success', sold: 'success', closed_lost: 'error', follow_up: 'warning', cancelled: 'error' };
const SALE_LABEL_MAP  = { open: 'Sale Open', pending_review: 'In Review', needs_revision: 'Needs Revision', closed_won: 'Approved', sold: 'Sold', closed_lost: 'Lost', follow_up: 'Follow Up', cancelled: 'Cancelled' };
import { Badge } from '../UI';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'sonner';
import ExportModal from './ExportModal';
import TabStatsStrip from './TabStatsStrip';
import FilterBar from '../UI/FilterBar';
import TransferFormModal from '../Transfers/TransferFormModal';
import { useFormFields } from '../../hooks/useFormFields';
import {
  STATUS_BADGE, STATUS_LABEL, TRANSFER_STATUSES, LIMIT,
  fmtDate, fmtDateTime, customerName, downloadCSV,
  TabHeader, Spinner, Empty, Pagination, Th, SortTh, Filters, FInput, FSelect,
  Overlay, ModalBox, ModalHeader, InfoTile,
} from './shared';

const TransfersTab = ({ companyList, initCompany = '', initStatus = '' }) => {
  const { user } = useAuth();
  const isSuper      = user?.role === 'superadmin';
  const isCompliance = user?.role === 'compliance_manager';
  const canReject    = isSuper || isCompliance;
  const [mgBusy, setMgBusy] = useState(false);
  const [mgStatus, setMgStatus] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [editOpen,    setEditOpen]    = useState(false);

  // Form-fields catalog for the edit modal. Fetched once when the tab mounts;
  // the same catalog the fronter uses, since compliance is editing the same
  // schema. fieldsLoading is forwarded to the modal so its initial paint
  // shows a spinner instead of an empty form.
  const { fields, fetchFields, loading: fieldsLoading } = useFormFields();
  useEffect(() => { fetchFields(); }, [fetchFields]);
  const [transfers, setTransfers] = useState([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [page, setPage]           = useState(1);
  const [status, setStatus]       = useState(initStatus);
  const [company, setCompany]     = useState(initCompany);
  // Free-text search box (parity with SalesTab + CallbacksTab). Server-side
  // search hits customer name + phone + reference fields inside form_data,
  // same shape the closer-side phone search uses.
  const [search, setSearch]       = useState('');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');
  const [sort, setSort]           = useState({ col: 'created_at', dir: 'desc' });

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
          search: search.trim() || undefined,
          date_from: dateFrom || undefined, date_to: dateTo || undefined,
          sort_by: sort.col, sort_dir: sort.dir,
          page, limit: LIMIT,
        },
      });
      setTransfers(res.data.transfers || []);
      setTotal(res.data.total || 0);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [status, company, search, dateFrom, dateTo, page, sort]);

  useEffect(() => { load(); }, [load]);

  // Server-side sort across the whole dataset; reset to page 1 on sort change.
  const toggleSort = (col) => {
    setPage(1);
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  };

  // Superadmin cross-company management (backend allows superadmin to bypass scope).
  useEffect(() => { setMgStatus(detail?.status || ''); }, [detail]);
  const doDeleteTransfer = async () => {
    if (!detail || !window.confirm('Delete this transfer? Any linked sale is removed too (cascade). This cannot be undone.')) return;
    setMgBusy(true);
    try { await client.delete(`transfers/${detail.id}`); toast.success('Transfer deleted'); setDetail(null); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Delete failed'); }
    finally { setMgBusy(false); }
  };
  const doUpdateTransferStatus = async () => {
    if (!detail || !mgStatus || mgStatus === detail.status) return;
    setMgBusy(true);
    try { await client.put(`transfers/${detail.id}`, { status: mgStatus }); toast.success('Transfer status updated'); setDetail(null); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Update failed'); }
    finally { setMgBusy(false); }
  };

  // Compliance + superadmin can reject a transfer with a written reason.
  // Backend (transfers.js POST /:id/reject) routes the notification to the
  // fronter exactly like a closer-side reject, so the user gets the same
  // alert path no matter who rejected it.
  // Compliance edit — dispatches PUT /transfers/:id with the edited form_data
  // and a reason. Backend (transfers.js MANAGER_ROLES) now includes
  // compliance_manager, so this is accepted without elevated guards. Audit
  // log entry on the transfer carries the reason for compliance review.
  const doEditTransfer = async (payload) => {
    if (!detail) return;
    await client.put(`transfers/${detail.id}`, payload);
    toast.success('Transfer updated');
    setEditOpen(false);
    setDetail(null);
    load();
  };

  const doRejectTransfer = async () => {
    if (!detail || !rejectReason.trim()) return;
    setMgBusy(true);
    try {
      await client.post(`transfers/${detail.id}/reject`, { reason: rejectReason.trim() });
      toast.success('Transfer rejected — fronter notified');
      setRejectOpen(false); setRejectReason(''); setDetail(null); load();
    } catch (e) { toast.error(e.response?.data?.error || 'Reject failed'); }
    finally { setMgBusy(false); }
  };

  const handleExport = async ({ dateFrom: df, dateTo: dt, company: co, userIds }) => {
    const res = await client.get('compliance/transfers', {
      params: { date_from: df || undefined, date_to: dt || undefined, company_id: co || undefined, user_ids: userIds.length ? userIds.join(',') : undefined, limit: 5000, page: 1 },
    });
    const all = res.data.transfers || [];
    const dupCount = all.filter(t => t.is_duplicate).length;
    const rows = all.map(t => [
      customerName(t), t.form_data?.Phone || '',
      t.created_by_name || '', t.assigned_closer_name || '',
      t.latest_disposition?.disposition_name || '',
      t.company_name || '', STATUS_LABEL[t.status] || t.status || '',
      fmtDate(t.created_at),
      t.is_duplicate ? 'Yes' : 'No',
      t.is_duplicate ? (DUP_REASON_LABEL[t.duplicate_reason] || t.duplicate_reason || '') : '',
    ]);
    // Trailing summary row so the duplicate count travels with the export.
    rows.push([]);
    rows.push([`Total transfers: ${all.length}`, '', '', '', '', '', '', '', `Duplicates: ${dupCount}`, '']);
    downloadCSV(rows, ['Customer','Phone','Fronter','Closer','Disposition','Company','Status','Created','Is Duplicate','Duplicate Reason'],
      `transfers_${todayET()}.csv`);
  };

  return (
    <div>
      <TabHeader
        title="All Transfers"
        subtitle={isSuper ? 'Lead transfers across all companies — open a record to edit status or delete' : 'Read-only view of lead transfers across all companies'}
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

      <FilterBar
        search={{
          value: search,
          onChange: (v) => { setSearch(v); setPage(1); },
          placeholder: 'Search name / phone / reference…',
        }}
        dateRange={{
          value: { date_from: dateFrom, date_to: dateTo },
          onChange: (r) => { setDateFrom(r.date_from || ''); setDateTo(r.date_to || ''); setPage(1); },
          defaultPreset: 'all',
        }}
        extras={
          <>
            <select value={company} onChange={e => { setCompany(e.target.value); setPage(1); }}
              className="input text-sm py-1.5" style={{ minWidth: 160 }}>
              <option value="">All companies</option>
              {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}
              className="input text-sm py-1.5" style={{ minWidth: 160 }}>
              <option value="">All statuses</option>
              {TRANSFER_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
            </select>
          </>
        }
        onClearAll={() => {
          setSearch(''); setCompany(''); setStatus('');
          setDateFrom(''); setDateTo(''); setPage(1);
        }}
      />

      {/* Stats strip — total matches + per-status breakdown of the page. */}
      <TabStatsStrip total={total} records={transfers} />

      <div className="rounded-xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {loading ? <Spinner /> : transfers.length === 0 ? (
          <Empty icon={ArrowRight} msg="No transfers found." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <SortTh col="customer"   sort={sort} onSort={toggleSort}>Customer</SortTh>
                  <SortTh col="fronter"    sort={sort} onSort={toggleSort}>Fronter</SortTh>
                  <SortTh col="closer"     sort={sort} onSort={toggleSort}>Closer</SortTh>
                  <Th>Disposition</Th>
                  <Th>Company</Th>
                  <SortTh col="status"     sort={sort} onSort={toggleSort}>Transfer Status</SortTh>
                  <Th>Sale Status</Th>
                  <SortTh col="created_at" sort={sort} onSort={toggleSort}>Date</SortTh>
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
                      {t.is_duplicate && (
                        <button onClick={e => { e.stopPropagation(); setDetail(t); }}
                          title={t.duplicate_reason === 'refresh'
                            ? 'Duplicate VICIDIAL transfer that refreshed an existing lead in place — click for history'
                            : 'Created as a duplicate — click to see its full history'}
                          className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full transition-colors"
                          style={{ backgroundColor: '#fef3c7', color: '#b45309', border: '1px solid #fcd34d' }}>
                          <Copy size={10} /> {t.duplicate_reason === 'refresh' ? 'Duplicate · in-place' : 'Duplicate Transfer'}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {t.created_by_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {t.assigned_closer_name || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {t.latest_disposition?.disposition_name ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ backgroundColor: `${t.latest_disposition.color || '#6b7280'}22`, color: t.latest_disposition.color || '#6b7280' }}
                          title={[t.latest_disposition.setter_name && `By ${t.latest_disposition.setter_name}`, t.latest_disposition.note].filter(Boolean).join(' — ')}>
                          {t.latest_disposition.disposition_name}
                        </span>
                      ) : <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
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
                  <InfoTile label="Company" value={detail.company_name} />
                  <InfoTile label="Fronter" value={detail.created_by_name} />
                  <InfoTile label="Closer"  value={detail.assigned_closer_name} />
                  {detail.latest_disposition?.disposition_name && (
                    <InfoTile label="Disposition" value={
                      <div>
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ backgroundColor: `${detail.latest_disposition.color || '#6b7280'}22`, color: detail.latest_disposition.color || '#6b7280' }}>
                          {detail.latest_disposition.disposition_name}
                        </span>
                        {detail.latest_disposition.setter_name && (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>By {detail.latest_disposition.setter_name}</p>
                        )}
                        {detail.latest_disposition.note && (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{detail.latest_disposition.note}</p>
                        )}
                      </div>
                    } />
                  )}
                  <InfoTile label="Entered At"      value={fmtDateTime(detail.created_at)} />
                  <InfoTile label="Last Updated"    value={fmtDateTime(detail.updated_at)} />
                </div>
              </section>

              {/* Duplicate origin / history — only for transfers created as a duplicate. */}
              {detail.is_duplicate && (
                <section>
                  <p className="text-xs font-bold uppercase tracking-wide mb-2 flex items-center gap-1.5"
                    style={{ color: '#b45309' }}>
                    <Copy size={12} /> Duplicate transfer — history
                  </p>
                  <div className="rounded-xl p-4 space-y-1.5 text-sm"
                    style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', color: 'var(--color-text)' }}>
                    <p><span className="font-semibold">Why flagged:</span> {DUP_REASON_LABEL[detail.duplicate_reason] || detail.duplicate_reason || 'Duplicate of an existing lead'}</p>
                    {detail.duplicate_detected_at && (
                      <p><span className="font-semibold">Detected:</span> {fmtDateTime(detail.duplicate_detected_at)}</p>
                    )}
                    {detail.original_transfer && (
                      <p>
                        <span className="font-semibold">Original transfer:</span>{' '}
                        {detail.original_transfer.created_at
                          ? <>created {fmtDate(detail.original_transfer.created_at)}
                              {detail.original_transfer.created_by_name ? ` by ${detail.original_transfer.created_by_name}` : ''}
                              {detail.original_transfer.status ? ` · status ${detail.original_transfer.status}` : ''}</>
                          : `#${String(detail.original_transfer.id || '').slice(0, 8)}`}
                      </p>
                    )}
                    <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                      This entry stays in the transfers list so the count reflects every transfer attempt entered — real and duplicate — and reconciles 1:1 with VICIDIAL.
                    </p>
                  </div>
                </section>
              )}

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
            <div className="px-6 pb-6 pt-3 flex-shrink-0 space-y-3" style={{ borderTop: '1px solid var(--color-border)' }}>
              {/* Compliance + superadmin can edit form_data directly. Backend
                  records the supplied reason on the transfer's edit_history
                  audit blob so the review trail stays intact. */}
              {canReject && detail.record_type !== 'duplicate_refresh' && (
                <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-primary-50, #eef2ff)', border: '1px solid var(--color-primary-200, #c7d2fe)' }}>
                  <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-primary-700)' }}>Compliance — edit transfer</p>
                  <button onClick={() => setEditOpen(true)} disabled={mgBusy || fieldsLoading}
                    className="px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50"
                    style={{ background: 'var(--gradient-sidebar)' }}>
                    Edit lead fields…
                  </button>
                </div>
              )}
              {/* Compliance + superadmin can reject the transfer with a reason.
                  Backend route routes the notification through the same path
                  a closer-side reject uses, so the fronter sees one bell. */}
              {canReject && detail.record_type !== 'duplicate_refresh' && detail.status !== 'rejected' && detail.status !== 'cancelled' && (
                <div className="rounded-xl p-3" style={{ backgroundColor: '#fff5f5', border: '1px solid #fecaca' }}>
                  <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: '#b91c1c' }}>Compliance — reject transfer</p>
                  {!rejectOpen ? (
                    <button onClick={() => setRejectOpen(true)} disabled={mgBusy}
                      className="px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
                      style={{ color: '#dc2626', backgroundColor: 'rgba(220,38,38,0.08)' }}>
                      Reject this transfer…
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                        placeholder="Reason for rejection (fronter will see this)…"
                        rows={3} className="input text-sm w-full resize-none" />
                      <div className="flex items-center gap-2">
                        <button onClick={doRejectTransfer} disabled={mgBusy || !rejectReason.trim()}
                          className="px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50"
                          style={{ background: 'linear-gradient(135deg,#dc2626,#991b1b)' }}>
                          {mgBusy ? 'Rejecting…' : 'Submit rejection'}
                        </button>
                        <button onClick={() => { setRejectOpen(false); setRejectReason(''); }}
                          disabled={mgBusy} className="px-3 py-2 rounded-lg text-sm font-bold border"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {isSuper && detail.record_type !== 'duplicate_refresh' && (
                <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                  <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-primary-700)' }}>Superadmin — manage (any company)</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select value={mgStatus} onChange={e => setMgStatus(e.target.value)} className="input text-sm" style={{ height: 36, maxWidth: 200 }}>
                      {TRANSFER_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
                    </select>
                    <button onClick={doUpdateTransferStatus} disabled={mgBusy || mgStatus === detail.status}
                      className="px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)' }}>
                      Save status
                    </button>
                    <button onClick={doDeleteTransfer} disabled={mgBusy}
                      className="px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-50 ml-auto" style={{ color: '#dc2626', backgroundColor: 'rgba(220,38,38,0.08)' }}>
                      Delete transfer
                    </button>
                  </div>
                </div>
              )}
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

      {/* Compliance edit modal — reuses TransferFormModal in edit mode.
          Closer dropdown is hidden, reason textarea is shown, submit
          dispatches PUT instead of POST. */}
      {editOpen && detail && (
        <TransferFormModal
          isOpen={editOpen}
          onClose={() => setEditOpen(false)}
          user={user}
          fields={fields}
          fieldsLoading={fieldsLoading}
          existingTransfer={detail}
          reasonRequired
          onSubmit={doEditTransfer}
        />
      )}
    </div>
  );
};

export default TransfersTab;
