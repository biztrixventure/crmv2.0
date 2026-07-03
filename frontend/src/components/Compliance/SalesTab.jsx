import { useState, useCallback, useEffect, useRef, Fragment } from 'react';
import { useFocus } from '../../contexts/FocusContext';
import { Shield, RotateCcw, Trash2, Eye, ChevronDown, ChevronUp, CheckCircle } from 'lucide-react';
import { Badge } from '../UI';
import SaleStatusBadge from '../UI/SaleStatusBadge';
import { toast } from 'sonner';
import client from '../../api/client';
import SaleDetailDrawer from '../Shared/SaleDetailDrawer';
import SaleModal from '../Closer/SaleModal';
import ExportModal from './ExportModal';
import FilterBar from '../UI/FilterBar';
import DateRangePicker from '../UI/DateRangePicker';
import TabStatsStrip from './TabStatsStrip';
import { prettyDispo } from '../../utils/dispositions';
import { fmtSaleDate } from '../../utils/timezone';
import { useAuth } from '../../contexts/AuthContext';
import { useComplianceStatuses } from '../../hooks/useComplianceStatuses';
import { useCancellationReasons } from '../../hooks/useCancellationReasons';
import {
  STATUS_BADGE, STATUS_LABEL, ALL_SALE_STATUSES as FALLBACK_ALL, COMPLIANCE_EDIT_STATUSES as FALLBACK_EDIT, LIMIT,
  fmtDate, closerName, downloadCSV,
  TabHeader, Spinner, Empty, Pagination, Th, SortTh, Filters, FInput, FSelect,
  Overlay, ModalBox, ModalHeader, fetchAllForExport,
} from './shared';

