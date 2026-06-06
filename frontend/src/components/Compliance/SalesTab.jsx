import { useState, useCallback, useEffect } from 'react';
import { Shield, RotateCcw, Trash2, Eye, ChevronDown, ChevronUp, CheckCircle } from 'lucide-react';
import { Badge } from '../UI';
import SaleStatusBadge from '../UI/SaleStatusBadge';
import client from '../../api/client';
import SaleDetailDrawer from '../Shared/SaleDetailDrawer';
import SaleModal from '../Closer/SaleModal';
import ExportModal from './ExportModal';
import TabStatsStrip from './TabStatsStrip';
import { fmtSaleDate } from '../../utils/timezone';
import { useAuth } from '../../contexts/AuthContext';
import { useComplianceStatuses } from '../../hooks/useComplianceStatuses';
import { useCancellationReasons } from '../../hooks/useCancellationReasons';
import {
  STATUS_BADGE, STATUS_LABEL, ALL_SALE_STATUSES as FALLBACK_ALL, COMPLIANCE_EDIT_STATUSES as FALLBACK_EDIT, LIMIT,
  fmtDate, closerName, downloadCSV,
  TabHeader, Spinner, Empty, Pagination, Th, SortTh, Filters, FInput, FSelect,
  Overlay, ModalBox, ModalHeader,
} from './shared';