const SalesTab = ({ companyList, initCompany = '', initStatus = '', disposition = '', isPostDate = false }) => {
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
  const [statusCounts, setStatusCounts] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  const [status, setStatus]     = useState(initStatus);
  const [company, setCompany]   = useState(initCompany);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [expanded, setExpanded] = useState(null);
  const [sort, setSort]         = useState({ col: 'created_at', dir: 'desc' });

  const [approving, setApproving]   = useState(null);
  const [detailSale, setDetailSale] = useState(null);

  // Notification deep-link → scroll + highlight the matching sale row 5s.
  const { focus } = useFocus();
  const focusRef = useRef(null);
  const focusedId = focus?.kind === 'sale' ? focus.id : null;
  useEffect(() => {
    if (focusedId && focusRef.current) {
      try { focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* noop */ }
    }
  }, [focusedId, sales]);
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
  // Post Date tab — charge-date window filter + in-flight charge action.
  const [chargeFrom, setChargeFrom] = useState('');
  const [chargeTo, setChargeTo]     = useState('');
  const [charging, setCharging]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('compliance/sales', {
        params: {
          search: search || undefined, status: status || undefined,
          company_id: company || undefined,
          disposition: disposition || undefined,
          // All Sales (no disposition) hides un-charged post-date sales — they
          // belong only to the Post Date tab until "Charge → Sale" is clicked.
          exclude_post_date: disposition ? undefined : 1,
          charge_from: chargeFrom || undefined, charge_to: chargeTo || undefined,
          date_from: dateFrom || undefined, date_to: dateTo || undefined,
          sort_by: sort.col, sort_dir: sort.dir,
          page, limit: LIMIT,
        },
      });
      setSales(res.data.sales || []);
      setTotal(res.data.total || 0);
      // Keep page-1 totals across pages; clear when a status filter is active
      // (then the page-derived breakdown — the one filtered status — is correct).
      setStatusCounts(prev => status ? null : (res.data.status_counts ?? prev));
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [search, status, company, disposition, chargeFrom, chargeTo, dateFrom, dateTo, page, sort]);

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

  // Charge a post-dated sale → flip disposition to "sale" so it leaves this tab,
  // then submit it to review so it appears — approvable — in All Sales (mirrors
  // the closer-side Charge button). Approve is NOT shown in the Post Date tab.
  const chargeSale = async (s) => {
    setCharging(s.id);
    try {
      await client.put(`sales/${s.id}`, { closer_disposition: 'sale', charge_at: null });
      try { await client.post(`sales/${s.id}/submit-review`); } catch { /* already in review */ }
      setSales(list => list.filter(x => x.id !== s.id));
      load();
    } catch { /* user retries */ } finally { setCharging(null); }
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
      await client.put(`sales/${editFieldsTarget.id}`, payload);
      setEditFieldsTarget(null);
      toast.success('Sale updated');
      load();   // refetch from the server so the row reflects the saved values
    } catch (err) {
      // Previously this had no catch — a rejected save looked like "nothing
      // happened". Surface the real reason so compliance knows what to fix.
      toast.error(err.response?.data?.error || 'Failed to save changes');
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
    // Export mirrors the active tab: a disposition tab exports its own
    // disposition; All Sales excludes un-charged post-date sales. Fetches ALL
    // matching rows (paged), not just the first 5,000.
    const allSales = await fetchAllForExport('compliance/sales',
      { disposition: disposition || undefined, exclude_post_date: disposition ? undefined : 1,
        date_from: df || undefined, date_to: dt || undefined, company_id: co || undefined, user_ids: userIds.length ? userIds.join(',') : undefined },
      'sales');
    const rows = allSales.map(s => [
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
        title={disposition ? prettyDispo(disposition) : 'All Sales'}
        subtitle={disposition
          ? (isPostDate
              ? 'Post-dated sales awaiting their charge date. Charge one to move it to All Sales.'
              : `Sales with the “${prettyDispo(disposition)}” disposition, across all companies.`)
          : 'Closer sales across all companies — full management access'}
        onRefresh={() => { setPage(1); load(); }}
        onExport={() => setExportOpen(true)}
      />

      <FilterBar
        search={{
          value: search,
          onChange: (v) => { setSearch(v); setPage(1); },
          placeholder: 'Search anything — record id, any field…',
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
              {ALL_SALE_STATUSES.map(s => <option key={s} value={s}>{labelOf(s)}</option>)}
            </select>
            {isPostDate && (
              <span className="inline-flex items-center gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Charge:</span>
                <DateRangePicker
                  allowFuture
                  value={{ date_from: chargeFrom ? chargeFrom.slice(0, 10) : '', date_to: chargeTo ? chargeTo.slice(0, 10) : '' }}
                  defaultPreset="all"
                  onChange={(r) => {
                    setChargeFrom(r.date_from ? `${r.date_from}T00:00:00` : '');
                    setChargeTo(r.date_to ? `${r.date_to}T23:59:59` : '');
                    setPage(1);
                  }}
                  onClear={() => { setChargeFrom(''); setChargeTo(''); setPage(1); }}
                />
              </span>
            )}
          </>
        }
        onClearAll={() => {
          setSearch(''); setCompany(''); setStatus('');
          setDateFrom(''); setDateTo(''); setChargeFrom(''); setChargeTo(''); setPage(1);
        }}
      />

      {/* Stats strip — total matches + per-status breakdown of the page.
          Catalog-driven labels + badges via the compliance hook. */}
      <TabStatsStrip
        total={total}
        records={sales}
        statusTotals={statusCounts}
        activeStatus={status}
        onSelectStatus={(s) => { setStatus(s); setPage(1); }}
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
                  <SortTh col="sale_date" sort={sort} onSort={toggleSort}>Sale Date</SortTh>
                  {isPostDate && <Th>Charge Date</Th>}
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {sales.map(s => {
                  const focused = focusedId && String(focusedId) === String(s.id);
                  return (
                  <Fragment key={s.id}>
                    <tr className="cursor-pointer"
                      ref={focused ? focusRef : null}
                      style={{ borderBottom: '1px solid var(--color-border)',
                        backgroundColor: focused ? 'var(--color-primary-50, #eef2ff)' : 'transparent',
                        boxShadow: focused ? 'inset 3px 0 0 var(--color-primary-500, #6366f1)' : 'none',
                        transition: 'background-color 0.3s' }}
                      onClick={() => setDetailSale(s)}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = focused ? 'var(--color-primary-50, #eef2ff)' : 'var(--color-bg-secondary)'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = focused ? 'var(--color-primary-50, #eef2ff)' : 'transparent'}>
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
                          {s.group_count > 1 && (
                            <span title="Multi-vehicle bundle — this row is one car of one deal"
                              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap"
                              style={{ backgroundColor: '#d1fae5', color: '#065f46' }}>
                              {s.group_count}-car deal
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
                      {isPostDate && (
                        <td className="px-4 py-3 text-xs font-semibold" style={{ color: s.charge_at ? '#b45309' : 'var(--color-text-tertiary)' }}>
                          {s.charge_at ? new Date(s.charge_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
                        </td>
                      )}
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {isPostDate && !isReadOnly && (
                            <button onClick={() => chargeSale(s)} disabled={charging === s.id}
                              title="Charge the card and move this to All Sales for approval"
                              className="px-2.5 py-1 rounded-lg text-xs font-bold text-white disabled:opacity-60 hover:opacity-90"
                              style={{ background: 'var(--gradient-sidebar)' }}>
                              {charging === s.id ? '…' : 'Charge → Sale'}
                            </button>
                          )}
                          {/* Approve / Return / Update are hidden in the Post Date tab —
                              a post-dated sale isn't reviewed until it's charged and lands
                              in All Sales. */}
                          {!isPostDate && (s.status === 'pending_review' ? (
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
                          ))}
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
                        <td colSpan={isPostDate ? 8 : 7} className="px-5 py-3">
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
                  </Fragment>
                  );
                })}
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