const SalesTab = ({ companyList, initCompany = '' }) => {
  const { user, isReadOnly } = useAuth();
  // Config-driven status catalog — SuperAdmin → Business Rules → Compliance
  // Workflow drives the dropdowns, labels, and badge colors. labelOf/badgeOf
  // gracefully fall back to a humanized key / 'secondary' so existing records
  // with legacy statuses always render correctly.
  const { allStatuses: cfgAll, editStatuses: cfgEdit, labelOf, badgeOf } = useComplianceStatuses();
  const { activeReasons: cancelReasonChoices } = useCancellationReasons();
  const ALL_SALE_STATUSES        = cfgAll?.length  ? cfgAll  : FALLBACK_ALL;
  const COMPLIANCE_EDIT_STATUSES = cfgEdit?.length ? cfgEdit : FALLBACK_EDIT;
  const [sales, setSales]       = useState([]);
  // Full form-field edit target for compliance — opens SaleModal pre-filled
  // and dispatches PUT /sales/:id on submit. Separate from the existing
  // status-only edit modal (editTarget) which only changes status + reason.
  const [editFieldsTarget, setEditFieldsTarget] = useState(null);
  const [editFieldsSaving, setEditFieldsSaving] = useState(false);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  const [status, setStatus]     = useState('');
  const [company, setCompany]   = useState(initCompany);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [expanded, setExpanded] = useState(null);
  const [sort, setSort]         = useState({ col: 'created_at', dir: 'desc' });

  const [approving, setApproving]   = useState(null);
  const [detailSale, setDetailSale] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);

  // Return modal
  const [returnTarget, setReturnTarget] = useState(null);
  const [returnNote, setReturnNote]     = useState('');
  const [returning, setReturning]       = useState(false);
  const [returnMsg, setReturnMsg]       = useState('');

  // Edit modal
  const [editTarget, setEditTarget] = useState(null);
  const [editStatus, setEditStatus] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editReasonKey, setEditReasonKey] = useState('');
  const [editCancelDate, setEditCancelDate] = useState('');
  const [editChargebackAmt, setEditChargebackAmt] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg, setEditMsg]       = useState('');
  // Cancel-like statuses gate the cancellation_date field. Keeps the rule
  // identical to the bulk endpoint so single + bulk flows behave the same.
  const CANCEL_LIKE = new Set(['cancelled', 'compliance_cancelled', 'closed_lost', 'chargeback', 'dispute']);
  const isCancelLikeStatus = CANCEL_LIKE.has(editStatus);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting]         = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('compliance/sales', {
        params: {
          search: search || undefined, status: status || undefined,
          company_id: company || undefined,
          date_from: dateFrom || undefined, date_to: dateTo || undefined,
          sort_by: sort.col, sort_dir: sort.dir,
          page, limit: LIMIT,
        },
      });
      setSales(res.data.sales || []);
      setTotal(res.data.total || 0);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [search, status, company, dateFrom, dateTo, page, sort]);

  useEffect(() => { load(); }, [load]);

  // Server-side sort across the whole dataset; reset to page 1 on sort change.
  const toggleSort = (col) => {
    setPage(1);
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  };

  const approve = async (sale) => {
    setApproving(sale.id);
    try {
      const r = await client.post(`sales/${sale.id}/compliance-approve`);
      // Instant feedback: flip the row to its new status (badge + Approve→Update), then resync.
      const updated = r.data?.sale;
      if (updated) setSales(list => list.map(x => x.id === sale.id ? { ...x, ...updated } : x));
      load();
    } catch { /* user retries */ } finally { setApproving(null); }
  };

  const openReturn = (s) => { setReturnTarget(s); setReturnNote(''); setReturnMsg(''); };
  const doReturn = async () => {
    if (!returnNote.trim()) { setReturnMsg('Note required.'); return; }
    setReturning(true);
    try {
      await client.post(`sales/${returnTarget.id}/compliance-return`, { note: returnNote });
      setReturnTarget(null); load();
    } catch (err) { setReturnMsg(err.response?.data?.error || 'Failed'); }
    finally { setReturning(false); }
  };

  const openEdit = (s) => {
    setEditTarget(s);
    setEditStatus(s.status);
    setEditReason('');
    setEditReasonKey(s.cancellation_reason_key || '');
    setEditCancelDate(s.cancellation_date || '');
    setEditChargebackAmt(s.chargeback_amount || '');
    setEditMsg('');
  };

  // Direct field-level edit for compliance. SaleForm produces a full payload
  // matching the closer flow; we forward it to PUT /sales/:id (backend
  // already lets compliance_manager through, see sales.js line 472).
  const doEditFields = async (payload) => {
    if (!editFieldsTarget) return;
    setEditFieldsSaving(true);
    try {
      const res = await client.put(`sales/${editFieldsTarget.id}`, payload);
      const updated = res?.data?.sale || res?.data?.data || res?.data;
      if (updated) setSales(list => list.map(x => x.id === editFieldsTarget.id ? { ...x, ...updated } : x));
      setEditFieldsTarget(null);
    } finally { setEditFieldsSaving(false); }
  };
  const doEdit = async () => {
    if (!editReason.trim()) { setEditMsg('Reason required.'); return; }
    if (isCancelLikeStatus && !editCancelDate) {
      setEditMsg('Cancellation date is required for this status.'); return;
    }
    // G28 — frontend mirror of the server-side requirement so the
    // operator sees the gate immediately instead of round-tripping.
    if (isCancelLikeStatus && !editReasonKey) {
      setEditMsg('Pick a canonical Reason from the dropdown.'); return;
    }
    setEditSaving(true);
    try {
      await client.post(`sales/${editTarget.id}/compliance`, {
        status: editStatus,
        reason: editReason,
        // Always send cancellation_date so a non-cancel status with a
        // previously-set date can clear it ("" → null on the server).
        cancellation_date: editCancelDate || null,
        cancellation_reason_key: editReasonKey || null,
        chargeback_amount: editStatus === 'chargeback' ? (editChargebackAmt || null) : undefined,
        chargeback_date:   editStatus === 'chargeback' ? (editCancelDate || null) : undefined,
      });
      setEditTarget(null); load();
    } catch (err) { setEditMsg(err.response?.data?.error || 'Failed'); }
    finally { setEditSaving(false); }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try { await client.delete(`sales/${deleteTarget.id}`); setDeleteTarget(null); load(); }
    catch { /* user retries */ } finally { setDeleting(false); }
  };

  const handleExport = async ({ dateFrom: df, dateTo: dt, company: co, userIds }) => {
    const res = await client.get('compliance/sales', {
      params: { date_from: df || undefined, date_to: dt || undefined, company_id: co || undefined, user_ids: userIds.length ? userIds.join(',') : undefined, limit: 5000, page: 1 },
    });
    const rows = (res.data.sales || []).map(s => [
      s.customer_name || '', s.customer_phone || '', s.customer_email || '',
      s.reference_no || '', labelOf(s.status) || '',
      s.fronter_name || '', closerName(s), s.companies?.name || '', s.sale_date ? fmtSaleDate(s.sale_date) : fmtDate(s.created_at),
    ]);
    downloadCSV(rows, ['Customer','Phone','Email','Reference','Status','Fronter','Closer','Company','Sale Date'],
      `sales_${new Date().toISOString().split('T')[0]}.csv`);
  };

  return (
    <div>
      <TabHeader
        title="All Sales"
        subtitle="Closer sales across all companies — full management access"
        onRefresh={() => { setPage(1); load(); }}
        onExport={() => setExportOpen(true)}
      />

      <Filters onSubmit={() => { setPage(1); load(); }}>
        <div className="relative flex-1" style={{ minWidth: 200 }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, phone, reference…" className="input text-sm w-full" />
        </div>
        <FSelect label="Company" value={company} onChange={e => setCompany(e.target.value)}>
          <option value="">All companies</option>
          {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FSelect>
        <FSelect label="Status" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {ALL_SALE_STATUSES.map(s => <option key={s} value={s}>{labelOf(s)}</option>)}
        </FSelect>
        <FInput label="From" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <FInput label="To"   type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)} />
      </Filters>

      {/* Stats strip — total matches + per-status breakdown of the page.
          Catalog-driven labels + badges via the compliance hook. */}
      <TabStatsStrip
        total={total}
        records={sales}
        labelOf={labelOf}
        badgeOf={(key) => {
          // Map the catalog badge variant to bg/color the strip expects.
          const variant = badgeOf(key);
          const VAR = {
            success:   { bg: '#d1fae5', color: '#047857' },
            error:     { bg: '#fee2e2', color: '#b91c1c' },
            warning:   { bg: '#fef3c7', color: '#b45309' },
            info:      { bg: '#dbeafe', color: '#1d4ed8' },
            secondary: { bg: '#f3f4f6', color: '#6b7280' },
          };
          return { ...(VAR[variant] || VAR.secondary), label: labelOf(key) };
        }}
      />

      <div className="rounded-xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {loading ? <Spinner /> : sales.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <SortTh col="customer"   sort={sort} onSort={toggleSort}>Customer</SortTh>
                  <SortTh col="status"     sort={sort} onSort={toggleSort}>Status</SortTh>
                  <SortTh col="fronter"    sort={sort} onSort={toggleSort}>Fronter</SortTh>
                  <SortTh col="closer"     sort={sort} onSort={toggleSort}>Closer</SortTh>
                  <Th>Company</Th>
                  <SortTh col="created_at" sort={sort} onSort={toggleSort}>Date</SortTh>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {sales.map(s => (
                  <>
                    <tr key={s.id} className="cursor-pointer"
                      style={{ borderBottom: '1px solid var(--color-border)' }}
                      onClick={() => setDetailSale(s)}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                      <td className="px-4 py-3">
                        <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{s.customer_name || '—'}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{s.customer_phone || ''}</p>
                        {s.reference_no && (
                          <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>#{s.reference_no}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <SaleStatusBadge sale={s} size="sm" />
                          {s.is_resell && (
                            <span title={`Resell · ${s.resell_intent || ''}`}
                              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap"
                              style={{ backgroundColor: '#ddd6fe', color: '#5b21b6' }}>
                              ↻ {(s.resell_intent || 'resell').replace(/_/g, ' ')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{s.fronter_name || '—'}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{closerName(s)}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{s.companies?.name || '—'}</td>
                      {/* Show the actual sale_date the closer entered (carries through
                          bulk uploads) instead of the upload moment. Falls back to
                          created_at on legacy rows where sale_date wasn't captured. */}
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{s.sale_date ? fmtSaleDate(s.sale_date) : fmtDate(s.created_at)}</td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {s.status === 'pending_review' ? (
                            !isReadOnly && (
                              <>
                                <button onClick={() => approve(s)} disabled={approving === s.id}
                                  className="px-2.5 py-1 rounded-lg text-xs font-bold text-white disabled:opacity-60 hover:opacity-90"
                                  style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}>
                                  {approving === s.id ? '…' : 'Approve'}
                                </button>
                                <button onClick={() => openReturn(s)}
                                  className="px-2.5 py-1 rounded-lg text-xs font-bold hover:opacity-90"
                                  style={{ color: '#d97706', border: '1px solid #fbbf24', backgroundColor: '#fffbeb' }}>
                                  Return
                                </button>
                              </>
                            )
                          ) : (
                            !isReadOnly && (
                              <button onClick={() => openEdit(s)}
                                className="px-2.5 py-1 rounded-lg text-xs font-bold text-white hover:opacity-90"
                                style={{ background: 'var(--gradient-sidebar)' }}>
                                Update
                              </button>
                            )
                          )}
                          {Array.isArray(s.edit_history) && s.edit_history.length > 0 && (
                            <button onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                              className="p-1 rounded" style={{ color: 'var(--color-text-secondary)' }}>
                              {expanded === s.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
                          )}
                          {/* Compliance field-level edit — opens SaleModal pre-filled.
                              Lives next to View so it's discoverable without
                              cluttering the workflow buttons (Approve/Return/Update). */}
                          {!isReadOnly && (
                            <button onClick={() => setEditFieldsTarget(s)} className="px-2 py-1 rounded-lg text-xs font-bold"
                              style={{ color: 'var(--color-primary-700)', backgroundColor: 'var(--color-primary-50, #eef2ff)' }}>
                              Edit
                            </button>
                          )}
                          <button onClick={() => setDetailSale(s)} className="p-1 rounded"
                            style={{ color: 'var(--color-primary-600)' }}>
                            <Eye size={14} />
                          </button>
                          {!isReadOnly && (
                            <button onClick={() => setDeleteTarget(s)} className="p-1 rounded"
                              style={{ color: '#ef4444' }}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded === s.id && Array.isArray(s.edit_history) && (
                      <tr key={`${s.id}-hist`} style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                        <td colSpan={7} className="px-5 py-3">
                          <p className="text-xs font-bold mb-2" style={{ color: 'var(--color-text-secondary)' }}>Audit Trail</p>
                          <div className="space-y-1">
                            {s.edit_history.map((h, i) => (
                              <div key={i} className="text-xs flex gap-3">
                                <span style={{ color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                                  {new Date(h.edited_at).toLocaleString()}
                                </span>
                                {h.previous_status && (
                                  <span style={{ color: 'var(--color-text-secondary)' }}>
                                    {h.previous_status} → {h.new_status || h.action}
                                  </span>
                                )}
                                {(h.reason || h.note) && (
                                  <span className="italic" style={{ color: 'var(--color-text)' }}>"{h.reason || h.note}"</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} limit={LIMIT} onPage={setPage} />
      </div>

      {/* Return modal */}
      {returnTarget && (
        <Overlay>
          <ModalBox>
            <ModalHeader icon={RotateCcw} title="Return to Closer"
              subtitle={`${returnTarget.customer_name} · Ref: ${returnTarget.reference_no || '—'}`}
              onClose={() => setReturnTarget(null)} />
            <div className="p-6 space-y-3">
              <textarea value={returnNote} onChange={e => setReturnNote(e.target.value)}
                placeholder="Explain what needs to be corrected…"
                rows={4} className="input text-sm w-full" autoFocus maxLength={2000} />
              <div className="flex justify-between">
                {returnMsg ? <p className="text-xs text-red-500">{returnMsg}</p> : <span />}
                <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{returnNote.length}/2000</span>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setReturnTarget(null)}
                  className="flex-1 py-2.5 rounded-xl border font-semibold text-sm"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
                <button onClick={doReturn} disabled={returning}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#d97706,#b45309)' }}>
                  {returning ? 'Returning…' : 'Return'}
                </button>
              </div>
            </div>
          </ModalBox>
        </Overlay>
      )}

      {/* Edit modal */}
      {editTarget && (
        <Overlay>
          <ModalBox>
            <ModalHeader icon={Shield} title="Compliance Update"
              subtitle={`${editTarget.customer_name} · Ref: ${editTarget.reference_no || '—'}`}
              onClose={() => setEditTarget(null)} />
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>New Status</label>
                <select value={editStatus} onChange={e => setEditStatus(e.target.value)} className="input text-sm w-full">
                  {COMPLIANCE_EDIT_STATUSES.map(s => <option key={s} value={s}>{labelOf(s)}</option>)}
                </select>
              </div>
              {/* Cancellation date — surfaces only when the picked status is
                  cancel-like (cancelled / compliance_cancelled / closed_lost /
                  chargeback / dispute). Same rule + key as the bulk
                  endpoint so single + bulk flows stay aligned. */}
              {isCancelLikeStatus && (
                <>
                  <div>
                    <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
                      Cancellation Date <span className="text-red-500">*</span>
                    </label>
                    <input type="date" value={editCancelDate}
                      onChange={e => setEditCancelDate(e.target.value)}
                      className="input text-sm w-full"
                      style={{
                        borderColor: !editCancelDate ? 'var(--color-error-300, #fca5a5)' : 'var(--color-border)',
                      }} />
                    <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      Business date the cancellation took effect. Drives monthly cancel reports.
                      {editTarget?.cancellation_date && !editCancelDate && ` Previously: ${editTarget.cancellation_date}.`}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
                      Reason (catalog)
                    </label>
                    <select value={editReasonKey}
                      onChange={e => setEditReasonKey(e.target.value)}
                      className="input text-sm w-full">
                      <option value="">— pick a canonical reason —</option>
                      {cancelReasonChoices.map(r => (
                        <option key={r.key} value={r.key}>{r.label}</option>
                      ))}
                    </select>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      Optional canonical key for top-reason reports. Free-text reason below still appended to the compliance note.
                    </p>
                  </div>
                  {editStatus === 'chargeback' && (
                    <div>
                      <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
                        Chargeback Amount (USD)
                      </label>
                      <input type="number" step="0.01" min="0" value={editChargebackAmt}
                        onChange={e => setEditChargebackAmt(e.target.value)}
                        className="input text-sm w-full"
                        placeholder="e.g. 1250.00" />
                      <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                        Money charged back. Used in net-revenue + chargeback-rate reports.
                      </p>
                    </div>
                  )}
                </>
              )}
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
                  Reason <span className="text-red-500">*</span>
                </label>
                <textarea value={editReason} onChange={e => setEditReason(e.target.value)}
                  placeholder="Explain the reason for this update…"
                  rows={3} className="input text-sm w-full" />
              </div>
              {editMsg && <p className="text-xs text-red-500">{editMsg}</p>}
              <div className="flex gap-3">
                <button onClick={() => setEditTarget(null)}
                  className="flex-1 py-2.5 rounded-xl border font-semibold text-sm"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
                <button onClick={doEdit} disabled={editSaving}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white disabled:opacity-50"
                  style={{ background: 'var(--gradient-sidebar)' }}>
                  {editSaving ? 'Saving…' : 'Save Update'}
                </button>
              </div>
            </div>
          </ModalBox>
        </Overlay>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <Overlay>
          <ModalBox>
            <div className="p-6 text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4 mx-auto"
                style={{ backgroundColor: '#fee2e2' }}>
                <Trash2 size={22} style={{ color: '#dc2626' }} />
              </div>
              <p className="text-base font-bold mb-2" style={{ color: 'var(--color-text)' }}>Delete Sale?</p>
              <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                {deleteTarget.customer_name} · {deleteTarget.reference_no || '—'}. Cannot be undone.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteTarget(null)}
                  className="flex-1 py-2.5 rounded-xl border font-semibold text-sm"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
                <button onClick={doDelete} disabled={deleting}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)' }}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </ModalBox>
        </Overlay>
      )}

      <SaleDetailDrawer sale={detailSale} onClose={() => setDetailSale(null)} />
      {exportOpen && (
        <ExportModal tab="sales" companyList={companyList}
          onClose={() => setExportOpen(false)} onExport={handleExport} />
      )}

      {/* Compliance field-level edit — SaleModal in update mode. */}
      <SaleModal
        isOpen={!!editFieldsTarget}
        onClose={() => setEditFieldsTarget(null)}
        user={user}
        existingSale={editFieldsTarget}
        onSubmit={doEditFields}
        isLoading={editFieldsSaving}
      />
    </div>
  );
};

export default SalesTab;
